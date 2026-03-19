/**
 * DentalPro Client API Bridge
 * In CLIENT mode this is injected instead of preload IPC bindings.
 * It translates window.api calls to HTTP fetch requests to the remote server.
 */
(function() {
  // Only activate in client mode — when __clientConfig is injected by preload-client.js
  if (typeof window.__clientConfig === 'undefined') {
    console.log('[DentalPro] Local/server mode — using IPC preload');
    return;
  }
  const cfg  = window.__clientConfig;
  const BASE = cfg.serverUrl || 'http://localhost:3747';
  const KEY  = cfg.serverKey || '';

  async function req(method, path, body) {
    const url = BASE + path;
    const headers = { 'Content-Type': 'application/json' };
    if (KEY) headers['x-server-key'] = KEY;
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`Server error ${r.status} on ${method} ${url}`);
      return r.json();
    } catch(e) {
      console.error(`[DentalPro API] ${method} ${url} failed:`, e.message);
      throw e;
    }
  }

  const GET  = p       => req('GET',    p);
  const POST = (p, b)  => req('POST',   p, b);
  const PUT  = (p, b)  => req('PUT',    p, b);
  const DEL  = p       => req('DELETE', p);

  window.api = {
    patients: {
      getAll:       ()    => GET('/patients'),
      get:          (id)  => GET(`/patients/${id}`),
      search:       (q)   => GET(`/patients/search?q=${encodeURIComponent(q)}`),
      create:       (p)   => POST('/patients', p),
      update:       (p)   => PUT(`/patients/${p.id}`, p),
      delete:       (id)  => DEL(`/patients/${id}`),
      getByProvider:(name)=> GET(`/patients/provider?name=${encodeURIComponent(name)}`),
      transfer:     (obj) => POST(`/patients/${obj.id}/transfer`, obj),
      undoTransfer: (id)  => POST(`/patients/${id}/undoTransfer`, {}),
    },
    operatories: {
      getAll:  ()   => GET('/operatories'),
      create:  (o)  => POST('/operatories', o),
      update:  (o)  => PUT(`/operatories/${o.id}`, o),
      delete:  (id) => DEL(`/operatories/${id}`),
    },
    appointments: {
      getAll:               ()       => GET('/appointments'),
      getByDate:            (date)   => GET(`/appointments/date/${date}`),
      getByPatient:         (pid)    => GET(`/appointments/patient/${pid}`),
      getByProvider:        ({date,name}) => GET(`/appointments/provider?date=${date}&name=${encodeURIComponent(name)}`),
      getWaitingRoom:       ()       => GET('/appointments/waiting'),
      getUnscheduled:       ()       => GET('/appointments/unscheduled'),
      getASAP:              ()       => GET('/appointments/asap'),
      getPinboard:          ()       => GET('/appointments/pinboard'),
      getRecallDue:         ()       => GET('/appointments/recall'),
      create:               (a)     => POST('/appointments', a),
      update:               (a)     => PUT(`/appointments/${a.id}`, a),
      delete:               (id)    => DEL(`/appointments/${id}`),
      sendToPinboard:       (id)    => POST(`/appointments/${id}/pinboard`, {}),
      sendToUnscheduled:    (id)    => POST(`/appointments/${id}/unscheduled`, {}),
      scheduleFromPinboard: (o)     => POST('/appointments/scheduleFromPinboard', o),
      markASAP:             (id)    => POST(`/appointments/${id}/asap`, {}),
      updateStatus:         ({id,status}) => POST(`/appointments/${id}/status`, {status}),
      updateConfirmed:      ({id,confirmed}) => POST(`/appointments/${id}/confirmed`, {confirmed}),
      updateArrival:        ({id,time_arrived}) => POST(`/appointments/${id}/arrival`, {time: time_arrived}),
      seatPatient:          ({id,time}) => POST(`/appointments/${id}/seat`, {time}),
      dismissPatient:       (id)    => POST(`/appointments/${id}/dismiss`, {}),
      removeArrival:        (id)    => POST(`/appointments/${id}/removeArrival`, {}),
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
      delete: (id) => DEL(`/treatments/${id}`),
    },
    billing: {
      getAll:        ()     => GET('/billing'),
      getByPatient:  (pid)  => GET(`/billing/patient/${pid}`),
      getByProvider: (name) => GET(`/billing/provider?name=${encodeURIComponent(name)}`),
      create: (b) => POST('/billing', b),
      update: (b) => PUT(`/billing/${b.id}`, b),
      delete: (id) => DEL(`/billing/${id}`),
    },
    providers: {
      getAll:           ()           => GET('/providers'),
      get:              (id)         => GET(`/providers/${id}`),
      create:           (p)          => POST('/providers', p),
      update:           (p)          => PUT(`/providers/${p.id}`, p),
      delete:           (id)         => DEL(`/providers/${id}`),
      getAvailability:  ()           => GET('/providers/availability/all'),
      getAppointments:  (name, date) => GET(`/providers/${encodeURIComponent(name)}/appointments?date=${date||''}`),
    },
    stats: {
      dashboard: (prov) => GET(`/stats/dashboard${prov?`?provider=${encodeURIComponent(prov)}`:''}`),
    },
    users: {
      login:            (creds) => POST('/users/login', creds),
      getAll:           ()      => GET('/users'),
      getByProvider:    (name)  => GET(`/users/provider?name=${encodeURIComponent(name)}`),
      create:           (u)     => POST('/users', u),
      update:           (u)     => PUT(`/users/${u.id}`, u),
      delete:           (id)    => DEL(`/users/${id}`),
      grantFullAccess:  (id)    => POST(`/users/${id}/grantFullAccess`, {}),
      revokeFullAccess: (id)    => POST(`/users/${id}/revokeFullAccess`, {}),
      changePassword:   ({id,password}) => POST(`/users/${id}/password`, {password}),
    },
  };

  console.log('[DentalPro] Running in CLIENT mode →', BASE);
})();