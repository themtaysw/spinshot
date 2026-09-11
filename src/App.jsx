import React, { useEffect, useRef, useState } from 'react'
import Viewport from './components/Viewport.jsx'
import Panel from './components/Panel.jsx'
import Timeline from './components/Timeline.jsx'
import { useStore } from './store.js'
import { useTimeline, applySample, captureKey, deleteKeyNear, editSplitAtPlayhead, editDeleteClip } from './lib/timeline.js'
import { saveProjectFile, openProject } from './lib/project.js'
import { exportCurrentPNG } from './lib/exporter.js'

export function setScreenFile(file, set) {
  if (file.type.startsWith('video/')) {
    set({ screenSrc: URL.createObjectURL(file), screenType: 'video', videoTrim: 0, clips: [], videoDur: 0, pendingFit: true })
  } else if (file.type.startsWith('image/')) {
    const r = new FileReader()
    r.onload = () => set({ screenSrc: r.result, screenType: 'image', videoTrim: 0, clips: [], videoDur: 0 })
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
      const file = [...(e.dataTransfer?.files || [])].find(
        (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
      )
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
      if (mod && key === 'e' && !e.shiftKey) {
        e.preventDefault()
        exportCurrentPNG().catch((err) => alert('Export failed: ' + err.message))
        return
      }
      if (typing || mod) return

      if (e.code === 'Space') {
        e.preventDefault()
        const { playing, t, length } = useTimeline.getState()
        if (!playing && t >= length - 0.001) useTimeline.setState({ t: 0 })
        useTimeline.setState({ playing: !playing })
      } else if (key === 'k') {
        captureKey()
      } else if (key === 's') {
        editSplitAtPlayhead()
      } else if (e.key === 'Escape') {
        useTimeline.setState({ selectedClip: null })
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        const { selectedClip, t } = useTimeline.getState()
        if (selectedClip != null) editDeleteClip(selectedClip)
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
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" /> Spinshot
        </div>
        <div className="topbar-actions">
          <button className="btn ghost" disabled={saving} onClick={saveScene} title="⌘S">
            {saving ? 'Saving…' : 'Save project'}
          </button>
          <button className="btn ghost" onClick={() => sceneInput.current.click()} title="⌘O">Open project</button>
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
