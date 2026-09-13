// Scene structure over the program timeline:
//  - device segments: when the phone is on stage, with intro/outro animations
//  - background keys: the stage background over time, with crossfades
import { easeCurve, PRESET_CURVES } from './bezier.js'

export const DEVICE_ANIMS = {
  cut: 'Cut',
  fade: 'Fade',
  rise: 'Rise from below',
  drop: 'Drop from above',
  slide: 'Slide in',
  scale: 'Scale up',
}

export const SCENE_DUR = 4

let seq = 0
export const newId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

export function makeDeviceSeg(start, end, extra = {}) {
  return { id: newId('d'), start, end, intro: 'rise', outro: 'fade', inDur: 0.7, outDur: 0.4, ...extra }
}

// device on/off + transform at time t. null segments = always on stage.
export function deviceStateAt(segs, t) {
  if (!segs) return { visible: true, alpha: 1, dx: 0, dy: 0, scale: 1 }
  const seg = segs.find((s) => t >= s.start && t < s.end)
  if (!seg) return { visible: false, alpha: 0, dx: 0, dy: 0, scale: 1 }
  const ease = (p) => easeCurve(PRESET_CURVES.snappy, p)
  const inP = seg.intro === 'cut' || seg.inDur <= 0 ? 1 : ease(Math.min(1, (t - seg.start) / seg.inDur))
  const outP = seg.outro === 'cut' || seg.outDur <= 0 ? 1 : ease(Math.min(1, (seg.end - t) / seg.outDur))
  const a = animFx(seg.intro, inP)
  const b = animFx(seg.outro, outP)
  return {
    visible: true,
    alpha: Math.min(a.alpha, b.alpha),
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: Math.min(a.scale, b.scale),
  }
}

function animFx(kind, e) {
  switch (kind) {
    case 'fade':
      return { alpha: e, dx: 0, dy: 0, scale: 0.96 + 0.04 * e }
    case 'rise':
      return { alpha: e, dx: 0, dy: -(1 - e) * 1.3, scale: 1 }
    case 'drop':
      return { alpha: e, dx: 0, dy: (1 - e) * 1.3, scale: 1 }
    case 'slide':
      return { alpha: e, dx: (1 - e) * 1.8, dy: 0, scale: 1 }
    case 'scale':
      return { alpha: e, dx: 0, dy: 0, scale: 0.5 + 0.5 * e }
    default:
      return { alpha: 1, dx: 0, dy: 0, scale: 1 }
  }
}

// merge overlapping/adjacent segments, keep sorted
export function normalizeSegs(segs) {
  if (!segs) return null
  const sorted = segs
    .filter((s) => s.end - s.start > 0.05)
    .slice()
    .sort((a, b) => a.start - b.start)
  const out = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.start <= last.end + 0.001) {
      last.end = Math.max(last.end, s.end)
      last.outro = s.outro
      last.outDur = s.outDur
    } else out.push({ ...s })
  }
  return out
}

// cut a hole [from, to) out of the segments (phone off stage there)
export function hideRange(segs, from, to, length) {
  const base = segs || [makeDeviceSeg(0, length, { intro: 'cut', outro: 'cut' })]
  const out = []
  for (const s of base) {
    if (to <= s.start || from >= s.end) {
      out.push(s)
      continue
    }
    if (from > s.start) out.push({ ...s, id: newId('d'), end: from })
    if (to < s.end) out.push({ ...s, id: newId('d'), start: to })
  }
  return normalizeSegs(out)
}

export function makeBgKey(t, bg, extra = {}) {
  return {
    id: newId('b'),
    t,
    bgType: bg.bgType,
    bgColor1: bg.bgColor1,
    bgColor2: bg.bgColor2,
    bgImage: bg.bgImage || null,
    transition: 'fade',
    dur: 0.6,
    ...extra,
  }
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const n = m ? parseInt(m[1], 16) : 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}
export function lerpColor(a, b, u) {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * u))
}

// a key as a two-color gradient (solids and images collapse to one color)
function asPair(k) {
  if (k.bgType === 'solid') return [k.bgColor1, k.bgColor1]
  if (k.bgType === 'gradient') return [k.bgColor1, k.bgColor2]
  return null
}

// background at time t; `base` is the store's static background (used with no keys)
export function bgAt(keys, t, base) {
  if (!keys?.length) return { bgType: base.bgType, c1: base.bgColor1, c2: base.bgColor2, bgImage: base.bgImage }
  let i = -1
  for (let j = 0; j < keys.length; j++) if (keys[j].t <= t) i = j
  const cur = keys[Math.max(0, i)]
  const prev = i > 0 ? keys[i - 1] : null
  const out = { bgType: cur.bgType, c1: cur.bgColor1, c2: cur.bgColor2, bgImage: cur.bgImage }
  if (!prev || cur.transition === 'cut' || cur.dur <= 0) return out
  const u = Math.min(1, Math.max(0, (t - cur.t) / cur.dur))
  if (u >= 1) return out
  const pa = asPair(prev)
  const pb = asPair(cur)
  if (!pa || !pb) return u < 0.5 ? { bgType: prev.bgType, c1: prev.bgColor1, c2: prev.bgColor2, bgImage: prev.bgImage } : out
  const e = u * u * (3 - 2 * u)
  return { bgType: 'gradient', c1: lerpColor(pa[0], pb[0], e), c2: lerpColor(pa[1], pb[1], e), bgImage: null }
}

// ripple helpers
export function remapSegs(segs, remap) {
  if (!segs) return null
  const out = []
  for (const s of segs) {
    let ns = remap(s.start)
    let ne = remap(s.end)
    if (ns == null) for (let x = s.start; x <= s.end && ns == null; x += 0.05) ns = remap(x)
    if (ne == null) for (let x = s.end; x >= s.start && ne == null; x -= 0.05) ne = remap(x)
    if (ns == null || ne == null || ne - ns < 0.1) continue
    out.push({ ...s, start: Math.round(ns * 1000) / 1000, end: Math.round(ne * 1000) / 1000 })
  }
  return normalizeSegs(out)
}

export function remapBgKeys(keys, remap) {
  const out = []
  for (const k of keys) {
    let nt = remap(k.t)
    if (nt == null) {
      // a key inside a cut region snaps to where the cut closes
      for (let x = k.t; x < k.t + 600 && nt == null; x += 0.05) nt = remap(x)
    }
    if (nt == null) continue
    out.push({ ...k, t: Math.round(nt * 1000) / 1000 })
  }
  out.sort((a, b) => a.t - b.t)
  return out.filter((k, i) => i === 0 || k.t - out[i - 1].t > 0.02)
}
