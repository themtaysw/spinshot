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
  addTextAtPlayhead,
  addTextPairAtPlayhead,
  addBadgeAtPlayhead,
  moveTextFromSnapshot,
  trimTextFromSnapshot,
  editReorderClip,
  moveKeyFromSnapshot,
  moveTextKeyFromSnapshot,
  addTextSceneAt,
  addPhoneSceneAt,
  hidePhoneAt,
  showPhoneAlways,
  moveDeviceSegFromSnapshot,
  trimDeviceSegFromSnapshot,
  moveBgKeyFromSnapshot,
  addBgKeyAtPlayhead,
  moveMusicFromSnapshot,
  trimMusicFromSnapshot,
} from '../lib/timeline.js'
import { DEVICE_ANIMS } from '../lib/scenes.js'
import Waveform from './Waveform.jsx'
import { displayText } from '../lib/textRender.js'
import { useStore } from '../store.js'
import { clipStarts, clipDur, programLength as programLengthOf } from '../lib/clips.js'
import { useThumbsMap, nearestThumb } from '../lib/thumbs.js'
import { fmtTime, fmtTick } from '../lib/format.js'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const ZOOM_MAX = 64
const ZOOM_LOG = Math.log2(ZOOM_MAX)

function chooseStep(pps) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  for (const s of steps) if (s * pps >= 64) return s
  return 600
}

export default function Timeline() {
  const tl = useTimeline()
  const exportingVideo = useStore((s) => s.exportingVideo)
  const clips = useStore((s) => s.clips)
  const texts = useStore((s) => s.texts)
  const deviceSegs = useStore((s) => s.deviceSegs)
  const bgKeys = useStore((s) => s.bgKeys)
  const music = useStore((s) => s.music)
  const activeLocale = useStore((s) => s.activeLocale)
  const media = useStore((s) => s.media)
  const screenType = useStore((s) => s.screenType)
  const hasVideo = screenType === 'video' && clips.length > 0
  const thumbsMap = useThumbsMap(hasVideo ? media : [])

  const scrollRef = useRef(null)
  const innerRef = useRef(null)
  const dragRef = useRef(null)
  const videoLaneRef = useRef(null)
  const [viewW, setViewW] = useState(600)
  const [laneH, setLaneH] = useState(40)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [clipDrag, setClipDrag] = useState(null) // { index, dx, insertAt } while reordering

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
    if (!e.target.closest('.tblock')) useTimeline.setState({ selectedText: null })
    if (!e.target.closest('.dseg')) useTimeline.setState({ selectedDevice: null })
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
    } else if (d.kind === 'tmove') {
      moveTextFromSnapshot(d.snapshot, d.id, (e.clientX - d.startX) / d.pps)
    } else if (d.kind === 'ttrim') {
      trimTextFromSnapshot(d.snapshot, d.id, d.edge, (e.clientX - d.originX) / d.pps)
    } else if (d.kind === 'cmove') {
      const dx = e.clientX - d.startX
      if (!d.moved && Math.abs(dx) > 6) d.moved = true
      if (d.moved) {
        const px = e.clientX - d.originX
        let insertAt = 0
        for (let i = 0; i < clips.length; i++) {
          if (i === d.index) continue
          if (px > xOf(starts[i] + clipDur(clips[i]) / 2)) insertAt++
        }
        d.insertAt = insertAt
        setClipDrag({ index: d.index, dx, insertAt })
      }
    } else if (d.kind === 'kmove' || d.kind === 'tkmove' || d.kind === 'bgmove') {
      const dx = e.clientX - d.startX
      if (!d.moved && Math.abs(dx) > 4) d.moved = true
      if (d.moved) {
        const t = d.t0 + dx / d.pps
        if (d.kind === 'kmove') moveKeyFromSnapshot(d.snapshot, d.index, t)
        else if (d.kind === 'tkmove') moveTextKeyFromSnapshot(d.id, d.snapshot, d.index, t)
        else moveBgKeyFromSnapshot(d.snapshot, d.id, t)
      }
    } else if (d.kind === 'dmove') {
      moveDeviceSegFromSnapshot(d.snapshot, d.id, (e.clientX - d.startX) / d.pps)
    } else if (d.kind === 'dtrim') {
      trimDeviceSegFromSnapshot(d.snapshot, d.id, d.edge, (e.clientX - d.originX) / d.pps)
    } else if (d.kind === 'mmove') {
      moveMusicFromSnapshot(d.snapshot, (e.clientX - d.startX) / d.pps)
    } else if (d.kind === 'mtrim') {
      trimMusicFromSnapshot(d.snapshot, d.edge, (e.clientX - d.originX) / d.pps)
    }
  }
  const startMusicDrag = (e, kind, edge) => {
    e.stopPropagation()
    if (e.button !== 0) return
    useTimeline.setState({ playing: false })
    dragRef.current = {
      kind,
      edge,
      pps,
      startX: e.clientX,
      originX: innerRef.current.getBoundingClientRect().left,
      snapshot: useStore.getState().music,
    }
    capture(e)
  }
  const startDeviceDrag = (e, id, kind, edge) => {
    e.stopPropagation()
    if (e.button !== 0) return
    useTimeline.setState({ selectedDevice: id, selectedText: null, selectedClip: null, playing: false })
    dragRef.current = {
      kind,
      id,
      edge,
      pps,
      startX: e.clientX,
      originX: innerRef.current.getBoundingClientRect().left,
      snapshot: useStore.getState().deviceSegs || [],
    }
    capture(e)
  }
  const startBgKeyDrag = (e, id) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const keys = useStore.getState().bgKeys
    const k = keys.find((x) => x.id === id)
    if (!k) return
    useTimeline.setState({ playing: false })
    dragRef.current = { kind: 'bgmove', id, snapshot: keys, t0: k.t, startX: e.clientX, pps, moved: false }
    capture(e)
  }
  const capture = (e) => {
    try {
      innerRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
  }
  const startClipDrag = (e, index) => {
    e.stopPropagation()
    if (e.button !== 0) return
    useTimeline.setState({ selectedClip: index, selectedText: null, playing: false })
    dragRef.current = {
      kind: 'cmove',
      index,
      startX: e.clientX,
      originX: innerRef.current.getBoundingClientRect().left,
      moved: false,
      insertAt: null,
    }
    capture(e)
  }
  const startKeyDrag = (e, index) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const keys = useTimeline.getState().keys
    useTimeline.setState({ playing: false })
    dragRef.current = { kind: 'kmove', index, snapshot: keys, t0: keys[index].t, startX: e.clientX, pps, moved: false }
    capture(e)
  }
  const startTextKeyDrag = (e, id, index) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const tx = useStore.getState().texts.find((x) => x.id === id)
    if (!tx) return
    useTimeline.setState({ selectedText: id, selectedClip: null, playing: false })
    dragRef.current = { kind: 'tkmove', id, index, snapshot: tx.keys, t0: tx.keys[index].t, startX: e.clientX, pps, moved: false }
    capture(e)
  }
  const startTextDrag = (e, id, kind, edge) => {
    e.stopPropagation()
    if (e.button !== 0) return
    useTimeline.setState({ selectedText: id, selectedClip: null, playing: false })
    dragRef.current = {
      kind,
      id,
      edge,
      pps,
      startX: e.clientX,
      originX: innerRef.current.getBoundingClientRect().left,
      snapshot: useStore.getState().texts,
    }
    try {
      innerRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
  }
  const onPointerUp = (e) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (d.kind === 'cmove') {
      if (!d.moved) seekTo(timeFromEvent(e))
      else if (d.insertAt != null) editReorderClip(d.index, d.insertAt)
      setClipDrag(null)
    } else if ((d.kind === 'kmove' || d.kind === 'tkmove' || d.kind === 'bgmove') && !d.moved) {
      seekTo(d.t0) // a plain click jumps to the key
    }
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
      snapshot: {
        clips: useStore.getState().clips,
        texts: useStore.getState().texts,
        deviceSegs: useStore.getState().deviceSegs,
        bgKeys: useStore.getState().bgKeys,
        keys: st.keys,
        t: st.t,
      },
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
    <div className={`timeline ${exportingVideo ? 'disabled' : ''}`}>
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
          <select
            className="tl-select"
            value=""
            title="Scenes: text-only sections, phone sections, and when the phone is on stage"
            onChange={(e) => {
              const v = e.target.value
              const t = useTimeline.getState().t
              if (v === 'text') addTextSceneAt(t)
              else if (v === 'phone') addPhoneSceneAt(t)
              else if (v === 'hide') hidePhoneAt(t)
              else if (v === 'always') showPhoneAlways()
              else if (v === 'bgkey') addBgKeyAtPlayhead()
            }}
          >
            <option value="">＋ Scene…</option>
            <option value="text">Text scene (phone off, title pair)</option>
            <option value="phone">Phone scene (phone rises in)</option>
            <option value="hide">Hide phone for 4s here</option>
            <option value="bgkey">Background key here</option>
            <option value="always">Phone always on stage</option>
          </select>
          <button className="btn ghost" onClick={addTextAtPlayhead} title="Add a text layer at the playhead (T)">
            ＋ Text
          </button>
          <button
            className="btn ghost"
            onClick={addTextPairAtPlayhead}
            title="Add a title + subtitle pair at the playhead (blur-in title, fade-up subtitle 0.3s later)"
          >
            ＋ Pair
          </button>
          <button
            className="btn ghost"
            onClick={addBadgeAtPlayhead}
            title="Add a pill badge (e.g. NEW) at the playhead — switch it to a card, dot marker or arrow callout in the Text section"
          >
            ＋ Badge
          </button>
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
            value={Array.isArray(tl.easing) ? 'custom' : tl.easing}
            onChange={(e) => e.target.value !== 'custom' && useTimeline.setState({ easing: e.target.value })}
            title="Keyframe easing — edit the curve in the Camera section"
          >
            <option value="ease">Ease</option>
            <option value="linear">Linear</option>
            {Array.isArray(tl.easing) && <option value="custom">Curve</option>}
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

          <div className="track-row device">
            <span className="track-label">Device</span>
            {deviceSegs === null ? (
              <div className="dseg always" title="The phone is always on stage — use ＋ Scene to add text-only sections">
                <span className="dseg-label">on stage throughout</span>
              </div>
            ) : (
              deviceSegs.map((sg) => (
                <div
                  key={sg.id}
                  className={`dseg ${tl.selectedDevice === sg.id ? 'selected' : ''}`}
                  style={{ left: xOf(sg.start), width: Math.max(6, xOf(sg.end - sg.start)) }}
                  onPointerDown={(e) => startDeviceDrag(e, sg.id, 'dmove')}
                  title={`phone on stage ${fmtTime(sg.start, 1)} → ${fmtTime(sg.end, 1)} · ${DEVICE_ANIMS[sg.intro]} in, ${DEVICE_ANIMS[sg.outro]} out`}
                >
                  <div className="tblock-handle l" onPointerDown={(e) => startDeviceDrag(e, sg.id, 'dtrim', 'start')} />
                  <span className="dseg-label">
                    {sg.intro !== 'cut' && <i className="dseg-fx">⤴</i>} phone {sg.outro !== 'cut' && <i className="dseg-fx">⤵</i>}
                  </span>
                  <div className="tblock-handle r" onPointerDown={(e) => startDeviceDrag(e, sg.id, 'dtrim', 'end')} />
                </div>
              ))
            )}
          </div>

          {bgKeys.length > 0 && (
            <div className="track-row bg">
              <span className="track-label">Background</span>
              {bgKeys.map((k) => (
                <div
                  key={k.id}
                  className={`bgkey ${Math.abs(k.t - tl.t) < 0.06 ? 'at' : ''}`}
                  style={{
                    left: xOf(k.t),
                    background:
                      k.bgType === 'gradient'
                        ? `linear-gradient(180deg, ${k.bgColor1}, ${k.bgColor2})`
                        : k.bgType === 'solid'
                        ? k.bgColor1
                        : k.bgType === 'image'
                        ? 'repeating-linear-gradient(45deg, #666 0 3px, #999 3px 6px)'
                        : 'transparent',
                  }}
                  title={`background key · ${fmtTime(k.t)} · ${k.transition === 'cut' ? 'cut' : `${k.dur}s fade`} · drag to move, click to jump`}
                  onPointerDown={(e) => startBgKeyDrag(e, k.id)}
                />
              ))}
            </div>
          )}

          <div className="track-row">
            <span className="track-label">Camera</span>
            {tl.keys.map((k, i) => (
              <div
                key={i}
                className={`key-marker ${Math.abs(k.t - tl.t) < 0.06 ? 'at' : ''}`}
                style={{ left: xOf(k.t) }}
                title={`${fmtTime(k.t)} · drag to move, click to jump`}
                onPointerDown={(e) => startKeyDrag(e, i)}
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
                const thumbs = thumbsMap[c.mediaId]
                const thumbW = thumbs ? Math.max(12, (dispH * thumbs.w) / thumbs.h) : 40
                const n = Math.max(1, Math.ceil(w / thumbW))
                const imgs = thumbs?.thumbs?.length
                  ? Array.from({ length: n }, (_, j) =>
                      nearestThumb(thumbs.thumbs, c.srcStart + ((j + 0.5) / n) * (c.srcEnd - c.srcStart))
                    )
                  : []
                const srcName = media.find((m) => m.id === c.mediaId)?.name
                const dragging = clipDrag?.index === i
                return (
                  <div
                    key={i}
                    className={`clip ${sel === i ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
                    style={{ left: xOf(starts[i]), width: w, transform: dragging ? `translateX(${clipDrag.dx}px)` : undefined }}
                    onPointerDown={(e) => startClipDrag(e, i)}
                    title={`${srcName ? srcName + ' · ' : ''}${fmtTime(c.srcStart, 1)} → ${fmtTime(c.srcEnd, 1)}${c.speed !== 1 ? ` · ${c.speed}×` : ''}`}
                  >
                    <div className="clip-thumbs">
                      {imgs.map((th, j) => th && <img key={j} src={th.url} alt="" draggable={false} />)}
                    </div>
                    {media.length > 1 && srcName && <span className="clip-name">{srcName}</span>}
                    {c.speed !== 1 && <span className="clip-speed">{c.speed}×</span>}
                    <div className="clip-handle l" onPointerDown={(e) => startTrim(e, i, 'start')} />
                    <div className="clip-handle r" onPointerDown={(e) => startTrim(e, i, 'end')} />
                  </div>
                )
              })}
              {clipDrag && (() => {
                // insertion line: before the clip that will follow the dropped one
                const others = clips.map((c, i) => i).filter((i) => i !== clipDrag.index)
                const after = others[clipDrag.insertAt]
                const x = after == null ? xOf(programLengthOf(clips)) : xOf(starts[after])
                return <div className="insert-line" style={{ left: x }} />
              })()}
            </div>
          )}

          {texts.length > 0 && (
            <div className="track-row text">
              <span className="track-label">Text</span>
              {texts.map((tx) => (
                <div
                  key={tx.id}
                  className={`tblock ${tl.selectedText === tx.id ? 'selected' : ''}`}
                  style={{ left: xOf(tx.start), width: Math.max(6, xOf(tx.end - tx.start)) }}
                  onPointerDown={(e) => startTextDrag(e, tx.id, 'tmove')}
                  title={`${fmtTime(tx.start, 1)} → ${fmtTime(tx.end, 1)} · drag to move, edges to trim`}
                >
                  <div className="tblock-handle l" onPointerDown={(e) => startTextDrag(e, tx.id, 'ttrim', 'start')} />
                  <span className="tblock-label">{displayText(tx, activeLocale).split('\n')[0] || 'Text'}</span>
                  {(tx.keys || []).map((k, i) => (
                    <div
                      key={i}
                      className={`tblock-key ${Math.abs(k.t - tl.t) < 0.06 ? 'at' : ''}`}
                      style={{ left: xOf(k.t - tx.start) }}
                      title={`position key · ${fmtTime(k.t)} · drag to move, click to jump`}
                      onPointerDown={(e) => startTextKeyDrag(e, tx.id, i)}
                    />
                  ))}
                  <div className="tblock-handle r" onPointerDown={(e) => startTextDrag(e, tx.id, 'ttrim', 'end')} />
                </div>
              ))}
            </div>
          )}

          {music && (
            <div className="track-row music">
              <span className="track-label">Music</span>
              <div
                className="mblock"
                style={{ left: xOf(music.offset), width: Math.max(6, xOf(music.len)) }}
                onPointerDown={(e) => startMusicDrag(e, 'mmove')}
                title={`${music.name} · starts at ${fmtTime(music.offset, 1)} · ${music.len.toFixed(1)}s used of ${music.dur.toFixed(1)}s · drag to move, edges to trim`}
              >
                <Waveform src={music.src} dur={music.dur} trim={music.trim} len={music.len} width={Math.max(6, xOf(music.len))} height={28} />
                <div className="tblock-handle l" onPointerDown={(e) => startMusicDrag(e, 'mtrim', 'start')} />
                <span className="mblock-label">♫ {music.name}</span>
                <div className="tblock-handle r" onPointerDown={(e) => startMusicDrag(e, 'mtrim', 'end')} />
              </div>
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
