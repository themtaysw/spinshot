const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const ai = require('./ai.cjs')

ai.register()

let win
let pendingOpenFile = null

function sendOpenFile(p) {
  if (win && !win.isDestroyed()) win.webContents.send('open-project', p)
  else pendingOpenFile = p
}

app.on('open-file', (e, p) => {
  e.preventDefault()
  sendOpenFile(p)
})

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'Spinshot',
    backgroundColor: '#0d0d12',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.on('did-finish-load', () => {
    if (pendingOpenFile) {
      win.webContents.send('open-project', pendingOpenFile)
      pendingOpenFile = null
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('save-png', async (_e, { dataURL, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  })
  if (canceled || !filePath) return { saved: false }
  const base64 = dataURL.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'))
  return { saved: true, filePath }
})

ipcMain.handle('save-binary', async (_e, { bytes, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  })
  if (canceled || !filePath) return { saved: false }
  fs.writeFileSync(filePath, Buffer.from(bytes))
  return { saved: true, filePath }
})

ipcMain.handle('choose-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    message: 'Choose a folder for the PNG frames',
  })
  if (canceled || !filePaths[0]) return null
  return filePaths[0]
})

ipcMain.handle('save-frame', async (_e, { dir, name, dataURL }) => {
  const base64 = dataURL.replace(/^data:image\/png;base64,/, '')
  fs.writeFileSync(path.join(dir, name), Buffer.from(base64, 'base64'))
  return { saved: true }
})

// Streaming video export: the renderer writes MP4 chunks at explicit positions
// as they're encoded, so nothing is buffered in memory.
const exports_ = new Map()
let exportSeq = 0

ipcMain.handle('export-begin', async (_e, { name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
  })
  if (canceled || !filePath) return { canceled: true }
  const id = ++exportSeq
  exports_.set(id, { fd: fs.openSync(filePath, 'w'), filePath })
  return { id, filePath }
})

// batch exports open files by path without a dialog per file
ipcMain.handle('export-begin-at', async (_e, { filePath }) => {
  const id = ++exportSeq
  exports_.set(id, { fd: fs.openSync(filePath, 'w'), filePath })
  return { id, filePath }
})

ipcMain.handle('export-write', async (_e, { id, position, bytes }) => {
  const ex = exports_.get(id)
  if (!ex) throw new Error('unknown export')
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 0
  while (off < buf.length) off += fs.writeSync(ex.fd, buf, off, buf.length - off, position + off)
  return true
})

ipcMain.handle('export-end', async (_e, { id }) => {
  const ex = exports_.get(id)
  if (!ex) return { saved: false }
  fs.closeSync(ex.fd)
  exports_.delete(id)
  return { saved: true, filePath: ex.filePath }
})

ipcMain.handle('export-abort', async (_e, { id }) => {
  const ex = exports_.get(id)
  if (!ex) return false
  try {
    fs.closeSync(ex.fd)
    fs.unlinkSync(ex.filePath)
  } catch {
    /* best effort */
  }
  exports_.delete(id)
  return true
})

ipcMain.handle('save-project', async (_e, { bytes, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name || 'Untitled.spinshot',
    filters: [{ name: 'Spinshot project', extensions: ['spinshot'] }],
  })
  if (canceled || !filePath) return { saved: false }
  fs.writeFileSync(filePath, Buffer.from(bytes))
  return { saved: true, filePath }
})

ipcMain.handle('read-file', async (_e, { filePath }) => {
  return fs.readFileSync(filePath)
})

ipcMain.handle('save-text', async (_e, { text, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: name,
    filters: [{ name: 'Spinshot scene', extensions: ['json'] }],
  })
  if (canceled || !filePath) return { saved: false }
  fs.writeFileSync(filePath, text, 'utf8')
  return { saved: true, filePath }
})
