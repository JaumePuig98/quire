const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const h = (e, ...a) => cb(...a);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.sendSync('init:get'),
  setPrefs: (p) => ipcRenderer.send('prefs:set', p),
  openDialog: () => ipcRenderer.invoke('doc:open-dialog'),
  openPath: (p) => ipcRenderer.invoke('doc:open-path', p),
  save: (args) => ipcRenderer.invoke('doc:save', args),
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
  versionsList: (p) => ipcRenderer.invoke('versions:list', p),
  versionsRead: (f) => ipcRenderer.invoke('versions:read', f),
  onSystemTheme: (cb) => on('theme:system', cb),
  onFlush: (cb) => on('app:flush', cb),
  onOpenFile: (cb) => on('app:open-file', cb),
});
