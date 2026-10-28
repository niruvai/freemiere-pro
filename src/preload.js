const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { pathToFileURL } = require('url');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  fileUrl: (p) => pathToFileURL(p).href,
  mediaUrl: (p) => 'flmedia://media/' + encodeURIComponent(p),
  allowMedia: (paths) => ipcRenderer.invoke('media:allow', paths),
  saveFrame: (dataUrl, name) => ipcRenderer.invoke('frame:save', dataUrl, name),
  pathForFile: (file) => (webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : file.path),

  pickMedia: () => ipcRenderer.invoke('media:pick'),
  probe: (p) => ipcRenderer.invoke('media:probe', p),
  thumb: (p, type, duration) => ipcRenderer.invoke('media:thumb', p, type, duration),
  wave: (p) => ipcRenderer.invoke('media:wave', p),
  proxy: (p, type) => ipcRenderer.invoke('media:proxy', p, type),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),

  saveProject: (data, filePath) => ipcRenderer.invoke('project:save', data, filePath),
  openProject: () => ipcRenderer.invoke('project:open'),
  confirmDiscard: () => ipcRenderer.invoke('confirm:discard'),
  setDirty: (dirty, title) => ipcRenderer.send('state:dirty', dirty, title),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),

  pickExportPath: (name) => ipcRenderer.invoke('export:pick', name),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),

  onMenu: (fn) => ipcRenderer.on('menu', (_e, name) => fn(name)),
  onExportProgress: (fn) => ipcRenderer.on('export:progress', (_e, p) => fn(p)),
  onProjectLoaded: (fn) => ipcRenderer.on('project:loaded', (_e, p) => fn(p)),
});
