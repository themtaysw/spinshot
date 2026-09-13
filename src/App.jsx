import React, { useEffect, useRef, useState } from 'react'
import Viewport from './components/Viewport.jsx'
import Panel from './components/Panel.jsx'
import Timeline from './components/Timeline.jsx'
import AudioSync from './components/AudioSync.jsx'
import SettingsDialog from './components/SettingsDialog.jsx'
import StartScreen from './components/StartScreen.jsx'
import { useStore } from './store.js'
import {
  useTimeline,
  applySample,
  captureKey,
  deleteKeyNear,
  editSplitAtPlayhead,
  editDeleteClip,
  addTextAtPlayhead,
  deleteText,
  duplicateText,
  deleteDeviceSeg,
  setMusicFile,
} from './lib/timeline.js'
import { saveProjectFile, openProject } from './lib/project.js'
import { exportCurrentPNG } from './lib/exporter.js'
import { initHistory, undo, redo, useHistoryState } from './lib/history.js'

const mediaName = (file) => file.name.replace(/\.[^.]+$/, '') || 'Recording'
const mediaExt = (file) => (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp4').toLowerCase()

// A dropped recording is appended to the program when one already exists;
// otherwise it starts a fresh one. Images always replace the screen.
export function setScreenFile(file, set) {
  if (file.type.startsWith('video/')) {
    const s = useStore.getState()
    const entry = { id: `m${Date.now().toString(36)}`, name: mediaName(file), src: URL.createObjectURL(file), ext: mediaExt(file), dur: 0, pending: true }
    if (s.screenType === 'video' && s.media.length) {
      set({ media: [...s.media, entry] })
    } else {
      set({ screenSrc: entry.src, screenType: 'video', videoTrim: 0, clips: [], media: [entry], pendingFit: true })
    }
  } else if (file.type.startsWith('image/')) {
    const r = new FileReader()
    r.onload = () => set({ screenSrc: r.result, screenType: 'image', videoTrim: 0, clips: [], media: [] })
    r.readAsDataURL(file)
  }
}

import { screenMedia, phoneRef, threeRef } from './lib/refs.js'

// dev/testing hook
if (typeof window !== 'undefined') window.__spinshotDebug = { useStore, useTimeline, screenMedia, phoneRef, threeRef }

const LAYOUT_DEFAULTS = { panelW: 292, timelineH: 156 }
const LAYOUT_LIMITS = { panelW: [230, 600], timelineH: [112, 640] }
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))

function loadLayout() {
  try {
    return { ...LAYOUT_DEFAULTS, ...JSON.parse(localStorage.getItem('spinshot.layout') || '{}') }
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}

// Drag handle between panes. Reports pointer position while dragging; double-click resets.
function Resizer({ axis, onMove, onReset }) {
  const [active, setActive] = useState(false)
  return (
    <div
      className={`resizer ${axis} ${active ? 'active' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic pointer */
        }
        setActive(true)
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) onMove(e)
      }}
      onPointerUp={() => setActive(false)}
      onPointerCancel={() => setActive(false)}
      onDoubleClick={onReset}
      title="Drag to resize · double-click to reset"
    />
  )
}

export default function App() {
  const set = useStore((s) => s.set)
  const [dragging, setDragging] = useState(false)
  const sceneInput = useRef(null)
  const dragDepth = useRef(0)
  const saveSceneRef = useRef(() => {})
  const mainRef = useRef(null)
  const colRef = useRef(null)
  const [layout, setLayout] = useState(loadLayout)
  const { canUndo, canRedo } = useHistoryState()
  const projectName = useStore((s) => s.projectName)

  useEffect(() => {
    initHistory()
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('spinshot.layout', JSON.stringify(layout))
    } catch {
      /* private mode etc. */
    }
  }, [layout])

  useEffect(() => {
    const onDragOver = (e) => e.preventDefault()
    const onDragEnter = (e) => {
      e.preventDefault()
      dragDepth.current++
      setDragging(true)
    }
    const onDragLeave = (e) => {
      e.preventDefault()
      dragDepth.current--
      if (dragDepth.current <= 0) {
        dragDepth.current = 0
        setDragging(false)
      }
    }
    const onDrop = (e) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (!useStore.getState().started) return
      const files = [...(e.dataTransfer?.files || [])]
      const audio = files.find((f) => f.type.startsWith('audio/'))
      if (audio) setMusicFile(audio).catch((err) => alert('Could not load that audio file: ' + err.message))
      const file = files.find((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
      if (file) setScreenFile(file, set)
    }
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey
      const typing = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)
      const key = e.key.toLowerCase()

      if (mod && key === 's') {
        e.preventDefault()
        saveSceneRef.current()
        return
      }
      if (mod && key === 'o') {
        e.preventDefault()
        sceneInput.current?.click()
        return
      }
      if (mod && key === 'n') {
        e.preventDefault()
        if (!useStore.getState().started || window.confirm('Start a new sequence? Unsaved changes to the current one are lost.')) set({ started: false })
        return
      }
      if (mod && key === 'e' && !e.shiftKey) {
        e.preventDefault()
        exportCurrentPNG().catch((err) => alert('Export failed: ' + err.message))
        return
      }
      if (mod && key === 'd') {
        const { selectedText } = useTimeline.getState()
        if (selectedText != null) {
          e.preventDefault()
          duplicateText(selectedText)
        }
        return
      }
      if (mod && key === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (typing || mod || !useStore.getState().started) return

      if (e.code === 'Space') {
        e.preventDefault()
        const { playing, t, length } = useTimeline.getState()
        if (!playing && t >= length - 0.001) useTimeline.setState({ t: 0 })
        useTimeline.setState({ playing: !playing })
      } else if (key === 'k') {
        captureKey()
      } else if (key === 's') {
        editSplitAtPlayhead()
      } else if (key === 't') {
        addTextAtPlayhead()
      } else if (e.key === 'Escape') {
        if (useStore.getState().showSettings) useStore.setState({ showSettings: false })
        useTimeline.setState({ selectedClip: null, selectedText: null, selectedDevice: null })
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        const { selectedClip, selectedText, selectedDevice, t } = useTimeline.getState()
        if (selectedText != null) deleteText(selectedText)
        else if (selectedDevice != null) deleteDeviceSeg(selectedDevice)
        else if (selectedClip != null) editDeleteClip(selectedClip)
        else deleteKeyNear(t)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1)
        const { t, length } = useTimeline.getState()
        const nt = Math.min(length, Math.max(0, Math.round((t + step) * 10) / 10))
        useTimeline.setState({ t: nt, playing: false })
        applySample(nt)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [set])

  const [saving, setSaving] = useState(false)
  const saveScene = async () => {
    setSaving(true)
    try {
      await saveProjectFile()
    } catch (err) {
      alert('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }
  saveSceneRef.current = saveScene

  const loadScene = async (file) => {
    try {
      await openProject(file)
    } catch (err) {
      alert(err.message)
    }
  }

  // .spinshot files double-clicked in Finder arrive through the Electron shell
  useEffect(() => {
    if (!window.spinshot?.onOpenProject) return
    return window.spinshot.onOpenProject(async (path) => {
      try {
        const bytes = await window.spinshot.readFile(path)
        await openProject(new Blob([bytes]))
      } catch (err) {
        alert('Could not open project: ' + err.message)
      }
    })
  }, [])

  return (
    <div className="app">
      <AudioSync />
      <SettingsDialog />
      <StartScreen />
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-name">Spinshot</span>
          <span className="project-name">{projectName}</span>
        </div>
        <div className="topbar-actions">
          <button
            className="btn ghost icon-only"
            onClick={() => {
              if (window.confirm('Start a new sequence? Unsaved changes to the current one are lost.')) set({ started: false })
            }}
            title="New sequence (⌘N)"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
          <span className="topbar-sep" />
          <button className="btn ghost icon-only" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 4L2.5 7.5 6 11" />
              <path d="M3 7.5h6.5a3.5 3.5 0 0 1 0 7H8" />
            </svg>
          </button>
          <button className="btn ghost icon-only" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 4l3.5 3.5L10 11" />
              <path d="M13 7.5H6.5a3.5 3.5 0 0 0 0 7H8" />
            </svg>
          </button>
          <span className="topbar-sep" />
          <button className="btn ghost icon-only" onClick={() => set({ showSettings: true })} title="Settings (Claude API key, model)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="2.3" />
              <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
            </svg>
          </button>
          <span className="topbar-sep" />
          <button className="btn ghost" onClick={() => sceneInput.current.click()} title="⌘O">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v1" />
              <path d="M2 7.5h11.2a1 1 0 0 1 .97 1.24l-.9 3.5A1 1 0 0 1 12.3 13H3.5A1.5 1.5 0 0 1 2 11.5v-4z" />
            </svg>
            Open
            <kbd className="kbd">⌘O</kbd>
          </button>
          <button className="btn ghost" disabled={saving} onClick={saveScene} title="⌘S">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 2.5v7.5M5 7.5l3 3 3-3" />
              <path d="M2.5 10.5v1.5A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
            </svg>
            {saving ? 'Saving…' : 'Save'}
            <kbd className="kbd">⌘S</kbd>
          </button>
          <input
            ref={sceneInput}
            type="file"
            accept=".spinshot,.json"
            hidden
            onChange={(e) => {
              if (e.target.files[0]) loadScene(e.target.files[0])
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <div className="main" ref={mainRef}>
        <div className="viewport-col" ref={colRef}>
          <Viewport />
          <Resizer
            axis="y"
            onMove={(e) => {
              const bottom = colRef.current.getBoundingClientRect().bottom
              setLayout((l) => ({ ...l, timelineH: clamp(bottom - e.clientY, LAYOUT_LIMITS.timelineH) }))
            }}
            onReset={() => setLayout((l) => ({ ...l, timelineH: LAYOUT_DEFAULTS.timelineH }))}
          />
          <Timeline height={layout.timelineH} />
        </div>
        <Resizer
          axis="x"
          onMove={(e) => {
            const right = mainRef.current.getBoundingClientRect().right
            setLayout((l) => ({ ...l, panelW: clamp(right - e.clientX, LAYOUT_LIMITS.panelW) }))
          }}
          onReset={() => setLayout((l) => ({ ...l, panelW: LAYOUT_DEFAULTS.panelW }))}
        />
        <Panel width={layout.panelW} />
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">Drop to set the screen</div>
        </div>
      )}
    </div>
  )
}
