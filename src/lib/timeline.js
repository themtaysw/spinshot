import { create } from 'zustand'
import * as THREE from 'three'
import { threeRef, controlsRef, phoneRef, historyGate, frameTime } from './refs.js'
import {
  hideRange,
  makeDeviceSeg,
  normalizeSegs,
  makeBgKey,
  bgAt,
  remapSegs,
  remapBgKeys,
  SCENE_DUR,
} from './scenes.js'
import { useStore } from '../store.js'
import * as Clips from './clips.js'
import { remapRange, makeText, makeTextPair, makeBadge, newTextId, isLightColor, resolveAt, measureText, fitTextSize, fitText } from './textRender.js'
import { getAspect } from '../store.js'
import { easeCurve, DEFAULT_CURVE } from './bezier.js'

// When looping, the animation eases back to its start pose over this many
// seconds instead of snapping — playback and exports both include it.
export const LOOP_RETURN = 1

export const useTimeline = create((set) => ({
  keys: [],
  t: 0,
  length: 6,
  playing: false,
  easing: 'ease', // 'ease' | 'linear'
  loop: true,
  autoKey: true,
  zoom: 1, // 1 = whole timeline fits the track width
  selectedClip: null, // index into store.clips
  selectedText: null, // id in store.texts
  selectedDevice: null, // id in store.deviceSegs
  set: (p) => set(p),
}))

// ---- scenes: device segments ----
export function hidePhoneAt(t, dur = SCENE_DUR) {
  const s = useStore.getState()
  const { length } = useTimeline.getState()
  useStore.setState({ deviceSegs: hideRange(s.deviceSegs, t, Math.min(length, t + dur), length) })
  useTimeline.setState({ selectedDevice: null })
}

export function addPhoneSegAt(t, dur = SCENE_DUR) {
  const s = useStore.getState()
  const { length } = useTimeline.getState()
  const seg = makeDeviceSeg(t, Math.min(length, t + dur))
  const segs = normalizeSegs([...(s.deviceSegs || []), seg])
  useStore.setState({ deviceSegs: segs })
  const hit = segs.find((x) => t >= x.start && t < x.end) || seg
  useTimeline.setState({ selectedDevice: hit.id, selectedText: null, selectedClip: null })
  return hit.id
}

export function showPhoneAlways() {
  useStore.setState({ deviceSegs: null })
  useTimeline.setState({ selectedDevice: null })
}

export function updateDeviceSeg(id, patch) {
  const segs = (useStore.getState().deviceSegs || []).map((x) => (x.id === id ? { ...x, ...patch } : x))
  useStore.setState({ deviceSegs: 'start' in patch || 'end' in patch ? normalizeSegs(segs) : segs })
}

export function deleteDeviceSeg(id) {
  useStore.setState({ deviceSegs: (useStore.getState().deviceSegs || []).filter((x) => x.id !== id) })
  if (useTimeline.getState().selectedDevice === id) useTimeline.setState({ selectedDevice: null })
}

export function moveDeviceSegFromSnapshot(snapshot, id, delta) {
  const { length } = useTimeline.getState()
  const src = snapshot.find((x) => x.id === id)
  if (!src) return
  const dur = src.end - src.start
  const start = Math.min(Math.max(0, src.start + delta), Math.max(0, length - dur))
  const segs = snapshot.map((x) => (x.id === id ? { ...x, start: Math.round(start * 100) / 100, end: Math.round((start + dur) * 100) / 100 } : x))
  useStore.setState({ deviceSegs: normalizeSegs(segs) })
}

export function trimDeviceSegFromSnapshot(snapshot, id, edge, newT) {
  const { length } = useTimeline.getState()
  const src = snapshot.find((x) => x.id === id)
  if (!src) return
  const t = Math.round(Math.min(length, Math.max(0, newT)) * 100) / 100
  const patch = edge === 'start' ? { start: Math.min(t, src.end - 0.2) } : { end: Math.max(t, src.start + 0.2) }
  useStore.setState({ deviceSegs: normalizeSegs(snapshot.map((x) => (x.id === id ? { ...x, ...patch } : x))) })
}

// ---- scenes: background keys ----
const BG_EPS = 0.06
const bgFields = ['bgType', 'bgColor1', 'bgColor2', 'bgImage']

export function bgKeyAtPlayhead() {
  const t = useTimeline.getState().t
  return useStore.getState().bgKeys.find((k) => Math.abs(k.t - t) <= BG_EPS) || null
}

// Edit the background: writes the key at the playhead when backgrounds are
// keyed (creating one there if needed), otherwise the static setting.
export function setBackground(patch) {
  const s = useStore.getState()
  if (!s.bgKeys.length) {
    useStore.setState(patch)
    return
  }
  const t = Math.round(useTimeline.getState().t * 100) / 100
  const existing = bgKeyAtPlayhead()
  if (existing) {
    useStore.setState({ bgKeys: s.bgKeys.map((k) => (k.id === existing.id ? { ...k, ...patch } : k)) })
    return
  }
  const cur = bgAt(s.bgKeys, t, s)
  const key = makeBgKey(t, { bgType: cur.bgType, bgColor1: cur.c1, bgColor2: cur.c2, bgImage: cur.bgImage }, patch)
  useStore.setState({ bgKeys: [...s.bgKeys, key].sort((a, b) => a.t - b.t) })
}

export function addBgKeyAtPlayhead(extra = {}) {
  const s = useStore.getState()
  const t = Math.round(useTimeline.getState().t * 100) / 100
  const cur = bgAt(s.bgKeys, t, s)
  const key = makeBgKey(t, { bgType: cur.bgType, bgColor1: cur.c1, bgColor2: cur.c2, bgImage: cur.bgImage }, extra)
  useStore.setState({ bgKeys: [...s.bgKeys.filter((k) => Math.abs(k.t - t) > BG_EPS), key].sort((a, b) => a.t - b.t) })
  return key.id
}

export function updateBgKey(id, patch) {
  useStore.setState({ bgKeys: useStore.getState().bgKeys.map((k) => (k.id === id ? { ...k, ...patch } : k)) })
}

export function deleteBgKeyNear(t) {
  const { bgKeys } = useStore.getState()
  if (!bgKeys.length) return
  let best = 0
  for (let i = 1; i < bgKeys.length; i++) if (Math.abs(bgKeys[i].t - t) < Math.abs(bgKeys[best].t - t)) best = i
  useStore.setState({ bgKeys: bgKeys.filter((_, i) => i !== best) })
}

export function clearBgKeys() {
  const s = useStore.getState()
  const cur = bgAt(s.bgKeys, useTimeline.getState().t, s)
  useStore.setState({ bgKeys: [], bgType: cur.bgType, bgColor1: cur.c1, bgColor2: cur.c2, bgImage: cur.bgImage })
}

export function moveBgKeyFromSnapshot(snapshot, id, newT) {
  const { length } = useTimeline.getState()
  const t = Math.round(Math.min(length, Math.max(0, newT)) * 100) / 100
  useStore.setState({ bgKeys: snapshot.map((k) => (k.id === id ? { ...k, t } : k)).sort((a, b) => a.t - b.t) })
}

// ---- music ----
export async function setMusicFile(file) {
  const { loadAudio } = await import('./audio.js')
  const src = URL.createObjectURL(file)
  const { dur } = await loadAudio(src)
  const { length } = useTimeline.getState()
  const music = {
    id: `a${Date.now().toString(36)}`,
    name: file.name.replace(/\.[^.]+$/, '') || 'Music',
    src,
    ext: (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp3').toLowerCase(),
    dur,
    offset: 0,
    trim: 0,
    len: Math.min(dur, Math.max(0.5, length)),
    volume: 0.8,
    fadeIn: 0,
    fadeOut: 1,
  }
  useStore.setState({ music })
}

export function updateMusic(patch) {
  const m = useStore.getState().music
  if (m) useStore.setState({ music: { ...m, ...patch } })
}

export function removeMusic() {
  useStore.setState({ music: null })
}

export function moveMusicFromSnapshot(snapshot, delta) {
  const { length } = useTimeline.getState()
  const offset = Math.min(Math.max(0, snapshot.offset + delta), Math.max(0, length - 0.2))
  updateMusic({ offset: Math.round(offset * 100) / 100 })
}

export function trimMusicFromSnapshot(snapshot, edge, newT) {
  const m = snapshot
  if (edge === 'start') {
    const minStart = m.offset - m.trim // can't reveal audio before the file starts
    const start = Math.min(m.offset + m.len - 0.5, Math.max(0, minStart, newT))
    const delta = start - m.offset
    updateMusic({
      offset: Math.round(start * 100) / 100,
      trim: Math.round((m.trim + delta) * 100) / 100,
      len: Math.round((m.len - delta) * 100) / 100,
    })
  } else {
    const maxEnd = m.offset + (m.dur - m.trim)
    const end = Math.max(m.offset + 0.5, Math.min(maxEnd, newT))
    updateMusic({ len: Math.round((end - m.offset) * 100) / 100 })
  }
}

// ---- scene quick-adds ----
export function addTextSceneAt(t) {
  const { length } = useTimeline.getState()
  const dur = Math.min(SCENE_DUR, Math.max(1, length - t))
  hidePhoneAt(t, dur)
  addBgKeyAtPlayhead()
  const s = useStore.getState()
  const pair = makeTextPair({ t: Math.min(t + 0.2, length - 0.5), length, light: bgIsLight(s), index: s.texts.length })
  for (const tx of pair) {
    tx.end = Math.min(length, t + dur - 0.2)
    tx.y = tx.id === pair[0].id ? 0.42 : 0.42 + pair[0].size * pair[0].lineHeight * 0.5 + tx.size * 1.15
  }
  useStore.setState({ texts: [...s.texts, ...fitTexts(pair)] })
  useTimeline.setState({ selectedText: pair[0].id, selectedClip: null, selectedDevice: null, playing: false })
}

export function addPhoneSceneAt(t) {
  const { length } = useTimeline.getState()
  const id = addPhoneSegAt(t, Math.min(SCENE_DUR, Math.max(1, length - t)))
  addBgKeyAtPlayhead()
  useTimeline.setState({ selectedDevice: id, playing: false })
}

// ---- text layers ----
function remapTexts(texts, remap) {
  const out = []
  for (const tx of texts) {
    const r = remapRange(remap, tx.start, tx.end)
    if (!r) continue
    const keys = (tx.keys || [])
      .map((k) => ({ ...k, t: remap(k.t) }))
      .filter((k) => k.t != null)
      .map((k) => ({ ...k, t: Math.round(k.t * 1000) / 1000 }))
    out.push({ ...tx, start: r[0], end: r[1], keys })
  }
  return out
}

// ---- text position keyframes (x / y / size over the text's lifetime) ----
const TEXT_KEY_EPS = 0.06

function upsertTextKey(keys, key) {
  return keys
    .filter((k) => Math.abs(k.t - key.t) > TEXT_KEY_EPS)
    .concat(key)
    .sort((a, b) => a.t - b.t)
}

// Sets position/size: writes the keyframe at the playhead when the text is
// keyed, otherwise its base values.
export function setTextPosition(id, patch) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  if (!tx.keys?.length) {
    updateText(id, patch)
    return
  }
  const t = Math.round(useTimeline.getState().t * 100) / 100
  const cur = resolveAt(tx, t)
  const existing = tx.keys.find((k) => Math.abs(k.t - t) <= TEXT_KEY_EPS)
  const key = { t, x: cur.x, y: cur.y, size: cur.size, ease: existing?.ease || DEFAULT_CURVE, ...patch }
  updateText(id, { keys: upsertTextKey(tx.keys, key) })
}

export function addTextKey(id) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  const t = Math.round(useTimeline.getState().t * 100) / 100
  const cur = resolveAt(tx, t)
  updateText(id, { keys: upsertTextKey(tx.keys || [], { t, x: cur.x, y: cur.y, size: cur.size, ease: DEFAULT_CURVE }) })
}

// index of the key whose segment contains the playhead (the last key if beyond)
export function textSegmentIndex(tx, t) {
  const keys = tx.keys || []
  if (keys.length < 2) return -1
  let i = 0
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++
  return i
}

export function setTextKeyEase(id, index, curve) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx?.keys?.[index]) return
  updateText(id, { keys: tx.keys.map((k, i) => (i === index ? { ...k, ease: curve } : k)) })
}

export function removeTextKeyNear(id, t) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx?.keys?.length) return
  let best = 0
  for (let i = 1; i < tx.keys.length; i++) if (Math.abs(tx.keys[i].t - t) < Math.abs(tx.keys[best].t - t)) best = i
  const keys = tx.keys.filter((_, i) => i !== best)
  // dropping the last key freezes the text where it was
  const patch = keys.length ? { keys } : { keys, x: tx.keys[best].x, y: tx.keys[best].y, size: tx.keys[best].size }
  updateText(id, patch)
}

export function clearTextKeys(id) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  const cur = resolveAt(tx, useTimeline.getState().t)
  updateText(id, { keys: [], x: cur.x, y: cur.y, size: cur.size })
}

function bgIsLight(s) {
  if (s.bgType === 'solid' || s.bgType === 'gradient') return isLightColor(s.bgColor1)
  return false
}

export function addTextAtPlayhead() {
  const tl = useTimeline.getState()
  const s = useStore.getState()
  const tx = makeText({ t: tl.t, length: tl.length, light: bgIsLight(s), index: s.texts.length })
  useStore.setState({ texts: [...s.texts, tx] })
  useTimeline.setState({ selectedText: tx.id, selectedClip: null, playing: false })
  return tx.id
}

// shrink texts that would run off the sides of the current frame
export function fitTexts(list, maxW = 0.86) {
  const aspect = getAspect(useStore.getState())
  return list.map((tx) => ({ ...tx, ...fitText(tx, aspect, maxW) }))
}

export function fitTextWidth(id) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  const cur = resolveAt(tx, useTimeline.getState().t)
  const fit = fitText({ ...tx, size: cur.size }, getAspect(useStore.getState()))
  if (fit.text !== tx.text) updateText(id, { text: fit.text })
  setTextPosition(id, { size: fit.size })
}

// align the selected text (or callout) to the frame: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export function alignText(id, mode, margin = 0.06) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  const t = useTimeline.getState().t
  const cur = resolveAt(tx, Math.min(Math.max(t, tx.start), tx.end))
  const aspect = getAspect(useStore.getState())
  const b = measureText({ ...tx, x: cur.x, y: cur.y, size: cur.size, keys: [] }, aspect)
  const r2 = (v) => Math.round(v * 1000) / 1000
  if (mode === 'left') setTextPosition(id, { x: r2(cur.x + (margin - b.x)) })
  else if (mode === 'hcenter') setTextPosition(id, { x: r2(cur.x + (0.5 - (b.x + b.w / 2))) })
  else if (mode === 'right') setTextPosition(id, { x: r2(cur.x + (1 - margin - (b.x + b.w))) })
  else if (mode === 'top') setTextPosition(id, { y: r2(cur.y + (margin - b.y)) })
  else if (mode === 'vcenter') setTextPosition(id, { y: r2(cur.y + (0.5 - (b.y + b.h / 2))) })
  else if (mode === 'bottom') setTextPosition(id, { y: r2(cur.y + (1 - margin - (b.y + b.h))) })
}

// put the phone back in the middle of the frame (position and camera aim)
export function centerPhone() {
  useStore.setState({ posX: 0, posY: 0 })
  const controls = controlsRef.current
  if (controls) {
    controls.target.set(0, -0.02, controls.target.z)
    controls.update()
  }
  autoCaptureKey()
}

export function addTextPairAtPlayhead() {
  const tl = useTimeline.getState()
  const s = useStore.getState()
  const pair = fitTexts(makeTextPair({ t: tl.t, length: tl.length, light: bgIsLight(s), index: s.texts.length }))
  useStore.setState({ texts: [...s.texts, ...pair] })
  useTimeline.setState({ selectedText: pair[0].id, selectedClip: null, playing: false })
}

export function addBadgeAtPlayhead() {
  const tl = useTimeline.getState()
  const s = useStore.getState()
  const tx = makeBadge({ t: tl.t, length: tl.length, light: bgIsLight(s), index: s.texts.length })
  useStore.setState({ texts: [...s.texts, tx] })
  useTimeline.setState({ selectedText: tx.id, selectedClip: null, playing: false })
}

export function duplicateText(id) {
  const { texts } = useStore.getState()
  const src = texts.find((tx) => tx.id === id)
  if (!src) return
  const copy = { ...src, id: newTextId(), y: Math.min(0.95, src.y + src.size * src.lineHeight + 0.02) }
  useStore.setState({ texts: [...texts, copy] })
  useTimeline.setState({ selectedText: copy.id })
}

export function updateText(id, patch) {
  const { texts } = useStore.getState()
  useStore.setState({ texts: texts.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx)) })
}

export function deleteText(id) {
  const { texts } = useStore.getState()
  useStore.setState({ texts: texts.filter((tx) => tx.id !== id) })
  if (useTimeline.getState().selectedText === id) useTimeline.setState({ selectedText: null })
}

export function moveTextFromSnapshot(snapshotTexts, id, delta) {
  const { length } = useTimeline.getState()
  const src = snapshotTexts.find((tx) => tx.id === id)
  if (!src) return
  const dur = src.end - src.start
  const start = Math.min(Math.max(0, src.start + delta), Math.max(0, length - dur))
  const shift = start - src.start
  updateText(id, {
    start: Math.round(start * 100) / 100,
    end: Math.round((start + dur) * 100) / 100,
    keys: (src.keys || []).map((k) => ({ ...k, t: Math.round((k.t + shift) * 1000) / 1000 })),
  })
}

export function trimTextFromSnapshot(snapshotTexts, id, edge, newT) {
  const { length } = useTimeline.getState()
  const src = snapshotTexts.find((tx) => tx.id === id)
  if (!src) return
  const t = Math.round(Math.min(length, Math.max(0, newT)) * 100) / 100
  if (edge === 'start') updateText(id, { start: Math.min(t, src.end - 0.2) })
  else updateText(id, { end: Math.max(t, src.start + 0.2) })
}

export const MAX_LENGTH = 3600

// A freshly loaded recording reports its duration here: clamp any clips that
// reference it, and — for a recording the user just added — append it to the
// program as one full-length clip.
export function registerMediaDuration(id, dur) {
  const s = useStore.getState()
  const entry = s.media.find((m) => m.id === id)
  if (!entry) return
  const media = s.media.map((m) => (m.id === id ? { ...m, dur, pending: false } : m))
  let clips = s.clips
    .map((c) => (c.mediaId === id ? { ...c, srcStart: Math.min(c.srcStart, dur), srcEnd: Math.min(c.srcEnd, dur) } : c))
    .filter((c) => c.srcEnd - c.srcStart > 0.01)
  if (entry.pending) {
    const trim = s.media[0]?.id === id ? s.videoTrim || 0 : 0 // legacy single-video trim
    clips = [...clips, ...Clips.defaultClips(dur, trim, id)]
  }
  useStore.setState({ media, clips, videoTrim: 0 })
  syncLengthToProgram()
  if (s.pendingFit) {
    useTimeline.setState({ t: 0, playing: false, selectedClip: null })
    useStore.setState({ pendingFit: false })
  }
}

export function mediaDuration(mediaId) {
  return useStore.getState().media.find((m) => m.id === mediaId)?.dur || Infinity
}

// With a video loaded, the timeline length is the edited program's length.
export function syncLengthToProgram() {
  const { clips, screenType } = useStore.getState()
  if (screenType !== 'video' || !clips.length) return
  const length = Math.max(Clips.MIN_CLIP, Math.round(Clips.programLength(clips) * 100) / 100)
  const tl = useTimeline.getState()
  useTimeline.setState({ length, t: Math.min(tl.t, length) })
}

function applyClipEdit(result) {
  const { clips, remap } = result
  const tl = useTimeline.getState()
  const st = useStore.getState()
  useStore.setState({
    clips,
    texts: remapTexts(st.texts, remap),
    deviceSegs: remapSegs(st.deviceSegs, remap),
    bgKeys: remapBgKeys(st.bgKeys, remap),
  })
  const keys = Clips.remapKeys(tl.keys, remap)
  useTimeline.setState({ keys })
  syncLengthToProgram()
  const nt = remap(tl.t)
  const length = useTimeline.getState().length
  const t = Math.min(length, nt === null || nt === undefined ? tl.t : nt)
  useTimeline.setState({ t, playing: false })
  applySample(t)
}

export function editSplitAtPlayhead() {
  const { clips } = useStore.getState()
  if (!clips.length) return
  applyClipEdit(Clips.splitAt(clips, useTimeline.getState().t))
}

export function editDeleteClip(index) {
  const { clips } = useStore.getState()
  if (index == null || !clips[index] || clips.length < 2) return
  applyClipEdit(Clips.deleteClip(clips, index))
  useTimeline.setState({ selectedClip: null })
}

export function editReorderClip(from, to) {
  const { clips } = useStore.getState()
  if (!clips[from]) return
  const result = Clips.reorderClips(clips, from, to)
  if (result.clips === clips) return
  applyClipEdit(result)
  useTimeline.setState({ selectedClip: result.clips.indexOf(clips[from]) })
}

// ---- dragging keyframes in time (idempotent from a snapshot taken at pointer-down) ----
export function moveKeyFromSnapshot(snapshotKeys, index, newT) {
  const { length } = useTimeline.getState()
  const t = Math.round(Math.min(length, Math.max(0, newT)) * 100) / 100
  const keys = snapshotKeys.map((k, i) => (i === index ? { ...k, t } : k)).sort((a, b) => a.t - b.t)
  useTimeline.setState({ keys })
}

export function moveTextKeyFromSnapshot(id, snapshotKeys, index, newT) {
  const tx = useStore.getState().texts.find((x) => x.id === id)
  if (!tx) return
  const t = Math.round(Math.min(tx.end, Math.max(tx.start, newT)) * 100) / 100
  const keys = snapshotKeys.map((k, i) => (i === index ? { ...k, t } : k)).sort((a, b) => a.t - b.t)
  updateText(id, { keys })
}

export function editSetSpeed(index, speed) {
  const { clips } = useStore.getState()
  if (!clips[index]) return
  applyClipEdit(Clips.setSpeed(clips, index, speed))
}

// Drag-trimming works from a snapshot taken at pointer-down so each move is idempotent.
export function editTrimFromSnapshot(snapshot, index, edge, newT) {
  const srcDur = mediaDuration(snapshot.clips[index]?.mediaId)
  const result = Clips.trimClip(snapshot.clips, index, edge, newT, srcDur)
  const st = useStore.getState()
  useStore.setState({
    clips: result.clips,
    texts: remapTexts(snapshot.texts || st.texts, result.remap),
    deviceSegs: remapSegs(snapshot.deviceSegs !== undefined ? snapshot.deviceSegs : st.deviceSegs, result.remap),
    bgKeys: remapBgKeys(snapshot.bgKeys || st.bgKeys, result.remap),
  })
  useTimeline.setState({ keys: Clips.remapKeys(snapshot.keys, result.remap) })
  syncLengthToProgram()
  const tl = useTimeline.getState()
  const t = Math.min(tl.length, snapshot.t)
  useTimeline.setState({ t, playing: false })
  applySample(t)
}

export function cycleLength() {
  const { length, loop, keys } = useTimeline.getState()
  return loop && keys.length >= 2 ? length + LOOP_RETURN : length
}

const EPS = 0.06
const rad = THREE.MathUtils.degToRad

function currentPose() {
  const three = threeRef.current
  const controls = controlsRef.current
  if (!three || !controls) return null
  const s = useStore.getState()
  return {
    camPos: three.camera.position.toArray(),
    target: controls.target.toArray(),
    fov: s.fov,
    rot: [s.rotX, s.rotY, s.rotZ],
    pos: [s.posX || 0, s.posY || 0, s.posZ || 0],
  }
}

const ZERO3 = [0, 0, 0]
const posOf = (k) => k.pos || ZERO3

export function captureKey() {
  const pose = currentPose()
  if (!pose) return
  const { t, keys, length } = useTimeline.getState()
  const kt = Math.min(t, length)
  const next = keys
    .filter((k) => Math.abs(k.t - kt) > EPS)
    .concat({ t: kt, ...pose })
    .sort((a, b) => a.t - b.t)
  useTimeline.setState({ keys: next })
}

// Rotato-style recording: called whenever the user moves the camera or the
// device while an animation exists — silently writes/updates the keyframe at
// the playhead, but only if the pose actually differs from the animation.
export function autoCaptureKey() {
  const { autoKey, keys, t, playing } = useTimeline.getState()
  if (!autoKey || keys.length === 0 || playing) return
  const pose = currentPose()
  if (!pose) return
  const s = sample(t)
  if (s) {
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const rotDiff = Math.max(...pose.rot.map((v, i) => Math.abs(v - s.rot[i])))
    if (
      d3(pose.camPos, s.camPos) < 0.004 &&
      d3(pose.target, s.target) < 0.004 &&
      d3(pose.pos, posOf(s)) < 0.004 &&
      Math.abs(pose.fov - s.fov) < 0.15 &&
      rotDiff < 0.25
    )
      return
  }
  captureKey()
}

export function deleteKeyNear(t) {
  const { keys } = useTimeline.getState()
  if (!keys.length) return
  let best = 0
  for (let i = 1; i < keys.length; i++) if (Math.abs(keys[i].t - t) < Math.abs(keys[best].t - t)) best = i
  useTimeline.setState({ keys: keys.filter((_, i) => i !== best) })
}

// mode: 'ease' (smoothstep) | 'linear' | [x1, y1, x2, y2] custom curve
function easeU(u, mode) {
  if (Array.isArray(mode)) return easeCurve(mode, u)
  return mode === 'linear' ? u : u * u * (3 - 2 * u)
}

// the timeline easing as a curve the graph editor can show
export function timelineCurve(mode) {
  if (Array.isArray(mode)) return mode
  return mode === 'linear' ? [0, 0, 1, 1] : DEFAULT_CURVE
}

const shortestAngle = (a, b) => a + (((b - a + 180) % 360 + 360) % 360 - 180)

export function sample(t) {
  const { keys, easing, loop, length } = useTimeline.getState()
  if (!keys.length) return null

  // Loop-return segment: ease from the end pose back to the first keyframe.
  if (loop && keys.length >= 2 && t > length) {
    const end = sampleAt(length, keys, easing)
    const start = keys[0]
    const u = easeU(Math.min(1, (t - length) / LOOP_RETURN), 'ease')
    const lerpA = (p, q) => p.map((v, j) => v + (q[j] - v) * u)
    return {
      camPos: lerpA(end.camPos, start.camPos),
      target: lerpA(end.target, start.target),
      fov: end.fov + (start.fov - end.fov) * u,
      // rotations take the shortest path so a 360° spin doesn't unwind
      rot: end.rot.map((v, j) => {
        const goal = shortestAngle(v, start.rot[j])
        return v + (goal - v) * u
      }),
      pos: lerpA(posOf(end), posOf(start)),
    }
  }

  return sampleAt(t, keys, easing)
}

function sampleAt(t, keys, easing) {
  if (t <= keys[0].t) return keys[0]
  const last = keys[keys.length - 1]
  if (t >= last.t) return last
  let i = 0
  while (keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const u = easeU((t - a.t) / (b.t - a.t), easing)
  const lerpA = (p, q) => p.map((v, j) => v + (q[j] - v) * u)
  return {
    camPos: lerpA(a.camPos, b.camPos),
    target: lerpA(a.target, b.target),
    fov: a.fov + (b.fov - a.fov) * u,
    rot: lerpA(a.rot, b.rot),
    pos: lerpA(posOf(a), posOf(b)),
  }
}

// program time the scene should be drawn at: the export loop drives frameTime
// directly; otherwise the live playhead is the truth
export function renderTime() {
  const tl = useTimeline.getState()
  const t = useStore.getState().exportingVideo ? frameTime.current : tl.t
  return Math.min(t, tl.length)
}

export function applySample(t) {
  frameTime.current = t
  const s = sample(t)
  if (!s) return
  const three = threeRef.current
  const controls = controlsRef.current
  const phone = phoneRef.current
  if (!three) return
  three.camera.position.fromArray(s.camPos)
  three.camera.fov = s.fov
  three.camera.updateProjectionMatrix()
  if (controls) {
    controls.target.fromArray(s.target)
    controls.update()
  }
  // set the group directly (immediate, for deterministic export renders)…
  const pos = posOf(s)
  if (phone) {
    phone.rotation.set(rad(s.rot[0]), rad(s.rot[1]), rad(s.rot[2]))
    phone.position.set(pos[0], pos[1], pos[2])
  }
  // …and mirror into the store so the sliders track the animation (not an undo step)
  const r = (v) => Math.round(v * 10) / 10
  const r2 = (v) => Math.round(v * 100) / 100
  historyGate.suspend++
  try {
    useStore.setState({
      rotX: r(s.rot[0]),
      rotY: r(s.rot[1]),
      rotZ: r(s.rot[2]),
      fov: r(s.fov),
      posX: r2(pos[0]),
      posY: r2(pos[1]),
      posZ: r2(pos[2]),
    })
  } finally {
    historyGate.suspend--
  }
}

export const PRESETS = {
  spin: 'Hero spin',
  orbit: 'Orbit',
  dolly: 'Dolly in',
  sway: 'Sway',
}

export function applyPreset(name) {
  const pose = currentPose()
  if (!pose) return
  const { camPos, target, fov, rot, pos } = pose
  const mk = (t, c, tg, f, r) => ({ t, camPos: c, target: tg, fov: f, rot: r, pos })
  let keys = []
  let length = 6
  let easing = 'ease'

  if (name === 'spin') {
    easing = 'linear'
    keys = [
      mk(0, camPos, target, fov, rot),
      mk(length, camPos, target, fov, [rot[0], rot[1] + 360, rot[2]]),
    ]
  } else if (name === 'orbit') {
    easing = 'linear'
    const off = [camPos[0] - target[0], camPos[1] - target[1], camPos[2] - target[2]]
    const r0 = Math.hypot(off[0], off[2])
    const a0 = Math.atan2(off[0], off[2])
    const sweep = (Math.PI * 2) / 3
    const N = 12
    keys = Array.from({ length: N + 1 }, (_, i) => {
      const a = a0 - sweep / 2 + (sweep * i) / N
      return mk(
        (length * i) / N,
        [target[0] + Math.sin(a) * r0, camPos[1], target[2] + Math.cos(a) * r0],
        target,
        fov,
        rot
      )
    })
  } else if (name === 'dolly') {
    length = 5
    const near = camPos.map((v, i) => target[i] + (v - target[i]) * 0.55)
    keys = [mk(0, camPos, target, fov, rot), mk(length, near, target, fov, rot)]
  } else if (name === 'sway') {
    keys = [
      mk(0, camPos, target, fov, [rot[0], rot[1] - 16, rot[2]]),
      mk(length / 2, camPos, target, fov, [rot[0], rot[1] + 16, rot[2]]),
      mk(length, camPos, target, fov, [rot[0], rot[1] - 16, rot[2]]),
    ]
  }
  useTimeline.setState({ keys, length, easing, t: 0, playing: false })
  applySample(0)
}
