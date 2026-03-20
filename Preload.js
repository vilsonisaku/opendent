const { contextBridge, ipcRenderer } = require('electron');

// Step 1: expose a test marker immediately
contextBridge.exposeInMainWorld('__preloadRan', true);

// Step 2: read config from argv
let config = {};
try {
  const arg = process.argv.find(a => a.startsWith('--dental-config='));
  if (arg) {
    config = JSON.parse(Buffer.from(arg.replace('--dental-config=', ''), 'base64').toString('utf8'));
  }
} catch(e) {}

const IS_CLIENT = config.mode === 'client';
const BASE = (IS_CLIENT && config.serverUrl) ? config.serverUrl : 'http://localhost:3747';
const KEY  = config.serverKey || '';

contextBridge.exposeInMainWorld('__clientConfig', IS_CLIENT ? { serverUrl: BASE, serverKey: KEY } : null);

// Step 3: build http requester (client) or ipc proxy (server)
// Proxy HTTP requests through main process (has full Node.js access)
function httpReq(method, p, body) {
  return ipcRenderer.invoke('http:request', { method, url: BASE + p, body, key: KEY });
}

const G = p       => IS_CLIENT ? httpReq('GET',    p)    : null;
const P = (p, b)  => IS_CLIENT ? httpReq('POST',   p, b) : null;
const U = (p, b)  => IS_CLIENT ? httpReq('PUT',    p, b) : null;
const D = p       => IS_CLIENT ? httpReq('DELETE', p)    : null;
const I = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

const api = {
  patients: {
    getAll:        () => IS_CLIENT ? G('/patients')                                   : I('patients:getAll'),
    get:           id => IS_CLIENT ? G(`/patients/${id}`)                             : I('patients:get', id),
    search:        q  => IS_CLIENT ? G(`/patients/search?q=${encodeURIComponent(q)}`) : I('patients:search', q),
    create:        p  => IS_CLIENT ? P('/patients', p)                                : I('patients:create', p),
    update:        p  => IS_CLIENT ? U(`/patients/${p.id}`, p)                        : I('patients:update', p),
    delete:        id => IS_CLIENT ? D(`/patients/${id}`)                             : I('patients:delete', id),
    getByProvider: n  => IS_CLIENT ? G(`/patients/provider?name=${encodeURIComponent(n)}`) : I('patients:getByProvider', n),
    transfer:      o  => IS_CLIENT ? P(`/patients/${o.id}/transfer`, o)               : I('patients:transfer', o),
    undoTransfer:  id => IS_CLIENT ? P(`/patients/${id}/undoTransfer`, {})            : I('patients:undoTransfer', id),
  },
  operatories: {
    getAll:  ()  => IS_CLIENT ? G('/operatories')                : I('operatories:getAll'),
    create:  o   => IS_CLIENT ? P('/operatories', o)             : I('operatories:create', o),
    update:  o   => IS_CLIENT ? U(`/operatories/${o.id}`, o)     : I('operatories:update', o),
    delete:  id  => IS_CLIENT ? D(`/operatories/${id}`)          : I('operatories:delete', id),
  },
  appointments: {
    getAll:               ()           => IS_CLIENT ? G('/appointments')                                                        : I('appointments:getAll'),
    getByDate:            date         => IS_CLIENT ? G(`/appointments/date/${date}`)                                           : I('appointments:getByDate', date),
    getByPatient:         pid          => IS_CLIENT ? G(`/appointments/patient/${pid}`)                                         : I('appointments:getByPatient', pid),
    getByProvider:        ({date,name})=> IS_CLIENT ? G(`/appointments/provider?date=${date}&name=${encodeURIComponent(name)}`) : I('appointments:getByProvider', {date,name}),
    getWaitingRoom:       ()           => IS_CLIENT ? G('/appointments/waiting')                                                : I('appointments:getWaitingRoom'),
    getUnscheduled:       ()           => IS_CLIENT ? G('/appointments/unscheduled')                                            : I('appointments:getUnscheduled'),
    getASAP:              ()           => IS_CLIENT ? G('/appointments/asap')                                                   : I('appointments:getASAP'),
    getPinboard:          ()           => IS_CLIENT ? G('/appointments/pinboard')                                               : I('appointments:getPinboard'),
    getRecallDue:         ()           => IS_CLIENT ? G('/appointments/recall')                                                 : I('appointments:getRecallDue'),
    create:               a            => IS_CLIENT ? P('/appointments', a)                                                     : I('appointments:create', a),
    update:               a            => IS_CLIENT ? U(`/appointments/${a.id}`, a)                                             : I('appointments:update', a),
    delete:               id           => IS_CLIENT ? D(`/appointments/${id}`)                                                  : I('appointments:delete', id),
    sendToPinboard:       id           => IS_CLIENT ? P(`/appointments/${id}/pinboard`, {})                                     : I('appointments:sendToPinboard', id),
    sendToUnscheduled:    id           => IS_CLIENT ? P(`/appointments/${id}/unscheduled`, {})                                  : I('appointments:sendToUnscheduled', id),
    scheduleFromPinboard: o            => IS_CLIENT ? P('/appointments/scheduleFromPinboard', o)                                : I('appointments:scheduleFromPinboard', o),
    markASAP:             id           => IS_CLIENT ? P(`/appointments/${id}/asap`, {})                                         : I('appointments:markASAP', id),
    updateStatus:         ({id,status})=> IS_CLIENT ? P(`/appointments/${id}/status`, {status})                                 : I('appointments:updateStatus', {id,status}),
    updateConfirmed:      ({id,confirmed})=>IS_CLIENT?P(`/appointments/${id}/confirmed`,{confirmed})                            : I('appointments:updateConfirmed', {id,confirmed}),
    updateArrival:        ({id,time_arrived})=>IS_CLIENT?P(`/appointments/${id}/arrival`,{time:time_arrived})                   : I('appointments:updateArrival', {id,time_arrived}),
    seatPatient:          ({id,time}) => IS_CLIENT ? P(`/appointments/${id}/seat`, {time})                                      : I('appointments:seatPatient', {id,time}),
    dismissPatient:       id          => IS_CLIENT ? P(`/appointments/${id}/dismiss`, {})                                       : I('appointments:dismissPatient', id),
    removeArrival:        id          => IS_CLIENT ? P(`/appointments/${id}/removeArrival`, {})                                 : I('appointments:removeArrival', id),
  },
  blockouts: {
    getByDate: date => IS_CLIENT ? G(`/blockouts/${date}`)   : I('blockouts:getByDate', date),
    create:    b    => IS_CLIENT ? P('/blockouts', b)         : I('blockouts:create', b),
    delete:    id   => IS_CLIENT ? D(`/blockouts/${id}`)      : I('blockouts:delete', id),
  },
  treatments: {
    getByPatient: pid => IS_CLIENT ? G(`/treatments/patient/${pid}`) : I('treatments:getByPatient', pid),
    create: t  => IS_CLIENT ? P('/treatments', t)       : I('treatments:create', t),
    update: t  => IS_CLIENT ? U(`/treatments/${t.id}`,t): I('treatments:update', t),
    delete: id => IS_CLIENT ? D(`/treatments/${id}`)    : I('treatments:delete', id),
  },
  billing: {
    getAll:        ()  => IS_CLIENT ? G('/billing')                                          : I('billing:getAll'),
    getByPatient:  pid => IS_CLIENT ? G(`/billing/patient/${pid}`)                           : I('billing:getByPatient', pid),
    getByProvider: n   => IS_CLIENT ? G(`/billing/provider?name=${encodeURIComponent(n)}`)   : I('billing:getByProvider', n),
    create: b  => IS_CLIENT ? P('/billing', b)        : I('billing:create', b),
    update: b  => IS_CLIENT ? U(`/billing/${b.id}`,b) : I('billing:update', b),
    delete: id => IS_CLIENT ? D(`/billing/${id}`)     : I('billing:delete', id),
  },
  providers: {
    getAll:          ()        => IS_CLIENT ? G('/providers')                                                              : I('providers:getAll'),
    get:             id        => IS_CLIENT ? G(`/providers/${id}`)                                                        : I('providers:get', id),
    create:          p         => IS_CLIENT ? P('/providers', p)                                                           : I('providers:create', p),
    update:          p         => IS_CLIENT ? U(`/providers/${p.id}`, p)                                                   : I('providers:update', p),
    delete:          id        => IS_CLIENT ? D(`/providers/${id}`)                                                        : I('providers:delete', id),
    getAvailability: ()        => IS_CLIENT ? G('/providers/availability/all')                                             : I('providers:getAvailability'),
    getAppointments: (name,date)=>IS_CLIENT ? G(`/providers/${encodeURIComponent(name)}/appointments?date=${date||''}`)    : I('providers:getAppointments', {name,date}),
  },
  stats: {
    dashboard: prov => IS_CLIENT ? G(`/stats/dashboard${prov?`?provider=${encodeURIComponent(prov)}`:''}`): I('stats:dashboard', prov),
  },
  users: {
    login:           creds => IS_CLIENT ? P('/users/login', creds)                         : I('users:login', creds),
    getAll:          ()    => IS_CLIENT ? G('/users')                                       : I('users:getAll'),
    getByProvider:   n     => IS_CLIENT ? G(`/users/provider?name=${encodeURIComponent(n)}`): I('users:getByProvider', n),
    create:          u     => IS_CLIENT ? P('/users', u)                                    : I('users:create', u),
    update:          u     => IS_CLIENT ? U(`/users/${u.id}`, u)                            : I('users:update', u),
    delete:          id    => IS_CLIENT ? D(`/users/${id}`)                                 : I('users:delete', id),
    grantFullAccess: id    => IS_CLIENT ? P(`/users/${id}/grantFullAccess`, {})             : I('users:grantFullAccess', id),
    revokeFullAccess:id    => IS_CLIENT ? P(`/users/${id}/revokeFullAccess`, {})            : I('users:revokeFullAccess', id),
    changePassword:  ({id,password}) => IS_CLIENT ? P(`/users/${id}/password`,{password})  : I('users:changePassword', {id,password}),
  },
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('electronAPI', {
  reconfigure:      () => ipcRenderer.invoke('setup:reconfigure'),
  getConfig:        () => ipcRenderer.invoke('config:get'),
  saveClientConfig: (cfg) => ipcRenderer.invoke('config:saveClient', cfg),
});

console.log('[preload] done — IS_CLIENT:', IS_CLIENT, '| api exposed:', typeof api);