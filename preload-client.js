const { contextBridge, ipcRenderer } = require('electron');
const http = require('http');

// Get config from main process synchronously
const config = ipcRenderer.sendSync('config:getSync') || {};
const BASE = config.serverUrl || 'http://localhost:3747';
const KEY  = config.serverKey || '';

console.log('[preload-client] BASE:', BASE);

// Make HTTP requests from the preload (Node.js context - no CSP)
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url    = new URL(BASE + path);
    const data   = body ? JSON.stringify(body) : null;
    const opts   = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(KEY ? { 'x-server-key': KEY } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const GET  = p       => request('GET',    p);
const POST = (p, b)  => request('POST',   p, b);
const PUT  = (p, b)  => request('PUT',    p, b);
const DEL  = p       => request('DELETE', p);

// Expose window.api identical to the IPC preload
contextBridge.exposeInMainWorld('api', {
  patients: {
    getAll:        ()    => GET('/patients'),
    get:           (id)  => GET(`/patients/${id}`),
    search:        (q)   => GET(`/patients/search?q=${encodeURIComponent(q)}`),
    create:        (p)   => POST('/patients', p),
    update:        (p)   => PUT(`/patients/${p.id}`, p),
    delete:        (id)  => DEL(`/patients/${id}`),
    getByProvider: (n)   => GET(`/patients/provider?name=${encodeURIComponent(n)}`),
    transfer:      (o)   => POST(`/patients/${o.id}/transfer`, o),
    undoTransfer:  (id)  => POST(`/patients/${id}/undoTransfer`, {}),
  },
  operatories: {
    getAll:  ()  => GET('/operatories'),
    create:  (o) => POST('/operatories', o),
    update:  (o) => PUT(`/operatories/${o.id}`, o),
    delete:  (id)=> DEL(`/operatories/${id}`),
  },
  appointments: {
    getAll:               ()           => GET('/appointments'),
    getByDate:            (date)       => GET(`/appointments/date/${date}`),
    getByPatient:         (pid)        => GET(`/appointments/patient/${pid}`),
    getByProvider:        ({date,name})=> GET(`/appointments/provider?date=${date}&name=${encodeURIComponent(name)}`),
    getWaitingRoom:       ()           => GET('/appointments/waiting'),
    getUnscheduled:       ()           => GET('/appointments/unscheduled'),
    getASAP:              ()           => GET('/appointments/asap'),
    getPinboard:          ()           => GET('/appointments/pinboard'),
    getRecallDue:         ()           => GET('/appointments/recall'),
    create:               (a)         => POST('/appointments', a),
    update:               (a)         => PUT(`/appointments/${a.id}`, a),
    delete:               (id)        => DEL(`/appointments/${id}`),
    sendToPinboard:       (id)        => POST(`/appointments/${id}/pinboard`, {}),
    sendToUnscheduled:    (id)        => POST(`/appointments/${id}/unscheduled`, {}),
    scheduleFromPinboard: (o)         => POST('/appointments/scheduleFromPinboard', o),
    markASAP:             (id)        => POST(`/appointments/${id}/asap`, {}),
    updateStatus:         ({id,status})    => POST(`/appointments/${id}/status`, {status}),
    updateConfirmed:      ({id,confirmed}) => POST(`/appointments/${id}/confirmed`, {confirmed}),
    updateArrival:        ({id,time_arrived}) => POST(`/appointments/${id}/arrival`, {time: time_arrived}),
    seatPatient:          ({id,time}) => POST(`/appointments/${id}/seat`, {time}),
    dismissPatient:       (id)        => POST(`/appointments/${id}/dismiss`, {}),
    removeArrival:        (id)        => POST(`/appointments/${id}/removeArrival`, {}),
  },
  blockouts: {
    getByDate: (date) => GET(`/blockouts/${date}`),
    create:    (b)    => POST('/blockouts', b),
    delete:    (id)   => DEL(`/blockouts/${id}`),
  },
  treatments: {
    getByPatient: (pid) => GET(`/treatments/patient/${pid}`),
    create: (t) => POST('/treatments', t),
    update: (t) => PUT(`/treatments/${t.id}`, t),
    delete: (id)=> DEL(`/treatments/${id}`),
  },
  billing: {
    getAll:        ()    => GET('/billing'),
    getByPatient:  (pid) => GET(`/billing/patient/${pid}`),
    getByProvider: (n)   => GET(`/billing/provider?name=${encodeURIComponent(n)}`),
    create: (b) => POST('/billing', b),
    update: (b) => PUT(`/billing/${b.id}`, b),
    delete: (id)=> DEL(`/billing/${id}`),
  },
  providers: {
    getAll:          ()         => GET('/providers'),
    get:             (id)       => GET(`/providers/${id}`),
    create:          (p)        => POST('/providers', p),
    update:          (p)        => PUT(`/providers/${p.id}`, p),
    delete:          (id)       => DEL(`/providers/${id}`),
    getAvailability: ()         => GET('/providers/availability/all'),
    getAppointments: (name, date) => GET(`/providers/${encodeURIComponent(name)}/appointments?date=${date||''}`),
  },
  stats: {
    dashboard: (prov) => GET(`/stats/dashboard${prov ? `?provider=${encodeURIComponent(prov)}` : ''}`),
  },
  users: {
    login:           (creds) => POST('/users/login', creds),
    getAll:          ()      => GET('/users'),
    getByProvider:   (n)     => GET(`/users/provider?name=${encodeURIComponent(n)}`),
    create:          (u)     => POST('/users', u),
    update:          (u)     => PUT(`/users/${u.id}`, u),
    delete:          (id)    => DEL(`/users/${id}`),
    grantFullAccess: (id)    => POST(`/users/${id}/grantFullAccess`, {}),
    revokeFullAccess:(id)    => POST(`/users/${id}/revokeFullAccess`, {}),
    changePassword:  ({id,password}) => POST(`/users/${id}/password`, {password}),
  },
});

// Signal to app.js that we're in client mode
contextBridge.exposeInMainWorld('__clientConfig', {
  serverUrl: BASE,
  serverKey: KEY,
});

contextBridge.exposeInMainWorld('electronAPI', {
  reconfigure: () => ipcRenderer.invoke('setup:reconfigure'),
  resetSetup:  () => ipcRenderer.invoke('config:reset'),
  getConfig:   () => ipcRenderer.invoke('config:get'),
});

console.log('[preload-client] API ready, connecting to:', BASE);