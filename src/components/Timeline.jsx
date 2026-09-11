import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  useTimeline,
  applySample,
  captureKey,
  deleteKeyNear,
  applyPreset,
  PRESETS,
  MAX_LENGTH,
  editSplitAtPlayhead,
  editDeleteClip,
  editSetSpeed,
  editTrimFromSnapshot,
} from '../lib/timeline.js'
import { useStore } from '../store.js'
import { clipStarts, clipDur } from '../lib/clips.js'
import { useThumbs, nearestThumb } from '../lib/thumbs.js'
import { fmtTime, fmtTick } from '../lib/format.js'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const ZOOM_MAX = 64
const ZOOM_LOG = Math.log2(ZOOM_MAX)

function chooseStep(pps) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) if (s * pps >= 64) return s
  return 600
}

export default function Timeline({ height }) {
  const tl = useTimeline()
  const exportingVideo = useStore((s) => s.exportingVideo)
  const clips = useStore((s) => s.clips)
  const screenSrc = useStore((s) => s.screenSrc)
  const screenType = useStore((s) => s.screenType)
  const hasVideo = screenType === 'video' && !!screenSrc && clips.length > 0
  const thumbs = useThumbs(hasVideo ? screenSrc : null)

  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const dragRef = useRef(null)
  const videoLaneRef = useRef(null)
  const [viewW, setViewW] = useState(600)
  const [laneH, setLaneH] = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // the video lane grows with the timeline height; thumbnails scale with it
  useLayoutEffect(() => {
    const el = videoLaneRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLaneH(el.clientHeight))
    ro.observe(el)
    setLaneH(el.clientHeight)
    return () => ro.disconnect()
  }, [hasVideo])

  const length = Math.max(0.1, tl.length)
  const pps = (viewW / length) * tl.zoom // pixels per second
  const innerW = Math.max(viewW, Math.round(length * pps))
  const xOf = (t) => t * pps
  const shownT = Math.min(tl.t, length)

  const timeFromEvent = (e) => {
    const r = innerRef.current.getBoundingClientRect()
    return Math.min(length, Math.max(0, (e.clientX - r.left) / pps))
  }
  const seekTo = (t) => {
    const nt = Math.round(t * 100) / 100
    useTimeline.setState({ t: nt, playing: false })
    applySample(nt)
  }

  // keep the playhead in view while playing / stepping
  useEffect(() => {
    const el = scrollRef.current
    if (!el || tl.zoom <= 1) return
    const px = xOf(shownT)
    if (px < el.scrollLeft + 4 || px > el.scrollLeft + viewW - 8) {
      el.scrollLeft = Math.max(0, px - viewW * 0.15)
    }
  }, [shownT, pps, viewW, tl.zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘/ctrl + wheel zooms around the cursor
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const st = useTimeline.getState()
      const r = el.getBoundingClientRect()
      const cursorX = e.clientX - r.left
      const ppsNow = (el.clientWidth / Math.max(0.1, st.length)) * st.zoom
      const tAtCursor = (el.scrollLeft + cursorX) / ppsNow
      const z = Math.min(ZOOM_MAX, Math.max(1, st.zoom * Math.exp(-e.deltaY * 0.01)))
      useTimeline.setState({ zoom: z })
      requestAnimationFrame(() => {
        const pps2 = (el.clientWidth / Math.max(0.1, st.length)) * z
        el.scrollLeft = Math.max(0, tAtCursor * pps2 - cursorX)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const togglePlay = () => {
    const { playing, t, length: len } = useTimeline.getState()
    if (!playing && t >= len - 0.001) useTimeline.setState({ t: 0 })
    useTimeline.setState({ playing: !playing })
  }

  // ---- pointer interactions on the track area ----
  const onPointerDown = (e) => {
    if (e.button !== 0) return
    if (!e.target.closest('.clip')) useTimeline.setState({ selectedClip: null })
    dragRef.current = { kind: 'seek' }
    try {
      innerRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    seekTo(timeFromEvent(e))
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    if (d.kind === 'seek') {
      if (e.buttons & 1) seekTo(timeFromEvent(e))
    } else if (d.kind === 'trim') {
      const t = (e.clientX - d.originX) / d.pps
      editTrimFromSnapshot(d.snapshot, d.index, d.edge, t)
    }
  }
  const onPointerUp = () => {
    dragRef.current = null
  }
  const startTrim = (e, index, edge) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const st = useTimeline.getState()
    useTimeline.setState({ selectedClip: index, playing: false })
    dragRef.current = {
      kind: 'trim',
      index,
      edge,
      pps,
      originX: innerRef.current.getBoundingClientRect().left,
      snapshot: { clips: useStore.getState().clips, keys: st.keys, t: st.t },
    }
    try {
      innerRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
  }

  // ---- ruler (only the visible part is rendered) ----
  const step = chooseStep(pps)
  const minor = (step / 5) * pps >= 9 ? step / 5 : (step / 2) * pps >= 9 ? step / 2 : step
  const ticks = []
  const tStart = Math.max(0, scrollLeft / pps - step)
  const tEnd = Math.min(length, (scrollLeft + viewW) / pps + step)
  for (let s = Math.floor(tStart / minor) * minor; s <= tEnd + 1e-6; s += minor) {
    const isMajor = Math.abs(s / step - Math.round(s / step)) < 1e-6
    ticks.push({ s: Math.round(s * 1000) / 1000, major: isMajor })
  }

  const hasKeys = tl.keys.length > 0
  const sel = tl.selectedClip != null && clips[tl.selectedClip] ? tl.selectedClip : null
  const starts = clipStarts(clips)
  const zoomSlider = (Math.log2(tl.zoom) / ZOOM_LOG) * 100

  return (
    <div className={`timeline ${exportingVideo ? 'disabled' : ''}`} style={height ? { height } : undefined}>
      <div className="tl-toolbar">
        <div className="tl-group">
          <button className="btn ghost play" onClick={togglePlay} title="Play / pause (space)">
            {tl.playing ? '❚❚' : '▶'}
          </button>
        </div>

        <div className="tl-sep" />

        <div className="tl-group">
          <button className="btn ghost" onClick={captureKey} title="Capture camera + device pose at the playhead (K)">
            ＋ Key
          </button>
          <button
            className="btn ghost"
            disabled={!hasKeys}
            onClick={() => deleteKeyNear(useTimeline.getState().t)}
            title="Delete the keyframe nearest the playhead (⌫)"
          >
            － Key
          </button>
          <button
            className={`rec ${tl.autoKey ? 'on' : ''}`}
            onClick={() => useTimeline.setState({ autoKey: !tl.autoKey })}
            title="Auto-keyframe: with at least one keyframe set, moving the camera or device at the playhead records a keyframe automatically"
          >
            <span className="rec-dot">●</span>
            <span className="rec-txt">auto-key</span>
          </button>
        </div>

        <div className="tl-sep" />

        <div className="tl-group">
          <button
            className="btn ghost"
            disabled={!hasVideo}
            onClick={editSplitAtPlayhead}
            title="Split the video at the playhead (S)"
          >
            ✂ Split
          </button>
          {sel != null && (
            <>
              <select
                className="tl-select"
                value={clips[sel].speed}
                onChange={(e) => editSetSpeed(sel, Number(e.target.value))}
                title="Playback speed of the selected clip"
              >
                {SPEEDS.map((sp) => (
                  <option key={sp} value={sp}>{sp}×</option>
                ))}
              </select>
              <button
                className="btn ghost"
                disabled={clips.length < 2}
                onClick={() => editDeleteClip(sel)}
                title="Remove the selected clip (⌫) — everything after it ripples left"
              >
                × Clip
              </button>
            </>
          )}
        </div>

        <div className="tl-sep" />

        <div className="tl-group">
          <select
            className="tl-select"
            value=""
            onChange={(e) => e.target.value && applyPreset(e.target.value)}
            title="Replace keyframes with a motion preset"
          >
            <option value="">Presets…</option>
            {Object.entries(PRESETS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>

          <select
            className="tl-select"
            value={tl.easing}
            onChange={(e) => useTimeline.setState({ easing: e.target.value })}
          >
            <option value="ease">Ease</option>
            <option value="linear">Linear</option>
          </select>
        </div>

        <div className="tl-sep" />

        <div className="tl-group">
          <label
            className="tl-field"
            title={hasVideo ? 'Length follows the edited video' : 'Timeline length in seconds'}
          >
            <input
              type="number"
              min={0.5}
              max={MAX_LENGTH}
              step={0.5}
              value={tl.length}
              disabled={hasVideo}
              onChange={(e) => {
                const len = Math.min(MAX_LENGTH, Math.max(0.5, Number(e.target.value) || 0.5))
                useTimeline.setState({ length: len, t: Math.min(useTimeline.getState().t, len) })
              }}
            />
            s
          </label>

          <label
            className="tl-field"
            title="Loop playback — the animation eases back to its start pose, and looping exports include the return"
          >
            <input type="checkbox" checked={tl.loop} onChange={(e) => useTimeline.setState({ loop: e.target.checked })} />
            loop
          </label>
        </div>

        <div className="tl-sep" />

        <div className="tl-group">
          <button
            className="btn ghost"
            disabled={!hasKeys}
            onClick={() => useTimeline.setState({ keys: [], playing: false, t: 0 })}
          >
            Clear
          </button>
        </div>

        <div className="tl-group tl-zoom" title="Zoom (⌘ + scroll over the timeline also zooms)">
          <span className="tl-zoom-ico">−</span>
          <input
            type="range"
            min={0}
            max={100}
            value={zoomSlider}
            onChange={(e) => useTimeline.setState({ zoom: Math.pow(2, (Number(e.target.value) / 100) * ZOOM_LOG) })}
            onDoubleClick={() => useTimeline.setState({ zoom: 1 })}
          />
          <span className="tl-zoom-ico">+</span>
        </div>

        <span className="time-display">
          {fmtTime(shownT)}<span className="dim"> / {fmtTime(length)}</span>
        </span>
      </div>

      <div
        ref={scrollRef}
        className="tl-scroll"
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      >
        <div
          ref={innerRef}
          className="tl-track-area"
          style={{ width: innerW }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="ruler">
            {ticks.map((tk) => (
              <div
                key={tk.s}
                className={`tick ${tk.major ? 'major' : ''}`}
                style={{ left: xOf(tk.s) }}
              >
                {tk.major && <span>{fmtTick(tk.s, step)}</span>}
              </div>
            ))}
          </div>

          <div className="track-row">
            <span className="track-label">Camera</span>
            {tl.keys.map((k, i) => (
              <div
                key={i}
                className={`key-marker ${Math.abs(k.t - tl.t) < 0.06 ? 'at' : ''}`}
                style={{ left: xOf(k.t) }}
                title={fmtTime(k.t)}
              />
            ))}
          </div>

          {hasVideo && (
            <div className="track-row video" ref={videoLaneRef}>
              <span className="track-label">Video</span>
              {clips.map((c, i) => {
                const d = clipDur(c)
                const w = Math.max(3, xOf(d))
                const dispH = Math.max(8, laneH - 8) // clip inset + borders
                const thumbW = thumbs ? Math.max(12, (dispH * thumbs.w) / thumbs.h) : 40
                const n = Math.max(1, Math.ceil(w / thumbW))
                const imgs = thumbs?.thumbs?.length
                  ? Array.from({ length: n }, (_, j) =>
                      nearestThumb(thumbs.thumbs, c.srcStart + ((j + 0.5) / n) * (c.srcEnd - c.srcStart))
                    )
                  : []
                return (
                  <div
                    key={i}
                    className={`clip ${sel === i ? 'selected' : ''}`}
                    style={{ left: xOf(starts[i]), width: w }}
                    onPointerDown={() => useTimeline.setState({ selectedClip: i })}
                    title={`${fmtTime(c.srcStart, 1)} → ${fmtTime(c.srcEnd, 1)} of the recording${c.speed !== 1 ? ` · ${c.speed}×` : ''}`}
                  >
                    <div className="clip-thumbs">
                      {imgs.map((th, j) => th && <img key={j} src={th.url} alt="" draggable={false} />)}
                    </div>
                    {c.speed !== 1 && <span className="clip-speed">{c.speed}×</span>}
                    <div className="clip-handle l" onPointerDown={(e) => startTrim(e, i, 'start')} />
                    <div className="clip-handle r" onPointerDown={(e) => startTrim(e, i, 'end')} />
                  </div>
                )
              })}
            </div>
          )}

          <div className="playhead" style={{ left: xOf(shownT) }}>
            <div className="playhead-flag" />
          </div>
        </div>
      </div>
    </div>
  )
}
