const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('spinshot', {
  savePNG: (dataURL, name) => ipcRenderer.invoke('save-png', { dataURL, name }),
  saveText: (text, name) => ipcRenderer.invoke('save-text', { text, name }),
  saveBinary: (bytes, name) => ipcRenderer.invoke('save-binary', { bytes, name }),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  saveFrame: (dir, name, dataURL) => ipcRenderer.invoke('save-frame', { dir, name, dataURL }),
  saveProject: (bytes, name) => ipcRenderer.invoke('save-project', { bytes, name }),
  exportBegin: (name) => ipcRenderer.invoke('export-begin', { name }),
  exportBeginAt: (filePath) => ipcRenderer.invoke('export-begin-at', { filePath }),
  ai: {
    hasKey: () => ipcRenderer.invoke('ai-key-has'),
    setKey: (key, provider) => ipcRenderer.invoke('ai-key-set', { key, provider }),
    clearKey: (provider) => ipcRenderer.invoke('ai-key-clear', { provider }),
    getSettings: () => ipcRenderer.invoke('ai-settings-get'),
    setSettings: (patch) => ipcRenderer.invoke('ai-settings-set', patch),
    test: () => ipcRenderer.invoke('ai-test'),
    estimate: (payload) => ipcRenderer.invoke('ai-estimate', payload),
    translate: (payload) => ipcRenderer.invoke('ai-translate', payload),
    copy: (payload) => ipcRenderer.invoke('ai-copy', payload),
    storyboard: (payload) => ipcRenderer.invoke('ai-storyboard', payload),
  },
  exportWrite: (id, position, bytes) => ipcRenderer.invoke('export-write', { id, position, bytes }),
  exportEnd: (id) => ipcRenderer.invoke('export-end', { id }),
  exportAbort: (id) => ipcRenderer.invoke('export-abort', { id }),
  readFile: (filePath) => ipcRenderer.invoke('read-file', { filePath }),
  onFullscreen: (cb) => {
    const handler = (_e, v) => cb(v)
    ipcRenderer.on('fullscreen', handler)
    return () => ipcRenderer.removeListener('fullscreen', handler)
  },
  onOpenProject: (cb) => {
    const handler = (_e, p) => cb(p)
    ipcRenderer.on('open-project', handler)
    return () => ipcRenderer.removeListener('open-project', handler)
  },
})
