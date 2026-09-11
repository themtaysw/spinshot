import React, { useRef, useState } from 'react'
import { useStore, FINISHES, LIGHT_PRESETS, ASPECTS } from '../store.js'
import { exportCurrentPNG } from '../lib/exporter.js'
import { exportTimeline } from '../lib/videoExporter.js'
import { useTimeline, autoCaptureKey } from '../lib/timeline.js'
import { controlsRef } from '../lib/refs.js'
import { setScreenFile } from '../App.jsx'

function Section({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`section ${open ? 'open' : 'collapsed'}`}>
      <button className="section-title" onClick={() => setOpen(!open)}>
        {title}
        <span className="chevron">⌄</span>
      </button>
      <div className="section-body">
        <div className="section-body-inner">{children}</div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="row-control">{children}</div>
    </div>
  )
}

function Slider({ value, onChange, min, max, step = 1, suffix = '' }) {
  return (
    <div className="slider-wrap">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="slider-val">{value}{suffix}</span>
    </div>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map(([key, label]) => (
        <button key={key} className={value === key ? 'active' : ''} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export default function Panel({ width }) {
  const s = useStore()
  const set = s.set
  const screenInput = useRef(null)
  const bgInput = useRef(null)
  const [busy, setBusy] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const readFile = (file, cb) => {
    const r = new FileReader()
    r.onload = () => cb(r.result)
    r.readAsDataURL(file)
  }

  const doExport = async () => {
    setBusy(true)
    setSavedMsg('')
    try {
      const res = await exportCurrentPNG()
      if (res?.saved) setSavedMsg(`Saved ${res.w}×${res.h}`)
    } catch (err) {
      setSavedMsg('Export failed: ' + err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={width ? { width } : undefined}>
      <Section title="Screen">
        <div className="btn-row">
          <button className="btn" onClick={() => screenInput.current.click()}>Choose image / video…</button>
          {s.screenSrc && (
            <button
              className="btn ghost"
              onClick={() => {
                set({ screenSrc: null, screenType: 'image', videoTrim: 0, clips: [], videoDur: 0 })
                useTimeline.setState({ selectedClip: null })
              }}
            >
              Clear
            </button>
          )}
        </div>
        <input
          ref={screenInput}
          type="file"
          accept="image/*,video/*"
          hidden
          onChange={(e) => e.target.files[0] && setScreenFile(e.target.files[0], set)}
        />
        <div className="hint">or drag &amp; drop anywhere — screenshots and screen recordings both work</div>
        {s.screenType === 'video' && s.videoDur > 0 && (
          <>
            <div className="hint">
              recording is {s.videoDur.toFixed(1)}s — cut, trim and speed it up on the video lane below the viewport
              (S splits at the playhead, drag clip edges to trim, ⌫ deletes the selected clip)
            </div>
            <label className="checkline">
              <input type="checkbox" checked={s.bakeTrim} onChange={(e) => set({ bakeTrim: e.target.checked })} />
              save projects with only the edited video (smaller file)
            </label>
          </>
        )}
      </Section>

      <Section title="Device" defaultOpen>
        <div className="swatches">
          {Object.entries(FINISHES).map(([key, f]) => (
            <button
              key={key}
              title={f.label}
              className={`swatch ${s.finish === key ? 'active' : ''}`}
              style={{ background: f.frame }}
              onClick={() => set({ finish: key })}
            />
          ))}
        </div>
        <Row label="Tilt"><Slider value={s.rotX} onChange={(v) => { set({ rotX: v }); autoCaptureKey() }} min={-45} max={45} suffix="°" /></Row>
        <Row label="Turn"><Slider value={s.rotY} onChange={(v) => { set({ rotY: v }); autoCaptureKey() }} min={-180} max={180} suffix="°" /></Row>
        <Row label="Roll"><Slider value={s.rotZ} onChange={(v) => { set({ rotZ: v }); autoCaptureKey() }} min={-45} max={45} suffix="°" /></Row>
      </Section>

      <Section title="Camera">
        <Row label="Lens">
          <Slider value={s.fov} onChange={(v) => { set({ fov: v }); autoCaptureKey() }} min={12} max={75} suffix="°" />
        </Row>
        <div className="hint">low = flat product shot · high = dramatic</div>
        <button className="btn ghost" onClick={() => controlsRef.current?.reset()}>Reset camera</button>
      </Section>

      <Section title="Background">
        <Segmented
          options={[['transparent', 'None'], ['solid', 'Solid'], ['gradient', 'Gradient'], ['image', 'Image']]}
          value={s.bgType}
          onChange={(v) => set({ bgType: v })}
        />
        {(s.bgType === 'solid' || s.bgType === 'gradient') && (
          <Row label={s.bgType === 'gradient' ? 'Top' : 'Color'}>
            <input type="color" value={s.bgColor1} onChange={(e) => set({ bgColor1: e.target.value })} />
          </Row>
        )}
        {s.bgType === 'gradient' && (
          <Row label="Bottom">
            <input type="color" value={s.bgColor2} onChange={(e) => set({ bgColor2: e.target.value })} />
          </Row>
        )}
        {s.bgType === 'image' && (
          <>
            <button className="btn" onClick={() => bgInput.current.click()}>Choose background…</button>
            <input
              ref={bgInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files[0] && readFile(e.target.files[0], (src) => set({ bgImage: src }))}
            />
          </>
        )}
      </Section>

      <Section title="Light & floor">
        <Segmented
          options={Object.entries(LIGHT_PRESETS)}
          value={s.lightPreset}
          onChange={(v) => set({ lightPreset: v })}
        />
        <Row label="Intensity">
          <Slider value={s.lightIntensity} onChange={(v) => set({ lightIntensity: v })} min={0.2} max={2.5} step={0.1} />
        </Row>
        <Row label="Shadow">
          <input type="checkbox" checked={s.shadow} onChange={(e) => set({ shadow: e.target.checked })} />
        </Row>
        <Row label="Reflection">
          <input type="checkbox" checked={s.reflection} onChange={(e) => set({ reflection: e.target.checked })} />
        </Row>
      </Section>

      <Section title="Export">
        <Segmented
          options={Object.entries(ASPECTS).map(([k, v]) => [k, `${v.label}`])}
          value={s.aspect}
          onChange={(v) => set({ aspect: v })}
        />
        <Row label="Size">
          <select value={s.exportRes} onChange={(e) => set({ exportRes: Number(e.target.value) })}>
            <option value={1080}>1080 px</option>
            <option value={1620}>1620 px</option>
            <option value={2160}>2160 px</option>
            <option value={3240}>3240 px</option>
          </select>
        </Row>
        {s.bgType === 'transparent' && <div className="hint">background will be transparent</div>}
        <button className="btn primary" disabled={busy} onClick={doExport} title="⌘E">
          {busy ? 'Rendering…' : 'Export PNG'}
        </button>
        {savedMsg && <div className="hint ok">{savedMsg}</div>}
      </Section>

      <VideoExport />
    </div>
  )
}

function VideoExport() {
  const s = useStore()
  const set = s.set
  const keyCount = useTimeline((t) => t.keys.length)
  const [progress, setProgress] = useState(null)
  const [msg, setMsg] = useState('')
  const cancelRef = useRef(false)

  const isElectron = !!window.spinshot
  const canExport = keyCount >= 2 && !s.exportingVideo

  const dims = () => {
    const a = ASPECTS[s.aspect]
    const short = s.exportRes
    const w = a.w <= a.h ? short : Math.round((short * a.w) / a.h)
    const h = a.w <= a.h ? Math.round((short * a.h) / a.w) : short
    return { w, h }
  }

  const run = async () => {
    setMsg('')
    setProgress(0)
    cancelRef.current = false
    set({ exportingVideo: true })
    useTimeline.setState({ playing: false })
    try {
      const { w, h } = dims()
      if (s.videoFormat === 'mp4') {
        const res = await exportTimeline({
          width: w,
          height: h,
          fps: s.videoFps,
          mode: 'mp4',
          name: `spinshot-${w}x${h}.mp4`,
          onProgress: setProgress,
          shouldCancel: () => cancelRef.current,
        })
        if (res?.saved) setMsg('Video saved')
      } else {
        const dir = await window.spinshot.chooseDir()
        if (!dir) return
        await exportTimeline({
          width: w,
          height: h,
          fps: s.videoFps,
          mode: 'frames',
          onFrame: (dataURL, i) =>
            window.spinshot.saveFrame(dir, `frame-${String(i).padStart(4, '0')}.png`, dataURL),
          onProgress: setProgress,
          shouldCancel: () => cancelRef.current,
        })
        setMsg('Frames saved to folder')
      }
    } catch (err) {
      setMsg(err.message === 'cancelled' ? 'Cancelled' : 'Export failed: ' + err.message)
    } finally {
      set({ exportingVideo: false })
      setProgress(null)
    }
  }

  return (
    <Section title="Export video">
      <Row label="Format">
        <select value={s.videoFormat} onChange={(e) => set({ videoFormat: e.target.value })}>
          <option value="mp4">MP4 (H.264)</option>
          {isElectron && <option value="frames">PNG sequence</option>}
        </select>
      </Row>
      <Row label="FPS">
        <select value={s.videoFps} onChange={(e) => set({ videoFps: Number(e.target.value) })}>
          <option value={24}>24</option>
          <option value={30}>30</option>
          <option value={60}>60</option>
        </select>
      </Row>
      {keyCount < 2 && <div className="hint">add at least 2 keyframes, or pick a motion preset below the viewport</div>}
      {s.videoFormat === 'mp4' && s.bgType === 'transparent' && (
        <div className="hint">MP4 has no transparency — use PNG sequence for that</div>
      )}
      {s.exportingVideo ? (
        <>
          <div className="progress">
            <div className="progress-fill" style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
          </div>
          <button className="btn" onClick={() => (cancelRef.current = true)}>Cancel</button>
        </>
      ) : (
        <button className="btn primary" disabled={!canExport} onClick={run}>
          Export video
        </button>
      )}
      {msg && <div className="hint ok">{msg}</div>}
    </Section>
  )
}
