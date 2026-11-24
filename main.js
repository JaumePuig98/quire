const { screen, app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./shared/doc.js');
const Sun = require('./shared/sun.js');
const X = require('./exporters.js');
const { toEpub } = require('./epub.js');

const isDev = process.argv.includes('--dev');
const FILE_EXTS = ['.draft', '.md', '.markdown', '.txt'];
const OPEN_EXTS = FILE_EXTS.concat('.docx');

/* ---------------------------- preferences ---------------------------- */
const DEFAULT_PREFS = {
  theme: 'system', // system | light | dark | evening (light by day, dark between sunset and sunrise)
  font: 'serif', // serif | sans
  size: 22, weight: 400,
  lineHeight: 1.7, paraGap: 0.6, indent: 0, headBefore: 0.9, headAfter: 0.4, quoteGap: 0.9, // spacing
  measure: 680,
  anchor: 68, // % of the window height where the writing line sits
  typewriter: true,
  fade: true,
  finishBy: '', lastVersion: '', // finish date (YYYY-MM-DD) for the daily pace; the version whose release note was last shown
  introSeen: true, // set to false only on a first install (no settings file yet), so updates never show the first-run hint
  caret: 'bar', caretBlink: true, fadeReach: 100, names: true, sprintMin: 20, // caret: bar | block | underline; fadeReach in % of the default fade; names: Tab completes names
  glow: true, glowStrength: 100, glowColor: 'accent', // strength in % of the default; color: accent (follows the accent color), a color name or white
  goal: 0, // daily word goal, 0 = off
  fullscreen: true,
  readScope: 'chapter', centerMode: 'strict', justify: true, fmtbar: true, bookGoal: 0, autoUpdate: true, // text slides sideways so the caret stays in the middle
  accent: 'amber', titlePage: null, // null = not chosen yet, the title page is ticked
  showSession: false, richPaste: true, pageNumbers: true, focus: 'off', streak: { last: '', count: 0, best: 0 },
  pageSize: null, margins: 'normal', // export page: null = Letter in Canada and the US, A4 elsewhere
  notesMode: 'comments', // export notes: off | comments | footnotes
  smartQuotes: 'off', friendly: true, companion: false, // off | en | es | de: curly quotes and a proper ellipsis while typing
  recent: [],
  lastPath: null,
};
const userFile = (n) => path.join(app.getPath('userData'), n);
let prefs = Object.assign({}, DEFAULT_PREFS);
function loadPrefs() {
  try { prefs = Object.assign({}, DEFAULT_PREFS, JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8'))); } catch (e) { prefs.introSeen = false; /* first run */ }
}
function savePrefs() {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); atomicWrite(userFile('settings.json'), JSON.stringify(prefs, null, 2)); } catch (e) { /* ignore */ }
}
const sleepMs = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* no wait available */ } };
// Write next to the target, then swap in. On Windows the swap can fail for a moment while OneDrive, Dropbox or an antivirus
// has the file open, so it is retried briefly, and the temporary file never stays behind.
function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepMs(60 * (i + 1)); continue; }
      try { fs.unlinkSync(tmp); } catch (e2) { /* already gone */ }
      throw e;
    }
  }
}
const isDark = () => (prefs.theme === 'system' ? nativeTheme.shouldUseDarkColors : prefs.theme === 'evening' ? Sun.isNight() : prefs.theme === 'dark');
const BG = { light: '#F4F1EA', dark: '#181715' };

/* ------------------------------ updates ------------------------------ */
// Installed copies check GitHub Releases at start (unless switched off), download quietly and install when the app is closed.
// The portable build and development runs never update themselves. Settings, About shows the state and can check on request.
const installKind = () => (!app.isPackaged ? 'dev' : process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed');
let updater = null;
let updateState = { status: 'idle' }; // idle | checking | downloading | ready | current | error
function pushUpdate(st) {
  updateState = st;
  if (win && !win.isDestroyed()) win.webContents.send('update:state', st);
}
const CHECK_EVERY = 3 * 60 * 60 * 1000; // a writing app stays open for days, so look again every few hours
let lastCheck = 0;
function updLog(line) { // userData/updater.log: what the updater did and why it failed, kept small
  try {
    const f = userFile('updater.log');
    try { if (fs.statSync(f).size > 100000) fs.writeFileSync(f, ''); } catch (e) { /* no log yet */ }
    fs.appendFileSync(f, new Date().toISOString() + ' ' + String(line).replace(/\s+/g, ' ').slice(0, 400) + '\n');
  } catch (e) { /* logging must never break the app */ }
}
function setupUpdates() {
  if (installKind() !== 'installed') return;
  try {
    const { autoUpdater } = require('electron-updater');
    updater = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: (m) => updLog('info ' + m), warn: (m) => updLog('warn ' + m), error: (m) => updLog('error ' + m), debug: () => {} };
    updLog('start version ' + app.getVersion() + ' arch ' + process.arch);
    autoUpdater.on('checking-for-update', () => pushUpdate({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => pushUpdate({ status: 'downloading', version: info && info.version, percent: 0 }));
    autoUpdater.on('download-progress', (pr) => pushUpdate({ status: 'downloading', version: updateState.version, percent: Math.round((pr && pr.percent) || 0) }));
    autoUpdater.on('update-not-available', () => pushUpdate({ status: 'current', checked: Date.now() }));
    autoUpdater.on('update-downloaded', (info) => {
      pushUpdate({ status: 'ready', version: info && info.version });
      if (win && !win.isDestroyed()) win.webContents.send('update:ready', info && info.version);
    });
    autoUpdater.on('error', (err) => pushUpdate({ status: 'error', message: String((err && err.message) || err || '').split('\n')[0].slice(0, 160) })); // offline is fine: the app works without it
    const auto = (why) => {
      if (prefs.autoUpdate === false) return;
      if (['checking', 'downloading', 'ready'].includes(updateState.status)) return;
      lastCheck = Date.now(); updLog('check (' + why + ')');
      autoUpdater.checkForUpdates().catch(() => {});
    };
    setTimeout(() => auto('start'), 8000);
    setInterval(() => auto('timer'), CHECK_EVERY).unref();
    app.on('browser-window-focus', () => { if (Date.now() - lastCheck > 60 * 60 * 1000) auto('focus'); }); // back after a break
  } catch (err) { updLog('setup failed ' + err); }
}
ipcMain.handle('app:info', () => ({ version: app.getVersion(), kind: installKind(), update: updateState }));
// What to paste into a bug report: versions, system and the update log. No file names or document text.
ipcMain.handle('app:diagnostics', () => {
  let log = '';
  try { log = fs.readFileSync(userFile('updater.log'), 'utf8').trim().split('\n').slice(-25).join('\n'); } catch (e) { log = '(no update log yet)'; }
  const text = [
    'Quire ' + app.getVersion() + ' (' + installKind() + ')',
    'Electron ' + process.versions.electron + ', Chrome ' + process.versions.chrome + ', Node ' + process.versions.node,
    'System ' + os.type() + ' ' + os.release() + ' ' + process.arch + ', language ' + app.getLocale(),
    'Update state: ' + JSON.stringify(updateState),
    'Automatic updates: ' + (prefs.autoUpdate === false ? 'off' : 'on'),
    '', 'Update log (last lines):', log,
  ].join('\n');
  require('electron').clipboard.writeText(text);
  return text.length;
});
ipcMain.handle('update:check', async () => {
  if (!updater) return { status: 'unsupported', kind: installKind() };
  if (updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'ready') return updateState;
  lastCheck = Date.now(); updLog('check (button)');
  try { await updater.checkForUpdates(); } catch (err) { pushUpdate({ status: 'error', message: String((err && err.message) || err).split('\n')[0].slice(0, 160) }); }
  return updateState;
});
// Silent install, then the new version starts by itself.
ipcMain.handle('update:install', () => {
  if (updater && updateState.status === 'ready') { updLog('install (restart button)'); updater.quitAndInstall(true, true); return true; }
  return false;
});

/* ------------------------------ window ------------------------------ */
let win = null;
let allowClose = false;

// Where the window was last time, if that place still exists on a screen.
function startBounds() {
  const b = prefs.bounds;
  const def = { width: 1280, height: 820 };
  if (!b || !(b.width >= 640) || !(b.height >= 480)) return def;
  const visible = screen.getAllDisplays().some((d) => {
    const w = d.workArea;
    return b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 && b.y < w.y + w.height - 80 && b.y + 80 < w.y + w.height && b.y >= w.y - 20;
  });
  return visible ? { x: b.x, y: b.y, width: b.width, height: b.height } : def;
}
function createWindow() {
  win = new BrowserWindow({
    ...startBounds(), minWidth: 640, minHeight: 480,
    fullscreen: !!prefs.fullscreen,
    backgroundColor: isDark() ? BG.dark : BG.light,
    title: 'Quire',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (prefs.bounds && prefs.bounds.maximized && !prefs.fullscreen) win.maximize();
  let boundsTimer;
  const rememberBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
      const nb = win.getNormalBounds();
      prefs.bounds = { x: nb.x, y: nb.y, width: nb.width, height: nb.height, maximized: win.isMaximized() };
      savePrefs();
    }, 600);
  };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => win.on(ev, rememberBounds));
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // if the page ever crashes, bring it back: the autosave and recovery copy are already on disk
  let lastCrash = 0;
  win.webContents.on('render-process-gone', () => {
    if (Date.now() - lastCrash < 10000) return;
    lastCrash = Date.now();
    setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 300);
  });

  // The renderer saves its work before the window actually closes.
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:flush');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); }, 3000);
  });
  win.on('closed', () => { win = null; });
  win.on('enter-full-screen', () => { prefs.fullscreen = true; savePrefs(); if (!win.isDestroyed()) win.webContents.send('win:fullscreen-state', true); });
  win.on('leave-full-screen', () => { prefs.fullscreen = false; savePrefs(); if (!win.isDestroyed()) win.webContents.send('win:fullscreen-state', false); });

  // Right-click: spelling suggestions + clipboard.
  win.webContents.on('context-menu', (e, params) => {
    const items = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable || params.selectionText) {
      items.push({ role: 'cut', enabled: params.editFlags.canCut });
      items.push({ role: 'copy', enabled: params.editFlags.canCopy });
      items.push({ role: 'paste', enabled: params.editFlags.canPaste });
      items.push({ type: 'separator' });
      items.push({ role: 'selectAll' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}

/* --------------------------- opening files --------------------------- */
function fileFromArgv(argv) {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    if (FILE_EXTS.includes(path.extname(a).toLowerCase()) && fs.existsSync(a)) return path.resolve(a);
  }
  return null;
}
// What we last read from or wrote to each file: if the file on disk differs (git, OneDrive, Dropbox...), we never overwrite it blindly.
const known = new Map();
const hashOf = (t) => require('crypto').createHash('sha1').update(t).digest('hex');
const noBom = (t) => (t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);
const diskChanged = (p) => { if (!known.has(p)) return false; try { return hashOf(noBom(fs.readFileSync(p, 'utf8'))) !== known.get(p); } catch (e) { return false; } };
function readDoc(p) {
  try {
    if (fs.statSync(p).size > 50 * 1024 * 1024) return { path: p, error: path.basename(p) + ' is too large to open (over 50 MB).' };
    const text = noBom(fs.readFileSync(p, 'utf8'));
    known.set(p, hashOf(text)); return { path: p, text };
  } catch (e) { return { path: p, error: 'Could not open ' + path.basename(p) + ': ' + e.message }; }
}
function addRecent(p) {
  prefs.lastPath = p;
  prefs.recent = [p].concat((prefs.recent || []).filter((x) => x !== p)).slice(0, 10);
  savePrefs();
}

/* ------------------- recovery and version history ------------------- */
// History belongs to the document (its id is stored inside the file), so renaming or moving the file keeps it.
const recoveryFile = () => userFile('recovery.draft');
const versionsRoot = () => path.join(app.getPath('userData'), 'versions');
const idOf = (text) => { const m = /"id":\s*"([A-Za-z0-9_-]{1,40})"/.exec(String(text).slice(0, 600)); return m ? m[1] : null; };
const lastSnapshot = new Map();
const lastText = new Map();
const SNAPSHOT_EVERY_MS = 5 * 60 * 1000;
const SNAPSHOT_KEEP = 60;

// A snapshot file is "<time>.draft", or "<time>~<name>.draft" when the person named it: named ones are never cleaned up.
const cleanSnapName = (n) => String(n || '').replace(/[\\/:*?"<>|.~\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function writeSnapshot(id, text, name) {
  try {
    const dir = path.join(versionsRoot(), id);
    fs.mkdirSync(dir, { recursive: true });
    const nm = cleanSnapName(name);
    fs.writeFileSync(path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + (nm ? '~' + nm : '') + '.draft'), text);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.draft') && !f.includes('~')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP))) fs.unlinkSync(path.join(dir, f));
    return true;
  } catch (e) { return false; /* history is best effort */ }
}
function snapshot(text, force) {
  const id = idOf(text);
  if (!id) return;
  // Safety net: if a save is about to shrink the document a lot, keep what was there before.
  const prev = lastText.get(id);
  if (prev && prev.length > 2000 && text.length < prev.length * 0.7) { writeSnapshot(id, prev); lastSnapshot.set(id, Date.now()); }
  lastText.set(id, text);
  if (Date.now() - (lastSnapshot.get(id) || 0) < (force ? 60 * 1000 : SNAPSHOT_EVERY_MS)) return;
  lastSnapshot.set(id, Date.now());
  writeSnapshot(id, text);
}

/* ------------------------------- export ------------------------------- */
const safeName = (s) => {
  let n = (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(n)) n += '_';
  return n || 'Untitled';
};

/* -------------------------------- IPC -------------------------------- */
ipcMain.on('init:get', (e) => {
  let open = null;
  const argvFile = fileFromArgv(process.argv);
  if (argvFile) open = readDoc(argvFile);
  let recovery = null;
  if (!open) {
    try { recovery = fs.readFileSync(recoveryFile(), 'utf8'); } catch (err) { /* none */ }
    if (!recovery && prefs.lastPath && fs.existsSync(prefs.lastPath)) open = readDoc(prefs.lastPath);
  }
  e.returnValue = { version: app.getVersion(), prefs, defaults: DEFAULT_PREFS, systemDark: nativeTheme.shouldUseDarkColors, open, recovery, fullscreen: win ? win.isFullScreen() : false };
});
ipcMain.on('prefs:set', (e, p) => {
  if (!p || typeof p !== 'object') return;
  for (const k of Object.keys(p)) if (k in DEFAULT_PREFS) prefs[k] = p[k]; // only known settings
  savePrefs();
});

// Word files are converted here: the page receives an ordinary draft, flagged as an import.
async function readAny(p) {
  if (path.extname(String(p)).toLowerCase() !== '.docx') return readDoc(p);
  try {
    if (fs.statSync(p).size > 60 * 1024 * 1024) return { path: p, error: path.basename(p) + ' is too large to import.' };
    const { importDocx } = require('./docx-import');
    const doc = await importDocx(p, path.basename(p, path.extname(p)));
    return { path: p, text: D.serializeDraft(doc), imported: true };
  } catch (err) { return { path: p, error: 'Could not import ' + path.basename(p) + '. The file is damaged or is not a Word document.' }; }
}
ipcMain.handle('doc:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open',
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['draft', 'md', 'markdown', 'txt', 'docx'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return readAny(r.filePaths[0]);
});
ipcMain.handle('doc:open-path', (e, p) => readAny(p));

/* ---- the app's own file browser ---- */
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function placesList() {
  const out = [];
  for (const [n, k] of [['Documents', 'documents'], ['Desktop', 'desktop'], ['Downloads', 'downloads'], ['Home', 'home']]) {
    try { const p = app.getPath(k); if (fs.existsSync(p)) out.push({ name: n, path: p }); } catch (err) { /* skip */ }
  }
  if (process.platform === 'win32') {
    // a disconnected network drive can take seconds to answer: ask for all letters at once and give up quickly
    const drives = await Promise.all('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (c) => {
      const d = c + ':\\';
      try { await within(fs.promises.access(d), 600); return { name: 'Drive ' + c + ':', path: d }; } catch (err) { return null; }
    }));
    out.push(...drives.filter(Boolean));
  } else out.push({ name: 'Computer', path: '/' });
  return out;
}
ipcMain.handle('fs:list', async (e, { dir, kind }) => {
  let d = dir || (kind === 'export' ? prefs.lastExportDir : prefs.lastDir) || app.getPath('documents');
  try { await within(fs.promises.access(d), 3000); } catch (err) { d = app.getPath('documents'); }
  const res = { dir: d, parent: path.dirname(d) === d ? null : path.dirname(d), sep: path.sep, places: await placesList(), entries: [] };
  try {
    const list = await within(fs.promises.readdir(d, { withFileTypes: true }), 5000); // a slow network folder never freezes the app
    for (const ent of list) {
      if (ent.name.startsWith('.') || ent.name === '$RECYCLE.BIN' || ent.name === 'System Volume Information') continue;
      let isDir = ent.isDirectory();
      if (!isDir && !ent.isFile()) { try { isDir = (await fs.promises.stat(path.join(d, ent.name))).isDirectory(); } catch (err) { continue; } }
      res.entries.push({ name: ent.name, dir: isDir });
    }
    res.entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
  } catch (err) { res.error = err.message === 'timeout' ? 'This folder is taking too long to open.' : 'This folder cannot be opened.'; }
  return res;
});
ipcMain.handle('fs:mkdir', (e, { parent, name }) => {
  try {
    if (!String(name || '').trim()) return { error: 'Type a folder name.' };
    const n = safeName(name);
    const p = path.join(parent, n);
    fs.mkdirSync(p);
    return { path: p };
  } catch (err) { return { error: err.code === 'EEXIST' ? 'That folder already exists.' : 'Could not create the folder.' }; }
});
ipcMain.handle('fs:exists', (e, p) => { try { return fs.existsSync(p); } catch (err) { return false; } });
ipcMain.on('fs:remember', (e, { kind, dir }) => { if (typeof dir === 'string') { prefs[kind === 'export' ? 'lastExportDir' : 'lastDir'] = dir; savePrefs(); } });

ipcMain.handle('doc:save', async (e, { path: p, text, suggested, saveAs, force }) => {
  try {
    if (p && !saveAs && !force && diskChanged(p)) return { conflict: true };
    if (!p || saveAs) {
      const r = await dialog.showSaveDialog(win, {
        title: saveAs ? 'Save as' : 'Save',
        defaultPath: p && saveAs ? path.join(path.dirname(p), safeName(suggested) + '.draft') : path.join(app.getPath('documents'), safeName(suggested) + '.draft'),
        filters: [{ name: 'Draft document', extensions: ['draft'] }],
      });
      if (r.canceled || !r.filePath) return null;
      p = r.filePath.toLowerCase().endsWith('.draft') ? r.filePath : r.filePath + '.draft';
    }
    atomicWrite(p, text);
    known.set(p, hashOf(text));
    snapshot(text, true);
    addRecent(p);
    fs.unlink(recoveryFile(), () => {});
    return { path: p };
  } catch (err) {
    dialog.showErrorBox('Could not save', err.message);
    return null;
  }
});
ipcMain.handle('doc:autosave', (e, { path: p, text, force }) => {
  try {
    if (!force && diskChanged(p)) return { conflict: true };
    atomicWrite(p, text); known.set(p, hashOf(text)); snapshot(text); return { ok: true };
  } catch (err) { return { ok: false }; }
});
ipcMain.handle('doc:changed', (e, p) => diskChanged(p));
// before either version is lost, the other one goes into the history
ipcMain.handle('doc:snapshot', (e, { text, path: p }) => {
  try {
    const t = p ? fs.readFileSync(p, 'utf8') : text;
    const id = idOf(t); if (id) writeSnapshot(id, t);
    return true;
  } catch (err) { return false; }
});
ipcMain.on('recovery:save', (e, text) => { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); atomicWrite(recoveryFile(), text); } catch (err) { /* ignore */ } });
ipcMain.on('recovery:clear', () => fs.unlink(recoveryFile(), () => {}));

ipcMain.handle('doc:export', async (e, { format, doc, opts, suggested, path: chosen }) => {
  const ext = { md: 'md', txt: 'txt', docx: 'docx', pdf: 'pdf', epub: 'epub' }[format];
  if (!ext) return { error: 'Unknown format' };
  const label = { md: 'Markdown', txt: 'Plain text', docx: 'Word document', pdf: 'PDF', epub: 'EPUB e-book' }[format];
  let r;
  if (chosen) r = { filePath: chosen.toLowerCase().endsWith('.' + ext) ? chosen : chosen + '.' + ext };
  else {
    r = await dialog.showSaveDialog(win, {
      title: 'Export as ' + label,
      defaultPath: path.join(prefs.lastExportDir || app.getPath('documents'), safeName(suggested) + '.' + ext),
      filters: [{ name: label, extensions: [ext] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
  }
  try {
    D.validate(doc);
    let data;
    if (format === 'md') data = D.toMarkdown(doc, opts);
    else if (format === 'txt') data = D.toPlainText(doc, opts);
    else if (format === 'epub') data = toEpub(doc, opts);
    else if (format === 'docx') data = await X.toDocx(doc, Object.assign({}, opts, { embedDir: path.join(__dirname, 'exporter-fonts') }));
    else data = await X.renderPdf(doc, opts, path.join(__dirname, 'renderer', 'fonts'));
    fs.writeFileSync(r.filePath, data);
    prefs.lastExportDir = path.dirname(r.filePath);
    savePrefs();
    return { path: r.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

/* ------------------------------ Word copy next to a book ------------------------------ */
// With the setting on, saving a .draft also writes Book.docx beside it (for Google Drive on a phone). We remember the hash of what we wrote,
// so we can tell when someone else changed that file, and never overwrite those changes without asking.
const companionFile = () => userFile('companions.json');
function companionRecords() { try { return JSON.parse(fs.readFileSync(companionFile(), 'utf8')); } catch (e) { return {}; } }
function companionRecord(p, rec) {
  const all = companionRecords();
  if (rec) all[p] = rec; else delete all[p];
  const keys = Object.keys(all);
  if (keys.length > 200) delete all[keys[0]];
  try { atomicWrite(companionFile(), JSON.stringify(all)); } catch (e) { /* the Word copy is a convenience: never fail a save over this */ }
}
const companionPathOf = (p) => (/\.draft$/i.test(String(p)) ? String(p).replace(/\.draft$/i, '.docx') : null);
const fileHash = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
ipcMain.handle('companion:check', (e, p) => {
  const docx = companionPathOf(p);
  if (!docx) return { state: 'none' };
  try {
    const gdoc = String(p).replace(/\.draft$/i, '.gdoc');
    const hasDocx = fs.existsSync(docx), rec = companionRecords()[p];
    if (hasDocx && rec && fileHash(docx) !== rec.hash) return { state: 'changed', docx, hash: fileHash(docx) };
    if (fs.existsSync(gdoc)) return { state: 'gdoc', gdoc }; // a Google Docs pointer: Quire cannot read it, but it can say so
    return { state: hasDocx && !rec ? 'unknown' : 'ok', docx };
  } catch (err) { return { state: 'none', error: err.message }; }
});
ipcMain.handle('companion:write', async (e, { path: p, doc, opts, force }) => {
  const docx = companionPathOf(p);
  if (!docx) return { status: 'none' };
  try {
    const rec = companionRecords()[p];
    if (!force && fs.existsSync(docx)) {
      if (!rec) return { status: 'exists', name: path.basename(docx) }; // a Word file of that name that Quire did not write
      if (fileHash(docx) !== rec.hash) return { status: 'conflict' };
    }
    D.validate(doc);
    const data = await X.toDocx(doc, Object.assign({}, opts, { titlePage: false, notes: true, notesMode: 'comments', embedDir: path.join(__dirname, 'exporter-fonts') }));
    atomicWrite(docx, data);
    companionRecord(p, { hash: crypto.createHash('sha1').update(data).digest('hex'), at: Date.now() });
    return { status: 'ok', path: docx };
  } catch (err) { return { status: 'error', message: err.code === 'EBUSY' || err.code === 'EPERM' ? 'is the Word copy open in Word?' : err.message }; }
});
ipcMain.handle('companion:read', async (e, p) => {
  const docx = companionPathOf(p);
  try { const { importRaw } = require('./docx-import'); return { raw: await importRaw(docx), hash: fileHash(docx) }; }
  catch (err) { return { error: err.message }; }
});
// The changes in the Word copy were looked at (imported or left): its current content is the new baseline.
ipcMain.handle('companion:accept', (e, p) => {
  const docx = companionPathOf(p);
  try { companionRecord(p, { hash: fileHash(docx), at: Date.now() }); return true; } catch (err) { return false; }
});
ipcMain.handle('companion:open-gdoc', (e, f) => {
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const url = j.url || (j.doc_id ? 'https://docs.google.com/document/d/' + encodeURIComponent(j.doc_id) + '/edit' : '');
    if (/^https:\/\/docs\.google\.com\//.test(url)) { shell.openExternal(url); return true; }
  } catch (err) { /* not a readable pointer */ }
  return false;
});

ipcMain.handle('ui:confirm', async (e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  return r.response;
});
ipcMain.handle('ui:error', (e, { message }) => dialog.showMessageBox(win, { type: 'error', message, buttons: ['OK'] }).then(() => true));
ipcMain.handle('win:fullscreen', () => { if (!win) return false; win.setFullScreen(!win.isFullScreen()); return !win.isFullScreen(); });
ipcMain.on('win:title', (e, t) => { if (win) win.setTitle(t); });
ipcMain.on('win:close', () => { if (win && !win.isDestroyed()) win.close(); });
ipcMain.on('win:close-now', () => { allowClose = true; if (win && !win.isDestroyed()) win.close(); });
ipcMain.handle('spell:info', () => {
  try { return { available: session.defaultSession.availableSpellCheckerLanguages, current: session.defaultSession.getSpellCheckerLanguages() }; }
  catch (err) { return { available: [], current: [] }; }
});
ipcMain.handle('spell:set', (e, langs) => {
  try {
    const avail = session.defaultSession.availableSpellCheckerLanguages;
    const ok = (Array.isArray(langs) ? langs : []).filter((l) => avail.includes(l)).slice(0, 2);
    if (!ok.length) return false;
    session.defaultSession.setSpellCheckerLanguages(ok);
    prefs.spellLangs = ok; savePrefs();
    return true;
  } catch (err) { return false; }
});
ipcMain.on('shell:show', (e, p) => shell.showItemInFolder(p));

ipcMain.handle('versions:list', (e, id) => {
  try {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(id))) return [];
    const dir = path.join(versionsRoot(), id);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.draft')).sort().reverse()
      .map((f) => { const m = /~(.+)\.draft$/.exec(f); return { file: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtimeMs, name: m ? m[1] : '' }; });
  } catch (err) { return []; }
});
// "Save a version" with a name
ipcMain.handle('versions:save', (e, { id, text, name }) => {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(id)) || typeof text !== 'string' || !cleanSnapName(name)) return false;
  return writeSnapshot(id, text, name);
});
ipcMain.handle('versions:delete', (e, f) => {
  try {
    const full = path.resolve(String(f));
    if (!full.startsWith(versionsRoot() + path.sep) || !path.basename(full).includes('~')) return false; // only named versions, only inside the history folder
    fs.unlinkSync(full);
    return true;
  } catch (err) { return false; }
});
ipcMain.handle('versions:read', (e, f) => {
  try {
    const full = path.resolve(String(f));
    if (!full.startsWith(versionsRoot() + path.sep)) return null; // only files inside the history folder
    return fs.readFileSync(full, 'utf8');
  } catch (err) { return null; }
});

/* ------------------------------ lifecycle ------------------------------ */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = fileFromArgv(argv);
    if (f) win.webContents.send('app:open-file', readDoc(f));
  });
  app.whenReady().then(() => {
    loadPrefs();
    if (!isDev) Menu.setApplicationMenu(null);
    try {
      const avail = session.defaultSession.availableSpellCheckerLanguages;
      const wanted = Array.isArray(prefs.spellLangs) && prefs.spellLangs.length ? prefs.spellLangs : ['en-CA', 'en-US', 'en-GB'];
      const langs = wanted.filter((l) => avail.includes(l)).slice(0, 2);
      if (langs.length) session.defaultSession.setSpellCheckerLanguages(langs);
    } catch (err) { /* keep the OS default */ }
    nativeTheme.on('updated', () => { if (win) win.webContents.send('theme:system', nativeTheme.shouldUseDarkColors); });
    createWindow();
    setupUpdates();
  });
  app.on('window-all-closed', () => app.quit());
}
