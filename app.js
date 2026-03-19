// ═══════════════════════════════════════════════════════════════════════════
// CORE UTILS & STATE — must be declared first
// ═══════════════════════════════════════════════════════════════════════════
const $  = (s,c=document) => c.querySelector(s);
const $$ = (s,c=document) => [...c.querySelectorAll(s)];

const state = {
  currentView:    'dashboard',
  scheduleDate:   new Date().toISOString().split('T')[0],
  calMonth:       new Date(),
  activeList:     null,
  weekView:       false,
  selectedPatient:null,
  dragApptId:     null,
  providers:      [],
  operatories:    [],
  pinboardItems:  [],
  ctxMenu:        null,
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTH & RBAC
// ═══════════════════════════════════════════════════════════════════════════
let currentUser = null;

function isAdmin()       { return currentUser?.role === 'admin'; }
function hasFullAccess() { return currentUser?.role === 'admin' || currentUser?.full_access === 1; }
function myProvider()    { return currentUser?.provider_name || null; }

function quickLogin(u, p) {
  document.getElementById('login-username').value = u;
  document.getElementById('login-password').value = p;
  document.getElementById('login-form').dispatchEvent(new Event('submit'));
}
function togglePassword() {
  const inp = document.getElementById('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}


// ── Connection mode indicator ─────────────────────────────────────
async function initConnectionStatus() {
  const badge = document.getElementById('conn-badge');
  const wrap  = document.getElementById('connection-status');
  if (!badge || !wrap) return;

  if (typeof window.__clientConfig !== 'undefined') {
    // Client mode — show server URL and test connection
    wrap.style.display = 'block';
    const url = window.__clientConfig.serverUrl;
    badge.style.background = 'rgba(14,165,233,.15)';
    badge.style.color = 'var(--sky2)';
    badge.textContent = '🌐 ' + url.replace('http://','');
    // Test connection
    try {
      const r = await fetch(url + '/health');
      const d = await r.json();
      if (d.ok) {
        badge.style.background = 'rgba(34,197,94,.15)';
        badge.style.color = '#4ade80';
        badge.textContent = '🟢 Server: ' + url.replace('http://','');
      }
    } catch(e) {
      badge.style.background = 'rgba(239,68,68,.15)';
      badge.style.color = '#f87171';
      badge.textContent = '🔴 No connection';
      badge.title = 'Cannot reach ' + url;
    }
  } else {
    // Local/server mode
    wrap.style.display = 'block';
    badge.style.background = 'rgba(15,41,66,.3)';
    badge.style.color = 'rgba(255,255,255,.5)';
    badge.textContent = '🖥️ Local Server';
  }
}

async function tryLogin(username, password) {
  let user = null;

  // Try DB login first
  try {
    user = await window.api.users.login({ username, password });
  } catch(e) {
    console.warn('DB login failed, using fallback:', e);
  }

  // Fallback to hardcoded credentials if DB not ready
  if (!user) {
    const FALLBACK = [
      { id:1, username:'admin',      password:'password123', role:'admin',  provider_name:'Dr. Smith',    full_access:1, provider:{name:'Dr. Smith',   color:'#2563eb'} },
      { id:2, username:'drjohnson',  password:'password123', role:'doctor', provider_name:'Dr. Johnson',  full_access:0, provider:{name:'Dr. Johnson', color:'#16a34a'} },
      { id:3, username:'drwilliams', password:'password123', role:'doctor', provider_name:'Dr. Williams', full_access:0, provider:{name:'Dr. Williams',color:'#9333ea'} },
      { id:4, username:'sarah',      password:'password123', role:'doctor', provider_name:'Sarah H.',     full_access:0, provider:{name:'Sarah H.',    color:'#0891b2'} },
      { id:5, username:'mike',       password:'password123', role:'doctor', provider_name:'Mike H.',      full_access:0, provider:{name:'Mike H.',     color:'#d97706'} },
    ];
    const found = FALLBACK.find(u => u.username === username && u.password === password);
    if (found) user = found;
  }

  if (!user) return false;

  currentUser = user;
  applyRoleUI();
  const overlay = document.getElementById('login-overlay');
  overlay.classList.add('hidden'); overlay.style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  $('[data-view="dashboard"]')?.classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-dashboard')?.classList.add('active');
  state.currentView = 'dashboard';
  updateNavCounts();
  initConnectionStatus();
  renderView('dashboard').catch(err => console.error('Login render error:', err));
  return true;
}

function applyRoleUI() {
  const prov = currentUser.provider;
  const av = document.getElementById('sidebar-avatar');
  const nm = document.getElementById('sidebar-name');
  const rl = document.getElementById('sidebar-role');

  // Avatar initials + color
  if (av) {
    const parts = (currentUser.provider_name || currentUser.username).split(' ');
    av.textContent = ((parts[0]||'')[0]||'').toUpperCase() + ((parts[1]||'')[0]||'').toUpperCase();
    av.style.background = prov?.color || 'var(--navy2)';
  }

  // Name
  if (nm) nm.textContent = currentUser.provider_name || currentUser.username;

  // Role badge
  if (rl) {
    if (isAdmin()) {
      rl.innerHTML = `<span class="role-badge role-admin">Administrator</span>`;
    } else if (hasFullAccess()) {
      rl.innerHTML = `<span class="role-badge role-full">Full Access</span>`;
    } else {
      rl.innerHTML = `<span class="role-badge role-restricted">Restricted</span>`;
    }
  }

  // Show reconfigure button for admins
  const reconfigBtn = document.getElementById('btn-reconfigure');
  if (reconfigBtn) reconfigBtn.style.display = isAdmin() ? 'block' : 'none';
}

function reconfigure() {
  if (!confirm('This will close the app and reopen the setup wizard.\n\nYou can switch between Server and Client mode.\n\nContinue?')) return;
  if (window.electronAPI?.reconfigure) {
    window.electronAPI.reconfigure();
  } else {
    alert('Please delete the config file and restart:\n\nWindows: %APPDATA%\\dental-pro\\dental-config.json\nMac: ~/Library/Application Support/dental-pro/dental-config.json');
  }
}

function logout() {
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  const overlay = document.getElementById('login-overlay');
  overlay.classList.remove('hidden'); overlay.style.display = 'flex';
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
}

document.getElementById('login-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  const btn = document.querySelector('.login-btn');
  if (!u || !p) { err.textContent = 'Please fill in all fields.'; return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try {
    const ok = await tryLogin(u, p);
    if (!ok) {
      err.textContent = 'Incorrect username or password.';
      document.getElementById('login-password').value = '';
      document.getElementById('login-password').focus();
    }
  } catch(e2) {
    console.error('Login error:', e2);
    err.textContent = 'Login error — check console. Try restarting the app.';
  } finally {
    btn.textContent = 'Sign In'; btn.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILS (continued)
// ═══════════════════════════════════════════════════════════════════════════
const timeToMins  = t => { if(!t) return 0; const[h,m]=t.split(':').map(Number); return h*60+m; };
const minsToTime  = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const formatDate  = d => { if(!d) return '—'; return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
const formatCurrency = v => '$'+(parseFloat(v)||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const initials    = (f,l) => ((f||'')[0]||'').toUpperCase()+((l||'')[0]||'').toUpperCase();
const age         = dob => { if(!dob) return ''; return Math.floor((Date.now()-new Date(dob))/(365.25*86400000)); };
const debounce    = (fn,d) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),d); }; };

function statusBadge(s) {
  const m = { 'Scheduled':'badge-sky','Confirmed':'badge-green','Arrived':'badge-cyan','In Chair':'badge-purple','Completed':'badge-gray','Cancelled':'badge-red','No Show':'badge-red','Broken':'badge-red','Treatment Planned':'badge-amber','In Progress':'badge-sky','Pending':'badge-amber','Paid':'badge-green','Partial':'badge-purple','Overdue':'badge-red' };
  return `<span class="badge ${m[s]||'badge-gray'}">${s}</span>`;
}
function confirmedBadge(c) {
  const m = {'Confirmed':'badge-green','eConfirmed':'badge-cyan','Unconfirmed':'badge-gray','Left Message':'badge-amber'};
  return `<span class="badge ${m[c]||'badge-gray'}">${c||'Unconfirmed'}</span>`;
}

function toast(msg, type='info') {
  const el=document.createElement('div'); el.className=`toast-item ${type}`;
  const icons={'success':'✓','error':'✕','info':'ℹ'};
  el.innerHTML=`<span>${icons[type]||'ℹ'}</span>${msg}`;
  $('#toast').appendChild(el); setTimeout(()=>el.remove(),3200);
}

async function updateNavCounts() {
  try {
    const [patients, stats, providers] = await Promise.all([
      fetchMyPatients(),
      fetchMyStats(),
      window.api.providers.getAll(),
    ]);
    const nc = $('#nc-patients'); if(nc) nc.textContent = patients.length;
    const na = $('#nc-appts');    if(na) na.textContent = stats.todayAppts||0;
    const nb = $('#nc-billing');  if(nb) nb.textContent = stats.pendingBalance > 0 ? '$'+Math.round(stats.pendingBalance/1000)+'k' : '—';
    const nd = $('#nc-doctors');  if(nd) nd.textContent = providers.length;
    if (isAdmin() && window.api.users) {
      try {
        const users = await window.api.users.getAll();
        const nu = $('#nc-users'); if(nu) nu.textContent = users.length;
      } catch(e) {}
    }
  } catch(e) { console.error('updateNavCounts:', e); }
}

// Safe role-aware fetch helpers — fall back to getAll + filter if getByProvider missing
async function fetchMyPatients() {
  const prov = myProvider();
  if (hasFullAccess()) return window.api.patients.getAll();
  if (!prov) return [];

  // Try dedicated IPC first (uses primary_provider only)
  try {
    if (window.api.patients.getByProvider) {
      return await window.api.patients.getByProvider(prov);
    }
  } catch(e) {}

  // Fallback: filter by primary_provider (not transferred away) OR transferred_to this provider
  try {
    const all = await window.api.patients.getAll();
    return all.filter(p =>
      (p.primary_provider === prov && p.status !== 'Transferred') ||
      (p.transferred_to === prov && p.status === 'Transferred')
    );
  } catch(e) { return []; }
}
async function fetchMyAppointments(date) {
  const prov = myProvider();
  if (hasFullAccess()) return window.api.appointments.getByDate(date);
  try {
    if (window.api.appointments.getByProvider) {
      return await window.api.appointments.getByProvider({ date, name: prov });
    }
  } catch(e) {}
  // Fallback: get all and filter
  const all = await window.api.appointments.getByDate(date);
  return all.filter(a => a.provider === prov || a.hygienist === prov);
}

async function fetchMyBilling() {
  const prov = myProvider();
  if (hasFullAccess()) return window.api.billing.getAll();
  try {
    if (window.api.billing.getByProvider) return await window.api.billing.getByProvider(prov);
  } catch(e) {}
  // Fallback: get all and filter client-side
  const all = await window.api.billing.getAll();
  const myPts = await fetchMyPatients();
  const myPtIds = new Set(myPts.map(p => p.id));
  return all.filter(b => myPtIds.has(b.patient_id));
}

async function fetchMyStats() {
  const today = new Date().toISOString().split('T')[0];
  const month = today.substring(0, 7);

  // For restricted users always calculate client-side — backend stats may not filter correctly
  if (!hasFullAccess()) {
    try {
      const [pts, appts, bills] = await Promise.all([
        fetchMyPatients(),
        fetchMyAppointments(today),
        fetchMyBilling(),
      ]);
      return {
        totalPatients:  pts.length,
        todayAppts:     appts.length,
        monthRevenue:   bills.filter(b => b.date && b.date.startsWith(month)).reduce((s,b) => s+(b.paid||0), 0),
        pendingBalance: bills.reduce((s,b) => s+(b.balance||0), 0),
        unscheduled:    appts.filter(a => a.unscheduled).length,
        asap:           appts.filter(a => a.is_asap).length,
        recallDue:      0,
      };
    } catch(e) {
      return {totalPatients:0,todayAppts:0,monthRevenue:0,pendingBalance:0,unscheduled:0,asap:0,recallDue:0};
    }
  }

  // Full access — use backend
  try { return await window.api.stats.dashboard(null); } catch(e) {}
  return {totalPatients:0,todayAppts:0,monthRevenue:0,pendingBalance:0,unscheduled:0,asap:0,recallDue:0};
}
// ═══════════════════════════════════════════════════════════════════════════
function openModal(title, bodyHTML, onOpen) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  $('#modal-overlay').classList.remove('hidden');
  if (onOpen) onOpen($('#modal-body'));
}
function closeModal() { $('#modal-overlay').classList.add('hidden'); }
$('#modal-close').onclick = closeModal;
$('#modal-overlay').onclick = e => { if(e.target===$('#modal-overlay')) closeModal(); };
document.addEventListener('keydown', e => { if(e.key==='Escape'){ hideCtxMenu(); closeModal(); } });

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════
function showCtxMenu(x, y, items) {
  hideCtxMenu();
  const menu = document.createElement('div'); menu.className='ctx-menu'; menu.id='ctx-menu';
  menu.style.cssText=`left:${x}px;top:${y}px`;
  items.forEach(item => {
    if (item==='sep') { const s=document.createElement('div'); s.className='ctx-sep'; menu.appendChild(s); }
    else if (item.header) { const h=document.createElement('div'); h.className='ctx-header'; h.textContent=item.header; menu.appendChild(h); }
    else {
      const b=document.createElement('div'); b.className='ctx-item'+(item.danger?' danger':'');
      b.innerHTML=`${item.icon||''} ${item.label}`;
      b.onclick=()=>{ hideCtxMenu(); item.action(); };
      menu.appendChild(b);
    }
  });
  document.body.appendChild(menu); state.ctxMenu=menu;
  const rect=menu.getBoundingClientRect();
  if(rect.right>window.innerWidth)  menu.style.left=(x-rect.width)+'px';
  if(rect.bottom>window.innerHeight) menu.style.top=(y-rect.height)+'px';
  const bd=$('#ctx-backdrop'); if(bd){bd.classList.add('active');}
}
function hideCtxMenu() {
  if(state.ctxMenu){state.ctxMenu.remove();state.ctxMenu=null;}
  const bd=$('#ctx-backdrop'); if(bd){bd.classList.remove('active');}
}
document.getElementById('ctx-backdrop').onclick = hideCtxMenu;

// Bubble tooltip
let bubbleTimer;
function showBubble(e, appt) {
  hideBubble();
  bubbleTimer = setTimeout(()=>{
    const b=document.createElement('div'); b.className='appt-bubble'; b.id='appt-bubble';
    b.innerHTML=`
      <div class="bubble-name">${appt.patient_name||'—'}</div>
      ${appt.dob?`<div class="bubble-row"><span class="bubble-key">Age</span><span class="bubble-val">${age(appt.dob)} yrs</span></div>`:''}
      <div class="bubble-row"><span class="bubble-key">Time</span><span class="bubble-val">${appt.time} · ${appt.duration}min</span></div>
      <div class="bubble-row"><span class="bubble-key">Type</span><span class="bubble-val">${appt.type||'—'}</span></div>
      <div class="bubble-row"><span class="bubble-key">Provider</span><span class="bubble-val">${appt.provider||'—'}</span></div>
      <div class="bubble-row"><span class="bubble-key">Status</span><span class="bubble-val">${appt.status}</span></div>
      <div class="bubble-row"><span class="bubble-key">Confirmed</span><span class="bubble-val">${appt.confirmed||'—'}</span></div>
      ${appt.insurance?`<div class="bubble-row"><span class="bubble-key">Insurance</span><span class="bubble-val">${appt.insurance}</span></div>`:''}
      ${appt.procedures?`<div class="bubble-row"><span class="bubble-key">Procs</span><span class="bubble-val">${appt.procedures}</span></div>`:''}
      ${appt.allergies&&appt.allergies!=='None'?`<div class="bubble-allergy">⚠ ALLERGY: ${appt.allergies}</div>`:''}
      ${appt.patient_note?`<div style="margin-top:8px;color:#fbbf24;font-size:11px">📝 ${appt.patient_note}</div>`:''}`;
    b.style.cssText=`left:${Math.min(e.clientX+14,window.innerWidth-254)}px;top:${Math.min(e.clientY-10,window.innerHeight-200)}px`;
    document.body.appendChild(b);
  }, 500);
}
function hideBubble() { clearTimeout(bubbleTimer); const b=$('#appt-bubble'); if(b) b.remove(); }

// ═══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════
$$('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const view=btn.dataset.view;
    $$('.nav-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach(v=>v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
    state.currentView=view;
    renderView(view).catch(err=>console.error('renderView error:',err));
  });
});
async function renderView(v) {
  try {
    if(v==='dashboard')         await renderDashboard();
    else if(v==='patients')     await renderPatients();
    else if(v==='appointments') await renderScheduleModule();
    else if(v==='billing')      await renderBilling();
    else if(v==='doctors')      await renderDoctors();
    else if(v==='users')        await renderUsers();
  } catch(err) {
    console.error('renderView failed:', v, err);
  }
}
function switchToView(v) {
  $$('.nav-btn').forEach(b=>b.classList.remove('active'));
  $(`[data-view="${v}"]`)?.classList.add('active');
  $$('.view').forEach(x=>x.classList.remove('active'));
  $(`#view-${v}`)?.classList.add('active');
  state.currentView=v;
  renderView(v).catch(err=>console.error('switchToView error:',err));
}

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════
async function renderDashboard() {
  const prov = myProvider();
  const restricted = !hasFullAccess();
  const today = new Date().toISOString().split('T')[0];

  let stats={totalPatients:0,todayAppts:0,pendingBalance:0,monthRevenue:0,unscheduled:0,asap:0,recallDue:0};
  let appts=[], patients=[];
  try {
    [stats, appts, patients] = await Promise.all([
      fetchMyStats(),
      fetchMyAppointments(today),
      fetchMyPatients(),
    ]);
  } catch(e) { console.error('Dashboard fetch error:', e); }

  const myAppts = restricted
    ? appts.filter(a => a.provider === prov || a.hygienist === prov)
    : appts;

  const el=$('#view-dashboard');
  el.innerHTML=`
    <div class="page-header">
      <div>
        <div class="page-title">Good ${greeting()}, ${currentUser?.provider_name || currentUser?.username || 'Doctor'}</div>
        <div class="page-subtitle">
          ${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
          ${restricted ? `<span class="role-badge role-restricted" style="margin-left:8px">Restricted View</span>` : ''}
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" onclick="switchToView('patients')">View Patients</button>
        <button class="btn btn-primary" onclick="switchToView('appointments')">Open Schedule</button>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card navy">
        <div class="stat-icon navy"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="6" r="3"/><path d="M2 17c0-3.314 2.686-6 6-6"/><circle cx="15" cy="9" r="2.5"/><path d="M11 17c0-2.209 1.791-4 4-4h0"/></svg></div>
        <div class="stat-label">${restricted ? 'My Patients' : 'Total Patients'}</div>
        <div class="stat-value">${stats.totalPatients}</div>
        <div class="stat-sub">${restricted ? 'Assigned to me' : 'Active records'}</div>
      </div>
      <div class="stat-card sky">
        <div class="stat-icon sky"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="14" height="13" rx="2"/><path d="M7 2v3M13 2v3M3 8h14"/></svg></div>
        <div class="stat-label">${restricted ? 'My Appointments Today' : "Today's Appointments"}</div>
        <div class="stat-value">${stats.todayAppts}</div>
        <div class="stat-sub">${stats.asap||0} ASAP · ${stats.unscheduled||0} unscheduled</div>
      </div>
      <div class="stat-card green">
        <div class="stat-icon green"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="5" width="16" height="11" rx="2"/><path d="M2 9h16"/></svg></div>
        <div class="stat-label">${restricted ? 'My Revenue This Month' : 'Month Revenue'}</div>
        <div class="stat-value">${formatCurrency(stats.monthRevenue)}</div>
        <div class="stat-sub">Collected this month</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-icon amber"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 2v10M10 12l4 4M10 12l-4 4"/><circle cx="10" cy="4" r="2"/></svg></div>
        <div class="stat-label">Recall Due (30d)</div>
        <div class="stat-value">${stats.recallDue}</div>
        <div class="stat-sub">${formatCurrency(stats.pendingBalance)} outstanding</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">${restricted ? 'My Schedule Today' : "Today's Schedule"}</div><div class="card-subtitle">${myAppts.length} appointments</div></div>
          <button class="btn btn-ghost btn-sm" onclick="switchToView('appointments')">View all →</button>
        </div>
        ${myAppts.length===0?'<div class="empty-state"><h3>No appointments today</h3></div>':
          myAppts.map(a=>`
            <div class="dash-appt-item" onclick="switchToView('appointments')">
              <div class="da-time">${a.time}</div>
              <div class="da-dot" style="background:${a.op_color||'#8fa3b8'}"></div>
              <div style="flex:1">
                <div class="da-name">${a.patient_name||'—'}</div>
                <div class="da-meta">${a.type||''} · ${a.op_name||''}</div>
              </div>
              ${statusBadge(a.status)}
            </div>`).join('')}
      </div>
      <div class="card">
        <div class="card-header">
          <div><div class="card-title">${restricted ? 'My Patients' : 'Recent Patients'}</div></div>
          <button class="btn btn-ghost btn-sm" onclick="switchToView('patients')">View all →</button>
        </div>
        ${patients.slice(0,7).map(p=>`
          <div class="dash-appt-item" onclick="openPatientDetail(${p.id})">
            <div class="avatar avatar-sm" style="background:${avatarColor(p.first_name)}">${initials(p.first_name,p.last_name)}</div>
            <div style="flex:1">
              <div class="da-name">${p.first_name} ${p.last_name}</div>
              <div class="da-meta">${p.phone||''}</div>
            </div>
            <div class="text-sm text-muted">${p.insurance||''}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function greeting() {
  const h=new Date().getHours();
  return h<12?'morning':h<17?'afternoon':'evening';
}
function avatarColor(name) {
  const colors=['#0f2942','#0369a1','#065f46','#7c2d12','#4c1d95','#831843','#1e3a5f'];
  return colors[(name||'').charCodeAt(0)%colors.length];
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULE MODULE
// ═══════════════════════════════════════════════════════════════════════════
async function renderScheduleModule() {
  state.providers    = await window.api.providers.getAll();
  state.operatories  = await window.api.operatories.getAll();
  state.pinboardItems= await window.api.appointments.getPinboard();
  const [unscheduled,asap,recall]=await Promise.all([
    window.api.appointments.getUnscheduled(),
    window.api.appointments.getASAP(),
    window.api.appointments.getRecallDue(),
  ]);

  const el=$('#view-appointments');
  el.innerHTML=`
    <div class="page-header" style="padding:10px 18px">
      <div class="page-title" style="font-size:16px">Schedule</div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" onclick="showPatAppts()">Pat Appts</button>
        <button class="btn btn-secondary btn-sm" onclick="showMakeRecall()">Make Recall</button>
        <button class="btn btn-secondary btn-sm" onclick="showListsModal()">Lists</button>
        <button class="btn btn-primary btn-sm" onclick="showNewApptModal()">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"/></svg>
          Make Appt
        </button>
      </div>
    </div>
    <div class="appt-layout appt-layout-grid">
      <div class="appt-left">
        <div class="mini-cal" id="mini-cal"></div>
        <div class="appt-lists">
          <div class="lists-label">Appointment Lists</div>
          <button class="list-btn ${state.activeList==='unscheduled'?'active-list':''}" onclick="showListView('unscheduled')">
            <span>Unscheduled</span><span class="list-count ${unscheduled.length>0?'red':''}">${unscheduled.length}</span>
          </button>
          <button class="list-btn ${state.activeList==='asap'?'active-list':''}" onclick="showListView('asap')">
            <span>ASAP List</span><span class="list-count ${asap.length>0?'amber':''}">${asap.length}</span>
          </button>
          <button class="list-btn ${state.activeList==='recall'?'active-list':''}" onclick="showListView('recall')">
            <span>Recall List</span><span class="list-count ${recall.length>0?'amber':''}">${recall.length}</span>
          </button>
        </div>
        <div class="providers-panel">
          <div class="lists-label">Providers
            <span style="font-size:9px;color:var(--text3);font-weight:400;margin-left:4px">live</span>
          </div>
          <div id="sidebar-provider-status">
            ${state.providers.map(p=>`<div class="prov-row"><div class="prov-dot" style="background:${p.color}"></div><span>${p.name}</span><span style="font-size:10px;color:var(--text3);margin-left:auto">${p.is_hygienist?'RDH':p.title}</span></div>`).join('')}
          </div>
        </div>
        <div class="pinboard-panel">
          <div class="pinboard-title">
            <span>Pinboard</span>
            ${state.pinboardItems.length>0?`<button class="btn btn-ghost btn-xs" onclick="clearPinboard()">Clear</button>`:''}
          </div>
          <div id="pinboard-items">
            ${state.pinboardItems.length===0
              ?'<div style="font-size:11px;color:var(--text3);padding:2px 4px 8px">Drag appointments here</div>'
              :state.pinboardItems.map(a=>`
                <div class="pinboard-item" draggable="true" data-appt-id="${a.id}" ondragstart="onPinboardDragStart(event,${a.id})">
                  <div class="pinboard-name">${a.patient_name||'—'}</div>
                  <div class="pinboard-meta">${a.type||''} · ${a.duration}min</div>
                  <div class="pinboard-actions">
                    <button class="btn btn-secondary btn-xs" onclick="scheduleFromPinboard(${a.id})">Schedule</button>
                    <button class="btn btn-ghost btn-xs" onclick="removeFromPinboard(${a.id})">✕</button>
                  </div>
                </div>`).join('')}
          </div>
        </div>
      </div>
      <div class="appt-main" id="appt-main"></div>
      <div class="waiting-room-panel" id="waiting-room-panel">
        <div class="wr-header">
          <div class="wr-title">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="8"/><path d="M10 6v4l2.5 2.5"/></svg>
            Waiting Room
          </div>
          <div id="wr-count" class="wr-count">0</div>
          <button class="btn btn-ghost btn-xs" onclick="refreshWaitingRoom()" title="Refresh">↻</button>
        </div>
        <div class="wr-prefs">
          <span class="wr-pref-label">Alert after</span>
          <input type="number" id="wr-alert-mins" class="wr-mins-input" value="15" min="1" max="60"/>
          <span class="wr-pref-label">min</span>
        </div>
        <div id="wr-list" class="wr-list">
          <div class="wr-empty">No patients waiting</div>
        </div>
      </div>
    </div>`;
  renderMiniCal();
  state.activeList ? await renderListView(state.activeList) : state.weekView ? await renderWeekView() : await renderGrid();
  await refreshWaitingRoom();
  startWaitingRoomRefresh();
}

// ─── GRID ─────────────────────────────────────────────────────────────────
async function renderGrid() {
  state.activeList=null;
  $$('.list-btn').forEach(b=>b.classList.remove('active-list'));

  let appts=[], blockouts=[];
  try {
    [appts, blockouts] = await Promise.all([
      fetchMyAppointments(state.scheduleDate),
      window.api.blockouts.getByDate(state.scheduleDate),
    ]);
  } catch(e) {
    try { appts = await window.api.appointments.getByDate(state.scheduleDate); } catch(e2) {}
    try { blockouts = await window.api.blockouts.getByDate(state.scheduleDate); } catch(e2) {}
  }

  // For restricted doctors, filter to only their appointments
  if (!hasFullAccess() && myProvider()) {
    appts = appts.filter(a => a.provider === myProvider() || a.hygienist === myProvider());
  }
  const ops=state.operatories;
  const isToday=state.scheduleDate===new Date().toISOString().split('T')[0];
  const startHour=7,endHour=22,totalMins=(endHour-startHour)*60,slotH=14;
  const totalH=(totalMins/10)*slotH;

  let timeLabels='';
  for(let h=startHour;h<endHour;h++){
    const label=h===12?'12 PM':h>12?`${h-12} PM`:`${h} AM`;
    timeLabels+=`<div class="time-slot-label" style="height:${slotH*6}px">${label}</div>`;
  }

  const opCols=ops.map(op=>{
    const opAppts=appts.filter(a=>a.operatory_id===op.id);
    const opBlocks=blockouts.filter(b=>b.operatory_id===op.id && b.type!=='Lunch');
    let slots='';
    for(let m=0;m<totalMins;m+=10){
      const isHr=m%60===0&&m>0;
      slots+=`<div class="op-slot${isHr?' hour-start':''}" data-op="${op.id}" data-time="${minsToTime(startHour*60+m)}" onclick="onSlotClick(event,'${op.id}','${minsToTime(startHour*60+m)}')" ondragover="onSlotDragOver(event)" ondrop="onSlotDrop(event,'${op.id}','${minsToTime(startHour*60+m)}')" ondragleave="onSlotDragLeave(event)"></div>`;
    }
    const apptBlocks=opAppts.map(a=>{
      const top=((timeToMins(a.time)-startHour*60)/10)*slotH;
      const height=Math.max((a.duration/10)*slotH,slotH);
      const flags=[]; if(a.is_new_patient)flags.push('NP'); if(a.is_asap)flags.push('ASAP'); if(a.is_hygiene)flags.push('HYG');
      // Light block: tinted bg + colored border
      const bg=hexToRgba(op.color,0.12);
      const borderCol=op.color;
      const textCol=darken(op.color);
      return `<div class="appt-block" style="top:${top}px;height:${height}px;background:${bg};border-left-color:${borderCol};color:${textCol}" data-id="${a.id}" draggable="true"
        ondragstart="onApptDragStart(event,${a.id})" ondragend="onApptDragEnd(event)"
        onclick="event.stopPropagation();showEditApptModal(${a.id})"
        oncontextmenu="event.preventDefault();showApptRightClick(event,${JSON.stringify(a).replace(/"/g,'&quot;')})"
        onmouseenter="showBubble(event,${JSON.stringify(a).replace(/"/g,'&quot;')})" onmouseleave="hideBubble()">
        <div class="appt-inner">
          <div class="appt-block-name">${a.patient_name||'—'}</div>
          ${height>24?`<div class="appt-block-type">${a.type||''}</div>`:''}
          ${height>36?`<div class="appt-block-time">${a.time}</div>`:''}
          ${flags.length&&height>30?`<div class="appt-block-flags">${flags.map(f=>`<span class="appt-flag" style="background:${hexToRgba(borderCol,.2)};color:${textCol}">${f}</span>`).join('')}</div>`:''}
        </div>
      </div>`;
    }).join('');

    const blockoutBlocks=opBlocks.map(b=>{
      const top=((timeToMins(b.start_time)-startHour*60)/10)*slotH;
      const height=((timeToMins(b.end_time)-timeToMins(b.start_time))/10)*slotH;
      return `<div class="blockout-block" style="top:${top}px;height:${height}px;background:${b.color}18;border-color:${b.color};color:${b.color}" oncontextmenu="event.preventDefault();showBlockoutCtx(event,${b.id})" title="${b.type}">${b.type}</div>`;
    }).join('');

    return `<div class="op-col">
      <div class="op-header" style="border-bottom-color:${op.color}" onclick="toast('${op.name} — ${op.default_provider||'No provider'}','info')">
        <div class="op-header-dot" style="background:${op.color}"></div>
        <span>${op.default_provider||op.abbr||op.name}</span>
        ${op.is_hygiene?'<span style="font-size:9px;color:var(--text3)">HYG</span>':''}
      </div>
      <div class="op-body" style="height:${totalH}px" ondragover="event.preventDefault()" ondrop="onBodyDrop(event,'${op.id}')">
        ${slots}${apptBlocks}${blockoutBlocks}
        ${isToday?`<div class="time-line" id="time-line-${op.id}"></div>`:''}
      </div>
    </div>`;
  }).join('');

  const main=$('#appt-main');
  const d=new Date(state.scheduleDate+'T00:00:00');
  main.innerHTML=`
    <div class="appt-toolbar">
      <button class="btn btn-ghost btn-sm" onclick="changeDay(-1)">◀</button>
      <div>
        <div class="appt-toolbar-date">${d.toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric'})}</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="changeDay(1)">▶</button>
      <button class="btn btn-secondary btn-sm" onclick="goToday()">Today</button>
      <div class="toolbar-sep"></div>
      <div class="view-toggle">
        <div class="vtbtn ${!state.weekView?'active':''}" onclick="state.weekView=false;renderGrid()">Day</div>
        <div class="vtbtn ${state.weekView?'active':''}" onclick="state.weekView=true;renderWeekView()">Week</div>
      </div>
      <div class="toolbar-sep"></div>
      <button class="btn btn-secondary btn-sm" onclick="showAddBlockoutModal()">+ Blockout</button>
      <button class="btn btn-secondary btn-sm" onclick="showSearchModal()">🔍 Open Slot</button>
      <div class="toolbar-sep"></div>
      <span style="font-size:12px;color:var(--text3)">${appts.length} appt${appts.length!==1?'s':''}</span>
    </div>
    <div class="schedule-scroll" id="schedule-scroll">
      <div class="schedule-grid">
        <div class="time-col"><div class="time-header"></div>${timeLabels}</div>
        <div class="ops-area">${opCols}</div>
      </div>
    </div>`;
  if(isToday) updateTimeLine();
  const sc=$('#schedule-scroll'); if(sc) sc.scrollTop=((8-startHour)*6)*slotH-10;
  refreshSidebarProviderStatus();
}

async function renderWeekView() {
  const main = $('#appt-main');
  if (!main) return;

  // Get the Monday of the current week
  const base = new Date(state.scheduleDate + 'T00:00:00');
  const dow = base.getDay(); // 0=Sun
  const monday = new Date(base);
  monday.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1));

  // Build 7 dates
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    dates.push(`${y}-${m}-${day}`);
  }

  const todayStr = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  })();

  // Fetch all appointments for the week
  const apptsByDate = {};
  await Promise.all(dates.map(async dt => {
    try {
      const appts = await fetchMyAppointments(dt);
      apptsByDate[dt] = (hasFullAccess() ? appts : appts.filter(a => a.provider === myProvider() || a.hygienist === myProvider()))
        .filter(a => !a.unscheduled && !a.pinboard);
    } catch(e) { apptsByDate[dt] = []; }
  }));

  const weekStart = new Date(monday);
  const weekEnd = new Date(monday); weekEnd.setDate(monday.getDate()+6);
  const fmtRange = `${weekStart.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${weekEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;

  main.innerHTML = `
    <div class="appt-toolbar">
      <button class="btn btn-ghost btn-sm" onclick="weekNavPrev()">◀</button>
      <div><div class="appt-toolbar-date">${fmtRange}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="weekNavNext()">▶</button>
      <button class="btn btn-secondary btn-sm" onclick="goToday()">Today</button>
      <div class="toolbar-sep"></div>
      <div class="view-toggle">
        <div class="vtbtn" onclick="state.weekView=false;renderGrid()">Day</div>
        <div class="vtbtn active">Week</div>
      </div>
      <div class="toolbar-sep"></div>
      <button class="btn btn-secondary btn-sm" onclick="showAddBlockoutModal()">+ Blockout</button>
    </div>
    <div class="week-grid">
      ${dates.map(dt => {
        const d = new Date(dt+'T00:00:00');
        const isToday = dt === todayStr;
        const isSelected = dt === state.scheduleDate;
        const dayAppts = apptsByDate[dt] || [];
        const dayName = d.toLocaleDateString('en-US',{weekday:'short'});
        const dayNum  = d.getDate();
        return `
          <div class="week-day ${isToday?'week-day-today':''} ${isSelected?'week-day-selected':''}">
            <div class="week-day-header" onclick="state.weekView=false;state.scheduleDate='${dt}';renderGrid()">
              <span class="week-day-name">${dayName}</span>
              <span class="week-day-num ${isToday?'week-today-num':''}">${dayNum}</span>
              <span class="week-day-count">${dayAppts.length} appt${dayAppts.length!==1?'s':''}</span>
            </div>
            <div class="week-day-appts">
              ${dayAppts.length === 0
                ? '<div class="week-empty">—</div>'
                : dayAppts.map(a => `
                    <div class="week-appt" style="border-left:3px solid ${a.op_color||'var(--sky2)'};background:${a.op_color||'var(--sky2)'}18"
                         onclick="state.weekView=false;state.scheduleDate='${dt}';renderGrid()">
                      <div class="week-appt-time">${a.time}</div>
                      <div class="week-appt-name">${a.patient_name||'—'}</div>
                      <div class="week-appt-type">${a.type||''}</div>
                      ${a.status==='In Chair'?'<span class="badge badge-red" style="font-size:9px">In Chair</span>':
                        a.status==='Completed'?'<span class="badge badge-green" style="font-size:9px">Done</span>':''}
                    </div>`).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function weekNavPrev() {
  const d = new Date(state.scheduleDate+'T00:00:00');
  d.setDate(d.getDate()-7);
  state.scheduleDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  renderWeekView();
}
function weekNavNext() {
  const d = new Date(state.scheduleDate+'T00:00:00');
  d.setDate(d.getDate()+7);
  state.scheduleDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  renderWeekView();
}

function hexToRgba(hex,a){
  hex=hex.replace('#','');
  if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const r=parseInt(hex.substring(0,2),16);
  const g=parseInt(hex.substring(2,4),16);
  const b=parseInt(hex.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}
function darken(hex) {
  hex=hex.replace('#','');
  if(hex.length===3) hex=hex.split('').map(c=>c+c).join('');
  const r=Math.max(0,parseInt(hex.substring(0,2),16)-60);
  const g=Math.max(0,parseInt(hex.substring(2,4),16)-60);
  const b=Math.max(0,parseInt(hex.substring(4,6),16)-60);
  return `rgb(${r},${g},${b})`;
}

function updateTimeLine() {
  const now=new Date(), mins=now.getHours()*60+now.getMinutes();
  const top=((mins-7*60)/10)*14;
  state.operatories.forEach(op=>{
    const line=$(`#time-line-${op.id}`); if(line) line.style.top=top+'px';
  });
}
setInterval(updateTimeLine,60000);

async function refreshSidebarProviderStatus() {
  const panel = $('#sidebar-provider-status');
  if (!panel) return;
  try {
    const avail = await window.api.providers.getAvailability();
    panel.innerHTML = avail.map(p => {
      const dotColor = p.status === 'In Chair' ? 'var(--red)' :
                       p.status === 'Overdue'  ? 'var(--amber)' :
                       'var(--green)';
      const label = p.status === 'In Chair'
        ? `<span style="font-size:10px;color:var(--red);margin-left:auto;font-weight:600">In Chair</span>`
        : p.status === 'Overdue'
        ? `<span style="font-size:10px;color:var(--amber);margin-left:auto;font-weight:600">Overdue</span>`
        : `<span style="font-size:10px;color:var(--green);margin-left:auto;font-weight:600">Free</span>`;
      return `
        <div class="prov-row" style="cursor:pointer" onclick="switchToView('doctors')" title="${p.status}${p.inChair?' — '+p.inChair.patient_name:''}">
          <div class="prov-dot" style="background:${p.color}"></div>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</span>
          <div style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;margin-left:6px;box-shadow:0 0 0 2px ${dotColor}33"></div>
          ${label}
        </div>`;
    }).join('');
  } catch(e) {}
}

// Slot interactions
function onSlotClick(e,opId,time){
  if(state.pinboardItems.length>0){
    const a=state.pinboardItems[0];
    if(confirm(`Schedule "${a.patient_name}" at ${time}?`))
      window.api.appointments.scheduleFromPinboard({id:a.id,date:state.scheduleDate,time,operatory_id:parseInt(opId)})
        .then(()=>{toast('Scheduled from pinboard','success');renderScheduleModule();});
  } else showNewApptModal(parseInt(opId),time);
}
function onApptDragStart(e,id){state.dragApptId=id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('apptId',id);setTimeout(()=>document.querySelector(`[data-id="${id}"]`)?.classList.add('dragging'),0);}
function onApptDragEnd(e){document.querySelector(`[data-id="${state.dragApptId}"]`)?.classList.remove('dragging');}
function onSlotDragOver(e){e.preventDefault();e.currentTarget.classList.add('drop-target');e.dataTransfer.dropEffect='move';}
function onSlotDragLeave(e){e.currentTarget.classList.remove('drop-target');}
function onSlotDrop(e,opId,time){
  e.preventDefault();e.stopPropagation();e.currentTarget.classList.remove('drop-target');
  const id=parseInt(e.dataTransfer.getData('apptId')||state.dragApptId);if(!id)return;
  if(state.pinboardItems.find(p=>p.id===id))
    window.api.appointments.scheduleFromPinboard({id,date:state.scheduleDate,time,operatory_id:parseInt(opId)})
      .then(()=>{toast('Scheduled','success');renderScheduleModule();});
  else
    window.api.appointments.getByDate(state.scheduleDate).then(appts=>{
      const a=appts.find(x=>x.id===id);if(!a)return;
      window.api.appointments.update({...a,id,time,operatory_id:parseInt(opId)})
        .then(()=>{toast('Appointment moved','success');renderGrid();});
    });
}
function onBodyDrop(e,opId){e.preventDefault();}
function onPinboardDragStart(e,id){state.dragApptId=id;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('apptId',id);}

async function clearPinboard(){
  await Promise.all(state.pinboardItems.map(a=>window.api.appointments.update({...a,pinboard:0})));
  toast('Pinboard cleared','info');renderScheduleModule();
}
async function removeFromPinboard(id){
  const all=await window.api.appointments.getAll();
  const a=all.find(x=>x.id===id);
  if(a) await window.api.appointments.update({...a,pinboard:0,unscheduled:1});
  toast('Moved to unscheduled','info');renderScheduleModule();
}
async function scheduleFromPinboard(id){
  openModal('Schedule Appointment',`
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="pb-date" type="date" value="${state.scheduleDate}"/></div>
      <div class="form-group"><label class="form-label">Time</label><input class="form-input" id="pb-time" type="time" value="09:00"/></div>
      <div class="form-group full"><label class="form-label">Operatory</label><select class="form-select" id="pb-op">${state.operatories.map(o=>`<option value="${o.id}">${o.name}</option>`).join('')}</select></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmScheduleFromPinboard(${id})">Schedule</button>
    </div>`);
}
async function confirmScheduleFromPinboard(id){
  const date=$('#pb-date').value,time=$('#pb-time').value,op=parseInt($('#pb-op').value);
  if(!date||!time){toast('Date and time required','error');return;}
  await window.api.appointments.scheduleFromPinboard({id,date,time,operatory_id:op});
  closeModal();toast('Appointment scheduled','success');renderScheduleModule();
}

// Right-click
function showApptRightClick(e,a){
  showCtxMenu(e.clientX,e.clientY,[
    {header:a.patient_name},
    {label:'Edit Appointment', icon:'✏️', action:()=>showEditApptModal(a.id)},
    {label:'View Patient',     icon:'👤', action:()=>{switchToView('patients');setTimeout(()=>openPatientDetail(a.patient_id),100);}},
    'sep',
    {header:'Status'},
    {label:'Mark Arrived',    icon:'✅', action:()=>markArrived(a.id)},
    {label:'In Chair',        icon:'🪑', action:()=>updateApptStatus(a.id,'In Chair')},
    {label:'Completed',       icon:'✔', action:()=>updateApptStatus(a.id,'Completed')},
    'sep',
    {header:'Confirmation'},
    {label:'Confirmed',       icon:'📞', action:()=>updateApptConfirmed(a.id,'Confirmed')},
    {label:'eConfirmed',      icon:'📱', action:()=>updateApptConfirmed(a.id,'eConfirmed')},
    {label:'Left Message',    icon:'📨', action:()=>updateApptConfirmed(a.id,'Left Message')},
    'sep',
    {label:'→ Pinboard',      icon:'📌', action:()=>copyToPinboard(a.id)},
    {label:'→ Unscheduled',   icon:'📋', action:()=>sendToUnscheduled(a.id)},
    {label:'Mark ASAP',       icon:'⚡', action:()=>markASAP(a.id)},
    'sep',
    {label:'Break Appointment',icon:'💔', action:()=>breakAppt(a.id), danger:true},
    {label:'Delete',           icon:'🗑', action:()=>deleteAppt(a.id), danger:true},
  ]);
}
function showBlockoutCtx(e,id){
  showCtxMenu(e.clientX,e.clientY,[{label:'Delete Blockout',action:()=>deleteBlockout(id),danger:true}]);
}
async function markArrived(id){
  const t=new Date().toTimeString().slice(0,5);
  await window.api.appointments.updateArrival({id,time_arrived:t});
  toast('Patient arrived at '+t,'success');
  renderGrid();
  refreshWaitingRoom();
}

// ─── WAITING ROOM ─────────────────────────────────────────────────────────
let wrRefreshTimer = null;

function startWaitingRoomRefresh() {
  if (wrRefreshTimer) clearInterval(wrRefreshTimer);
  wrRefreshTimer = setInterval(() => {
    if ($('#waiting-room-panel')) refreshWaitingRoom();
    else clearInterval(wrRefreshTimer);
  }, 60000);
}

async function refreshWaitingRoom() {
  const panel = $('#wr-list');
  if (!panel) return;
  const patients = await window.api.appointments.getWaitingRoom();
  const alertMins = parseInt($('#wr-alert-mins')?.value || '15');
  const count = $('#wr-count');
  if (count) count.textContent = patients.length;
  if (count) count.className = 'wr-count' + (patients.length > 0 ? ' has-patients' : '');

  if (patients.length === 0) {
    panel.innerHTML = '<div class="wr-empty">No patients waiting</div>';
    return;
  }

  const now = new Date();
  panel.innerHTML = patients.map(p => {
    const arrived = p.time_arrived || p.time || '00:00';
    const [ah, am] = arrived.split(':').map(Number);
    const arrivedDate = new Date(); arrivedDate.setHours(ah, am, 0, 0);
    const waitMins = Math.max(0, Math.floor((now - arrivedDate) / 60000));
    const isAlert = waitMins >= alertMins;
    return `
      <div class="wr-item ${isAlert ? 'wr-alert' : ''}">
        <div class="wr-item-main">
          <div class="wr-item-name">${p.patient_name || '—'}</div>
          <div class="wr-item-meta">${p.type || 'Appointment'} · ${p.op_name || '—'}</div>
        </div>
        <div class="wr-item-right">
          <div class="wr-wait ${isAlert ? 'wr-wait-alert' : ''}">${waitMins}m</div>
          <div class="wr-arrived">In: ${arrived}</div>
        </div>
        <div class="wr-item-actions">
          <button class="wr-btn wr-btn-seat" onclick="seatPatient(${p.id})" title="Seat patient">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 10l4 4 6-6"/></svg>
            Seat
          </button>
          <button class="wr-btn wr-btn-dismiss" onclick="dismissPatient(${p.id})" title="Mark complete">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10h12"/></svg>
          </button>
          <button class="wr-btn wr-btn-remove" onclick="removeArrival(${p.id})" title="Remove arrival">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5l10 10M15 5L5 15"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

async function seatPatient(id) {
  await window.api.appointments.seatPatient({ id, time: new Date().toTimeString().slice(0,5) });
  toast('Patient seated','success');
  renderGrid();
  refreshWaitingRoom();
}
async function dismissPatient(id) {
  await window.api.appointments.dismissPatient(id);
  toast('Appointment completed','success');
  renderGrid();
  refreshWaitingRoom();
}
async function removeArrival(id) {
  if (!confirm('Remove this patient from the waiting room? Their arrival time will be cleared.')) return;
  await window.api.appointments.removeArrival(id);
  toast('Arrival removed','info');
  renderGrid();
  refreshWaitingRoom();
}
async function updateApptStatus(id,s){
  await window.api.appointments.updateStatus({id,status:s});
  if (s === 'In Chair') await window.api.appointments.seatPatient({id, time: new Date().toTimeString().slice(0,5)});
  if (s === 'Completed') await window.api.appointments.dismissPatient(id);
  toast('Status: '+s,'success');
  renderGrid();
  refreshWaitingRoom();
}
async function updateApptConfirmed(id,c){await window.api.appointments.updateConfirmed({id,confirmed:c});toast('Confirmed: '+c,'success');renderGrid();}
async function copyToPinboard(id){await window.api.appointments.sendToPinboard(id);toast('Added to pinboard','info');renderScheduleModule();}
async function sendToUnscheduled(id){if(!confirm('Send to unscheduled list?'))return;await window.api.appointments.sendToUnscheduled(id);toast('Sent to unscheduled','info');renderScheduleModule();}
async function markASAP(id){await window.api.appointments.markASAP(id);toast('Marked ASAP','success');renderScheduleModule();}
async function breakAppt(id){if(!confirm('Break this appointment?'))return;await window.api.appointments.sendToUnscheduled(id);toast('Appointment broken','info');renderScheduleModule();}
async function deleteAppt(id){if(!confirm('Delete appointment?'))return;await window.api.appointments.delete(id);toast('Deleted','info');renderGrid();}
async function deleteBlockout(id){await window.api.blockouts.delete(id);toast('Blockout removed','info');renderGrid();}

// List views
async function showListView(type){
  state.activeList=type;
  $$('.list-btn').forEach(b=>b.classList.remove('active-list'));
  await renderScheduleModule();
}
async function renderListView(type){
  const main=$('#appt-main');if(!main)return;
  let items=[],cols=[],title='';
  if(type==='unscheduled'){items=await window.api.appointments.getUnscheduled();title='Unscheduled List';cols=['Patient','Phone','Type','Provider','Duration','Actions'];}
  else if(type==='asap'){items=await window.api.appointments.getASAP();title='ASAP List';cols=['Patient','Phone','Type','Provider','Duration','Actions'];}
  else if(type==='recall'){items=await window.api.appointments.getRecallDue();title='Recall List';cols=['Patient','Phone','Provider','Recall Due','Insurance','Actions'];}
  main.innerHTML=`
    <div class="appt-toolbar">
      <div class="appt-toolbar-date">${title}</div>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="state.activeList=null;renderGrid()">← Back to Schedule</button>
    </div>
    <div class="list-view" style="padding:16px">
      ${items.length===0?'<div class="empty-state"><h3>No records</h3></div>':`
      <div class="card"><div class="table-wrap">
        <table>
          <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${type==='recall'?items.map(p=>`
            <tr>
              <td class="td-name">${p.first_name} ${p.last_name}</td>
              <td>${p.phone||'—'}</td>
              <td>${p.primary_provider||'—'}</td>
              <td><span style="color:${new Date(p.recall_due)<new Date()?'var(--red)':'var(--amber)'}">${formatDate(p.recall_due)}</span></td>
              <td>${p.insurance||'—'}</td>
              <td><div style="display:flex;gap:4px">
                <button class="btn btn-primary btn-xs" onclick="scheduleRecall(${p.id})">Schedule</button>
                <button class="btn btn-ghost btn-xs" onclick="openPatientDetail(${p.id})">View</button>
              </div></td>
            </tr>`).join(''):items.map(a=>`
            <tr>
              <td class="td-name">${a.patient_name||'—'}</td>
              <td>${a.phone||'—'}</td>
              <td>${a.type||'—'}</td>
              <td>${a.provider||'—'}</td>
              <td class="td-mono">${a.duration}m</td>
              <td><div style="display:flex;gap:4px">
                <button class="btn btn-sky btn-xs" onclick="sendToPinboardFromList(${a.id})">→ Pinboard</button>
                <button class="btn btn-ghost btn-xs" onclick="showEditApptModal(${a.id})">Edit</button>
                <button class="btn btn-danger btn-xs" onclick="deleteAppt(${a.id}).then(()=>renderListView('${type}'))">Del</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div></div>`}
    </div>`;
}

async function sendToPinboardFromList(id){await window.api.appointments.sendToPinboard(id);toast('Added to pinboard','success');renderScheduleModule();}

async function scheduleRecall(patientId){
  const p=await window.api.patients.get(patientId);
  openModal(`Schedule Recall — ${p.first_name} ${p.last_name}`,`
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="rc-date" type="date" value="${state.scheduleDate}"/></div>
      <div class="form-group"><label class="form-label">Time</label><input class="form-input" id="rc-time" type="time" value="09:00"/></div>
      <div class="form-group"><label class="form-label">Operatory</label><select class="form-select" id="rc-op">${state.operatories.map(o=>`<option value="${o.id}">${o.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Duration</label><select class="form-select" id="rc-dur">${[30,45,60,90].map(d=>`<option>${d}</option>`).join('')}</select></div>
      <div class="form-group full"><label class="form-label">Type</label><select class="form-select" id="rc-type"><option>Prophy Recall</option><option>Perio Recall</option><option>Child Prophy</option></select></div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmScheduleRecall(${patientId})">Schedule</button>
    </div>`);
}
async function confirmScheduleRecall(pid){
  const p=await window.api.patients.get(pid);
  await window.api.appointments.create({patient_id:pid,operatory_id:parseInt($('#rc-op').value),date:$('#rc-date').value,time:$('#rc-time').value,duration:parseInt($('#rc-dur').value),type:$('#rc-type').value,provider:p.secondary_provider||p.primary_provider||'Sarah H.',hygienist:p.secondary_provider||'Sarah H.',status:'Scheduled',confirmed:'Unconfirmed',is_new_patient:0,is_hygiene:1,is_asap:0,patient_note:'',appt_note:'Recall',unscheduled:0,pinboard:0,procedures:'D1110',time_arrived:'',time_seated:'',time_dismissed:''});
  closeModal();toast('Recall scheduled','success');state.activeList=null;renderScheduleModule();
}

// Navigation
function changeDay(dir){
  const d = new Date(state.scheduleDate+'T00:00:00');
  d.setDate(d.getDate()+dir);
  // Use local date parts to avoid timezone shift
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  state.scheduleDate = `${y}-${m}-${day}`;
  state.calMonth = new Date(state.scheduleDate+'T00:00:00');
  state.activeList = null;
  renderScheduleModule();
}
function goToday(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  state.scheduleDate = `${y}-${m}-${day}`;
  state.activeList = null;
  renderScheduleModule();
}
function selectDate(ds){state.scheduleDate=ds;state.calMonth=new Date(ds+'T00:00:00');state.activeList=null;renderScheduleModule();}
function changeCalMonth(dir){state.calMonth=new Date(state.calMonth.getFullYear(),state.calMonth.getMonth()+dir,1);renderMiniCal();}

function renderMiniCal(){
  const cal=$('#mini-cal');if(!cal)return;
  const today=new Date().toISOString().split('T')[0];
  const m=state.calMonth,year=m.getFullYear(),mon=m.getMonth();
  const fd=new Date(year,mon,1).getDay(),dim=new Date(year,mon+1,0).getDate();
  let cells='';
  for(let i=0;i<fd;i++) cells+=`<div class="cal-day other-month"></div>`;
  for(let d=1;d<=dim;d++){
    const ds=`${year}-${String(mon+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells+=`<div class="cal-day${ds===today?' today':''}${ds===state.scheduleDate?' selected':''}" onclick="selectDate('${ds}')">${d}</div>`;
  }
  cal.innerHTML=`<div class="mini-cal-header"><span class="mini-cal-title">${m.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span><div style="display:flex;gap:2px"><button class="mini-cal-nav" onclick="changeCalMonth(-1)">‹</button><button class="mini-cal-nav" onclick="changeCalMonth(1)">›</button></div></div><div class="mini-cal-grid">${['S','M','T','W','T','F','S'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}${cells}</div>`;
}

// Pat Appts
async function showPatAppts(){
  const patients=await window.api.patients.getAll();
  openModal('Patient Appointments',`
    <div style="margin-bottom:12px"><div class="search-bar" style="width:100%"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px;color:var(--text3)"><circle cx="8" cy="8" r="5"/><path d="M18 18l-4-4"/></svg><input type="text" placeholder="Search patient..." id="pappt-search" oninput="filterPatAppts(this.value)"/></div></div>
    <div id="pappt-list" style="max-height:400px;overflow-y:auto">
      ${patients.map(p=>`<div class="dash-appt-item" onclick="closeModal();openPatientApptHistory(${p.id})" style="cursor:pointer"><div class="avatar avatar-sm" style="background:${avatarColor(p.first_name)}">${initials(p.first_name,p.last_name)}</div><div style="flex:1"><div style="font-weight:600;color:var(--navy)">${p.first_name} ${p.last_name}</div><div class="text-sm text-muted">${p.phone||'—'}</div></div><div class="text-sm text-muted">${p.primary_provider||''}</div></div>`).join('')}
    </div>`);
}
async function filterPatAppts(q){const patients=q?await window.api.patients.search(q):await window.api.patients.getAll();const l=$('#pappt-list');if(l)l.innerHTML=patients.map(p=>`<div class="dash-appt-item" onclick="closeModal();openPatientApptHistory(${p.id})" style="cursor:pointer"><div class="avatar avatar-sm" style="background:${avatarColor(p.first_name)}">${initials(p.first_name,p.last_name)}</div><div style="flex:1"><div style="font-weight:600">${p.first_name} ${p.last_name}</div><div class="text-sm text-muted">${p.phone||'—'}</div></div></div>`).join('');}
async function openPatientApptHistory(pid){
  const [p,appts]=await Promise.all([window.api.patients.get(pid),window.api.appointments.getByPatient(pid)]);
  openModal(`${p.first_name} ${p.last_name} — Appointments`,`
    <div style="margin-bottom:12px;display:flex;gap:6px">${p.recall_due?`<span class="badge badge-amber">Recall: ${formatDate(p.recall_due)}</span>`:''} ${p.allergies&&p.allergies!=='None'?`<span class="badge badge-red">⚠ ${p.allergies}</span>`:''}</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Op</th><th>Provider</th><th>Status</th><th>Actions</th></tr></thead><tbody>${appts.length===0?`<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">No appointments</td></tr>`:appts.map(a=>`<tr><td>${formatDate(a.date)||'Unscheduled'}</td><td>${a.type||'—'}</td><td>${a.op_name||'—'}</td><td>${a.provider||'—'}</td><td>${statusBadge(a.status)}</td><td>${a.date?`<button class="btn btn-ghost btn-xs" onclick="closeModal();selectDate('${a.date}')">Go</button>`:''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="form-actions"><button class="btn btn-primary" onclick="closeModal();showNewApptModalForPatient(${pid})">Schedule New</button></div>`);
}

async function showMakeRecall(){const pts=await window.api.appointments.getRecallDue();if(!pts.length){toast('No patients due for recall','info');return;}scheduleRecall(pts[0].id);}
async function showListsModal(){
  const[u,a,r]=await Promise.all([window.api.appointments.getUnscheduled(),window.api.appointments.getASAP(),window.api.appointments.getRecallDue()]);
  openModal('Appointment Lists',`<div style="display:flex;flex-direction:column;gap:8px">
    <button class="btn btn-secondary" style="justify-content:space-between" onclick="closeModal();showListView('unscheduled')"><span>Unscheduled List</span><span class="badge badge-red">${u.length}</span></button>
    <button class="btn btn-secondary" style="justify-content:space-between" onclick="closeModal();showListView('asap')"><span>ASAP List</span><span class="badge badge-amber">${a.length}</span></button>
    <button class="btn btn-secondary" style="justify-content:space-between" onclick="closeModal();showListView('recall')"><span>Recall List (60 days)</span><span class="badge badge-amber">${r.length}</span></button>
  </div>`);
}

function showSearchModal(){
  openModal('Find Available Opening',`
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Search for available appointment slots within a date range.</p>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">From</label><input class="form-input" id="srch-from" type="date" value="${state.scheduleDate}"/></div>
      <div class="form-group"><label class="form-label">To</label><input class="form-input" id="srch-to" type="date" value="${new Date(Date.now()+30*86400000).toISOString().split('T')[0]}"/></div>
      <div class="form-group"><label class="form-label">Provider</label><select class="form-select" id="srch-prov"><option value="">Any</option>${state.providers.map(p=>`<option>${p.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Duration Needed</label><select class="form-select" id="srch-dur">${[30,45,60,90].map(d=>`<option value="${d}">${d} min</option>`).join('')}</select></div>
    </div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="runSearch()">Search</button></div>`);
}
async function runSearch(){
  const from=new Date($('#srch-from').value+'T00:00:00'),to=new Date($('#srch-to').value+'T00:00:00'),prov=$('#srch-prov').value,results=[];
  const d=new Date(from);
  while(d<=to&&results.length<8){
    const ds=d.toISOString().split('T')[0];
    const dayAppts=await window.api.appointments.getByDate(ds);
    const busy=dayAppts.filter(a=>!prov||a.provider===prov).map(a=>timeToMins(a.time));
    for(let h=8;h<17;h++){const m=h*60;if(!busy.some(b=>Math.abs(b-m)<30)){results.push({date:ds,time:minsToTime(m)});break;}}
    d.setDate(d.getDate()+1);
  }
  $('#modal-body').innerHTML=`<p style="color:var(--text2);font-size:13px;margin-bottom:12px">Available openings:</p>
    <div class="card"><div class="table-wrap">${results.length===0?'<div class="empty-state"><h3>No openings found</h3></div>':`
      <table><thead><tr><th>Date</th><th>Time</th><th>Action</th></tr></thead><tbody>
      ${results.map(r=>`<tr><td>${formatDate(r.date)}</td><td class="td-mono">${r.time}</td><td><button class="btn btn-primary btn-xs" onclick="closeModal();selectDate('${r.date}')">Go to date</button></td></tr>`).join('')}
      </tbody></table>`}</div></div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`;
}

function showAddBlockoutModal(){
  const types=[{l:'Staff Meeting',c:'#7c3aed'},{l:'Holiday',c:'#dc2626'},{l:'Personal',c:'#0891b2'},{l:'Block – Restorative',c:'#d97706'},{l:'Block – Hygiene',c:'#059669'}];
  openModal('Add Blockout',`
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Date</label><input class="form-input" id="bo-date" type="date" value="${state.scheduleDate}"/></div>
      <div class="form-group"><label class="form-label">Operatory</label><select class="form-select" id="bo-op">${state.operatories.map(o=>`<option value="${o.id}">${o.name}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Start Time</label><input class="form-input" id="bo-start" type="time" value="12:00"/></div>
      <div class="form-group"><label class="form-label">End Time</label><input class="form-input" id="bo-end" type="time" value="13:00"/></div>
      <div class="form-group full"><label class="form-label">Type</label><select class="form-select" id="bo-type">${types.map(t=>`<option value="${t.c}">${t.l}</option>`).join('')}</select></div>
      <div class="form-group full"><label class="form-label">Note (optional)</label><input class="form-input" id="bo-note" placeholder="Optional note"/></div>
    </div>
    <div class="form-actions"><button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveBlockout()">Add</button></div>`);
}
async function saveBlockout(){
  const label=$('#bo-type').options[$('#bo-type').selectedIndex].text;
  const b={operatory_id:parseInt($('#bo-op').value),date:$('#bo-date').value,start_time:$('#bo-start').value,end_time:$('#bo-end').value,type:label,color:$('#bo-type').value,note:$('#bo-note').value.trim()};
  if(!b.date||!b.start_time||!b.end_time){toast('Fill all fields','error');return;}
  await window.api.blockouts.create(b);closeModal();toast('Blockout added','success');renderGrid();
}

// Appointment form
async function apptFormHTML(a={}){
  const patients=await window.api.patients.getAll();
  const types=['Comprehensive Exam','Limited Exam','Emergency','Cleaning','Prophy Recall','Perio Recall','Filling','Crown','Root Canal','Extraction','Implant','Whitening','X-Ray','Consultation','Follow-up','New Patient Exam'];
  return `<div class="form-grid">
    <div class="form-group full"><label class="form-label">Patient *</label><select class="form-select" id="a-patient"><option value="">Select patient...</option>${patients.map(p=>`<option value="${p.id}" ${a.patient_id==p.id?'selected':''}>${p.last_name}, ${p.first_name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Date *</label><input class="form-input" id="a-date" type="date" value="${a.date||state.scheduleDate}"/></div>
    <div class="form-group"><label class="form-label">Time *</label><input class="form-input" id="a-time" type="time" value="${a.time||'09:00'}"/></div>
    <div class="form-group"><label class="form-label">Operatory</label><select class="form-select" id="a-op">${state.operatories.map(o=>`<option value="${o.id}" ${a.operatory_id==o.id?'selected':''}>${o.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Duration</label><select class="form-select" id="a-dur">${[10,15,20,30,45,60,90,120].map(d=>`<option value="${d}" ${a.duration==d?'selected':''}>${d} min</option>`).join('')}</select></div>
    <div class="form-group full"><label class="form-label">Type</label><select class="form-select" id="a-type">${types.map(t=>`<option ${a.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Provider</label><select class="form-select" id="a-prov">${state.providers.filter(p=>!p.is_hygienist).map(p=>`<option ${a.provider===p.name?'selected':''}>${p.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Hygienist</label><select class="form-select" id="a-hyg"><option value="">None</option>${state.providers.filter(p=>p.is_hygienist).map(p=>`<option ${a.hygienist===p.name?'selected':''}>${p.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Status</label><select class="form-select" id="a-status">${['Scheduled','Confirmed','Arrived','In Chair','Completed','Cancelled','No Show'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Confirmed</label><select class="form-select" id="a-conf">${['Unconfirmed','Confirmed','eConfirmed','Left Message'].map(s=>`<option ${a.confirmed===s?'selected':''}>${s}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Procedures</label><input class="form-input" id="a-procs" value="${a.procedures||''}" placeholder="D0150, D1110..."/></div>
    <div class="form-group" style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">
      <label class="form-check"><input type="checkbox" id="a-np" ${a.is_new_patient?'checked':''}/> New Patient</label>
      <label class="form-check"><input type="checkbox" id="a-hg" ${a.is_hygiene?'checked':''}/> Hygiene</label>
      <label class="form-check"><input type="checkbox" id="a-asap" ${a.is_asap?'checked':''}/> ASAP</label>
    </div>
    <div class="form-group full"><label class="form-label">Patient Note</label><input class="form-input" id="a-pnote" value="${a.patient_note||''}" placeholder="Visible on schedule..."/></div>
    <div class="form-group full"><label class="form-label">Appointment Note</label><textarea class="form-textarea" id="a-note">${a.appt_note||''}</textarea></div>
    <div class="form-actions full" id="appt-form-actions"></div>
  </div>`;
}
async function showNewApptModal(opId=null,time=null){
  const html=await apptFormHTML({operatory_id:opId,time:time||'09:00'});
  openModal('New Appointment',html,body=>{$('#appt-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveAppt(null)">Schedule</button>`;});
}
async function showNewApptModalForPatient(pid){
  const html=await apptFormHTML({patient_id:pid});
  openModal('New Appointment',html,body=>{$('#appt-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveAppt(null)">Schedule</button>`;});
}
async function showEditApptModal(id){
  const all=await window.api.appointments.getAll();const a=all.find(x=>x.id===id);
  if(!a){toast('Not found','error');return;}
  const html=await apptFormHTML(a);
  openModal('Edit Appointment',html,body=>{$('#appt-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-danger btn-sm" onclick="copyToPinboard(${id}).then(()=>{closeModal();renderScheduleModule()})">→ Pinboard</button><button class="btn btn-primary" onclick="saveAppt(${id})">Save</button>`;});
}
async function saveAppt(id){
  const status = $('#a-status').value;
  const now    = new Date().toTimeString().slice(0,5);

  // Fetch existing record to preserve time fields
  let existing = {};
  if (id) {
    const all = await window.api.appointments.getAll();
    existing = all.find(x => x.id === id) || {};
  }

  const a = {
    patient_id:   parseInt($('#a-patient').value),
    operatory_id: parseInt($('#a-op').value),
    date:         $('#a-date').value,
    time:         $('#a-time').value,
    duration:     parseInt($('#a-dur').value),
    type:         $('#a-type').value,
    provider:     $('#a-prov').value,
    hygienist:    $('#a-hyg').value || '',
    status,
    confirmed:    $('#a-conf').value,
    is_new_patient: $('#a-np').checked ? 1 : 0,
    is_hygiene:   $('#a-hg').checked ? 1 : 0,
    is_asap:      $('#a-asap').checked ? 1 : 0,
    patient_note: $('#a-pnote').value.trim(),
    appt_note:    $('#a-note').value.trim(),
    unscheduled:  0, pinboard: 0,
    procedures:   $('#a-procs').value.trim(),
    // Preserve existing time fields — don't wipe them on every save
    time_arrived:  existing.time_arrived  || '',
    time_seated:   existing.time_seated   || '',
    time_dismissed:existing.time_dismissed|| '',
  };

  // Auto-set time fields based on status
  if (status === 'Arrived'  && !a.time_arrived)  a.time_arrived   = now;
  if (status === 'In Chair')                      { if(!a.time_arrived) a.time_arrived = now; if(!a.time_seated) a.time_seated = now; }
  if (status === 'Completed' && !a.time_dismissed) a.time_dismissed = now;

  if (!a.patient_id) { toast('Select a patient','error'); return; }
  if (!a.date || !a.time) { toast('Date and time required','error'); return; }

  if (id) await window.api.appointments.update({...a, id});
  else    await window.api.appointments.create(a);

  closeModal();
  toast(id ? 'Updated' : 'Scheduled', 'success');
  state.scheduleDate = a.date;
  state.activeList   = null;
  renderScheduleModule();
}

// ═══════════════════════════════════════════════════════════════════════════
// PATIENTS MODULE
// ═══════════════════════════════════════════════════════════════════════════
async function renderPatients(search=''){
  let pts=[];
  try {
    if (search) {
      const all = await window.api.patients.search(search);
      const prov = myProvider();
      pts = hasFullAccess() ? all : all.filter(p => p.primary_provider===prov || p.secondary_provider===prov);
    } else {
      pts = await fetchMyPatients();
    }
  } catch(e) { console.error('renderPatients error:', e); pts = []; }
  const el=$('#view-patients');
  el.innerHTML=`
    <div class="page-header">
      <div><div class="page-title">Patients</div><div class="page-subtitle">${pts.length} records</div></div>
      <div class="page-actions">
        <div class="search-bar"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" style="width:14px;height:14px;color:var(--text3)"><circle cx="8" cy="8" r="5"/><path d="M18 18l-4-4"/></svg><input type="text" placeholder="Search patients..." id="pat-search" value="${search}"/></div>
        <button class="btn btn-primary" onclick="showNewPatientModal()">+ New Patient</button>
      </div>
    </div>
    <div class="table-container">
      <div class="card">
        ${pts.length===0?'<div class="empty-state"><h3>No patients found</h3></div>':`
        <div class="table-wrap"><table>
          <thead><tr><th>Patient</th><th>DOB / Age</th><th>Phone</th><th>Insurance</th><th>Provider</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${pts.map(p=>{
            const isXferred = p.status==='Transferred';
            return `
            <tr class="${isXferred?'row-transferred':''}">
              <td><div style="display:flex;align-items:center;gap:9px"><div class="avatar avatar-sm" style="background:${avatarColor(p.first_name)}">${initials(p.first_name,p.last_name)}</div><div><div class="td-name">${p.first_name} ${p.last_name}</div><div class="td-mono">#${String(p.id).padStart(5,'0')}</div></div></div></td>
              <td>${p.dob?`${formatDate(p.dob)} <span class="text-muted text-sm">(${age(p.dob)})</span>`:'—'}</td>
              <td>${p.phone||'—'}</td>
              <td>${p.insurance?`<span class="badge badge-navy">${p.insurance}</span>`:'—'}</td>
              <td>${isXferred&&p.transferred_to?`<span style="font-size:11px;color:var(--text3)">→ ${p.transferred_to}</span>`:(p.primary_provider||'—')}</td>
              <td>${isXferred?`<span class="badge badge-amber">Transferred</span>`:`<span class="badge badge-green">Active</span>`}</td>
              <td><div style="display:flex;gap:4px">
                <button class="btn btn-secondary btn-xs" onclick="openPatientDetail(${p.id})">View</button>
                <button class="btn btn-ghost btn-xs" onclick="showEditPatientModal(${p.id})">Edit</button>
                <button class="btn btn-sky btn-xs" data-transfer-id="${p.id}">↔ Transfer</button>
                <button class="btn btn-danger btn-xs" onclick="deletePatient(${p.id},'${p.first_name} ${p.last_name}')">Del</button>
              </div></td>
            </tr>`;}).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>`;
  $('#pat-search').oninput=debounce(e=>renderPatients(e.target.value),300);

  // Event delegation for transfer buttons
  const tableWrap = $('#view-patients .table-wrap');
  if (tableWrap) {
    tableWrap.addEventListener('click', async function(e) {
      const btn = e.target.closest('[data-transfer-id]');
      if (!btn) return;
      const id = parseInt(btn.dataset.transferId);
      const p = await window.api.patients.get(id);
      if (p) showTransferModal(id, p.first_name+' '+p.last_name, p.primary_provider||'', p.transferred_to||'', p.status||'');
    });
  }
}

async function openPatientDetail(id){
  const[p,appts,treatments,billing]=await Promise.all([window.api.patients.get(id),window.api.appointments.getByPatient(id),window.api.treatments.getByPatient(id),window.api.billing.getByPatient(id)]);
  state.selectedPatient=p;
  const el=$('#view-patients');
  el.innerHTML=`
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-secondary btn-sm" onclick="renderPatients()">← Back</button>
        <div>
          <div class="page-title" style="font-size:17px;display:flex;align-items:center;gap:8px">
            ${p.first_name} ${p.last_name}
            ${p.status==='Transferred'?`<span class="badge badge-amber">Transferred</span>`:''}
          </div>
          <div class="page-subtitle">#${String(p.id).padStart(5,'0')} · ${p.status==='Transferred'?`Transferred from ${p.transferred_from||'—'} → ${p.transferred_to||'—'} on ${formatDate(p.transferred_date)}`:(p.primary_provider||'—')}</div>
        </div>
      </div>
      <div class="page-actions">
        ${p.status==='Transferred'
          ? `<button class="btn btn-ghost btn-sm" onclick="undoTransfer(${p.id})">↩ Undo Transfer</button>`
          : `<button class="btn btn-secondary btn-sm" data-transfer-detail="${p.id}">↔ Transfer</button>`}
        <button class="btn btn-secondary btn-sm" onclick="showNewApptModalForPatient(${p.id})">New Appt</button>
        <button class="btn btn-primary btn-sm" onclick="showEditPatientModal(${p.id})">Edit Patient</button>
      </div>
    </div>
    <div class="patient-detail">
      <div class="pat-header">
        <div class="avatar avatar-lg" style="background:${avatarColor(p.first_name)}">${initials(p.first_name,p.last_name)}</div>
        <div class="pat-info">
          <div class="pat-name">${p.first_name} ${p.last_name}</div>
          <div class="pat-meta">
            ${p.dob?`<div class="pat-meta-item"><strong>Age:</strong> ${age(p.dob)}</div>`:''}
            <div class="pat-meta-item"><strong>DOB:</strong> ${formatDate(p.dob)}</div>
            <div class="pat-meta-item"><strong>Gender:</strong> ${p.gender||'—'}</div>
            <div class="pat-meta-item"><strong>Phone:</strong> ${p.phone||'—'}</div>
            <div class="pat-meta-item"><strong>Email:</strong> ${p.email||'—'}</div>
            <div class="pat-meta-item"><strong>Insurance:</strong> ${p.insurance||'—'}</div>
            <div class="pat-meta-item"><strong>ID:</strong> ${p.insurance_id||'—'}</div>
            <div class="pat-meta-item"><strong>Recall:</strong> <span style="color:${p.recall_due&&new Date(p.recall_due)<new Date()?'var(--red)':'inherit'}">${formatDate(p.recall_due)}</span></div>
            ${p.allergies&&p.allergies!=='None'?`<div class="pat-meta-item"><span class="badge badge-red">⚠ ${p.allergies}</span></div>`:''}
          </div>
        </div>
      </div>
      <div class="detail-tabs">
        <button class="detail-tab active" onclick="switchTab(this,'tab-chart')">Tooth Chart</button>
        <button class="detail-tab" onclick="switchTab(this,'tab-tx')">Tx Plan <span class="badge badge-gray" style="font-size:10px">${treatments.length}</span></button>
        <button class="detail-tab" onclick="switchTab(this,'tab-appts')">Appointments <span class="badge badge-gray" style="font-size:10px">${appts.length}</span></button>
        <button class="detail-tab" onclick="switchTab(this,'tab-billing')">Billing</button>
        <button class="detail-tab" onclick="switchTab(this,'tab-notes')">Notes</button>
      </div>
      <div id="tab-chart" class="tab-pane active">${renderToothChart(treatments)}</div>
      <div id="tab-tx" class="tab-pane">${renderTxTab(p.id,treatments)}</div>
      <div id="tab-appts" class="tab-pane">${renderPatAppts(appts)}</div>
      <div id="tab-billing" class="tab-pane">${renderPatBilling(billing)}</div>
      <div id="tab-notes" class="tab-pane">${renderNotesTab(p)}</div>
    </div>`;

  // Wire up transfer button in detail header
  const detailTransferBtn = $('[data-transfer-detail]', el);
  if (detailTransferBtn) {
    detailTransferBtn.addEventListener('click', () => {
      showTransferModal(p.id, p.first_name+' '+p.last_name, p.primary_provider||'', p.transferred_to||'', p.status||'');
    });
  }
}
function switchTab(btn,id){$$('.detail-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');$$('.tab-pane').forEach(p=>p.classList.remove('active'));$(`#${id}`).classList.add('active');}

function renderToothChart(treatments){
  const txMap={};treatments.forEach(t=>{if(t.tooth)txMap[t.tooth]=t.status;});
  const upper=['#1','#2','#3','#4','#5','#6','#7','#8','#9','#10','#11','#12','#13','#14','#15','#16'];
  const lower=['#32','#31','#30','#29','#28','#27','#26','#25','#24','#23','#22','#21','#20','#19','#18','#17'];
  const tc=n=>{const s=txMap[n];if(!s)return '';if(s==='Treatment Planned')return 'tx-planned';if(s==='Completed')return 'tx-completed';if(s==='In Progress')return 'tx-inprogress';return '';};
  return `<div class="tooth-chart">
    <div class="tooth-chart-title">Dental Chart</div>
    <div class="teeth-label">Upper · Maxillary</div>
    <div class="teeth-row">${upper.map(n=>`<div class="tooth ${tc(n)}" title="${n}${txMap[n]?': '+txMap[n]:''}"><div class="tooth-num">${n.replace('#','')}</div></div>`).join('')}</div>
    <div style="height:10px"></div>
    <div class="teeth-row">${lower.map(n=>`<div class="tooth ${tc(n)}" title="${n}${txMap[n]?': '+txMap[n]:''}"><div class="tooth-num">${n.replace('#','')}</div></div>`).join('')}</div>
    <div class="teeth-label">Lower · Mandibular</div>
    <div style="display:flex;gap:16px;justify-content:center;margin-top:14px">
      <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;background:var(--amber2);border:1.5px solid var(--amber);border-radius:2px"></span>Planned</span>
      <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;background:rgba(14,165,233,.1);border:1.5px solid var(--sky2);border-radius:2px"></span>In Progress</span>
      <span style="font-size:11px;color:var(--text3);display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:10px;height:10px;background:var(--green2);border:1.5px solid var(--green);border-radius:2px"></span>Completed</span>
    </div>
  </div>`;
}

function renderTxTab(pid,treatments){return `<div style="display:flex;justify-content:flex-end;margin-bottom:12px"><button class="btn btn-primary btn-sm" onclick="showAddTxModal(${pid})">+ Add Treatment</button></div>
  <div class="card"><div class="table-wrap">${treatments.length===0?'<div class="empty-state"><h3>No treatments</h3></div>':`<table><thead><tr><th>Tooth</th><th>Code</th><th>Description</th><th>Status</th><th>Fee</th><th>Provider</th><th></th></tr></thead><tbody>${treatments.map(t=>`<tr><td class="td-mono">${t.tooth||'—'} ${t.surface||''}</td><td class="td-mono">${t.procedure_code||'—'}</td><td>${t.description}</td><td>${statusBadge(t.status)}</td><td class="td-mono">${formatCurrency(t.fee)}</td><td>${t.provider||'—'}</td><td><div style="display:flex;gap:3px"><button class="btn btn-ghost btn-xs" onclick="showEditTxModal(${JSON.stringify(t).replace(/"/g,'&quot;')})">Edit</button><button class="btn btn-danger btn-xs" onclick="deleteTx(${t.id},${pid})">Del</button></div></td></tr>`).join('')}</tbody></table>`}</div></div>`;}

function renderPatAppts(appts){return `<div class="card"><div class="table-wrap">${appts.length===0?'<div class="empty-state"><h3>No appointments</h3></div>':`<table><thead><tr><th>Date</th><th>Time</th><th>Type</th><th>Op</th><th>Provider</th><th>Status</th><th>Confirmed</th></tr></thead><tbody>${appts.map(a=>`<tr><td>${formatDate(a.date)||'<span class="badge badge-gray">Unscheduled</span>'}</td><td class="td-mono">${a.time||'—'}</td><td>${a.type||'—'}</td><td>${a.op_name||'—'}</td><td>${a.provider||'—'}</td><td>${statusBadge(a.status)}</td><td>${confirmedBadge(a.confirmed)}</td></tr>`).join('')}</tbody></table>`}</div></div>`;}

function renderPatBilling(billing){
  const tot=billing.reduce((s,b)=>s+(b.fee||0),0),paid=billing.reduce((s,b)=>s+(b.paid||0),0),bal=billing.reduce((s,b)=>s+(b.balance||0),0);
  return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px">
    <div class="bill-sum-card"><div class="bill-sum-label">Total</div><div class="bill-sum-val">${formatCurrency(tot)}</div></div>
    <div class="bill-sum-card"><div class="bill-sum-label">Paid</div><div class="bill-sum-val" style="color:var(--green)">${formatCurrency(paid)}</div></div>
    <div class="bill-sum-card"><div class="bill-sum-label">Balance</div><div class="bill-sum-val" style="color:${bal>0?'var(--amber)':'var(--text)'}">${formatCurrency(bal)}</div></div>
  </div>
  <div class="card"><div class="table-wrap">${billing.length===0?'<div class="empty-state"><h3>No billing</h3></div>':`<table><thead><tr><th>Date</th><th>Description</th><th>Fee</th><th>Ins</th><th>Pt Pays</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>${billing.map(b=>`<tr><td>${formatDate(b.date)}</td><td>${b.description}</td><td class="td-mono">${formatCurrency(b.fee)}</td><td class="td-mono">${formatCurrency(b.insurance_pays)}</td><td class="td-mono">${formatCurrency(b.patient_pays)}</td><td class="td-mono" style="color:var(--green)">${formatCurrency(b.paid)}</td><td class="td-mono" style="color:${b.balance>0?'var(--amber)':'inherit'}">${formatCurrency(b.balance)}</td><td>${statusBadge(b.status)}</td></tr>`).join('')}</tbody></table>`}</div></div>`;
}

function renderNotesTab(p){return `<div class="card" style="padding:18px"><div class="form-group" style="margin-bottom:14px"><div class="form-label">Address</div><div style="color:var(--text);margin-top:4px">${p.address||'—'}</div></div><div class="divider"></div><div class="form-group" style="margin-bottom:14px"><div class="form-label">Allergies / Medical Alerts</div><div style="margin-top:4px">${p.allergies?`<span class="badge badge-red">⚠ ${p.allergies}</span>`:'<span class="badge badge-gray">None on file</span>'}</div></div><div class="divider"></div><div class="form-group"><div class="form-label">Clinical Notes</div><div style="color:var(--text);margin-top:4px;white-space:pre-wrap">${p.notes||'No notes'}</div></div></div>`;}

// Patient forms
function patientFormHTML(p={}){
  const provs=state.providers;
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">First Name *</label><input class="form-input" id="f-fname" value="${p.first_name||''}"/></div>
    <div class="form-group"><label class="form-label">Last Name *</label><input class="form-input" id="f-lname" value="${p.last_name||''}"/></div>
    <div class="form-group"><label class="form-label">Date of Birth</label><input class="form-input" id="f-dob" type="date" value="${p.dob||''}"/></div>
    <div class="form-group"><label class="form-label">Gender</label><select class="form-select" id="f-gender"><option value="">—</option><option ${p.gender==='Male'?'selected':''}>Male</option><option ${p.gender==='Female'?'selected':''}>Female</option><option ${p.gender==='Other'?'selected':''}>Other</option></select></div>
    <div class="form-group"><label class="form-label">Phone</label><input class="form-input" id="f-phone" value="${p.phone||''}"/></div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="f-email" type="email" value="${p.email||''}"/></div>
    <div class="form-group full"><label class="form-label">Address</label><input class="form-input" id="f-addr" value="${p.address||''}"/></div>
    <div class="form-group"><label class="form-label">Insurance Provider</label><input class="form-input" id="f-ins" value="${p.insurance||''}"/></div>
    <div class="form-group"><label class="form-label">Insurance ID</label><input class="form-input" id="f-insid" value="${p.insurance_id||''}"/></div>
    <div class="form-group"><label class="form-label">Primary Provider</label><select class="form-select" id="f-pprov"><option value="">—</option>${provs.filter(x=>!x.is_hygienist).map(x=>`<option ${p.primary_provider===x.name?'selected':''}>${x.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Hygienist</label><select class="form-select" id="f-sprov"><option value="">None</option>${provs.filter(x=>x.is_hygienist).map(x=>`<option ${p.secondary_provider===x.name?'selected':''}>${x.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Recall Due Date</label><input class="form-input" id="f-recall" type="date" value="${p.recall_due||''}"/></div>
    <div class="form-group"><label class="form-label">Allergies</label><input class="form-input" id="f-allg" value="${p.allergies||''}" placeholder="e.g. Penicillin, Latex"/></div>
    <div class="form-group full"><label class="form-label">Notes</label><textarea class="form-textarea" id="f-notes">${p.notes||''}</textarea></div>
    <div class="form-actions full" id="pat-form-actions"></div>
  </div>`;
}
function getPatientData(){return{first_name:$('#f-fname').value.trim(),last_name:$('#f-lname').value.trim(),dob:$('#f-dob').value,gender:$('#f-gender').value,phone:$('#f-phone').value.trim(),email:$('#f-email').value.trim(),address:$('#f-addr').value.trim(),insurance:$('#f-ins').value.trim(),insurance_id:$('#f-insid').value.trim(),primary_provider:$('#f-pprov').value,secondary_provider:$('#f-sprov').value,recall_due:$('#f-recall').value,allergies:$('#f-allg').value.trim(),notes:$('#f-notes').value.trim()};}
async function showNewPatientModal(){if(!state.providers.length)state.providers=await window.api.providers.getAll();openModal('New Patient',patientFormHTML(),body=>{$('#pat-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveNewPatient()">Save Patient</button>`;});}
async function saveNewPatient(){const p=getPatientData();if(!p.first_name||!p.last_name){toast('Name required','error');return;}await window.api.patients.create(p);closeModal();toast('Patient created','success');renderPatients();updateNavCounts();}
async function showEditPatientModal(id){if(!state.providers.length)state.providers=await window.api.providers.getAll();const p=await window.api.patients.get(id);openModal('Edit Patient',patientFormHTML(p),body=>{$('#pat-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveEditPatient(${id})">Save Changes</button>`;});}
async function saveEditPatient(id){const p={id,...getPatientData()};if(!p.first_name||!p.last_name){toast('Name required','error');return;}await window.api.patients.update(p);closeModal();toast('Updated','success');if(state.selectedPatient?.id===id)openPatientDetail(id);else renderPatients();}
async function deletePatient(id,name){if(!confirm(`Delete "${name}"? This cannot be undone.`))return;await window.api.patients.delete(id);toast('Deleted','info');renderPatients();updateNavCounts();}

async function showTransferModal(id, name, currentProvider, transferredTo, currentStatus) {
  const providers = await window.api.providers.getAll();
  const isTransferred = currentStatus === 'Transferred';
  openModal(`Transfer Patient — ${name}`, `
    <div style="margin-bottom:16px">
      ${isTransferred
        ? `<div class="prov-access-row" style="background:var(--amber2);border-color:rgba(217,119,6,.3)">
             <span class="badge badge-amber">Currently Transferred</span>
             <span style="font-size:12px;color:var(--text2)">→ ${transferredTo}</span>
           </div>`
        : `<div class="prov-access-row" style="background:var(--surface2)">
             <span style="font-size:12px;color:var(--text2)">Current provider: <strong>${currentProvider||'—'}</strong></span>
           </div>`}
    </div>
    <div class="form-grid">
      ${isTransferred ? '' : `
      <div class="form-group full">
        <label class="form-label">Transfer To *</label>
        <select class="form-select" id="tr-to">
          <option value="">Select provider...</option>
          ${providers.filter(p=>p.name!==currentProvider).map(p=>`
            <option value="${p.name}">${p.name} (${p.title||p.is_hygienist?'RDH':'MD'})</option>
          `).join('')}
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">Reason (optional)</label>
        <input class="form-input" id="tr-reason" placeholder="e.g. schedule conflict, specialization..."/>
      </div>`}
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      ${isTransferred
        ? `<button class="btn btn-ghost" onclick="undoTransfer(${id})">↩ Undo Transfer</button>`
        : `<button class="btn btn-primary" onclick="confirmTransfer(${id})">Transfer Patient</button>`}
    </div>`);
}

async function confirmTransfer(id) {
  const to = $('#tr-to')?.value;
  if (!to) { toast('Select a provider to transfer to','error'); return; }
  await window.api.patients.transfer({ id, transferred_to: to });
  closeModal();
  toast('Patient transferred','success');
  renderPatients();
}

async function undoTransfer(id) {
  await window.api.patients.undoTransfer(id);
  closeModal();
  toast('Transfer undone — patient restored to original provider','info');
  renderPatients();
}

// Treatment forms
function txFormHTML(t={}){const codes=['D0120','D0150','D0210','D0220','D1110','D1120','D2140','D2160','D2330','D2391','D2740','D2750','D3310','D3320','D3330','D4341','D4910','D7140','D7210'];return `<div class="form-grid"><div class="form-group"><label class="form-label">Tooth #</label><input class="form-input" id="t-tooth" value="${t.tooth||''}"/></div><div class="form-group"><label class="form-label">Surface</label><input class="form-input" id="t-surface" value="${t.surface||''}"/></div><div class="form-group"><label class="form-label">Code</label><select class="form-select" id="t-code"><option value="">—</option>${codes.map(c=>`<option ${t.procedure_code===c?'selected':''}>${c}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Fee</label><input class="form-input" id="t-fee" type="number" value="${t.fee||0}"/></div><div class="form-group full"><label class="form-label">Description *</label><input class="form-input" id="t-desc" value="${t.description||''}"/></div><div class="form-group"><label class="form-label">Status</label><select class="form-select" id="t-status"><option ${t.status==='Treatment Planned'?'selected':''}>Treatment Planned</option><option ${t.status==='In Progress'?'selected':''}>In Progress</option><option ${t.status==='Completed'?'selected':''}>Completed</option></select></div><div class="form-group"><label class="form-label">Priority</label><select class="form-select" id="t-priority"><option value="1">1 — Urgent</option><option value="2">2 — High</option><option value="3" ${(t.priority||3)==3?'selected':''}>3 — Medium</option><option value="4">4 — Low</option></select></div><div class="form-group"><label class="form-label">Provider</label><select class="form-select" id="t-prov">${state.providers.filter(p=>!p.is_hygienist).map(p=>`<option ${t.provider===p.name?'selected':''}>${p.name}</option>`).join('')}</select></div><div class="form-group full"><label class="form-label">Notes</label><textarea class="form-textarea" id="t-notes">${t.notes||''}</textarea></div><div class="form-actions full" id="tx-form-actions"></div></div>`;}
function showAddTxModal(pid){openModal('Add Treatment',txFormHTML(),body=>{$('#tx-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTx(null,${pid})">Add</button>`;});}
function showEditTxModal(t){if(typeof t==='string')t=JSON.parse(t);openModal('Edit Treatment',txFormHTML(t),body=>{$('#tx-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTx(${t.id},${t.patient_id})">Save</button>`;});}
async function saveTx(id,pid){const t={tooth:$('#t-tooth').value.trim(),surface:$('#t-surface').value.trim(),procedure_code:$('#t-code').value,description:$('#t-desc').value.trim(),status:$('#t-status').value,priority:parseInt($('#t-priority').value),fee:parseFloat($('#t-fee').value)||0,date_planned:new Date().toISOString().split('T')[0],date_completed:null,provider:$('#t-prov').value,notes:$('#t-notes').value.trim(),patient_id:pid};if(!t.description){toast('Description required','error');return;}if(id)await window.api.treatments.update({id,...t});else await window.api.treatments.create(t);closeModal();toast(id?'Updated':'Added','success');openPatientDetail(pid);}
async function deleteTx(id,pid){if(!confirm('Delete treatment?'))return;await window.api.treatments.delete(id);toast('Deleted','info');openPatientDetail(pid);}

// ═══════════════════════════════════════════════════════════════════════════
// BILLING MODULE
// ═══════════════════════════════════════════════════════════════════════════
async function renderBilling(){
  const restricted = !hasFullAccess();
  let bills = [];
  try { bills = await fetchMyBilling(); } catch(e) { console.error('renderBilling error:', e); }
  const tot=bills.reduce((s,b)=>s+(b.fee||0),0),paid=bills.reduce((s,b)=>s+(b.paid||0),0),bal=bills.reduce((s,b)=>s+(b.balance||0),0);
  const el=$('#view-billing');
  el.innerHTML=`
    <div class="page-header">
      <div><div class="page-title">${restricted ? 'My Billing & Revenue' : 'Billing & Insurance'}</div><div class="page-subtitle">${bills.length} records${restricted ? ' · my patients only' : ''}</div></div>
      <div class="page-actions"><button class="btn btn-primary" onclick="showNewBillModal()">+ New Charge</button></div>
    </div>
    <div class="billing-summary">
      <div class="bill-sum-card"><div class="bill-sum-label">Total Billed</div><div class="bill-sum-val">${formatCurrency(tot)}</div></div>
      <div class="bill-sum-card"><div class="bill-sum-label">Collected</div><div class="bill-sum-val" style="color:var(--green)">${formatCurrency(paid)}</div></div>
      <div class="bill-sum-card"><div class="bill-sum-label">Outstanding</div><div class="bill-sum-val" style="color:${bal>0?'var(--amber)':'var(--text)'}">${formatCurrency(bal)}</div></div>
    </div>
    <div class="table-container">
      <div class="card">${bills.length===0?'<div class="empty-state"><h3>No billing records</h3></div>':`
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Patient</th><th>Description</th><th>Code</th><th>Fee</th><th>Ins</th><th>Pt</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead>
          <tbody>${bills.map(b=>`
            <tr>
              <td class="td-mono">${formatDate(b.date)}</td>
              <td class="td-name">${b.patient_name||'—'}</td>
              <td>${b.description}</td>
              <td class="td-mono">${b.procedure_code||'—'}</td>
              <td class="td-mono">${formatCurrency(b.fee)}</td>
              <td class="td-mono">${formatCurrency(b.insurance_pays)}</td>
              <td class="td-mono">${formatCurrency(b.patient_pays)}</td>
              <td class="td-mono" style="color:var(--green)">${formatCurrency(b.paid)}</td>
              <td class="td-mono" style="color:${b.balance>0?'var(--amber)':'inherit'}">${formatCurrency(b.balance)}</td>
              <td>${statusBadge(b.status)}</td>
              <td><div style="display:flex;gap:3px">
                <button class="btn btn-ghost btn-xs" onclick="showEditBillModal(${b.id})">Edit</button>
                <button class="btn btn-danger btn-xs" onclick="deleteBill(${b.id})">Del</button>
              </div></td>
            </tr>`).join('')}
          </tbody>
        </table></div>`}
      </div>
    </div>`;
}
async function billFormHTML(b={}){
  const pts = await fetchMyPatients();
  return `<div class="form-grid"><div class="form-group full"><label class="form-label">Patient *</label><select class="form-select" id="b-pat"><option value="">Select...</option>${pts.map(p=>`<option value="${p.id}" ${b.patient_id==p.id?'selected':''}>${p.last_name}, ${p.first_name}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Date</label><input class="form-input" id="b-date" type="date" value="${b.date||new Date().toISOString().split('T')[0]}"/></div><div class="form-group"><label class="form-label">Procedure Code</label><input class="form-input" id="b-code" value="${b.procedure_code||''}"/></div><div class="form-group full"><label class="form-label">Description *</label><input class="form-input" id="b-desc" value="${b.description||''}"/></div><div class="form-group"><label class="form-label">Fee</label><input class="form-input" id="b-fee" type="number" value="${b.fee||0}" step="0.01"/></div><div class="form-group"><label class="form-label">Insurance Pays</label><input class="form-input" id="b-ins" type="number" value="${b.insurance_pays||0}" step="0.01"/></div><div class="form-group"><label class="form-label">Patient Pays</label><input class="form-input" id="b-ptpay" type="number" value="${b.patient_pays||0}" step="0.01"/></div><div class="form-group"><label class="form-label">Amount Paid</label><input class="form-input" id="b-paid" type="number" value="${b.paid||0}" step="0.01"/></div><div class="form-group"><label class="form-label">Status</label><select class="form-select" id="b-status">${['Pending','Paid','Partial','Overdue'].map(s=>`<option ${b.status===s?'selected':''}>${s}</option>`).join('')}</select></div><div class="form-actions full" id="bill-form-actions"></div></div>`;
}
async function showNewBillModal(){openModal('New Charge',await billFormHTML(),body=>{$('#bill-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveBill(null)">Add Charge</button>`;});}
async function showEditBillModal(id){
  const allBills = hasFullAccess()
    ? await window.api.billing.getAll()
    : await window.api.billing.getByProvider(myProvider());
  const b = allBills.find(x=>x.id===id);
  openModal('Edit Charge',await billFormHTML(b),body=>{$('#bill-form-actions',body).innerHTML=`<button class="btn btn-secondary" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveBill(${id})">Save</button>`;});
}
async function saveBill(id){const fee=parseFloat($('#b-fee').value)||0,paid=parseFloat($('#b-paid').value)||0,ptpay=parseFloat($('#b-ptpay').value)||0;const b={patient_id:parseInt($('#b-pat').value),date:$('#b-date').value,description:$('#b-desc').value.trim(),procedure_code:$('#b-code').value.trim(),fee,insurance_pays:parseFloat($('#b-ins').value)||0,patient_pays:ptpay,paid,balance:ptpay-paid,status:$('#b-status').value};if(!b.patient_id){toast('Select patient','error');return;}if(!b.description){toast('Description required','error');return;}if(id)await window.api.billing.update({id,...b});else await window.api.billing.create(b);closeModal();toast('Saved','success');renderBilling();updateNavCounts();}
async function deleteBill(id){if(!confirm('Delete?'))return;await window.api.billing.delete(id);toast('Deleted','info');renderBilling();updateNavCounts();}

// ═══════════════════════════════════════════════════════════════════════════
// DOCTORS MODULE
// ═══════════════════════════════════════════════════════════════════════════
const PROVIDER_COLORS = [
  '#2563eb','#0891b2','#059669','#7c3aed','#db2777',
  '#d97706','#dc2626','#0f2942','#065f46','#1e40af',
];

async function renderDoctors() {
  const el = $('#view-doctors');

  // Use cached providers immediately — no loading state
  let providers = state.providers && state.providers.length > 0
    ? state.providers
    : [];

  // Try to refresh providers from DB
  try { providers = await window.api.providers.getAll(); state.providers = providers; } catch(e) {}

  const doctors    = providers.filter(p => !p.is_hygienist);
  const hygienists = providers.filter(p =>  p.is_hygienist);

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Doctors & Providers</div>
        <div class="page-subtitle">${providers.length} providers</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="renderDoctors()">↻ Refresh</button>
        ${isAdmin() ? `
          <button class="btn btn-secondary" onclick="showNewProviderModal(1)">+ Add Hygienist</button>
          <button class="btn btn-primary" onclick="showNewProviderModal(0)">+ Add Doctor</button>
        ` : ''}
      </div>
    </div>
    <div id="avail-strip-placeholder" style="padding:8px 24px;font-size:12px;color:var(--text3)">Loading status...</div>
    <div style="padding:20px 24px;flex:1;overflow-y:auto">
      <div style="margin-bottom:24px">
        <div class="section-label">Doctors</div>
        ${doctors.length===0
          ? '<div class="empty-state"><h3>No doctors yet</h3></div>'
          : `<div class="doctors-grid" id="doctors-grid">${doctors.map(p=>simpleProviderCard(p)).join('')}</div>`}
      </div>
      <div>
        <div class="section-label">Hygienists</div>
        ${hygienists.length===0
          ? '<div class="empty-state"><h3>No hygienists yet</h3></div>'
          : `<div class="doctors-grid" id="hygienists-grid">${hygienists.map(p=>simpleProviderCard(p)).join('')}</div>`}
      </div>
    </div>`;

  el.addEventListener('click', function(e) {
    const editBtn   = e.target.closest('[data-edit-provider]');
    if (editBtn)   { e.stopPropagation(); showEditProviderModal(parseInt(editBtn.dataset.editProvider), editBtn.dataset.editUsername||'', parseInt(editBtn.dataset.editUserid)||null); return; }
    const delBtn    = e.target.closest('[data-delete-provider]');
    if (delBtn)    { e.stopPropagation(); deleteProvider(parseInt(delBtn.dataset.deleteProvider), delBtn.dataset.deleteName); return; }
    const grantBtn  = e.target.closest('[data-grant-user]');
    if (grantBtn)  { e.stopPropagation(); grantAccess(parseInt(grantBtn.dataset.grantUser)); return; }
    const revokeBtn = e.target.closest('[data-revoke-user]');
    if (revokeBtn) { e.stopPropagation(); revokeAccess(parseInt(revokeBtn.dataset.revokeUser)); return; }
    const card      = e.target.closest('[data-provider-id]');
    if (card)      { openDoctorDetail(parseInt(card.dataset.providerId)); }
  });

  // Enrich with availability + users in background
  enrichDoctorsPage(providers, el);
}

function simpleProviderCard(p) {
  return `
    <div class="provider-card status-free" data-provider-id="${p.id}" style="cursor:pointer">
      <div class="provider-card-top">
        <div class="provider-avatar" style="background:${p.color}">${initials(p.name.split(' ')[0], p.name.split(' ')[1]||'')}</div>
        <div class="prov-status-badge free"><div class="prov-status-dot free"></div>Free</div>
      </div>
      <div class="provider-card-name">${p.name}</div>
      <div class="provider-card-title">${p.title||'—'} · ${p.is_hygienist?'Hygienist':'Doctor'}</div>
      <div class="provider-card-actions" style="margin-top:12px">
        <button class="btn btn-secondary btn-sm" style="flex:1" data-edit-provider="${p.id}">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 5l4 4L7 17H3v-4L11 5z"/></svg>Edit
        </button>
        <button class="btn btn-danger btn-sm" data-delete-provider="${p.id}" data-delete-name="${p.name.replace(/"/g,'&quot;')}">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h12M10 11v4M8 11v4M6 7l1-2h6l1 2M8 7V5h4v2"/></svg>
        </button>
      </div>
    </div>`;
}

async function enrichDoctorsPage(providers, el) {
  let availability = [], users = [];
  try { availability = await window.api.providers.getAvailability(); } catch(e) {}
  try {
    if (isAdmin() && window.api.users && typeof window.api.users.getAll === 'function') {
      users = await window.api.users.getAll();
    }
  } catch(e) {}

  if (state.currentView !== 'doctors') return;

  const userMap  = {};
  // Map by exact provider_name AND by case-insensitive last name match
  users.forEach(u => {
    if (u.provider_name) {
      userMap[u.provider_name] = u;
      userMap[u.provider_name.toLowerCase()] = u;
    }
    // Also map by username (e.g. drjohnson → Dr. Johnson)
    userMap['__username__' + u.username] = u;
  });

  // Helper to find user for a provider
  const findUser = (provName) => {
    return userMap[provName]
        || userMap[provName.toLowerCase()]
        || users.find(u => {
             const last = provName.split(' ').pop().toLowerCase();
             return last.length > 2 && u.username.toLowerCase().includes(last);
           })
        || null;
  };
  const freeCount = availability.filter(p=>p.status==='Free').length;
  const busyCount = availability.filter(p=>p.status==='In Chair').length;

  // Update strip
  const strip = $('#avail-strip-placeholder', el);
  if (strip) strip.outerHTML = `<div class="avail-strip">
    <div class="avail-strip-item"><div class="avail-dot free"></div><span><strong>${freeCount}</strong> Free</span></div>
    <div class="avail-strip-item"><div class="avail-dot busy"></div><span><strong>${busyCount}</strong> In Chair</span></div>
    <div class="avail-strip-item"><div class="avail-dot" style="background:var(--text3)"></div><span><strong>${providers.length-freeCount-busyCount}</strong> Other</span></div>
    <span style="margin-left:auto;font-size:11px;color:var(--text3)">As of ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</span>
  </div>`;

  const availMap = {};
  availability.forEach(a => availMap[a.id] = a);

  // Update cards using findUser
  const dg = $('#doctors-grid', el);
  const hg = $('#hygienists-grid', el);
  const doctors    = providers.filter(p=>!p.is_hygienist);
  const hygienists = providers.filter(p=> p.is_hygienist);
  if (dg) dg.innerHTML = doctors.map(p=>providerCard(p,availMap[p.id]||{},findUser(p.name))).join('');
  if (hg) hg.innerHTML = hygienists.map(p=>providerCard(p,availMap[p.id]||{},findUser(p.name))).join('');

  clearTimeout(window._doctorRefreshTimer);
  window._doctorRefreshTimer = setTimeout(()=>{ if(state.currentView==='doctors') renderDoctors(); }, 60000);
}

function providerCard(p, avail={}, user=null) {
  const status   = avail.status || 'Free';
  const inChair  = avail.inChair;
  const nextAppt = avail.nextAppt;
  const done     = avail.doneCount || 0;
  const total    = avail.totalCount || 0;
  const pct      = total > 0 ? Math.round((done/total)*100) : 0;

  const sm = {
    'Free':     {cls:'status-free',    label:'Free',     dot:'free'},
    'In Chair': {cls:'status-busy',    label:'In Chair', dot:'busy'},
    'Overdue':  {cls:'status-overdue', label:'Overdue',  dot:'overdue'},
  }[status] || {cls:'status-free',label:'Free',dot:'free'};

  // Build the access/permission section (admin only)
  let accessSection = '';
  if (isAdmin() && users.length > 0) {
    if (!user && users.length === 0) {
      accessSection = '';
    } else if (!user) {
      // No linked user — show dropdown to link one
      const unlinkedUsers = users.filter(u => u.role !== 'admin');
      accessSection = `
        <div class="prov-access-row" style="background:var(--amber2);border-color:rgba(217,119,6,.25);flex-direction:column;align-items:flex-start;gap:8px">
          <span style="font-size:11px;color:var(--amber);font-weight:600">No login account linked</span>
          <div style="display:flex;gap:6px;width:100%">
            <select class="form-select" id="link-user-${p.id}" style="flex:1;font-size:11.5px;padding:4px 8px">
              <option value="">Select user to link...</option>
              ${unlinkedUsers.map(u=>`<option value="${u.id}">${u.username}</option>`).join('')}
            </select>
            <button class="btn btn-primary btn-xs" onclick="event.stopPropagation();linkUserToProvider(${p.id},'${p.name.replace(/'/g,"\\'")}')">Link</button>
            <button class="btn btn-secondary btn-xs" onclick="event.stopPropagation();quickCreateUser('${p.name.replace(/'/g,"\\'")}')">Create</button>
          </div>
        </div>`;
    } else if (user.role === 'admin') {
      accessSection = `
        <div class="prov-access-row" style="background:rgba(15,41,66,.06);border-color:rgba(15,41,66,.15)">
          <span class="badge badge-navy">Administrator</span>
          <span style="font-size:11px;color:var(--text3)">Full access always</span>
        </div>`;
    } else if (user.full_access) {
      accessSection = `
        <div class="prov-access-row" style="background:var(--green2);border-color:rgba(5,150,105,.25)">
          <span class="badge badge-green">Full Access</span>
          <button class="btn btn-danger btn-xs" data-revoke-user="${user.id}">Revoke</button>
        </div>`;
    } else {
      accessSection = `
        <div class="prov-access-row" style="background:var(--red2);border-color:rgba(220,38,38,.2)">
          <span class="badge badge-gray">Restricted</span>
          <button class="btn btn-sky btn-xs" data-grant-user="${user.id}">Grant Full Access</button>
        </div>`;
    }
  }

  return `
    <div class="provider-card ${sm.cls}" data-provider-id="${p.id}" style="cursor:pointer">
      <div class="provider-card-top">
        <div class="provider-avatar" style="background:${p.color}">${initials(p.name.split(' ')[0],p.name.split(' ')[1]||'')}</div>
        <div class="prov-status-badge ${sm.dot}">
          <div class="prov-status-dot ${sm.dot}"></div>${sm.label}
        </div>
      </div>
      <div class="provider-card-name">${p.name}</div>
      <div class="provider-card-title">${p.title||'—'} · ${p.is_hygienist?'Hygienist':'Doctor'}</div>
      ${inChair?`
        <div class="prov-in-chair-info">
          <div class="pic-label">Currently with</div>
          <div class="pic-patient">${inChair.patient_name}</div>
          <div class="pic-meta">${inChair.type||''} · ${inChair.op_name||''} · since ${inChair.time_seated||inChair.time}</div>
        </div>`:`
        <div class="prov-free-info">
          ${nextAppt?`<div class="pic-label">Next patient</div><div class="pic-patient">${nextAppt.patient_name}</div><div class="pic-meta">at ${nextAppt.time} · ${nextAppt.type||''}</div>`
            :`<div style="font-size:12px;color:var(--text3);padding:4px 0">No more appointments today</div>`}
        </div>`}
      <div class="prov-progress-row">
        <span class="prov-progress-label">${done} / ${total} today</span>
        <div class="prov-progress-bar"><div class="prov-progress-fill" style="width:${pct}%;background:${p.color}"></div></div>
        <span class="prov-progress-pct">${pct}%</span>
      </div>
      ${accessSection}
      ${isAdmin() ? `
      <div class="provider-card-actions">
        <button class="btn btn-secondary btn-sm" style="flex:1" data-edit-provider="${p.id}" data-edit-username="${user ? user.username : ''}" data-edit-userid="${user ? user.id : ''}">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 5l4 4L7 17H3v-4L11 5z"/></svg>Edit
        </button>
        <button class="btn btn-danger btn-sm" data-delete-provider="${p.id}" data-delete-name="${p.name.replace(/"/g,'&quot;')}">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h12M10 11v4M8 11v4M6 7l1-2h6l1 2M8 7V5h4v2"/></svg>
        </button>
      </div>` : ''}
    </div>`;
}

async function openDoctorDetail(providerId) {
  providerId = parseInt(providerId);
  const el = $('#view-doctors');
  el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text3)">Loading...</div>`;

  // Use the currently selected schedule date so it matches what's on screen
  const viewDate = state.scheduleDate || new Date().toISOString().split('T')[0];

  let providers = [], availability = [], appts = [];
  try {
    [providers, availability] = await Promise.all([
      window.api.providers.getAll(),
      window.api.providers.getAvailability(),
    ]);
  } catch(e) { console.error('openDoctorDetail fetch error:', e); }

  const p = providers.find(x => x.id === providerId);
  if (!p) { el.innerHTML = `<div class="empty-state"><h3>Provider not found</h3></div>`; return; }

  try {
    appts = await window.api.providers.getAppointments(p.name, viewDate);
  } catch(e) { console.error('getAppointments error:', e); appts = []; }

  const avail   = availability.find(x => x.id === providerId) || {};
  const status  = avail.status || 'Free';
  const inChair = avail.inChair || null;
  const done    = avail.doneCount || 0;
  const total   = avail.totalCount || 0;
  const pct     = total > 0 ? Math.round((done/total)*100) : 0;
  const dotCls  = status === 'In Chair' ? 'busy' : status === 'Overdue' ? 'overdue' : 'free';

  el.innerHTML = `
    <div class="page-header">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-secondary btn-sm" onclick="renderDoctors()">← Back</button>
        <div>
          <div class="page-title" style="font-size:17px">${p.name}</div>
          <div class="page-subtitle">${p.title||''} · ${p.is_hygienist?'Hygienist':'Doctor'}</div>
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="openDoctorDetail(${p.id})">↻ Refresh</button>
        ${isAdmin() ? `<button class="btn btn-secondary btn-sm" onclick="showEditProviderModal(${p.id},'${(avail.username||'').replace(/'/g,"\\'")}',${avail.userId||'null'})">Edit</button>` : ''}
      </div>
    </div>

    <div style="padding:20px 24px;flex:1;overflow-y:auto">

      <!-- Hero -->
      <div class="doctor-detail-hero">
        <div class="provider-avatar" style="background:${p.color};width:64px;height:64px;font-size:22px;border-radius:14px;flex-shrink:0">
          ${initials(p.name.split(' ')[0], p.name.split(' ')[1]||'')}
        </div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:20px;font-weight:700;color:var(--navy)">${p.name}</span>
            <div class="prov-status-badge ${dotCls}">
              <div class="prov-status-dot ${dotCls}"></div>
              ${status}
            </div>
          </div>
          <div style="font-size:13px;color:var(--text2)">${p.title||'—'} · ${p.is_hygienist?'Hygienist':'Doctor'}</div>
        </div>
        <div class="doctor-stats-row">
          <div class="doctor-stat"><div class="doctor-stat-val">${total}</div><div class="doctor-stat-label">Scheduled</div></div>
          <div class="doctor-stat"><div class="doctor-stat-val" style="color:var(--green)">${done}</div><div class="doctor-stat-label">Completed</div></div>
          <div class="doctor-stat"><div class="doctor-stat-val" style="color:var(--amber)">${total-done}</div><div class="doctor-stat-label">Remaining</div></div>
          <div class="doctor-stat"><div class="doctor-stat-val">${pct}%</div><div class="doctor-stat-label">Progress</div></div>
        </div>
      </div>

      <!-- Status Banner -->
      ${inChair ? `
        <div class="in-chair-alert">
          <div class="ica-icon">🪑</div>
          <div class="ica-body">
            <div class="ica-label">Currently in chair</div>
            <div class="ica-patient">${inChair.patient_name}</div>
            <div class="ica-meta">${inChair.type||''} · ${inChair.op_name||''} · since ${inChair.time_seated||inChair.time}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="switchToView('patients');setTimeout(()=>openPatientDetail(${inChair.patient_id}),150)">View Patient</button>
        </div>` : `
        <div class="free-alert">
          <div class="fa-dot" style="${status==='Overdue'?'background:var(--amber)':''}"></div>
          <span>${status==='Free'?'No patient currently in chair — provider is free':'Next appointment is overdue — patient not yet seated'}</span>
        </div>`}

      <!-- Today's Appointments -->
      <div style="margin-top:22px">
        <div class="section-label" style="margin-bottom:14px">
          Today's Patients (${appts.length}) — ${new Date(viewDate+'T00:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}
        </div>
        ${appts.length === 0
          ? '<div class="empty-state"><h3>No appointments today</h3><p>This provider has no scheduled appointments today</p></div>'
          : `<div class="doctor-appt-list">
              ${appts.map(a => {
                const isActive  = a.status === 'In Chair';
                const isDone    = a.status === 'Completed';
                const isWaiting = a.time_arrived && !a.time_seated;
                const barColor  = isActive ? 'var(--red)' : isDone ? 'var(--green)' : isWaiting ? 'var(--sky2)' : (a.op_color || 'var(--border)');
                return `
                  <div class="doc-appt-row${isActive?' doc-appt-active':''}${isDone?' doc-appt-done':''}">
                    <div class="doc-appt-time">
                      <div class="doc-appt-clock">${a.time}</div>
                      <div class="doc-appt-dur">${a.duration}m</div>
                    </div>
                    <div class="doc-appt-status-bar" style="background:${barColor}"></div>
                    <div class="doc-appt-body">
                      <div class="doc-appt-name">${a.patient_name||'—'}</div>
                      <div class="doc-appt-meta">${a.type||'Appointment'} · ${a.op_name||'—'}</div>
                      ${a.allergies&&a.allergies!=='None'?`<div class="doc-appt-allergy">⚠ ${a.allergies}</div>`:''}
                      ${a.procedures?`<div class="doc-appt-procs">${a.procedures}</div>`:''}
                    </div>
                    <div class="doc-appt-right">
                      ${isActive  ? `<span class="badge badge-red">In Chair</span>` :
                        isDone    ? `<span class="badge badge-green">Done</span>` :
                        isWaiting ? `<span class="badge badge-sky">Waiting</span>` :
                                    statusBadge(a.status)}
                      ${a.time_arrived?`<div style="font-size:10px;color:var(--text3);margin-top:3px">In: ${a.time_arrived}</div>`:''}
                      ${a.time_seated ?`<div style="font-size:10px;color:var(--text3)">Seated: ${a.time_seated}</div>`:''}
                    </div>
                    <div class="doc-appt-actions">
                      <button class="btn btn-ghost btn-xs" onclick="switchToView('patients');setTimeout(()=>openPatientDetail(${a.patient_id}),150)">Patient</button>
                      <button class="btn btn-ghost btn-xs" onclick="showEditApptModal(${a.id})">Appt</button>
                    </div>
                  </div>`;
              }).join('')}
            </div>`}
      </div>
    </div>`;
}

function providerFormHTML(p={}, user=null, allUsers=[]) {
  const isHyg    = p.is_hygienist || 0;
  const isEdit   = !!p.id;
  const isAdmin_ = user?.role === 'admin';
  const fullAccess = user?.full_access || 0;

  // Build color swatches
  const swatches = PROVIDER_COLORS.map(c =>
    `<div class="color-swatch ${p.color===c?'selected':''}" style="background:${c}" onclick="selectProviderColor('${c}')" data-color="${c}"></div>`
  ).join('');

  // Build login section separately to avoid nested template literal issues
  let loginSection = '';
  if (isAdmin()) {
    let currentUserBadge = '';
    let noUserWarning = '';

    if (isEdit && user) {
      currentUserBadge = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">'
        + '<span style="font-size:11px;color:var(--text3)">Current:</span>'
        + '<span style="font-size:13px;font-weight:700;color:var(--navy);background:var(--surface2);border:1.5px solid var(--border);padding:2px 10px;border-radius:6px;font-family:var(--mono)">' + user.username + '</span>'
        + '</div>';
    }

    if (isEdit && !user && allUsers.length > 0) {
      const opts = allUsers.map(u =>
        '<option value="' + u.username + '">' + u.username + ' (' + (u.provider_name || 'unlinked') + ')</option>'
      ).join('');
      noUserWarning = '<div style="background:var(--amber2);border:1.5px solid rgba(217,119,6,.3);border-radius:8px;padding:10px 14px;margin-bottom:12px">'
        + '<div style="font-size:12px;color:var(--amber);font-weight:600;margin-bottom:8px">⚠ No login account linked</div>'
        + '<div style="display:flex;gap:8px;align-items:center">'
        + '<select class="form-select" id="pf-link-existing"><option value="">— Link existing account —</option>' + opts + '</select>'
        + '<span style="font-size:11px;color:var(--text3)">or create new below</span>'
        + '</div></div>';
    }

    const usernameLabel = (!isEdit || !user) ? 'Username *' : 'Username';
    const passwordLabel = (isEdit && user) ? 'New Password' : 'Password';
    const passwordPlaceholder = (isEdit && user) ? 'Leave blank to keep current' : 'Min 6 characters';
    const currentUsername = user ? user.username : '';

    let accessSection = '';
    if (isAdmin_) {
      accessSection = '<div class="prov-access-row" style="background:rgba(15,41,66,.06);border-color:rgba(15,41,66,.15)">'
        + '<span class="badge badge-navy">Administrator</span>'
        + '<span style="font-size:12px;color:var(--text3)">Admin accounts always have full access</span>'
        + '</div>';
    } else {
      accessSection = '<div class="prov-access-row" style="background:var(--surface2);border-color:var(--border2)">'
        + '<div><div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:3px">Full Access</div>'
        + '<div style="font-size:12px;color:var(--text2)">Allow this doctor to see all patients, appointments and billing</div></div>'
        + '<label class="toggle-switch"><input type="checkbox" id="pf-fullaccess" ' + (fullAccess ? 'checked' : '') + '/><span class="toggle-track"></span></label>'
        + '</div>';
    }

    loginSection = '<div class="form-group full">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border)">Login Account</div>'
      + noUserWarning
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + '<div class="form-group" style="margin-bottom:0">'
          + '<label class="form-label">' + usernameLabel + '</label>'
          + currentUserBadge
          + '<input class="form-input" id="pf-username" value="' + currentUsername + '" placeholder="e.g. drsmith" autocomplete="off"/>'
        + '</div>'
        + '<div class="form-group" style="margin-bottom:0">'
          + '<label class="form-label">' + passwordLabel + '</label>'
          + '<div style="position:relative">'
            + '<input class="form-input" id="pf-password" type="password" placeholder="' + passwordPlaceholder + '" autocomplete="new-password" style="padding-right:36px"/>'
            + '<button type="button" onclick="pfTogglePw()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text3)">'
              + '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>'
            + '</button>'
          + '</div>'
        + '</div>'
      + '</div>'
    + '</div>'
    + '<div class="form-group full"><label class="form-label">Access Permission</label>' + accessSection + '</div>';
  }

  return `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Full Name *</label>
        <input class="form-input" id="pf-name" value="${p.name||''}" placeholder="e.g. Dr. Smith"/>
      </div>
      <div class="form-group">
        <label class="form-label">Title / Credential</label>
        <input class="form-input" id="pf-title" value="${p.title||''}" placeholder="e.g. DDS, DMD, RDH"/>
      </div>
      <div class="form-group full">
        <label class="form-label">Role</label>
        <div style="display:flex;gap:10px;margin-top:2px">
          <label class="form-check"><input type="radio" name="pf-role" id="pf-doctor" value="0" ${!isHyg?'checked':''}/> Doctor / Provider</label>
          <label class="form-check"><input type="radio" name="pf-role" id="pf-hyg" value="1" ${isHyg?'checked':''}/> Hygienist</label>
        </div>
      </div>
      <div class="form-group full">
        <label class="form-label">Calendar Color</label>
        <div class="color-picker-row">${swatches}
          <input type="color" id="pf-color-custom" value="${p.color||PROVIDER_COLORS[0]}"
            style="width:32px;height:32px;border-radius:6px;border:1.5px solid var(--border);padding:2px;cursor:pointer"
            oninput="selectProviderColor(this.value)"/>
        </div>
        <input type="hidden" id="pf-color" value="${p.color||PROVIDER_COLORS[0]}"/>
      </div>
      ${loginSection}
      <div class="form-actions full" id="pf-actions"></div>
    </div>`;
}
function pfTogglePw() {
  const i = document.getElementById('pf-password');
  if (i) i.type = i.type === 'password' ? 'text' : 'password';
}

function selectProviderColor(color) {
  $('#pf-color').value = color;
  $('#pf-color-custom').value = color;
  $$('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color===color));
}

function showNewProviderModal(isHyg=0) {
  openModal(isHyg ? 'Add Hygienist' : 'Add Doctor', providerFormHTML({is_hygienist:isHyg}), body=>{
    if (isHyg) $('#pf-hyg', body).checked = true;
    else       $('#pf-doctor', body).checked = true;
    $('#pf-actions', body).innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProvider(null, null)">Save</button>`;
  });
}

async function showEditProviderModal(id, knownUsername='', knownUserId=null) {
  const p = await window.api.providers.get(id);
  let user = null;
  let allUsers = [];

  if (isAdmin()) {
    try {
      // Server-side lookup — does all matching + auto-fixes provider_name in DB
      if (window.api.providers.getUserForProvider) {
        user = await window.api.providers.getUserForProvider(p.name);
      }
      // Also load all users for dropdown
      if (window.api.users) {
        allUsers = await window.api.users.getAll();
        // Final fallback: known username from card button
        if (!user && knownUsername) {
          user = allUsers.find(u => u.username === knownUsername) || null;
        }
        // Final fallback: any user list match
        if (!user) {
          const last = p.name.split(' ').pop().toLowerCase();
          if (last.length > 2) user = allUsers.find(u => u.username.toLowerCase().includes(last)) || null;
        }
      }
    } catch(e) { console.warn('user lookup failed:', e); }
  }

  openModal('Edit Provider', providerFormHTML(p, user, allUsers), body=>{
    $('#pf-actions', body).innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProvider(${id},${user?user.id:'null'})">Save Changes</button>`;
  });
}

async function saveProvider(id, userId) {
  // userId comes as string 'null' from onclick, convert properly
  userId = (userId && userId !== 'null' && !isNaN(userId)) ? parseInt(userId) : null;

  const name       = $('#pf-name')?.value.trim();
  const username   = $('#pf-username')?.value.trim();
  const password   = $('#pf-password')?.value.trim();
  const fullAccess = $('#pf-fullaccess')?.checked ? 1 : 0;

  if (!name) { toast('Name is required', 'error'); return; }

  const providerData = {
    name,
    title:        $('#pf-title')?.value.trim() || '',
    color:        $('#pf-color')?.value || PROVIDER_COLORS[0],
    is_hygienist: $('input[name="pf-role"]:checked')?.value === '1' ? 1 : 0,
  };

  if (id) {
    // Update provider record
    await window.api.providers.update({...providerData, id});

    // Handle user account (admin only)
    if (isAdmin() && window.api.users) {
      try {
        // Check if linking existing account from dropdown
        const linkExisting = $('#pf-link-existing')?.value;
        if (linkExisting) {
          const allU = await window.api.users.getAll();
          const found = allU.find(u => u.username === linkExisting);
          if (found) {
            userId = found.id;
            await window.api.users.update({...found, provider_name: name});
          }
        }

        if (userId) {
          // Update existing user account
          const allU = await window.api.users.getAll();
          const existingUser = allU.find(u => u.id === userId);
          if (existingUser) {
            const newUsername = username || existingUser.username;
            if (password && password.length > 0 && password.length < 6) {
              toast('Password must be at least 6 characters', 'error'); return;
            }
            const updateObj = {
              id: userId,
              username: newUsername,
              password: password && password.length >= 6 ? password : existingUser.password,
              role: existingUser.role,
              provider_name: name,
              full_access: fullAccess,
            };
            await window.api.users.update(updateObj);
          }
        } else if (username && password) {
          // Create new user account
          if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
          const result = await window.api.users.create({
            username, password, role: 'doctor', provider_name: name, full_access: fullAccess
          });
          if (result && result.error) { toast('Username already taken', 'error'); return; }
        }
      } catch(e) { console.warn('User update error:', e); }
    }
    toast('Provider updated', 'success');

  } else {
    // Create new provider
    await window.api.providers.create(providerData);

    // Create linked login account if username + password provided
    if (isAdmin() && window.api.users && username && password) {
      try {
        if (password.length < 6) {
          toast('Provider added — password too short, no login created', 'warn');
        } else {
          const result = await window.api.users.create({
            username, password, role: 'doctor', provider_name: name, full_access: fullAccess
          });
          if (result && result.error) toast('Provider added but username taken — set login in Users page', 'warn');
          else toast('Provider and login account created', 'success');
        }
      } catch(e) {}
    } else {
      toast('Provider added', 'success');
    }
  }

  closeModal();
  state.providers = await window.api.providers.getAll();
  updateNavCounts();
  renderDoctors();
}

async function deleteProvider(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  await window.api.providers.delete(id);
  toast('Provider deleted','info');
  state.providers = await window.api.providers.getAll();
  updateNavCounts();
  renderDoctors();
}

// ═══════════════════════════════════════════════════════════════════════════
// USERS MODULE (Admin only)
// ═══════════════════════════════════════════════════════════════════════════
async function renderUsers() {
  if (!isAdmin()) { toast('Access denied','error'); return; }
  const [users, providers] = await Promise.all([
    window.api.users.getAll(),
    window.api.providers.getAll(),
  ]);
  const el = $('#view-users');

  const roleBadge = r => r==='admin'
    ? '<span class="badge badge-navy">Admin</span>'
    : '<span class="badge badge-sky">Doctor</span>';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">User Management</div>
        <div class="page-subtitle">${users.length} users · Admin only</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" onclick="showNewUserModal()">+ Add User</button>
      </div>
    </div>
    <div class="table-container" style="flex:1;overflow-y:auto">
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Username</th><th>Role</th><th>Linked Provider</th>
              <th>Full Access</th><th>Created</th><th>Actions</th>
            </tr></thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:9px">
                      <div class="user-list-avatar" style="background:${u.role==='admin'?'var(--navy)':'var(--sky2)'}">
                        ${(u.username[0]||'').toUpperCase()}
                      </div>
                      <div>
                        <div class="td-name">${u.username}</div>
                        <div class="td-mono">${u.provider_name||'—'}</div>
                      </div>
                    </div>
                  </td>
                  <td>${roleBadge(u.role)}</td>
                  <td>${u.provider_name||'<span class="text-muted">None</span>'}</td>
                  <td>
                    ${u.role==='admin'
                      ? '<span class="badge badge-green">Always</span>'
                      : u.full_access
                        ? `<span class="badge badge-green">Granted</span>
                           <button class="btn btn-ghost btn-xs" onclick="revokeAccess(${u.id})">Revoke</button>`
                        : `<span class="badge badge-gray">Restricted</span>
                           <button class="btn btn-sky btn-xs" onclick="grantAccess(${u.id})">Grant Full</button>`}
                  </td>
                  <td class="text-muted td-mono">${u.created_at?u.created_at.split(' ')[0]:'—'}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary btn-xs" onclick="showEditUserModal(${u.id})">Edit</button>
                      ${u.role!=='admin'?`<button class="btn btn-danger btn-xs" onclick="deleteUser(${u.id},'${u.username}')">Del</button>`:''}
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Info box -->
      <div class="user-info-box">
        <div class="uib-title">Access Levels</div>
        <div class="uib-row">
          <span class="badge badge-navy">Admin</span>
          <span>Full access to everything including User Management</span>
        </div>
        <div class="uib-row">
          <span class="badge badge-green">Full Access</span>
          <span>Doctor with full access — sees all patients, all appointments, all billing</span>
        </div>
        <div class="uib-row">
          <span class="badge badge-gray">Restricted</span>
          <span>Doctor with restricted access — sees only their own patients and appointments</span>
        </div>
      </div>
    </div>`;
}

function userFormHTML(u={}, providers=[]) {
  const isEdit = !!u.id;
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">Username *</label>
      <input class="form-input" id="uf-username" value="${u.username||''}" placeholder="e.g. drsmith" autocomplete="off"/>
    </div>
    <div class="form-group"><label class="form-label">${isEdit ? 'New Password' : 'Password *'}</label>
      <div style="position:relative">
        <input class="form-input" id="uf-password" type="password" placeholder="${isEdit ? 'Leave blank to keep current' : 'Min 6 characters'}" autocomplete="new-password" style="padding-right:36px"/>
        <button type="button" onclick="toggleUFPassword()" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text3);padding:2px">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
        </button>
      </div>
      ${isEdit ? '<div style="font-size:11px;color:var(--text3);margin-top:4px">Leave blank to keep the current password</div>' : ''}
    </div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-select" id="uf-role" onchange="toggleFullAccessField()">
        <option value="doctor" ${u.role==='doctor'||!u.role?'selected':''}>Doctor</option>
        <option value="admin"  ${u.role==='admin'?'selected':''}>Admin</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">Linked Provider</label>
      <select class="form-select" id="uf-provider">
        <option value="">None</option>
        ${providers.map(p=>`<option value="${p.name}" ${u.provider_name===p.name?'selected':''}>${p.name} (${p.title||''})</option>`).join('')}
      </select>
    </div>
    <div class="form-group full" id="uf-fullaccess-row" style="${u.role==='admin'?'display:none':''}">
      <label class="form-check">
        <input type="checkbox" id="uf-fullaccess" ${u.full_access?'checked':''}/>
        Grant Full Access (can see all patients &amp; appointments)
      </label>
    </div>
    <div class="form-actions full" id="uf-actions"></div>
  </div>`;
}

function toggleUFPassword() {
  const inp = $('#uf-password');
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

function toggleFullAccessField() {
  const role = $('#uf-role')?.value;
  const row  = $('#uf-fullaccess-row');
  if (row) row.style.display = role==='admin' ? 'none' : '';
}

async function showNewUserModal() {
  const providers = await window.api.providers.getAll();
  openModal('Add User', userFormHTML({}, providers), body => {
    $('#uf-actions', body).innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUser(null)">Create User</button>`;
  });
}

async function showEditUserModal(id) {
  const [users, providers] = await Promise.all([window.api.users.getAll(), window.api.providers.getAll()]);
  const u = users.find(x => x.id === id);
  openModal('Edit User', userFormHTML(u, providers), body => {
    $('#uf-actions', body).innerHTML = `
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUser(${id})">Save Changes</button>`;
  });
}

async function saveUser(id) {
  const username = $('#uf-username').value.trim();
  const password = $('#uf-password')?.value.trim();
  const role     = $('#uf-role').value;
  const provider = $('#uf-provider').value;
  const full     = $('#uf-fullaccess')?.checked ? 1 : 0;

  if (!username) { toast('Username required','error'); return; }
  if (!id && !password) { toast('Password required for new users','error'); return; }
  if (password && password.length < 6) { toast('Password must be at least 6 characters','error'); return; }

  const obj = { username, role, provider_name: provider||null, full_access: role==='admin'?1:full };

  // Only include password if provided (on create always, on edit only if changed)
  if (password) obj.password = password;
  else if (!id) { toast('Password required','error'); return; }

  const result = id
    ? await window.api.users.update({ id, ...obj })
    : await window.api.users.create(obj);

  if (result && result.error) { toast('Username already taken — try another','error'); return; }
  closeModal();
  toast(id ? 'User updated' : 'User created', 'success');
  updateNavCounts();
  renderUsers();
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? They will no longer be able to log in.`)) return;
  await window.api.users.delete(id);
  toast('User deleted','info');
  updateNavCounts();
  renderUsers();
}

async function linkUserToProvider(providerId, providerName) {
  const sel = $(`#link-user-${providerId}`);
  const userId = sel?.value;
  if (!userId) { toast('Please select a user','error'); return; }
  await window.api.users.update({ id: parseInt(userId), provider_name: providerName });
  toast(`Linked to ${providerName}`,'success');
  renderDoctors();
}

async function quickCreateUser(providerName) {
  // Generate a username from provider name e.g. "Dr. Smith" → "drsmith"
  const suggested = providerName.toLowerCase().replace(/dr\.?\s*/,'').replace(/\s+/g,'').replace(/[^a-z0-9]/g,'');
  openModal(`Create Account — ${providerName}`, `
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">Create a login account linked to <strong>${providerName}</strong>.</p>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Username *</label>
        <input class="form-input" id="qcu-username" value="${suggested}" placeholder="e.g. drsmith"/>
      </div>
      <div class="form-group"><label class="form-label">Password *</label>
        <input class="form-input" id="qcu-password" type="password" value="password123" placeholder="Min 6 characters"/>
      </div>
      <div class="form-group full">
        <label class="form-check">
          <input type="checkbox" id="qcu-fullaccess"/>
          Grant Full Access (sees all patients &amp; appointments)
        </label>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="confirmQuickCreateUser('${providerName.replace(/'/g,"\\'")}')">Create Account</button>
    </div>`);
}

async function confirmQuickCreateUser(providerName) {
  const username = $('#qcu-username').value.trim();
  const password = $('#qcu-password').value.trim();
  const fullAccess = $('#qcu-fullaccess').checked ? 1 : 0;
  if (!username) { toast('Username required','error'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters','error'); return; }
  const result = await window.api.users.create({
    username, password, role: 'doctor',
    provider_name: providerName, full_access: fullAccess
  });
  if (result && result.error) { toast('Username already taken — try another','error'); return; }
  closeModal();
  toast(`Account created for ${providerName}`, 'success');
  renderDoctors();
}

async function linkUserToProvider(providerId, providerName) {
  const userId = parseInt($('#pf-link-user')?.value);
  if (!userId) { toast('Please select a user to link','error'); return; }
  try {
    const users = await window.api.users.getAll();
    const user = users.find(u => u.id === userId);
    if (!user) { toast('User not found','error'); return; }
    await window.api.users.update({...user, provider_name: providerName});
    toast(`Linked ${user.username} to ${providerName}`, 'success');
    closeModal();
    renderDoctors();
  } catch(e) { toast('Failed to link account','error'); }
}

async function grantAccess(id) {
  await window.api.users.grantFullAccess(id);
  toast('Full access granted','success');
  renderUsers();
}

async function revokeAccess(id) {
  await window.api.users.revokeFullAccess(id);
  toast('Full access revoked','info');
  renderUsers();
}

function showChangePasswordModal(id, username) {
  openModal(`Change Password — ${username}`, `
    <div class="form-grid">
      <div class="form-group full"><label class="form-label">New Password *</label>
        <input class="form-input" id="cp-pw" type="password" placeholder="Min 6 characters"/>
      </div>
      <div class="form-group full"><label class="form-label">Confirm Password</label>
        <input class="form-input" id="cp-pw2" type="password" placeholder="Repeat password"/>
      </div>
      <div class="form-actions full">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="savePassword(${id})">Change Password</button>
      </div>
    </div>`);
}

async function savePassword(id) {
  const pw  = $('#cp-pw').value.trim();
  const pw2 = $('#cp-pw2').value.trim();
  if (!pw || pw.length < 6) { toast('Password must be at least 6 characters','error'); return; }
  if (pw !== pw2) { toast('Passwords do not match','error'); return; }
  await window.api.users.changePassword({ id, password: pw });
  closeModal();
  toast('Password changed successfully','success');
}

(async()=>{
  state.providers   = await window.api.providers.getAll();
  state.operatories = await window.api.operatories.getAll();
  // Don't auto-render — wait for login
})();