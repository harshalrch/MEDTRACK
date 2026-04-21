/* Shared sidebar + nav helper – included on every app page */
function renderSidebar(activePage) {
  const items = [
    { href:'/dashboard',      ic:'🏠', label:'Dashboard'     },
    { href:'/medications',    ic:'💊', label:'Medications'   },
    { href:'/reminders',      ic:'⏰', label:'Reminders'     },
    { href:'/prescriptions',  ic:'📋', label:'Prescriptions' },
    { href:'/interactions',   ic:'⚠️', label:'Interactions'  },
    { href:'/reports',        ic:'📊', label:'Reports'       },
  ];
  return `
    <div class="sidebar">
      <div class="sb-logo"><div class="sb-icon">💊</div>Med<span>Track</span></div>
      <a href="/emergency" class="sb-sos">🚨 Emergency SOS</a>
      <div class="sb-section">Main</div>
      ${items.map(i=>`<a class="sb-item${activePage===i.href?' active':''}" href="${i.href}"><span class="ic">${i.ic}</span>${i.label}</a>`).join('')}
      <div class="sb-section">Account</div>
      <a class="sb-item${activePage==='/profile'?' active':''}" href="/profile"><span class="ic">👤</span>Profile</a>
      <div class="sb-bottom">
        <button class="sb-logout" onclick="doLogout()">🚪 Sign Out</button>
      </div>
    </div>`;
}
async function doLogout(){
  try{await fetch('/api/logout',{method:'POST',credentials:'include'});}catch(e){}
  window.location.href='/';
}
