/**
 * MedTrack – Complete Backend Server (PostgreSQL / Render)
 */

const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const session  = require('express-session');
const cors     = require('cors');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'medtrack-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const q = (text, params) => db.query(text, params);

async function initDB() {
  await q(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(25) NOT NULL,
    age INT NOT NULL,
    role VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    blood_group VARCHAR(5) DEFAULT NULL,
    address TEXT DEFAULT NULL,
    emergency_contact_name VARCHAR(150) DEFAULT NULL,
    emergency_contact_phone VARCHAR(25) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS medications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    frequency VARCHAR(100) NOT NULL,
    time_of_day VARCHAR(150) NOT NULL,
    with_food BOOLEAN DEFAULT FALSE,
    start_date DATE NOT NULL,
    end_date DATE DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS medication_logs (
    id SERIAL PRIMARY KEY,
    medication_id INT NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'taken',
    taken_at TIMESTAMP DEFAULT NOW(),
    notes TEXT DEFAULT NULL
  )`);

  await q(`CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id INT DEFAULT NULL REFERENCES medications(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    remind_at TIME NOT NULL,
    days_of_week VARCHAR(50) DEFAULT '1,2,3,4,5,6,7',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS prescriptions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doctor_name VARCHAR(200) DEFAULT NULL,
    issued_date DATE NOT NULL,
    notes TEXT DEFAULT NULL,
    file_name VARCHAR(300) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  await q(`CREATE TABLE IF NOT EXISTS drug_interactions (
    id SERIAL PRIMARY KEY,
    drug_a VARCHAR(200) NOT NULL,
    drug_b VARCHAR(200) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    description TEXT NOT NULL
  )`);

  const { rows: existing } = await q('SELECT COUNT(*) AS c FROM drug_interactions');
  if (parseInt(existing[0].c) === 0) {
    const interactions = [
      ['Warfarin','Aspirin','moderate','Increased bleeding risk. Monitor INR closely and watch for signs of bleeding.'],
      ['Metformin','Alcohol','moderate','Risk of lactic acidosis. Avoid heavy alcohol use while on Metformin.'],
      ['Amlodipine','Simvastatin','moderate','Amlodipine may increase Simvastatin levels, raising muscle damage risk.'],
      ['Aspirin','Ibuprofen','moderate','Concurrent use may reduce the cardioprotective effect of Aspirin.'],
      ['Metformin','Contrast dye','severe','Stop Metformin before iodinated contrast procedures – risk of acute kidney injury.'],
      ['Warfarin','Ibuprofen','severe','Significant increase in bleeding risk. Avoid combination.'],
      ['Lisinopril','Potassium','moderate','ACE inhibitors raise potassium; supplements may cause hyperkalemia.'],
      ['Atorvastatin','Clarithromycin','severe','Clarithromycin inhibits statin metabolism – risk of myopathy/rhabdomyolysis.']
    ];
    for (const [a, b, s, d] of interactions)
      await q('INSERT INTO drug_interactions (drug_a,drug_b,severity,description) VALUES ($1,$2,$3,$4)', [a,b,s,d]);
  }

  await q(`CREATE TABLE IF NOT EXISTS emergency_requests (
    id SERIAL PRIMARY KEY,
    user_id INT DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
    request_type VARCHAR(20) DEFAULT 'ambulance',
    location_lat DECIMAL(10,8) DEFAULT NULL,
    location_lng DECIMAL(11,8) DEFAULT NULL,
    address TEXT DEFAULT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    hospital_name VARCHAR(200) DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  console.log('✅ PostgreSQL connected & tables ready');
}

initDB().catch(e => console.error('❌ DB init failed:', e.message));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
};

// ── AUTH ──────────────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { first_name, last_name, email, phone, age, role, password } = req.body;
  if (!first_name || !last_name || !email || !phone || !age || !role || !password)
    return res.status(400).json({ error: 'All fields are required.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const { rows: existing } = await q('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.length)
      return res.status(409).json({ error: 'account_exists', message: '⚠️ An account with this email already exists. Please sign in.' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await q(
      'INSERT INTO users (first_name,last_name,email,phone,age,role,password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [first_name, last_name, email, phone, age, role, hash]
    );
    req.session.userId = rows[0].id;
    req.session.userName = first_name;
    res.json({ success: true, message: `🎉 Welcome to MedTrack, ${first_name}!`, userId: rows[0].id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });
  try {
    const { rows } = await q('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'No account found with this email.' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    req.session.userId = user.id;
    req.session.userName = user.first_name;
    res.json({ success: true, message: `Welcome back, ${user.first_name}!`,
      user: { id: user.id, name: `${user.first_name} ${user.last_name}`, email: user.email, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Server error.' }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(
      'SELECT id,first_name,last_name,email,phone,age,role,blood_group,address,emergency_contact_name,emergency_contact_phone,created_at FROM users WHERE id=$1',
      [req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/profile', requireAuth, async (req, res) => {
  const { blood_group, address, emergency_contact_name, emergency_contact_phone } = req.body;
  try {
    await q('UPDATE users SET blood_group=$1,address=$2,emergency_contact_name=$3,emergency_contact_phone=$4,updated_at=NOW() WHERE id=$5',
      [blood_group||null, address||null, emergency_contact_name||null, emergency_contact_phone||null, req.session.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 8)
    return res.status(400).json({ error: 'Invalid input.' });
  try {
    const { rows } = await q('SELECT password_hash FROM users WHERE id=$1', [req.session.userId]);
    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(new_password, 10);
    await q('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [hash, req.session.userId]);
    res.json({ success: true, message: 'Password updated.' });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── MEDICATIONS ───────────────────────────────────────────────────────────────
app.get('/api/medications', requireAuth, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM medications WHERE user_id=$1 AND is_active=TRUE ORDER BY created_at DESC', [req.session.userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/medications', requireAuth, async (req, res) => {
  const { name, dosage, frequency, time_of_day, with_food, start_date, end_date, notes } = req.body;
  if (!name || !dosage || !time_of_day || !start_date)
    return res.status(400).json({ error: 'Name, dosage, time, and start date are required.' });
  try {
    const { rows } = await q(
      'INSERT INTO medications (user_id,name,dosage,frequency,time_of_day,with_food,start_date,end_date,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [req.session.userId, name, dosage, frequency||'Once daily', time_of_day, !!with_food, start_date, end_date||null, notes||null]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/medications/:id', requireAuth, async (req, res) => {
  try {
    await q('UPDATE medications SET is_active=FALSE WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/medications/:id/log', requireAuth, async (req, res) => {
  const { status } = req.body;
  try {
    await q('INSERT INTO medication_logs (medication_id,user_id,status) VALUES ($1,$2,$3)',
      [req.params.id, req.session.userId, status||'taken']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/medications/stats', requireAuth, async (req, res) => {
  try {
    const { rows: total }  = await q('SELECT COUNT(*) AS c FROM medications WHERE user_id=$1 AND is_active=TRUE', [req.session.userId]);
    const { rows: taken }  = await q("SELECT COUNT(*) AS c FROM medication_logs WHERE user_id=$1 AND status='taken' AND EXTRACT(MONTH FROM taken_at)=EXTRACT(MONTH FROM NOW())", [req.session.userId]);
    const { rows: missed } = await q("SELECT COUNT(*) AS c FROM medication_logs WHERE user_id=$1 AND status='missed' AND EXTRACT(MONTH FROM taken_at)=EXTRACT(MONTH FROM NOW())", [req.session.userId]);
    const t = parseInt(taken[0].c) + parseInt(missed[0].c);
    const adherence = t > 0 ? Math.round((parseInt(taken[0].c) / t) * 100) : 0;
    res.json({ activeMeds: parseInt(total[0].c), takenThisMonth: parseInt(taken[0].c), adherence });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── REMINDERS ─────────────────────────────────────────────────────────────────
app.get('/api/reminders', requireAuth, async (req, res) => {
  try {
    const { rows } = await q(
      'SELECT r.*,m.name AS med_name FROM reminders r LEFT JOIN medications m ON r.medication_id=m.id WHERE r.user_id=$1 ORDER BY r.remind_at',
      [req.session.userId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/reminders', requireAuth, async (req, res) => {
  const { medication_id, title, remind_at, days_of_week } = req.body;
  if (!title || !remind_at) return res.status(400).json({ error: 'Title and time required.' });
  try {
    const { rows } = await q(
      'INSERT INTO reminders (user_id,medication_id,title,remind_at,days_of_week) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.session.userId, medication_id||null, title, remind_at, days_of_week||'1,2,3,4,5,6,7']
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/reminders/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM reminders WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/reminders/:id/toggle', requireAuth, async (req, res) => {
  try {
    await q('UPDATE reminders SET is_active=NOT is_active WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── PRESCRIPTIONS ─────────────────────────────────────────────────────────────
app.get('/api/prescriptions', requireAuth, async (req, res) => {
  try {
    const { rows } = await q('SELECT * FROM prescriptions WHERE user_id=$1 ORDER BY issued_date DESC', [req.session.userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/prescriptions', requireAuth, async (req, res) => {
  const { doctor_name, issued_date, notes, file_name } = req.body;
  if (!issued_date) return res.status(400).json({ error: 'Issued date required.' });
  try {
    const { rows } = await q(
      'INSERT INTO prescriptions (user_id,doctor_name,issued_date,notes,file_name) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.session.userId, doctor_name||null, issued_date, notes||null, file_name||null]
    );
    res.json({ success: true, id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/prescriptions/:id', requireAuth, async (req, res) => {
  try {
    await q('DELETE FROM prescriptions WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── DRUG INTERACTIONS ─────────────────────────────────────────────────────────
app.post('/api/interactions/check', requireAuth, async (req, res) => {
  try {
    const { rows: meds } = await q('SELECT name FROM medications WHERE user_id=$1 AND is_active=TRUE', [req.session.userId]);
    const names = meds.map(m => m.name.toLowerCase());
    const { rows: all } = await q('SELECT * FROM drug_interactions');
    const found = all.filter(i =>
      names.some(n => n.includes(i.drug_a.toLowerCase())) &&
      names.some(n => n.includes(i.drug_b.toLowerCase()))
    );
    res.json({ interactions: found, medicationNames: meds.map(m => m.name) });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/interactions/manual', async (req, res) => {
  const { drugs } = req.body;
  if (!drugs || !drugs.length) return res.json({ interactions: [] });
  try {
    const { rows: all } = await q('SELECT * FROM drug_interactions');
    const lower = drugs.map(d => d.toLowerCase());
    const found = all.filter(i =>
      lower.some(n => n.includes(i.drug_a.toLowerCase())) &&
      lower.some(n => n.includes(i.drug_b.toLowerCase()))
    );
    res.json({ interactions: found });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── REPORTS ───────────────────────────────────────────────────────────────────
app.get('/api/reports/adherence', requireAuth, async (req, res) => {
  try {
    const { rows: logs } = await q(
      `SELECT DATE(taken_at) AS day, status, COUNT(*) AS cnt
       FROM medication_logs
       WHERE user_id=$1 AND taken_at >= NOW() - INTERVAL '30 days'
       GROUP BY day, status ORDER BY day`,
      [req.session.userId]
    );
    const { rows: meds } = await q('SELECT id,name,dosage,frequency FROM medications WHERE user_id=$1 AND is_active=TRUE', [req.session.userId]);
    res.json({ logs, medications: meds });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── EMERGENCY ─────────────────────────────────────────────────────────────────
app.post('/api/emergency', async (req, res) => {
  const { request_type, location_lat, location_lng, address, notes } = req.body;
  try {
    const userId = req.session.userId || null;
    const { rows } = await q(
      'INSERT INTO emergency_requests (user_id,request_type,location_lat,location_lng,address,notes,hospital_name,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [userId, request_type||'ambulance', location_lat||null, location_lng||null, address||null, notes||null, 'Ruby Hall Clinic, Pune', 'dispatched']
    );
    res.json({ success: true, requestId: rows[0].id, message: '🚨 Emergency alert sent! Ambulance dispatched.',
      estimatedTime: '8–12 minutes', hospital: 'Ruby Hall Clinic, Pune', contactNumber: '108' });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── Pages ─────────────────────────────────────────────────────────────────────
const pages = ['','login','register','dashboard','emergency','profile','medications','reminders','prescriptions','interactions','reports'];
pages.forEach(p => {
  app.get(p ? `/${p}` : '/', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', p ? `${p}.html` : 'index.html'))
  );
});

app.listen(PORT, () => console.log(`\n🚀  MedTrack running → http://localhost:${PORT}\n`));
