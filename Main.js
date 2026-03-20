const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

console.log('[Main] __dirname:', __dirname);
console.log('[Main] process.resourcesPath:', process.resourcesPath);

// Helper: get the app's root directory correctly in both dev and packaged
function getAppDir() {
  // app.getAppPath() returns the path to app.asar in packaged builds
  // For loadFile we need the path inside the asar which __dirname provides
  // But electron's loadFile can load from inside asar using app.getAppPath()
  return app.getAppPath();
}

let db;
let mainWindow;

function runMigrations() {
  // Create tables that may be missing in older DB files
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'doctor',
      provider_name TEXT,
      full_access INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operatories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, abbr TEXT, color TEXT DEFAULT '#2563eb',
      default_provider TEXT, is_hygiene INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0
    );
  `);

  // Ensure default users exist with correct provider links
  const defaultUsers = [
    { username:'admin',      password:'password123', role:'admin',  provider_name:'Dr. Smith',    full_access:1 },
    { username:'drjohnson',  password:'password123', role:'doctor', provider_name:'Dr. Johnson',  full_access:0 },
    { username:'drwilliams', password:'password123', role:'doctor', provider_name:'Dr. Williams', full_access:0 },
    { username:'sarah',      password:'password123', role:'doctor', provider_name:'Sarah H.',     full_access:0 },
    { username:'mike',       password:'password123', role:'doctor', provider_name:'Mike H.',      full_access:0 },
  ];
  for (const u of defaultUsers) {
    try {
      db.prepare(`INSERT OR IGNORE INTO users (username,password,role,provider_name,full_access) VALUES (?,?,?,?,?)`)
        .run(u.username, u.password, u.role, u.provider_name, u.full_access);
      // Always force-update provider_name and role for default users
      db.prepare(`UPDATE users SET provider_name=?, role=?, full_access=? WHERE username=?`)
        .run(u.provider_name, u.role, u.full_access, u.username);
    } catch(e) { /* skip */ }
  }

  const cols = [
    "ALTER TABLE appointments ADD COLUMN broken INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN pinboard INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN unscheduled INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN is_asap INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN is_hygiene INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN is_new_patient INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN hygienist TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN confirmed TEXT DEFAULT 'Unconfirmed'",
    "ALTER TABLE appointments ADD COLUMN patient_note TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN appt_note TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN procedures TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN operatory_id INTEGER DEFAULT 0",
    "ALTER TABLE appointments ADD COLUMN time_arrived TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN time_seated TEXT DEFAULT ''",
    "ALTER TABLE appointments ADD COLUMN time_dismissed TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN primary_provider TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN secondary_provider TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN recall_due TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN status TEXT DEFAULT 'Active'",
    "ALTER TABLE patients ADD COLUMN transferred_to TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN transferred_from TEXT DEFAULT ''",
    "ALTER TABLE patients ADD COLUMN transferred_date TEXT DEFAULT ''",
    "ALTER TABLE providers ADD COLUMN is_hygienist INTEGER DEFAULT 0",
  ];
  for (const sql of cols) {
    try { db.prepare(sql).run(); } catch(e) { /* already exists */ }
  }

  // Fix existing operatories that have empty default_provider
  const opFixes = [
    { abbr:'Op1',  name:'Operatory 1', provider:'Dr. Smith' },
    { abbr:'Op2',  name:'Operatory 2', provider:'Dr. Johnson' },
    { abbr:'Op3',  name:'Operatory 3', provider:'Dr. Williams' },
    { abbr:'Hyg1', name:'Hygiene 1',   provider:'Sarah H.' },
    { abbr:'Hyg2', name:'Hygiene 2',   provider:'Mike H.' },
  ];
  for (const fix of opFixes) {
    try {
      db.prepare(`UPDATE operatories SET default_provider=? WHERE (default_provider IS NULL OR default_provider='') AND (abbr=? OR name=?)`)
        .run(fix.provider, fix.abbr, fix.name);
    } catch(e) {}
  }
}

function initDB() {
  db = new Database(path.join(app.getPath('userData'), 'dental2.db'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      dob TEXT, gender TEXT, phone TEXT, email TEXT, address TEXT,
      insurance TEXT, insurance_id TEXT, allergies TEXT, notes TEXT,
      primary_provider TEXT DEFAULT 'Dr. Smith',
      secondary_provider TEXT, recall_due TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operatories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, abbr TEXT, color TEXT DEFAULT '#2563eb',
      default_provider TEXT, is_hygiene INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER, operatory_id INTEGER,
      date TEXT NOT NULL, time TEXT NOT NULL,
      duration INTEGER DEFAULT 30,
      type TEXT, provider TEXT, hygienist TEXT,
      status TEXT DEFAULT 'Scheduled',
      confirmed TEXT DEFAULT 'Unconfirmed',
      is_new_patient INTEGER DEFAULT 0,
      is_hygiene INTEGER DEFAULT 0,
      is_asap INTEGER DEFAULT 0,
      patient_note TEXT, appt_note TEXT,
      broken INTEGER DEFAULT 0,
      unscheduled INTEGER DEFAULT 0,
      pinboard INTEGER DEFAULT 0,
      procedures TEXT,
      time_arrived TEXT, time_seated TEXT, time_dismissed TEXT,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );
    CREATE TABLE IF NOT EXISTS blockouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operatory_id INTEGER, date TEXT NOT NULL,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      type TEXT DEFAULT 'Lunch', color TEXT DEFAULT '#334155', note TEXT
    );
    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER, tooth TEXT, surface TEXT,
      procedure_code TEXT, description TEXT,
      status TEXT DEFAULT 'Treatment Planned',
      priority INTEGER DEFAULT 1, fee REAL DEFAULT 0,
      date_planned TEXT, date_completed TEXT, provider TEXT, notes TEXT,
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );
    CREATE TABLE IF NOT EXISTS billing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER, treatment_id INTEGER,
      date TEXT, description TEXT, procedure_code TEXT,
      fee REAL DEFAULT 0, insurance_pays REAL DEFAULT 0,
      patient_pays REAL DEFAULT 0, paid REAL DEFAULT 0,
      balance REAL DEFAULT 0, status TEXT DEFAULT 'Pending',
      FOREIGN KEY(patient_id) REFERENCES patients(id)
    );
    CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT, title TEXT, color TEXT, is_hygienist INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'doctor',
      provider_name TEXT,
      full_access INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  runMigrations();

  const pCount = db.prepare('SELECT COUNT(*) as c FROM providers').get();
  if (pCount.c === 0) {
    db.prepare("INSERT INTO providers (name,title,color,is_hygienist) VALUES (?,?,?,?)").run('Dr. Smith','DDS','#2563eb',0);
    db.prepare("INSERT INTO providers (name,title,color,is_hygienist) VALUES (?,?,?,?)").run('Dr. Johnson','DMD','#16a34a',0);
    db.prepare("INSERT INTO providers (name,title,color,is_hygienist) VALUES (?,?,?,?)").run('Dr. Williams','DDS','#9333ea',0);
    db.prepare("INSERT INTO providers (name,title,color,is_hygienist) VALUES (?,?,?,?)").run('Sarah H.','RDH','#0891b2',1);
    db.prepare("INSERT INTO providers (name,title,color,is_hygienist) VALUES (?,?,?,?)").run('Mike H.','RDH','#d97706',1);

    db.prepare("INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (?,?,?,?,?,?)").run('Operatory 1','Op1','#2563eb','Dr. Smith',0,1);
    db.prepare("INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (?,?,?,?,?,?)").run('Operatory 2','Op2','#16a34a','Dr. Johnson',0,2);
    db.prepare("INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (?,?,?,?,?,?)").run('Operatory 3','Op3','#9333ea','Dr. Williams',0,3);
    db.prepare("INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (?,?,?,?,?,?)").run('Hygiene 1','Hyg1','#0891b2','Sarah H.',1,4);
    db.prepare("INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (?,?,?,?,?,?)").run('Hygiene 2','Hyg2','#d97706','Mike H.',1,5);

    const ip = db.prepare(`INSERT INTO patients (first_name,last_name,dob,gender,phone,email,insurance,insurance_id,allergies,primary_provider,recall_due) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    ip.run('John','Davis','1985-03-14','Male','(555) 234-5678','john.davis@email.com','Delta Dental','DD-123456','Penicillin','Dr. Smith','2025-06-14');
    ip.run('Maria','Garcia','1992-07-22','Female','(555) 345-6789','maria.g@email.com','Cigna','CG-789012','None','Dr. Johnson','2025-07-22');
    ip.run('Robert','Chen','1978-11-05','Male','(555) 456-7890','rchen@email.com','Aetna','AE-345678','Latex','Dr. Williams','2025-05-05');
    ip.run('Sarah','Thompson','1995-02-18','Female','(555) 567-8901','sarah.t@email.com','BlueCross','BC-901234','None','Dr. Smith','2025-09-18');
    ip.run('Michael','Brown','1968-09-30','Male','(555) 678-9012','mbrown@email.com','United','UH-567890','Aspirin','Dr. Johnson','2025-03-30');
    ip.run('Emily','Wilson','2001-05-12','Female','(555) 789-0123','emily.w@email.com','Delta Dental','DD-234567','None','Dr. Smith','2025-11-12');
    ip.run('James','Lee','1955-12-03','Male','(555) 890-1234','jlee@email.com','Medicare','MC-345678','Sulfa','Dr. Williams','2025-04-03');

    const today = new Date().toISOString().split('T')[0];
    const ia = db.prepare(`INSERT INTO appointments (patient_id,operatory_id,date,time,duration,type,provider,hygienist,status,confirmed,is_new_patient,is_hygiene,procedures) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    ia.run(1,1,today,'08:00',60,'Comprehensive Exam','Dr. Smith','','Scheduled','Confirmed',1,0,'D0150,D0210');
    ia.run(2,4,today,'08:00',60,'Cleaning','Sarah H.','Sarah H.','Confirmed','eConfirmed',0,1,'D1110,D0220');
    ia.run(3,2,today,'09:00',90,'Root Canal','Dr. Johnson','','In Chair','Confirmed',0,0,'D3330');
    ia.run(4,5,today,'09:00',45,'Cleaning','Mike H.','Mike H.','Scheduled','Unconfirmed',0,1,'D1110');
    ia.run(5,1,today,'10:30',60,'Crown','Dr. Smith','','Scheduled','Confirmed',0,0,'D2740');
    ia.run(6,3,today,'11:00',30,'Limited Exam','Dr. Williams','','Scheduled','Unconfirmed',1,0,'D0140');
    ia.run(7,4,today,'11:00',60,'Perio','Sarah H.','Sarah H.','Scheduled','Confirmed',0,1,'D4341');
    ia.run(1,2,today,'14:00',60,'Follow-up','Dr. Johnson','','Scheduled','Unconfirmed',0,0,'');
    ia.run(2,1,today,'15:00',30,'X-Ray','Dr. Smith','','Scheduled','Unconfirmed',0,0,'D0220');

    const ib = db.prepare(`INSERT INTO blockouts (operatory_id,date,start_time,end_time,type,color,note) VALUES (?,?,?,?,?,?,?)`);
    [1,2,3,4,5].forEach(opId => ib.run(opId,today,'12:00','13:00','Lunch','#1e293b','Lunch break'));
    ib.run(3,today,'14:00','15:00','Staff Meeting','#7c3aed','Staff meeting');

    // Unscheduled / ASAP
    ia.run(3,0,'','',60,'Filling','Dr. Williams','','','Unconfirmed',0,0,'D2391');
    const uid = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.prepare('UPDATE appointments SET is_asap=1,unscheduled=1 WHERE id=?').run(uid);

    ia.run(5,0,'','',90,'Root Canal','Dr. Smith','','','Unconfirmed',0,0,'D3310');
    const uid2 = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.prepare('UPDATE appointments SET unscheduled=1 WHERE id=?').run(uid2);

    const it = db.prepare(`INSERT INTO treatments (patient_id,tooth,surface,procedure_code,description,status,fee,provider) VALUES (?,?,?,?,?,?,?,?)`);
    it.run(1,'#14','MOD','D2160','Amalgam 3+ surfaces','Treatment Planned',285,'Dr. Smith');
    it.run(1,'#19','','D3330','Endo molar','Treatment Planned',1200,'Dr. Smith');
    it.run(2,'#8','','D2740','Crown porcelain','Completed',1450,'Dr. Johnson');

    const bil = db.prepare(`INSERT INTO billing (patient_id,date,description,procedure_code,fee,insurance_pays,patient_pays,paid,balance,status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    bil.run(1,today,'Comprehensive Exam','D0150',285,200,85,85,0,'Paid');
    bil.run(2,today,'Prophylaxis Adult','D1110',135,100,35,0,35,'Pending');
    bil.run(3,today,'Crown Porcelain','D2740',1450,1000,450,225,225,'Partial');
  }
}

const fs           = require('fs');
const { startServer } = require('./server.js');

// ── Config file ────────────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'dental-config.json');
}
function loadConfig() {
  const p = getConfigPath();
  try {
    const data = fs.readFileSync(p, 'utf8');
    const cfg  = JSON.parse(data);
    console.log('[Config] Loaded from:', p);
    console.log('[Config] Mode:', cfg.mode, '| URL:', cfg.serverUrl || '(none)');
    return cfg;
  } catch(e) {
    console.log('[Config] Not found at:', p, '| Error:', e.message);
    return null;
  }
}
function saveConfig(cfg) {
  const p = getConfigPath();
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  console.log('[Config] Saved to:', p, '| Mode:', cfg.mode, '| URL:', cfg.serverUrl || '(none)');
}

// ── Setup window ──────────────────────────────────────────────────
let setupWindow = null;
function createSetupWindow() {
  const setupPreload = app.isPackaged
    ? path.join(process.resourcesPath, 'preload-setup.js')
    : path.join(__dirname, 'preload-setup.js');
  console.log('[Setup] preload:', setupPreload);
  setupWindow = new BrowserWindow({
    width: 640, height: 580, resizable: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: setupPreload,
      webSecurity: false,
      sandbox: false,
    },
    show: false, backgroundColor: '#0f2942'
  });
  setupWindow.loadFile(path.join(app.getAppPath(), 'setup.html'));
  setupWindow.once('ready-to-show', () => setupWindow.show());
}

// ── Main app window ──────────────────────────────────────────────
function createWindow(config) {
  const isClient = config && config.mode === 'client';
  const preloadPath = app.isPackaged
    ? path.join(process.resourcesPath, 'preload.js')
    : path.join(__dirname, 'preload.js');

  // Pass config as JSON string in additionalArguments
  // This is available in preload as process.argv before any IPC
  const configJson = JSON.stringify(config || {});

  console.log('[Window] mode:', isClient ? 'CLIENT → ' + config?.serverUrl : 'SERVER/LOCAL');
  console.log('[Window] __dirname:', __dirname);
  console.log('[Window] preloadPath:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1200, minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      webSecurity: false,
      allowRunningInsecureContent: isClient,
      additionalArguments: [`--dental-config=${Buffer.from(configJson).toString('base64')}`],
      sandbox: false,
    },
    show: false, backgroundColor: '#0f172a'
  });
  if (isClient) {
    mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'index.html'));
  }
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

// ── Setup IPC ────────────────────────────────────────────────────
ipcMain.handle('setup:saveConfig', async (_, cfg) => {
  if (cfg.mode === 'server') {
    initDB();
    const result = await startServer(db, cfg.port || 3747, cfg.serverKey || '');
    saveConfig({ mode:'server', port: result.port, serverKey: cfg.serverKey || '' });
    return { mode:'server', port: result.port, ips: result.ips, serverKey: cfg.serverKey };
  } else {
    // Test connection first using Node http (no CSP)
    const http = require('http');
    const testUrl = cfg.serverUrl + '/health';
    const parsed  = new URL(testUrl);
    const ok = await new Promise((resolve) => {
      const opts = {
        hostname: parsed.hostname,
        port:     parseInt(parsed.port) || 80,
        path:     '/health',
        method:   'GET',
        timeout:  5000,
        headers:  cfg.serverKey ? { 'x-server-key': cfg.serverKey } : {},
      };
      const req = http.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data).ok === true); }
          catch(e) { resolve(false); }
        });
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (!ok) throw new Error('Cannot reach server at ' + cfg.serverUrl);
    saveConfig({ mode:'client', serverUrl: cfg.serverUrl, serverKey: cfg.serverKey || '' });
    return { mode:'client', serverUrl: cfg.serverUrl };
  }
});
ipcMain.handle('setup:reconfigure', () => {
  // Delete config and relaunch setup wizard
  try { fs.unlinkSync(getConfigPath()); } catch(e) {}
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  createSetupWindow();
});
ipcMain.handle('setup:launch', () => {
  const config = loadConfig();
  if (setupWindow) { setupWindow.close(); setupWindow = null; }
  createWindow(config);
});
ipcMain.handle('setup:getNetworkInfo', () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  return Object.values(interfaces).flat()
    .filter(i => i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
});

app.whenReady().then(async () => {
  console.log('[Boot] Config path:', getConfigPath());
  const config = loadConfig();
  if (!config) {
    // No config — show setup wizard
    console.log('[Boot] No config found, showing setup wizard');
    createSetupWindow();
  } else if (config.mode === 'server') {
    // Server mode — init DB and start API server
    initDB();
    try { await startServer(db, config.port || 3747, config.serverKey || ''); }
    catch(e) { console.error('Server start failed:', e); }
    createWindow(config);
  } else {
    // Client mode — just open the app (uses HTTP API)
    createWindow(config);
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { const cfg = loadConfig(); createWindow(cfg); } });

ipcMain.handle('config:saveClient', (_, { serverUrl, serverKey }) => {
  saveConfig({ mode: 'client', serverUrl, serverKey: serverKey || '' });
  return true;
});
ipcMain.handle('config:getPath', () => getConfigPath());
ipcMain.handle('config:get',     () => loadConfig());
ipcMain.handle('config:reset',   () => { try { require('fs').unlinkSync(getConfigPath()); return true; } catch(e) { return false; } });
// Synchronous version for preload use
ipcMain.on('config:getSync', (event) => {
  const cfg = loadConfig() || {};
  console.log('[IPC] config:getSync returning:', JSON.stringify(cfg));
  event.returnValue = cfg;
});

// ── HTTP proxy for client mode ────────────────────────────────────
// Renderer/preload can't use Node's http directly in packaged apps
// Main process proxies all HTTP requests to the remote server
ipcMain.handle('http:request', (_, { method, url, body, key }) => {
  return new Promise((resolve, reject) => {
    const http    = require('http');
    const parsed  = new URL(url);
    const data    = body !== undefined ? JSON.stringify(body) : null;
    const opts    = {
      hostname: parsed.hostname,
      port:     parseInt(parsed.port) || 80,
      path:     parsed.pathname + parsed.search,
      method,
      timeout:  10000,
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'x-server-key': key } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    if (data) req.write(data);
    req.end();
  });
});

// IPC Handlers
ipcMain.handle('patients:getAll', () => db.prepare('SELECT * FROM patients ORDER BY last_name').all());
ipcMain.handle('patients:get', (_, id) => db.prepare('SELECT * FROM patients WHERE id=?').get(id));
ipcMain.handle('patients:search', (_, q) => db.prepare(`SELECT * FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY last_name`).all(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`));
ipcMain.handle('patients:create', (_, p) => { const r = db.prepare(`INSERT INTO patients (first_name,last_name,dob,gender,phone,email,address,insurance,insurance_id,allergies,notes,primary_provider,secondary_provider,recall_due) VALUES (@first_name,@last_name,@dob,@gender,@phone,@email,@address,@insurance,@insurance_id,@allergies,@notes,@primary_provider,@secondary_provider,@recall_due)`).run(p); return r.lastInsertRowid; });
ipcMain.handle('patients:update', (_, p) => { db.prepare(`UPDATE patients SET first_name=@first_name,last_name=@last_name,dob=@dob,gender=@gender,phone=@phone,email=@email,address=@address,insurance=@insurance,insurance_id=@insurance_id,allergies=@allergies,notes=@notes,primary_provider=@primary_provider,secondary_provider=@secondary_provider,recall_due=@recall_due WHERE id=@id`).run(p); return true; });
ipcMain.handle('patients:delete', (_, id) => { db.prepare('DELETE FROM patients WHERE id=?').run(id); return true; });

ipcMain.handle('operatories:getAll', () => db.prepare('SELECT * FROM operatories ORDER BY sort_order').all());
ipcMain.handle('operatories:create', (_, o) => { const r = db.prepare(`INSERT INTO operatories (name,abbr,color,default_provider,is_hygiene,sort_order) VALUES (@name,@abbr,@color,@default_provider,@is_hygiene,@sort_order)`).run(o); return r.lastInsertRowid; });
ipcMain.handle('operatories:update', (_, o) => { db.prepare(`UPDATE operatories SET name=@name,abbr=@abbr,color=@color,default_provider=@default_provider,is_hygiene=@is_hygiene WHERE id=@id`).run(o); return true; });
ipcMain.handle('operatories:delete', (_, id) => { db.prepare('DELETE FROM operatories WHERE id=?').run(id); return true; });

ipcMain.handle('appointments:getAll', () => db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.allergies,p.insurance,o.name as op_name,o.color as op_color FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN operatories o ON a.operatory_id=o.id ORDER BY a.date,a.time`).all());
ipcMain.handle('appointments:getByDate', (_, date) => db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.allergies,p.insurance,p.dob,o.name as op_name,o.color as op_color FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN operatories o ON a.operatory_id=o.id WHERE a.date=? AND a.unscheduled=0 AND a.pinboard=0 ORDER BY a.time`).all(date));
ipcMain.handle('appointments:getByPatient', (_, pid) => db.prepare(`SELECT a.*,o.name as op_name FROM appointments a LEFT JOIN operatories o ON a.operatory_id=o.id WHERE a.patient_id=? ORDER BY a.date DESC,a.time`).all(pid));
ipcMain.handle('appointments:getUnscheduled', () => db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.phone FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id WHERE a.unscheduled=1 ORDER BY p.last_name`).all());
ipcMain.handle('appointments:getASAP', () => db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.phone FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id WHERE a.is_asap=1 ORDER BY p.last_name`).all());
ipcMain.handle('appointments:getPinboard', () => db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id WHERE a.pinboard=1 ORDER BY a.rowid DESC`).all());
ipcMain.handle('appointments:getRecallDue', () => db.prepare(`SELECT * FROM patients WHERE recall_due IS NOT NULL AND recall_due <= date('now','+60 days') ORDER BY recall_due`).all());
ipcMain.handle('appointments:create', (_, a) => { const r = db.prepare(`INSERT INTO appointments (patient_id,operatory_id,date,time,duration,type,provider,hygienist,status,confirmed,is_new_patient,is_hygiene,is_asap,patient_note,appt_note,unscheduled,pinboard,procedures) VALUES (@patient_id,@operatory_id,@date,@time,@duration,@type,@provider,@hygienist,@status,@confirmed,@is_new_patient,@is_hygiene,@is_asap,@patient_note,@appt_note,@unscheduled,@pinboard,@procedures)`).run(a); return r.lastInsertRowid; });
ipcMain.handle('appointments:update', (_, a) => { db.prepare(`UPDATE appointments SET patient_id=@patient_id,operatory_id=@operatory_id,date=@date,time=@time,duration=@duration,type=@type,provider=@provider,hygienist=@hygienist,status=@status,confirmed=@confirmed,is_new_patient=@is_new_patient,is_hygiene=@is_hygiene,is_asap=@is_asap,patient_note=@patient_note,appt_note=@appt_note,unscheduled=@unscheduled,pinboard=@pinboard,procedures=@procedures,time_arrived=@time_arrived,time_seated=@time_seated,time_dismissed=@time_dismissed WHERE id=@id`).run(a); return true; });
ipcMain.handle('appointments:delete', (_, id) => { db.prepare('DELETE FROM appointments WHERE id=?').run(id); return true; });
ipcMain.handle('appointments:sendToPinboard', (_, id) => {
  try {
    db.prepare('UPDATE appointments SET pinboard=1,unscheduled=0,date="",time="" WHERE id=?').run(id);
  } catch(e) {
    // Fallback if columns missing — run migrations first then retry
    runMigrations();
    db.prepare('UPDATE appointments SET pinboard=1,unscheduled=0,date="",time="" WHERE id=?').run(id);
  }
  return true;
});
ipcMain.handle('appointments:sendToUnscheduled', (_, id) => {
  try {
    db.prepare('UPDATE appointments SET unscheduled=1,pinboard=0,broken=1,date="",time="" WHERE id=?').run(id);
  } catch(e) {
    runMigrations();
    db.prepare('UPDATE appointments SET unscheduled=1,pinboard=0,date="",time="" WHERE id=?').run(id);
  }
  return true;
});
ipcMain.handle('appointments:scheduleFromPinboard', (_, o) => { db.prepare('UPDATE appointments SET pinboard=0,unscheduled=0,date=@date,time=@time,operatory_id=@operatory_id WHERE id=@id').run(o); return true; });
ipcMain.handle('appointments:markASAP', (_, id) => { db.prepare('UPDATE appointments SET is_asap=1 WHERE id=?').run(id); return true; });
ipcMain.handle('appointments:updateStatus', (_, o) => { db.prepare('UPDATE appointments SET status=@status WHERE id=@id').run(o); return true; });
ipcMain.handle('appointments:updateConfirmed', (_, o) => { db.prepare('UPDATE appointments SET confirmed=@confirmed WHERE id=@id').run(o); return true; });
ipcMain.handle('appointments:updateArrival', (_, o) => {
  const t = o.time_arrived || new Date().toTimeString().slice(0,5);
  db.prepare('UPDATE appointments SET time_arrived=?, status="Arrived" WHERE id=?').run(t, o.id);
  return true;
});

ipcMain.handle('blockouts:getByDate', (_, date) => db.prepare('SELECT * FROM blockouts WHERE date=? ORDER BY operatory_id,start_time').all(date));
ipcMain.handle('blockouts:create', (_, b) => { const r = db.prepare(`INSERT INTO blockouts (operatory_id,date,start_time,end_time,type,color,note) VALUES (@operatory_id,@date,@start_time,@end_time,@type,@color,@note)`).run(b); return r.lastInsertRowid; });
ipcMain.handle('blockouts:delete', (_, id) => { db.prepare('DELETE FROM blockouts WHERE id=?').run(id); return true; });

ipcMain.handle('treatments:getByPatient', (_, pid) => db.prepare('SELECT * FROM treatments WHERE patient_id=? ORDER BY priority,id').all(pid));
ipcMain.handle('treatments:create', (_, t) => { const r = db.prepare(`INSERT INTO treatments (patient_id,tooth,surface,procedure_code,description,status,priority,fee,date_planned,provider,notes) VALUES (@patient_id,@tooth,@surface,@procedure_code,@description,@status,@priority,@fee,@date_planned,@provider,@notes)`).run(t); return r.lastInsertRowid; });
ipcMain.handle('treatments:update', (_, t) => { db.prepare(`UPDATE treatments SET tooth=@tooth,surface=@surface,procedure_code=@procedure_code,description=@description,status=@status,priority=@priority,fee=@fee,date_planned=@date_planned,date_completed=@date_completed,provider=@provider,notes=@notes WHERE id=@id`).run(t); return true; });
ipcMain.handle('treatments:delete', (_, id) => { db.prepare('DELETE FROM treatments WHERE id=?').run(id); return true; });

ipcMain.handle('billing:getAll', () => db.prepare(`SELECT b.*,p.first_name||' '||p.last_name as patient_name FROM billing b LEFT JOIN patients p ON b.patient_id=p.id ORDER BY b.date DESC`).all());
ipcMain.handle('billing:getByPatient', (_, pid) => db.prepare('SELECT * FROM billing WHERE patient_id=? ORDER BY date DESC').all(pid));
ipcMain.handle('billing:create', (_, b) => { const r = db.prepare(`INSERT INTO billing (patient_id,date,description,procedure_code,fee,insurance_pays,patient_pays,paid,balance,status) VALUES (@patient_id,@date,@description,@procedure_code,@fee,@insurance_pays,@patient_pays,@paid,@balance,@status)`).run(b); return r.lastInsertRowid; });
ipcMain.handle('billing:update', (_, b) => { db.prepare(`UPDATE billing SET date=@date,description=@description,fee=@fee,insurance_pays=@insurance_pays,patient_pays=@patient_pays,paid=@paid,balance=@balance,status=@status WHERE id=@id`).run(b); return true; });
ipcMain.handle('billing:delete', (_, id) => { db.prepare('DELETE FROM billing WHERE id=?').run(id); return true; });

ipcMain.handle('appointments:getWaitingRoom', () => {
  // Show any appointment with status='Arrived' OR (time_arrived set and not yet seated)
  return db.prepare(`
    SELECT a.*, p.first_name||' '||p.last_name as patient_name, p.phone,
           o.name as op_name, o.color as op_color
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN operatories o ON a.operatory_id = o.id
    WHERE (
      a.status = 'Arrived'
      OR (
        a.time_arrived IS NOT NULL AND a.time_arrived != ''
        AND (a.time_seated IS NULL OR a.time_seated = '')
        AND a.status NOT IN ('Completed','Cancelled','No Show','In Chair')
      )
    )
    AND a.unscheduled = 0
    ORDER BY CASE WHEN a.time_arrived != '' THEN a.time_arrived ELSE a.time END
  `).all();
});
ipcMain.handle('appointments:seatPatient', (_, obj) => {
  const t = obj.time || new Date().toTimeString().slice(0,5);
  db.prepare("UPDATE appointments SET time_seated=?, status='In Chair' WHERE id=?").run(t, obj.id);
  return true;
});
ipcMain.handle('appointments:dismissPatient', (_, id) => {
  db.prepare("UPDATE appointments SET time_dismissed=?, status='Completed' WHERE id=?")
    .run(new Date().toTimeString().slice(0,5), id);
  return true;
});
ipcMain.handle('appointments:removeArrival', (_, id) => {
  db.prepare("UPDATE appointments SET time_arrived='', status='Confirmed' WHERE id=?").run(id);
  return true;
});

ipcMain.handle('providers:getAppointments', (_, obj) => {
  // Accept either a string (name) for backwards compat, or {name, date}
  const name = typeof obj === 'string' ? obj : obj.name;
  const date = typeof obj === 'string' ? new Date().toISOString().split('T')[0] : (obj.date || new Date().toISOString().split('T')[0]);
  return db.prepare(`
    SELECT a.*,
           p.first_name||' '||p.last_name as patient_name,
           p.phone, p.dob, p.allergies, p.insurance,
           o.name as op_name, o.color as op_color
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    LEFT JOIN operatories o ON a.operatory_id = o.id
    WHERE a.date = ? AND (a.provider = ? OR a.hygienist = ?)
      AND a.unscheduled = 0 AND a.pinboard = 0
    ORDER BY a.time
  `).all(date, name, name);
});
ipcMain.handle('providers:getUserForProvider', (_, providerName) => {
  // Try exact match first
  let user = db.prepare('SELECT * FROM users WHERE provider_name=?').get(providerName);
  if (user) return user;
  // Try case-insensitive
  user = db.prepare('SELECT * FROM users WHERE lower(provider_name)=lower(?)').get(providerName);
  if (user) return user;
  // Try last name in username (e.g. "Dr. Johnson" → username contains "johnson")
  const parts = providerName.split(' ');
  const lastName = parts[parts.length - 1].toLowerCase();
  if (lastName.length > 2) {
    const all = db.prepare('SELECT * FROM users').all();
    user = all.find(u => u.username.toLowerCase().includes(lastName));
    if (user) {
      // Auto-fix the provider_name
      db.prepare('UPDATE users SET provider_name=? WHERE id=?').run(providerName, user.id);
      return { ...user, provider_name: providerName };
    }
  }
  return null;
});

ipcMain.handle('providers:getAll', () => db.prepare('SELECT * FROM providers ORDER BY is_hygienist, name').all());

ipcMain.handle('providers:getAvailability', () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now   = new Date().toTimeString().slice(0,5);
    const providers = db.prepare('SELECT * FROM providers ORDER BY is_hygienist, name').all();
    return providers.map(p => {
      try {
        const inChair = db.prepare(`
          SELECT a.*, pt.first_name||' '||pt.last_name as patient_name,
                 o.name as op_name, a.patient_id
          FROM appointments a
          LEFT JOIN patients pt ON a.patient_id = pt.id
          LEFT JOIN operatories o ON a.operatory_id = o.id
          WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.status='In Chair' LIMIT 1
        `).get(today, p.name, p.name);
        const nextAppt = db.prepare(`
          SELECT a.*, pt.first_name||' '||pt.last_name as patient_name
          FROM appointments a
          LEFT JOIN patients pt ON a.patient_id = pt.id
          WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.time>?
            AND a.status NOT IN ('Completed','Cancelled','No Show')
          ORDER BY a.time LIMIT 1
        `).get(today, p.name, p.name, now);
        const doneCount  = db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND (provider=? OR hygienist=?) AND status='Completed'`).get(today, p.name, p.name).c;
        const totalCount = db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND (provider=? OR hygienist=?) AND status NOT IN ('Cancelled','No Show') AND unscheduled=0`).get(today, p.name, p.name).c;
        const status = inChair ? 'In Chair' : (nextAppt && nextAppt.time <= now) ? 'Overdue' : 'Free';
        return { ...p, status, inChair: inChair || null, nextAppt: nextAppt || null, doneCount, totalCount };
      } catch(e) {
        return { ...p, status: 'Free', inChair: null, nextAppt: null, doneCount: 0, totalCount: 0 };
      }
    });
  } catch(e) {
    console.error('getAvailability error:', e);
    return [];
  }
});

ipcMain.handle('providers:get', (_, id) => db.prepare('SELECT * FROM providers WHERE id=?').get(id));
ipcMain.handle('providers:create', (_, p) => {
  const r = db.prepare(`INSERT INTO providers (name,title,color,is_hygienist) VALUES (@name,@title,@color,@is_hygienist)`).run(p);
  return r.lastInsertRowid;
});
ipcMain.handle('providers:update', (_, p) => {
  db.prepare(`UPDATE providers SET name=@name,title=@title,color=@color,is_hygienist=@is_hygienist WHERE id=@id`).run(p);
  return true;
});
ipcMain.handle('providers:delete', (_, id) => {
  db.prepare('DELETE FROM providers WHERE id=?').run(id);
  return true;
});

ipcMain.handle('stats:dashboard', (_, providerName) => {
  const today = new Date().toISOString().split('T')[0];
  const month = today.substring(0, 7);
  const filter = providerName ? `AND (provider=? OR hygienist=?)` : '';
  const args   = providerName ? [today, providerName, providerName] : [today];
  const argsUnsch = providerName ? [providerName, providerName] : [];

  // For provider-filtered revenue: join billing to appointments or patients
  const monthRevenue = providerName
    ? db.prepare(`
        SELECT COALESCE(SUM(b.paid),0) as s FROM billing b
        LEFT JOIN patients p ON b.patient_id = p.id
        LEFT JOIN appointments a ON a.patient_id = b.patient_id
        WHERE b.date LIKE ?
          AND (a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?)
      `).get(`${month}%`, providerName, providerName, providerName, providerName).s
    : db.prepare(`SELECT COALESCE(SUM(paid),0) as s FROM billing WHERE date LIKE ?`).get(`${month}%`).s;

  const pendingBalance = providerName
    ? db.prepare(`
        SELECT COALESCE(SUM(b.balance),0) as s FROM billing b
        LEFT JOIN patients p ON b.patient_id = p.id
        LEFT JOIN appointments a ON a.patient_id = b.patient_id
        WHERE b.balance > 0
          AND (a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?)
      `).get(providerName, providerName, providerName, providerName).s
    : db.prepare('SELECT COALESCE(SUM(balance),0) as s FROM billing WHERE balance>0').get().s;

  const totalPatients = providerName
    ? db.prepare(`
        SELECT COUNT(DISTINCT p.id) as c FROM patients p
        LEFT JOIN appointments a ON a.patient_id = p.id
        WHERE a.provider=? OR a.hygienist=? OR p.primary_provider=? OR p.secondary_provider=?
      `).get(providerName, providerName, providerName, providerName).c
    : db.prepare('SELECT COUNT(*) as c FROM patients').get().c;

  return {
    totalPatients,
    todayAppts:     db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE date=? AND unscheduled=0 ${filter}`).get(...args).c,
    pendingBalance,
    monthRevenue,
    unscheduled:    db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE unscheduled=1 ${providerName?'AND (provider=? OR hygienist=?)':''}`).get(...argsUnsch).c,
    asap:           db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE is_asap=1 ${providerName?'AND (provider=? OR hygienist=?)':''}`).get(...argsUnsch).c,
    recallDue:      db.prepare(`SELECT COUNT(*) as c FROM patients WHERE recall_due IS NOT NULL AND recall_due <= date('now','+30 days')`).get().c,
  };
});

// ── Users / Auth ─────────────────────────────────────────────────────
ipcMain.handle('users:login', (_, {username, password}) => {
  const user = db.prepare('SELECT * FROM users WHERE username=? AND password=?').get(username, password);
  if (!user) return null;
  // Attach provider info
  const provider = user.provider_name
    ? db.prepare('SELECT * FROM providers WHERE name=?').get(user.provider_name)
    : null;
  return { id:user.id, username:user.username, role:user.role, provider_name:user.provider_name, full_access:user.full_access, provider };
});
ipcMain.handle('users:getByProvider', (_, providerName) => {
  // Try exact match first
  let user = db.prepare('SELECT * FROM users WHERE provider_name=?').get(providerName);
  if (!user) {
    // Try last name match
    const lastName = (providerName.split(' ').pop() || '').toLowerCase();
    if (lastName.length > 2) {
      const all = db.prepare('SELECT * FROM users').all();
      user = all.find(u => u.username.toLowerCase().includes(lastName)) || null;
    }
  }
  // Auto-fix provider_name if found by fallback
  if (user && user.provider_name !== providerName) {
    db.prepare('UPDATE users SET provider_name=? WHERE id=?').run(providerName, user.id);
    user = {...user, provider_name: providerName};
  }
  return user || null;
});

ipcMain.handle('users:getAll', () => {
  const users = db.prepare('SELECT id,username,role,provider_name,full_access,created_at FROM users ORDER BY role,username').all();
  console.log('users:getAll →', users.map(u => `${u.username}:${u.provider_name||'NULL'}`).join(', '));
  return users;
});
ipcMain.handle('users:create', (_, u) => {
  try {
    const r = db.prepare(`INSERT INTO users (username,password,role,provider_name,full_access) VALUES (@username,@password,@role,@provider_name,@full_access)`).run(u);
    return { ok:true, id:r.lastInsertRowid };
  } catch(e) { return { ok:false, error:e.message }; }
});
ipcMain.handle('users:update', (_, u) => {
  if (u.password) {
    db.prepare(`UPDATE users SET username=@username,password=@password,role=@role,provider_name=@provider_name,full_access=@full_access WHERE id=@id`).run(u);
  } else {
    db.prepare(`UPDATE users SET username=@username,role=@role,provider_name=@provider_name,full_access=@full_access WHERE id=@id`).run(u);
  }
  return true;
});
ipcMain.handle('users:delete', (_, id) => { db.prepare('DELETE FROM users WHERE id=?').run(id); return true; });
ipcMain.handle('users:grantFullAccess', (_, id) => { db.prepare('UPDATE users SET full_access=1 WHERE id=?').run(id); return true; });
ipcMain.handle('users:revokeFullAccess', (_, id) => { db.prepare('UPDATE users SET full_access=0 WHERE id=?').run(id); return true; });
ipcMain.handle('users:changePassword', (_, {id, password}) => { db.prepare('UPDATE users SET password=? WHERE id=?').run(password, id); return true; });

// Role-aware patient/appointment queries
ipcMain.handle('patients:transfer', (_, {id, transferred_to}) => {
  const today = new Date().toISOString().split('T')[0];
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  db.prepare(`UPDATE patients SET 
    status='Transferred', 
    transferred_to=?, 
    transferred_from=?,
    transferred_date=?
    WHERE id=?`).run(transferred_to, p.primary_provider || '', today, id);
  return true;
});
ipcMain.handle('patients:undoTransfer', (_, id) => {
  const p = db.prepare('SELECT * FROM patients WHERE id=?').get(id);
  db.prepare(`UPDATE patients SET 
    status='Active',
    transferred_to='',
    transferred_from='',
    transferred_date=''
    WHERE id=?`).run(id);
  return true;
});
ipcMain.handle('patients:getByProvider', (_, name) =>
  db.prepare(`SELECT DISTINCT p.* FROM patients p
    WHERE (
      -- Primary patients (not transferred away)
      (p.primary_provider = ? AND (p.status != 'Transferred' OR p.status IS NULL OR p.status = ''))
      OR
      -- Transferred IN to this provider
      (p.transferred_to = ? AND p.status = 'Transferred')
    )
    ORDER BY p.last_name`).all(name, name)
);
ipcMain.handle('appointments:getByProvider', (_, {date, name}) =>
  db.prepare(`SELECT a.*,p.first_name||' '||p.last_name as patient_name,p.allergies,p.insurance,p.dob,o.name as op_name,o.color as op_color
    FROM appointments a LEFT JOIN patients p ON a.patient_id=p.id LEFT JOIN operatories o ON a.operatory_id=o.id
    WHERE a.date=? AND (a.provider=? OR a.hygienist=?) AND a.unscheduled=0 AND a.pinboard=0 ORDER BY a.time`).all(date,name,name)
);
ipcMain.handle('billing:getByProvider', (_, name) =>
  db.prepare(`SELECT b.*,p.first_name||' '||p.last_name as patient_name FROM billing b
    LEFT JOIN patients p ON b.patient_id=p.id
    LEFT JOIN appointments a ON a.patient_id=b.patient_id
    WHERE a.provider=? OR a.hygienist=? OR p.primary_provider=?
    GROUP BY b.id ORDER BY b.date DESC`).all(name,name,name)
);