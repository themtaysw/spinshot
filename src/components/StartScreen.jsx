import React, { useRef, useState } from 'react'
import { useStore, ASPECTS } from '../store.js'
import { useTimeline } from '../lib/timeline.js'
import { openProject } from '../lib/project.js'
import { resetHistory } from '../lib/history.js'

const BACKGROUNDS = {
  white: { label: 'White', bgType: 'solid', bgColor1: '#ffffff', bgColor2: '#c7d0e2' },
  black: { label: 'Black', bgType: 'solid', bgColor1: '#0b0b10', bgColor2: '#1b1b26' },
  indigo: { label: 'Indigo', bgType: 'gradient', bgColor1: '#635bff', bgColor2: '#1c1650' },
  sunset: { label: 'Sunset', bgType: 'gradient', bgColor1: '#ff8a3d', bgColor2: '#7c2bf0' },
  transparent: { label: 'Transparent', bgType: 'transparent', bgColor1: '#ffffff', bgColor2: '#c7d0e2' },
}

// Creates a fresh sequence from the chosen settings.
export function createSequence({ name, aspect, customAspect, length, fps, background }) {
  const st = useStore.getState()
  st.reset()
  const bg = BACKGROUNDS[background] || BACKGROUNDS.white
  useStore.setState({
    projectName: name.trim() || 'Untitled',
    aspect,
    customAspect: { w: Math.max(1, customAspect.w | 0), h: Math.max(1, customAspect.h | 0) },
    videoFps: fps,
    bgType: bg.bgType,
    bgColor1: bg.bgColor1,
    bgColor2: bg.bgColor2,
    started: true,
    showSettings: false,
  })
  useTimeline.setState({
    keys: [],
    length: Math.min(3600, Math.max(1, length)),
    t: 0,
    playing: false,
    easing: 'ease',
    loop: true,
    zoom: 1,
    selectedClip: null,
    selectedText: null,
    selectedDevice: null,
  })
  resetHistory()
}

export default function StartScreen() {
  const started = useStore((s) => s.started)
  const [name, setName] = useState('Untitled')
  const [aspect, setAspect] = useState('9:16')
  const [custom, setCustom] = useState({ w: 4, h: 3 })
  const [length, setLength] = useState(15)
  const [fps, setFps] = useState(30)
  const [background, setBackground] = useState('white')
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)

  if (started) return null

  const ratio = aspect === 'custom' ? custom : ASPECTS[aspect]
  const previewW = ratio.w >= ratio.h ? 64 : Math.round((64 * ratio.w) / ratio.h)
  const previewH = ratio.h >= ratio.w ? 64 : Math.round((64 * ratio.h) / ratio.w)

  const open = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      await openProject(file)
    } catch (err) {
      alert(err.message)
    } finally {
      setBusy(false)
    }
  }

  const create = () => createSequence({ name, aspect, customAspect: custom, length: Number(length) || 15, fps, background })

  return (
    <div className="start">
      <div className="start-card">
        <div className="start-brand">
          <span className="brand-dot" />
          <span className="brand-name">Spinshot</span>
        </div>
        <div className="start-title">New sequence</div>

        <div className="start-grid">
          <label className="start-field start-span">
            <span>Name</span>
            <input className="text-field" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} spellCheck={false} />
          </label>

          <div className="start-field start-span">
            <span>Format</span>
            <div className="format-grid">
              {Object.entries(ASPECTS).map(([k, a]) => (
                <button key={k} className={`format ${aspect === k ? 'active' : ''}`} onClick={() => setAspect(k)}>
                  <i style={{ width: a.w >= a.h ? 40 : Math.round((40 * a.w) / a.h), height: a.h >= a.w ? 40 : Math.round((40 * a.h) / a.w) }} />
                  <b>{a.label}</b>
                  <small>{k}</small>
                </button>
              ))}
              <button className={`format ${aspect === 'custom' ? 'active' : ''}`} onClick={() => setAspect('custom')}>
                <i style={{ width: previewW * 0.625, height: previewH * 0.625 }} />
                <b>Custom</b>
                <small>{custom.w}:{custom.h}</small>
              </button>
            </div>
            {aspect === 'custom' && (
              <div className="custom-ratio">
                <input className="text-field" type="number" min={1} max={64} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) || 1 })} />
                <span>:</span>
                <input className="text-field" type="number" min={1} max={64} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) || 1 })} />
                <span className="hint">width : height</span>
              </div>
            )}
          </div>

          <label className="start-field">
            <span>Length</span>
            <div className="custom-ratio">
              <input className="text-field" type="number" min={1} max={3600} step={0.5} value={length} onChange={(e) => setLength(e.target.value)} />
              <span className="hint">seconds</span>
            </div>
          </label>

          <label className="start-field">
            <span>Frame rate</span>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>

          <div className="start-field start-span">
            <span>Background</span>
            <div className="bg-chips">
              {Object.entries(BACKGROUNDS).map(([k, b]) => (
                <button
                  key={k}
                  className={`bg-chip ${background === k ? 'active' : ''}`}
                  onClick={() => setBackground(k)}
                  title={b.label}
                >
                  <i
                    style={{
                      background:
                        b.bgType === 'transparent'
                          ? 'repeating-conic-gradient(#3a3a46 0 25%, #22222b 0 50%) 0 0 / 10px 10px'
                          : b.bgType === 'gradient'
                          ? `linear-gradient(180deg, ${b.bgColor1}, ${b.bgColor2})`
                          : b.bgColor1,
                    }}
                  />
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="start-actions">
          <button className="btn ghost" disabled={busy} onClick={() => fileInput.current.click()}>
            {busy ? 'Opening…' : 'Open project…'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".spinshot,.json"
            hidden
            onChange={(e) => {
              open(e.target.files[0])
              e.target.value = ''
            }}
          />
          <button className="btn primary start-create" onClick={create}>
            Create
          </button>
        </div>
        <div className="hint start-hint">Format, length and frame rate can be changed later · the length follows your recording once you drop one.</div>
      </div>
    </div>
  )
}
