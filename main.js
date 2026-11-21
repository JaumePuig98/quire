const { app, BrowserWindow, ipcMain, dialog, Menu, nativeTheme, session, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./shared/doc.js');
const X = require('./exporters.js');

const isDev = process.argv.includes('--dev');
const FILE_EXTS = ['.draft', '.md', '.markdown', '.txt'];

/* ---------------------------- preferences ---------------------------- */
const DEFAULT_PREFS = {
  theme: 'system', // system | light | dark
  font: 'serif', // serif | sans
  size: 22,
  measure: 680,
  anchor: 68, // % of the window height where the writing line sits
  typewriter: true,
  fade: true,
  glow: true,
  sound: false,
  goal: 0, // daily word goal, 0 = off
  fullscreen: true,
  recent: [],
  lastPath: null,
};
const userFile = (n) => path.join(app.getPath('userData'), n);
let prefs = Object.assign({}, DEFAULT_PREFS);
function loadPrefs() {
  try { prefs = Object.assign({}, DEFAULT_PREFS, JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8'))); } catch (e) { /* first run */ }
}
function savePrefs() {
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); atomicWrite(userFile('settings.json'), JSON.stringify(prefs, null, 2)); } catch (e) { /* ignore */ }
}
function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const isDark = () => (prefs.theme === 'system' ? nativeTheme.shouldUseDarkColors : prefs.theme === 'dark');
const BG = { light: '#F4F1EA', dark: '#181715' };

/* ------------------------------ window ------------------------------ */
let win = null;
let allowClose = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 640, minHeight: 480,
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
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // The renderer saves its work before the window actually closes.
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:flush');
    setTimeout(() => { allowClose = true; if (win && !win.isDestroyed()) win.close(); }, 3000);
  });
  win.on('closed', () => { win = null; });
  win.on('enter-full-screen', () => { prefs.fullscreen = true; savePrefs(); });
  win.on('leave-full-screen', () => { prefs.fullscreen = false; savePrefs(); });

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
function readDoc(p) {
  try { return { path: p, text: fs.readFileSync(p, 'utf8') }; } catch (e) { return { path: p, error: 'Could not open ' + path.basename(p) + ': ' + e.message }; }
}
function addRecent(p) {
  prefs.lastPath = p;
  prefs.recent = [p].concat((prefs.recent || []).filter((x) => x !== p)).slice(0, 10);
  savePrefs();
}

/* ------------------- recovery and version history ------------------- */
const recoveryFile = () => userFile('recovery.draft');
const versionsDir = (p) => path.join(app.getPath('userData'), 'versions', crypto.createHash('sha1').update(p).digest('hex').slice(0, 16));
const lastSnapshot = new Map();
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
const SNAPSHOT_KEEP = 30;

function snapshot(p, text) {
  const last = lastSnapshot.get(p) || 0;
  if (Date.now() - last < SNAPSHOT_EVERY_MS) return;
  lastSnapshot.set(p, Date.now());
  try {
    const dir = versionsDir(p);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.draft'), text);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.draft')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - SNAPSHOT_KEEP))) fs.unlinkSync(path.join(dir, f));
  } catch (e) { /* history is best effort */ }
}

/* ------------------------------- export ------------------------------- */
const safeName = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

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
  e.returnValue = { prefs, systemDark: nativeTheme.shouldUseDarkColors, open, recovery, fullscreen: win ? win.isFullScreen() : false };
});
ipcMain.on('prefs:set', (e, p) => { Object.assign(prefs, p); savePrefs(); });

ipcMain.handle('doc:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open',
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['draft', 'md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return readDoc(r.filePaths[0]);
});
ipcMain.handle('doc:open-path', (e, p) => readDoc(p));

ipcMain.handle('doc:save', async (e, { path: p, text, suggested, saveAs }) => {
  if (!p || saveAs) {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: p && saveAs ? p : path.join(app.getPath('documents'), safeName(suggested) + '.draft'),
      filters: [{ name: 'Draft document', extensions: ['draft'] }],
    });
    if (r.canceled || !r.filePath) return null;
    p = r.filePath.toLowerCase().endsWith('.draft') ? r.filePath : r.filePath + '.draft';
  }
  try {
    atomicWrite(p, text);
    snapshot(p, text);
    addRecent(p);
    fs.unlink(recoveryFile(), () => {});
    return { path: p };
  } catch (err) {
    dialog.showErrorBox('Could not save', err.message);
    return null;
  }
});
ipcMain.handle('doc:autosave', (e, { path: p, text }) => {
  try { atomicWrite(p, text); snapshot(p, text); return true; } catch (err) { return false; }
});
ipcMain.on('recovery:save', (e, text) => { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); atomicWrite(recoveryFile(), text); } catch (err) { /* ignore */ } });
ipcMain.on('recovery:clear', () => fs.unlink(recoveryFile(), () => {}));

ipcMain.handle('doc:export', async (e, { format, doc, opts, suggested }) => {
  const ext = { md: 'md', txt: 'txt', docx: 'docx', pdf: 'pdf' }[format];
  if (!ext) return { error: 'Unknown format' };
  const label = { md: 'Markdown', txt: 'Plain text', docx: 'Word document', pdf: 'PDF' }[format];
  const r = await dialog.showSaveDialog(win, {
    title: 'Export as ' + label,
    defaultPath: path.join(prefs.lastExportDir || app.getPath('documents'), safeName(suggested) + '.' + ext),
    filters: [{ name: label, extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    D.validate(doc);
    let data;
    if (format === 'md') data = D.toMarkdown(doc, opts);
    else if (format === 'txt') data = D.toPlainText(doc, opts);
    else if (format === 'docx') data = await X.toDocx(doc, opts);
    else data = await X.renderPdf(doc, opts, path.join(__dirname, 'renderer', 'fonts'));
    fs.writeFileSync(r.filePath, data);
    prefs.lastExportDir = path.dirname(r.filePath);
    savePrefs();
    return { path: r.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('ui:confirm', async (e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  return r.response;
});
ipcMain.handle('ui:error', (e, { message }) => dialog.showMessageBox(win, { type: 'error', message, buttons: ['OK'] }).then(() => true));
ipcMain.handle('win:fullscreen', () => { if (!win) return false; win.setFullScreen(!win.isFullScreen()); return !win.isFullScreen(); });
ipcMain.on('win:title', (e, t) => { if (win) win.setTitle(t); });
ipcMain.on('win:close-now', () => { allowClose = true; if (win && !win.isDestroyed()) win.close(); });
ipcMain.on('shell:show', (e, p) => shell.showItemInFolder(p));

ipcMain.handle('versions:list', (e, p) => {
  try {
    const dir = versionsDir(p);
    return fs.readdirSync(dir).filter((f) => f.endsWith('.draft')).sort().reverse()
      .map((f) => ({ file: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtimeMs }));
  } catch (err) { return []; }
});
ipcMain.handle('versions:read', (e, f) => { try { return fs.readFileSync(f, 'utf8'); } catch (err) { return null; } });

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
      const wanted = ['en-CA', 'en-US', 'en-GB'];
      const avail = session.defaultSession.availableSpellCheckerLanguages;
      const langs = wanted.filter((l) => avail.includes(l)).slice(0, 2);
      if (langs.length) session.defaultSession.setSpellCheckerLanguages(langs);
    } catch (err) { /* keep the OS default */ }
    nativeTheme.on('updated', () => { if (win) win.webContents.send('theme:system', nativeTheme.shouldUseDarkColors); });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
