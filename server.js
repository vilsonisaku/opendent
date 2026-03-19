/**
 * DentalPro Network Server
 * Exposes the SQLite database over HTTP REST API
 * Runs when the app is configured in "server" mode
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const os      = require('os');

let db = null;
let app = null;
let httpServer = null;

function startServer(database, port = 3747, serverKey = '') {
  db  = database;
  app = express();

  // CORS — must be first, before everything including auth
  const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-server-key', 'Authorization'],
    credentials: false,
  };
  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions)); // handle preflight BEFORE auth
  app.use(express.json());

  // ── Request logger ────────────────────────────────────────────────
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?';
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms) from ${ip}`);
    });
    next();
  });

  // ── Auth middleware ───────────────────────────────────────────────
  app.use((req, res, next) => {
    // Skip auth for health check and OPTIONS preflight
    if (req.path === '/health' || req.method === 'OPTIONS') return next();
    const key = req.headers['x-server-key'] || req.query.key;
    if (serverKey && key !== serverKey) {
      return res.status(401).json({ error: 'Invalid server key' });
    }
    next();
  });

  // ── Health check ─────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.json({ ok: true, version: '2.4', mode: 'server', hostname: os.hostname() });
  });

  // ── Generic DB helper ─────────────────────────────────────────────
  const run  = (sql, ...args) => { try { return db.prepare(sql).run(...args); } catch(e) { return { error: e.message }; } };
  const get  = (sql, ...args) => { try { return db.prepare(sql).get(...args); } catch(e) { return null; } };
  const all  = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch(e) { return []; } };

  // ── Patients ─────────────────────────────────────────────────────
  app.get('/patients',          (_, res) => res.json(all(`SELECT * FROM patients ORDER BY last_name`)));
  app.get('/patients/search',   (req, res) => res.json(all(`SELECT * FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? ORDER BY last_name`, `%${req.query.q}%`,`%${req.query.q}%`,`%${req.query.q}%`)));
  app.get('/patients/provider', (req, res) => res.json(all(`SELECT DISTINCT p.* FROM patients p WHERE (p.primary_provider=? AND (p.status!='Transferred' OR p.status IS NULL OR p.status='')) OR (p.transferred_to=? AND p.status='Transferred') ORDER BY p.last_name`, req.query.name, req.query.name)));
  app.get('/patients/:id',      (req, res) => res.json(get(`SELECT * FROM patients WHERE id=?`, req.params.id)));
  app.post('/patients',         (req, res) => { const r = run(`INSERT INTO patients (first_name,last_name,dob,gender,phone,email,address,insurance,insurance_id,allergies,notes,primary_provider,secondary_provider,recall_due,status) VALUES (@first_name,@last_name,@dob,@gender,@phone,@email,@address,@insurance,@insurance_id,@allergies,@notes,@primary_provider,@secondary_provider,@recall_due,@status)`, req.body); res.json(r); });
  app.put('/patients/:id',      (req, res) => res.json(run(`UPDATE patients SET first_name=@first_name,last_name=@last_name,dob=@dob,gender=@gender,phone=@phone,email=@email,address=@address,insurance=@insurance,insurance_id=@insurance_id,allergies=@allergies,notes=@notes,primary_provider=@primary_provider,secondary_provider=@secondary_provider,recall_due=@recall_due WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/patients/:id',   (req, res) => res.json(run(`DELETE FROM patients WHERE id=?`, req.params.id)));
  app.post('/patients/:id/transfer',     (req, res) => { const today=new Date().toISOString().split('T')[0]; const p=get(`SELECT * FROM patients WHERE id=?`,req.params.id); res.json(run(`UPDATE patients SET status='Transferred',transferred_to=?,transferred_from=?,transferred_date=? WHERE id=?`, req.body.transferred_to, p?.primary_provider||'', today, req.params.id)); });
  app.post('/patients/:id/undoTransfer', (req, res) => res.json(run(`UPDATE patients SET status='Active',transferred_to='',transferred_from='',transferred_date='' WHERE id=?`, req.params.id)));

  // ── Operatories ──────────────────────────────────────────────────
  app.get('/operatories',        (_, res) => res.json(all(`SELECT * FROM operatories ORDER BY sort_order`)));
  app.post('/operatories',       (req, res) => { const r = run(`INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (@name,@abbr,@color,@default_provider,@is_hygiene,@sort_order)`, req.body); res.json(r); });
  app.put('/operatories/:id',    (req, res) => res.json(run(`UPDATE operatories SET name=@name,abbr=@abbr,color=@color,default_provider=@default_provider,is_hygiene=@is_hygiene WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/operatories/:id', (req, res) => res.json(run(`DELETE FROM operatories WHERE id=?`, req.params.id)));

  // ── Appointments ─────────────────────────────────────────────────
  const apptSelect = `SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.allergies,p.insurance,p.dob,o.name as op_name,o.color as op_color FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN operatories o ON a.operatory_id=o.id`;
  app.get('/appointments',              (_, res) => res.json(all(`${apptSelect} ORDER BY a.date,a.time`)));
  app.get('/appointments/date/:date',   (req, res) => res.json(all(`${apptSelect} WHERE a.date=? AND a.unscheduled=0 AND a.pinboard=0 ORDER BY a.time`, req.params.date)));
  app.get('/appointments/patient/:pid', (req, res) => res.json(all(`${apptSelect} WHERE a.patient_id=? ORDER BY a.date DESC,a.time`, req.params.pid)));
  app.get('/appointments/provider',     (req, res) => res.json(all(`${apptSelect} WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.unscheduled=0 AND a.pinboard=0 ORDER BY a.time`, req.query.date, req.query.name, req.query.name)));
  app.get('/appointments/unscheduled',  (_, res) => res.json(all(`${apptSelect} WHERE a.unscheduled=1 ORDER BY p.last_name`)));
  app.get('/appointments/asap',         (_, res) => res.json(all(`${apptSelect} WHERE a.is_asap=1 ORDER BY p.last_name`)));
  app.get('/appointments/pinboard',     (_, res) => res.json(all(`${apptSelect} WHERE a.pinboard=1 ORDER BY a.rowid DESC`)));
  app.get('/appointments/waiting',      (_, res) => res.json(all(`${apptSelect} WHERE (a.status='Arrived' OR (a.time_arrived IS NOT NULL AND a.time_arrived!='' AND (a.time_seated IS NULL OR a.time_seated='') AND a.status NOT IN ('Completed','Cancelled','No Show','In Chair'))) AND a.unscheduled=0 ORDER BY a.time_arrived`)));
  app.get('/appointments/recall',       (_, res) => res.json(all(`SELECT * FROM patients WHERE recall_due IS NOT NULL AND recall_due <= date('now','+60 days') ORDER BY recall_due`)));
  app.post('/appointments',             (req, res) => { const r = run(`INSERT INTO appointments (patient_id,operatory_id,date,time,duration,type,provider,hygienist,status,confirmed,is_new_patient,is_hygiene,is_asap,patient_note,appt_note,unscheduled,pinboard,procedures,time_arrived,time_seated,time_dismissed) VALUES (@patient_id,@operatory_id,@date,@time,@duration,@type,@provider,@hygienist,@status,@confirmed,@is_new_patient,@is_hygiene,@is_asap,@patient_note,@appt_note,@unscheduled,@pinboard,@procedures,@time_arrived,@time_seated,@time_dismissed)`, req.body); res.json(r); });
  app.put('/appointments/:id',          (req, res) => res.json(run(`UPDATE appointments SET patient_id=@patient_id,operatory_id=@operatory_id,date=@date,time=@time,duration=@duration,type=@type,provider=@provider,hygienist=@hygienist,status=@status,confirmed=@confirmed,is_new_patient=@is_new_patient,is_hygiene=@is_hygiene,is_asap=@is_asap,patient_note=@patient_note,appt_note=@appt_note,unscheduled=@unscheduled,pinboard=@pinboard,procedures=@procedures,time_arrived=@time_arrived,time_seated=@time_seated,time_dismissed=@time_dismissed WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/appointments/:id',       (req, res) => res.json(run(`DELETE FROM appointments WHERE id=?`, req.params.id)));
  app.post('/appointments/:id/pinboard',    (req, res) => res.json(run(`UPDATE appointments SET pinboard=1,unscheduled=0,date='',time='' WHERE id=?`, req.params.id)));
  app.post('/appointments/:id/unscheduled', (req, res) => res.json(run(`UPDATE appointments SET unscheduled=1,pinboard=0,date='',time='' WHERE id=?`, req.params.id)));
  app.post('/appointments/:id/asap',        (req, res) => res.json(run(`UPDATE appointments SET is_asap=1 WHERE id=?`, req.params.id)));
  app.post('/appointments/:id/status',      (req, res) => res.json(run(`UPDATE appointments SET status=? WHERE id=?`, req.body.status, req.params.id)));
  app.post('/appointments/:id/confirmed',   (req, res) => res.json(run(`UPDATE appointments SET confirmed=? WHERE id=?`, req.body.confirmed, req.params.id)));
  app.post('/appointments/:id/arrival',     (req, res) => { const t=req.body.time||new Date().toTimeString().slice(0,5); res.json(run(`UPDATE appointments SET time_arrived=?,status='Arrived' WHERE id=?`, t, req.params.id)); });
  app.post('/appointments/:id/seat',        (req, res) => { const t=req.body.time||new Date().toTimeString().slice(0,5); res.json(run(`UPDATE appointments SET time_seated=?,status='In Chair' WHERE id=?`, t, req.params.id)); });
  app.post('/appointments/:id/dismiss',     (req, res) => res.json(run(`UPDATE appointments SET time_dismissed=?,status='Completed' WHERE id=?`, new Date().toTimeString().slice(0,5), req.params.id)));
  app.post('/appointments/:id/removeArrival',(req, res) => res.json(run(`UPDATE appointments SET time_arrived='',status='Confirmed' WHERE id=?`, req.params.id)));
  app.post('/appointments/scheduleFromPinboard', (req, res) => res.json(run(`UPDATE appointments SET pinboard=0,unscheduled=0,date=?,time=?,operatory_id=? WHERE id=?`, req.body.date, req.body.time, req.body.operatory_id, req.body.id)));

  // ── Blockouts ────────────────────────────────────────────────────
  app.get('/blockouts/:date',    (req, res) => res.json(all(`SELECT * FROM blockouts WHERE date=? ORDER BY operatory_id,start_time`, req.params.date)));
  app.post('/blockouts',         (req, res) => { const r = run(`INSERT INTO blockouts (operatory_id,date,start_time,end_time,type,color,note) VALUES (@operatory_id,@date,@start_time,@end_time,@type,@color,@note)`, req.body); res.json(r); });
  app.delete('/blockouts/:id',   (req, res) => res.json(run(`DELETE FROM blockouts WHERE id=?`, req.params.id)));

  // ── Treatments ───────────────────────────────────────────────────
  app.get('/treatments/patient/:pid', (req, res) => res.json(all(`SELECT * FROM treatments WHERE patient_id=? ORDER BY priority,id`, req.params.pid)));
  app.post('/treatments',             (req, res) => { const r = run(`INSERT INTO treatments (patient_id,tooth,surface,procedure_code,description,status,priority,fee,date_planned,provider,notes) VALUES (@patient_id,@tooth,@surface,@procedure_code,@description,@status,@priority,@fee,@date_planned,@provider,@notes)`, req.body); res.json(r); });
  app.put('/treatments/:id',          (req, res) => res.json(run(`UPDATE treatments SET tooth=@tooth,surface=@surface,procedure_code=@procedure_code,description=@description,status=@status,priority=@priority,fee=@fee,date_planned=@date_planned,date_completed=@date_completed,provider=@provider,notes=@notes WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/treatments/:id',       (req, res) => res.json(run(`DELETE FROM treatments WHERE id=?`, req.params.id)));

  // ── Billing ──────────────────────────────────────────────────────
  app.get('/billing',              (_, res) => res.json(all(`SELECT b.*,p.first_name||' '||p.last_name as patient_name FROM billing b LEFT JOIN patients p ON b.patient_id=p.id ORDER BY b.date DESC`)));
  app.get('/billing/patient/:pid', (req, res) => res.json(all(`SELECT * FROM billing WHERE patient_id=? ORDER BY date DESC`, req.params.pid)));
  app.get('/billing/provider',     (req, res) => res.json(all(`SELECT b.*,p.first_name||' '||p.last_name as patient_name FROM billing b LEFT JOIN patients p ON b.patient_id=p.id LEFT JOIN appointments a ON a.patient_id=b.patient_id WHERE a.provider=? OR a.hygienist=? OR p.primary_provider=? GROUP BY b.id ORDER BY b.date DESC`, req.query.name, req.query.name, req.query.name)));
  app.post('/billing',             (req, res) => { const r = run(`INSERT INTO billing (patient_id,date,description,procedure_code,fee,insurance_pays,patient_pays,paid,balance,status) VALUES (@patient_id,@date,@description,@procedure_code,@fee,@insurance_pays,@patient_pays,@paid,@balance,@status)`, req.body); res.json(r); });
  app.put('/billing/:id',          (req, res) => res.json(run(`UPDATE billing SET date=@date,description=@description,fee=@fee,insurance_pays=@insurance_pays,patient_pays=@patient_pays,paid=@paid,balance=@balance,status=@status WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/billing/:id',       (req, res) => res.json(run(`DELETE FROM billing WHERE id=?`, req.params.id)));

  // ── Providers ────────────────────────────────────────────────────
  app.get('/providers',           (_, res) => res.json(all(`SELECT * FROM providers ORDER BY is_hygienist,name`)));
  app.get('/providers/:id',       (req, res) => res.json(get(`SELECT * FROM providers WHERE id=?`, req.params.id)));
  app.get('/providers/availability/all', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const now   = new Date().toTimeString().slice(0,5);
    const providers = all(`SELECT * FROM providers ORDER BY is_hygienist,name`);
    const result = providers.map(p => {
      try {
        const inChair  = get(`SELECT a.*,pt.first_name||' '||pt.last_name as patient_name,o.name as op_name FROM appointments a LEFT JOIN patients pt ON a.patient_id=pt.id LEFT JOIN operatories o ON a.operatory_id=o.id WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.status='In Chair' LIMIT 1`, today,p.name,p.name);
        const nextAppt = get(`SELECT a.*,pt.first_name||' '||pt.last_name as patient_name FROM appointments a LEFT JOIN patients pt ON a.patient_id=pt.id WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.time>? AND a.status NOT IN ('Completed','Cancelled','No Show') ORDER BY a.time LIMIT 1`, today,p.name,p.name,now);
        const doneCount  = get(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND (provider=? OR hygienist=?) AND status='Completed'`, today,p.name,p.name)?.c||0;
        const totalCount = get(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND (provider=? OR hygienist=?) AND status NOT IN ('Cancelled','No Show') AND unscheduled=0`, today,p.name,p.name)?.c||0;
        const status = inChair ? 'In Chair' : (nextAppt && nextAppt.time<=now) ? 'Overdue' : 'Free';
        return {...p, status, inChair:inChair||null, nextAppt:nextAppt||null, doneCount, totalCount};
      } catch(e) { return {...p, status:'Free', inChair:null, nextAppt:null, doneCount:0, totalCount:0}; }
    });
    res.json(result);
  });
  app.get('/providers/:name/appointments', (req, res) => {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    res.json(all(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.phone,p.dob,p.allergies,p.insurance,o.name as op_name,o.color as op_color FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN operatories o ON a.operatory_id=o.id WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.unscheduled=0 AND a.pinboard=0 ORDER BY a.time`, date, req.params.name, req.params.name));
  });
  app.post('/providers',         (req, res) => { const r = run(`INSERT INTO providers (name,title,color,is_hygienist) VALUES (@name,@title,@color,@is_hygienist)`, req.body); res.json(r); });
  app.put('/providers/:id',      (req, res) => res.json(run(`UPDATE providers SET name=@name,title=@title,color=@color,is_hygienist=@is_hygienist WHERE id=@id`, {...req.body, id: req.params.id})));
  app.delete('/providers/:id',   (req, res) => res.json(run(`DELETE FROM providers WHERE id=?`, req.params.id)));

  // ── Users ────────────────────────────────────────────────────────
  app.post('/users/login', (req, res) => {
    const user = get(`SELECT * FROM users WHERE username=? AND password=?`, req.body.username, req.body.password);
    if (!user) return res.json(null);
    const provider = user.provider_name ? get(`SELECT * FROM providers WHERE name=?`, user.provider_name) : null;
    res.json({...user, provider});
  });
  app.get('/users',            (_, res) => res.json(all(`SELECT id,username,role,provider_name,full_access,created_at FROM users ORDER BY role,username`)));
  app.get('/users/provider',   (req, res) => {
    let user = get(`SELECT * FROM users WHERE provider_name=?`, req.query.name);
    if (!user) {
      const last = (req.query.name.split(' ').pop()||'').toLowerCase();
      if (last.length > 2) user = all(`SELECT * FROM users`).find(u => u.username.toLowerCase().includes(last)) || null;
    }
    if (user && user.provider_name !== req.query.name) {
      run(`UPDATE users SET provider_name=? WHERE id=?`, req.query.name, user.id);
      user = {...user, provider_name: req.query.name};
    }
    res.json(user||null);
  });
  app.post('/users',           (req, res) => { try { const r=run(`INSERT INTO users (username,password,role,provider_name,full_access) VALUES (@username,@password,@role,@provider_name,@full_access)`,req.body); res.json({ok:true,id:r.lastInsertRowid}); } catch(e) { res.json({ok:false,error:e.message}); } });
  app.put('/users/:id',        (req, res) => { if(req.body.password) run(`UPDATE users SET username=@username,password=@password,role=@role,provider_name=@provider_name,full_access=@full_access WHERE id=@id`,{...req.body,id:req.params.id}); else run(`UPDATE users SET username=@username,role=@role,provider_name=@provider_name,full_access=@full_access WHERE id=@id`,{...req.body,id:req.params.id}); res.json(true); });
  app.delete('/users/:id',     (req, res) => res.json(run(`DELETE FROM users WHERE id=?`, req.params.id)));
  app.post('/users/:id/grantFullAccess',  (req, res) => res.json(run(`UPDATE users SET full_access=1 WHERE id=?`, req.params.id)));
  app.post('/users/:id/revokeFullAccess', (req, res) => res.json(run(`UPDATE users SET full_access=0 WHERE id=?`, req.params.id)));
  app.post('/users/:id/password',         (req, res) => res.json(run(`UPDATE users SET password=? WHERE id=?`, req.body.password, req.params.id)));

  // ── Stats ────────────────────────────────────────────────────────
  app.get('/stats/dashboard', (req, res) => {
    const prov  = req.query.provider;
    const today = new Date().toISOString().split('T')[0];
    const month = today.substring(0,7);
    const f = prov ? `AND (provider=? OR hygienist=?)` : '';
    const a = prov ? [today,prov,prov] : [today];
    const u = prov ? [prov,prov] : [];
    const monthRevenue = prov
      ? get(`SELECT COALESCE(SUM(b.paid),0) as s FROM billing b LEFT JOIN patients p ON b.patient_id=p.id LEFT JOIN appointments a ON a.patient_id=b.patient_id WHERE b.date LIKE ? AND (a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?)`,`${month}%`,prov,prov,prov,prov)?.s||0
      : get(`SELECT COALESCE(SUM(paid),0) as s FROM billing WHERE date LIKE ?`,`${month}%`)?.s||0;
    const pendingBalance = prov
      ? get(`SELECT COALESCE(SUM(b.balance),0) as s FROM billing b LEFT JOIN patients p ON b.patient_id=p.id LEFT JOIN appointments a ON a.patient_id=b.patient_id WHERE b.balance>0 AND (a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?)`,prov,prov,prov,prov)?.s||0
      : get(`SELECT COALESCE(SUM(balance),0) as s FROM billing WHERE balance>0`)?.s||0;
    const totalPatients = prov
      ? get(`SELECT COUNT(DISTINCT p.id) as c FROM patients p LEFT JOIN appointments a ON a.patient_id=p.id WHERE a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?`,prov,prov,prov,prov)?.c||0
      : get(`SELECT COUNT(*) as c FROM patients`)?.c||0;
    res.json({
      totalPatients,
      todayAppts:     get(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND unscheduled=0 ${f}`,...a)?.c||0,
      pendingBalance, monthRevenue,
      unscheduled:    get(`SELECT COUNT(*) as c FROM appointments WHERE unscheduled=1 ${prov?'AND (provider=? OR hygienist=?)':''}`, ...u)?.c||0,
      asap:           get(`SELECT COUNT(*) as c FROM appointments WHERE is_asap=1 ${prov?'AND (provider=? OR hygienist=?)':''}`, ...u)?.c||0,
      recallDue:      get(`SELECT COUNT(*) as c FROM patients WHERE recall_due IS NOT NULL AND recall_due <= date('now','+30 days')`)?.c||0,
    });
  });

  // ── Start HTTP server ────────────────────────────────────────────
  return new Promise((resolve, reject) => {
    httpServer = app.listen(port, '0.0.0.0', () => {
      const interfaces = os.networkInterfaces();
      const ips = Object.values(interfaces).flat()
        .filter(i => i.family === 'IPv4' && !i.internal)
        .map(i => i.address);
      console.log(`DentalPro Server running on port ${port}`);
      console.log(`Local IPs: ${ips.join(', ')}`);
      resolve({ port, ips });
    });
    httpServer.on('error', reject);
  });
}

function stopServer() {
  if (httpServer) httpServer.close();
}

module.exports = { startServer, stopServer };