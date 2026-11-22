const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => {
  const h = (e, ...a) => cb(...a);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.sendSync('init:get'),
  setPrefs: (p) => ipcRenderer.send('prefs:set', p),
  openDialog: () => ipcRenderer.invoke('doc:open-dialog'),
  fsList: (a) => ipcRenderer.invoke('fs:list', a),
  fsMkdir: (a) => ipcRenderer.invoke('fs:mkdir', a),
  fsExists: (p) => ipcRenderer.invoke('fs:exists', p),
  fsRemember: (a) => ipcRenderer.send('fs:remember', a),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (e) { return ''; } },
  openPath: (p) => ipcRenderer.invoke('doc:open-path', p),
  save: (args) => ipcRenderer.invoke('doc:save', args),
  docChanged: (p) => ipcRenderer.invoke('doc:changed', p),
  snapshotDoc: (a) => ipcRenderer.invoke('doc:snapshot', a),
  autosave: (args) => ipcRenderer.invoke('doc:autosave', args),
  recoverySave: (text) => ipcRenderer.send('recovery:save', text),
  recoveryClear: () => ipcRenderer.send('recovery:clear'),
  exportDoc: (args) => ipcRenderer.invoke('doc:export', args),
  confirm: (args) => ipcRenderer.invoke('ui:confirm', args),
  error: (message) => ipcRenderer.invoke('ui:error', { message }),
  toggleFullscreen: () => ipcRenderer.invoke('win:fullscreen'),
  setTitle: (t) => ipcRenderer.send('win:title', t),
  close: () => ipcRenderer.send('win:close'),
  closeNow: () => ipcRenderer.send('win:close-now'),
  showInFolder: (p) => ipcRenderer.send('shell:show', p),
  appInfo: () => ipcRenderer.invoke('app:info'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (e, st) => cb(st)),
  onUpdateReady: (cb) => ipcRenderer.on('update:ready', (e, v) => cb(v)),
  spellInfo: () => ipcRenderer.invoke('spell:info'),
  spellSet: (l) => ipcRenderer.invoke('spell:set', l),
  versionsList: (p) => ipcRenderer.invoke('versions:list', p),
  versionsSave: (a) => ipcRenderer.invoke('versions:save', a),
  versionsDelete: (f) => ipcRenderer.invoke('versions:delete', f),
  versionsRead: (f) => ipcRenderer.invoke('versions:read', f),
  onSystemTheme: (cb) => on('theme:system', cb),
  onFlush: (cb) => on('app:flush', cb),
  onOpenFile: (cb) => on('app:open-file', cb),
});
