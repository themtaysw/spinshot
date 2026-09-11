const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spinshot', {
  savePNG: (dataURL, name) => ipcRenderer.invoke('save-png', { dataURL, name }),
  saveText: (text, name) => ipcRenderer.invoke('save-text', { text, name }),
  saveBinary: (bytes, name) => ipcRenderer.invoke('save-binary', { bytes, name }),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  saveFrame: (dir, name, dataURL) => ipcRenderer.invoke('save-frame', { dir, name, dataURL }),
  saveProject: (bytes) => ipcRenderer.invoke('save-project', { bytes }),
  exportBegin: (name) => ipcRenderer.invoke('export-begin', { name }),
  exportWrite: (id, position, bytes) => ipcRenderer.invoke('export-write', { id, position, bytes }),
  exportEnd: (id) => ipcRenderer.invoke('export-end', { id }),
  exportAbort: (id) => ipcRenderer.invoke('export-abort', { id }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
  onOpenProject: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('open-project', handler)
    return () => ipcRenderer.removeListener('open-project', handler)
  },
})
