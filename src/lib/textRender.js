// 2D text layers drawn over the 3D render — the same code paints the live
// viewport overlay and every exported frame, so preview == export.
import { easeCurve } from './bezier.js'

export const FAMILIES = {
  sf: { label: 'SF Pro (system)', css: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", sans-serif' },
  helvetica: { label: 'Helvetica Neue', css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  avenir: { label: 'Avenir Next', css: '"Avenir Next", Avenir, sans-serif' },
  georgia: { label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'SF Mono', css: 'ui-monospace, "SF Mono", Menlo, monospace' },
}

export const ANIMS = {
  'fade-up': 'Fade up',
  blur: 'Blur in',
  words: 'Word by word',
  chars: 'Letter by letter',
  tracking: 'Tracking in',
  scale: 'Scale in',
  wipe: 'Wipe up',
  none: 'None',
}

// imported brand fonts: id -> { name } (registered with document.fonts by lib/fonts.js)
export const customFonts = new Map()

// which language variant to draw: 'base' or a locale code present in tx.i18n
export const renderLocale = { current: 'base' }
export function displayText(tx, locale = renderLocale.current) {
  if (locale && locale !== 'base' && tx.i18n && tx.i18n[locale] != null) return tx.i18n[locale]
  return tx.text || ''
}

export function familyCss(family) {
  if (family?.startsWith('custom:')) {
    const f = customFonts.get(family.slice(7))
    if (f) return `"${f.name}", -apple-system, BlinkMacSystemFont, sans-serif`
  }
  return FAMILIES[family]?.css || FAMILIES.sf.css
}

export const OUTS = { fade: 'Fade out', reverse: 'Reverse', none: 'Cut' }
export const EASINGS = { out: 'Ease out', inout: 'Ease in-out', linear: 'Linear' }
export const SHAPES = { none: 'None', pill: 'Pill', card: 'Card', dot: 'Dot marker', arrow: 'Arrow callout' }

export const STYLES = {
  title: { label: 'Title', size: 0.085, weight: 700, tracking: -0.025, lineHeight: 1.05, uppercase: false },
  subtitle: { label: 'Subtitle', size: 0.045, weight: 500, tracking: -0.005, lineHeight: 1.2, uppercase: false },
  caption: { label: 'Caption', size: 0.026, weight: 600, tracking: 0.1, lineHeight: 1.3, uppercase: true },
}

const EASE = {
  out: (p) => 1 - Math.pow(1 - p, 3),
  inout: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  linear: (p) => p,
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))

export function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return false
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150
}

let seq = 0
export const newTextId = () => `tx${Date.now().toString(36)}${(seq++).toString(36)}`

export function makeText({ t, length, light, index = 0 }) {
  const { label, ...style } = STYLES.title
  const start = Math.max(0, Math.min(t, Math.max(0, length - 0.5)))
  return {
    id: newTextId(),
    text: 'Your title here',
    x: 0.5,
    y: Math.min(0.85, 0.16 + index * 0.1),
    align: 'center',
    family: 'sf',
    color: light ? '#111116' : '#ffffff',
    fill: 'solid', // 'solid' | 'gradient'
    color2: '#635bff',
    gradAngle: 90, // degrees; 0 = left→right, 90 = top→bottom
    shadow: 0, // 0..1
    shape: 'none', // see SHAPES
    bgColor: '#635bff',
    bgAlpha: 1,
    pad: 0.5, // em
    ax: 0.5, // arrow target (normalized)
    ay: 0.45,
    keys: [], // position keyframes: [{ t, x, y, size }] in program seconds
    ...style,
    start,
    end: Math.min(length, start + 3),
    anim: 'fade-up',
    inDur: 0.7,
    outAnim: 'fade',
    outDur: 0.4,
    stagger: 0.06,
    easing: 'out',
  }
}

// The classic keynote pair: a blur-in title with a fade-up subtitle 0.3s behind it.
export function makeTextPair({ t, length, light, index = 0 }) {
  const title = { ...makeText({ t, length, light, index }), anim: 'blur', inDur: 0.8, outDur: 0.5 }
  title.end = Math.min(length, title.start + 4)
  const { label, ...sub } = STYLES.subtitle
  const subtitle = {
    ...makeText({ t, length, light, index }),
    ...sub,
    id: newTextId(),
    text: 'A short line that says why it matters',
    y: Math.min(0.9, title.y + title.size * title.lineHeight * 0.5 + sub.size * 1.15),
    color: light ? '#5c5c66' : '#c9c9d4',
    start: Math.min(title.end - 0.5, title.start + 0.3),
    end: title.end,
    anim: 'fade-up',
    inDur: 0.7,
    outDur: 0.4,
  }
  return [title, subtitle]
}

// a pill badge — "NEW", "Free trial", a feature label — with a scale-in
export function makeBadge({ t, length, light, index = 0 }) {
  const { label, ...cap } = STYLES.caption
  return {
    ...makeText({ t, length, light, index }),
    ...cap,
    text: 'NEW',
    color: '#ffffff',
    shape: 'pill',
    bgColor: '#635bff',
    pad: 0.6,
    anim: 'scale',
    inDur: 0.45,
    outDur: 0.3,
  }
}

// properties a saved style captures (everything except content, position and timing)
export const STYLE_PROPS = [
  'family', 'weight', 'size', 'tracking', 'lineHeight', 'uppercase', 'color', 'fill', 'color2', 'gradAngle', 'shadow',
  'shape', 'bgColor', 'bgAlpha', 'pad',
  'anim', 'inDur', 'outAnim', 'outDur', 'stagger', 'easing', 'align',
]

function hexAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function shapeBox(L, tx) {
  const pad = (tx.pad ?? 0.5) * L.px
  return { x: L.left - pad * 1.4, y: L.top - pad * 0.7, w: L.maxW + pad * 2.8, h: L.blockH + pad * 1.4 }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// arrow from the nearest edge of the text box toward the target, drawn on by `e`
function drawArrow(ctx, L, tx, W, H, e, dy) {
  const box = shapeBox(L, tx)
  const tgt = { x: tx.ax * W, y: tx.ay * H }
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2 + dy
  const ddx = tgt.x - cx
  const ddy = tgt.y - cy
  let from
  if (Math.abs(ddx) * box.h > Math.abs(ddy) * box.w) from = { x: ddx > 0 ? box.x + box.w : box.x, y: cy }
  else from = { x: cx, y: ddy > 0 ? box.y + box.h + dy : box.y + dy }
  const gap = L.px * 0.25
  const len = Math.hypot(tgt.x - from.x, tgt.y - from.y)
  if (len < gap * 2) return
  const ux = (tgt.x - from.x) / len
  const uy = (tgt.y - from.y) / len
  const start = { x: from.x + ux * gap, y: from.y + uy * gap }
  const full = len - gap * 1.6
  const drawn = full * e
  const end = { x: start.x + ux * drawn, y: start.y + uy * drawn }
  const lw = Math.max(1.5, L.px * 0.07)
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = tx.bgColor
  ctx.fillStyle = tx.bgColor
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  if (e > 0.15) {
    const hs = Math.max(6, L.px * 0.32)
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - ux * hs - uy * hs * 0.55, end.y - uy * hs + ux * hs * 0.55)
    ctx.lineTo(end.x - ux * hs + uy * hs * 0.55, end.y - uy * hs - ux * hs * 0.55)
    ctx.closePath()
    ctx.fill()
  }
}

function drawShape(ctx, L, tx, W, H, e, dy) {
  const shape = tx.shape || 'none'
  if (shape === 'none') return
  ctx.save()
  ctx.fillStyle = hexAlpha(tx.bgColor || '#635bff', tx.bgAlpha ?? 1)
  if (shape === 'dot') {
    const r = L.px * 0.55
    ctx.beginPath()
    ctx.arc(L.cx, L.cy + dy, r * 1.4, 0, Math.PI * 2)
    ctx.fillStyle = hexAlpha(tx.bgColor || '#635bff', 0.28 * (tx.bgAlpha ?? 1))
    ctx.fill()
    ctx.beginPath()
    ctx.arc(L.cx, L.cy + dy, r, 0, Math.PI * 2)
    ctx.fillStyle = hexAlpha(tx.bgColor || '#635bff', tx.bgAlpha ?? 1)
    ctx.fill()
  } else if (shape === 'pill' || shape === 'card') {
    const b = shapeBox(L, tx)
    roundRect(ctx, b.x, b.y + dy, b.w, b.h, shape === 'pill' ? b.h / 2 : L.px * 0.45)
    ctx.fill()
  } else if (shape === 'arrow') {
    const b = shapeBox(L, tx)
    ctx.globalAlpha *= tx.bgAlpha ?? 1
    roundRect(ctx, b.x, b.y + dy, b.w, b.h, L.px * 0.45)
    ctx.fill()
    drawArrow(ctx, L, tx, W, H, e, dy)
  }
  ctx.restore()
}

// x / y / size at time t, easing between position keyframes (base values when unkeyed)
export function resolveAt(tx, t) {
  const keys = tx.keys
  if (!keys?.length) return tx
  if (t <= keys[0].t) return { ...tx, x: keys[0].x, y: keys[0].y, size: keys[0].size }
  const last = keys[keys.length - 1]
  if (t >= last.t) return { ...tx, x: last.x, y: last.y, size: last.size }
  let i = 0
  while (keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const p = (t - a.t) / Math.max(0.001, b.t - a.t)
  const u = easeCurve(a.ease, p) // the segment's easing lives on the key that starts it
  return { ...tx, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, size: a.size + (b.size - a.size) * u }
}

function layout(ctx, tx, W, H, extraTracking = 0) {
  const px = tx.size * H
  ctx.font = `${tx.weight} ${px}px ${familyCss(tx.family)}`
  ctx.letterSpacing = `${(tx.tracking + extraTracking) * px}px`
  const shown = displayText(tx)
  const raw = tx.uppercase ? shown.toUpperCase() : shown
  const lines = raw.split('\n')
  const lh = tx.lineHeight * px
  const blockH = lines.length * lh
  const top = tx.y * H - blockH / 2
  const ax = tx.x * W
  const info = lines.map((text, i) => {
    const w = ctx.measureText(text).width
    const left = tx.align === 'center' ? ax - w / 2 : tx.align === 'right' ? ax - w : ax
    return { text, w, left, y: top + lh * (i + 0.5) }
  })
  return {
    px,
    lh,
    lines: info,
    top,
    blockH,
    left: Math.min(...info.map((l) => l.left)),
    maxW: Math.max(1, ...info.map((l) => l.w)),
    cx: ax,
    cy: tx.y * H,
  }
}

function fx(anim, e, px, lh) {
  switch (anim) {
    case 'fade-up':
    case 'words':
    case 'chars':
      return { alpha: e, dy: (1 - e) * px * 0.4 }
    case 'blur':
      return { alpha: e, blur: (1 - e) * px * 0.3, dy: (1 - e) * px * 0.1 }
    case 'tracking':
      return { alpha: e, tracking: (1 - e) * 0.35 }
    case 'scale':
      return { alpha: e, scale: 0.94 + 0.06 * e }
    case 'wipe':
      return { alpha: 1, wipe: e, dy: (1 - e) * lh }
    default:
      return { alpha: 1 }
  }
}

function splitUnits(line, mode) {
  if (mode === 'chars') return Array.from(line)
  return line.split(/(\s+)/).filter((u) => u.length)
}

function drawOne(ctx, raw, t, W, H, opts) {
  const tx = resolveAt(raw, Math.min(Math.max(t, raw.start), raw.end))
  const ease = EASE[tx.easing] || EASE.out
  const ghost = opts.preview && opts.selectedId === tx.id && (t < tx.start || t >= tx.end)
  const perUnit = tx.anim === 'words' || tx.anim === 'chars'

  const inE = ghost || tx.inDur <= 0 ? 1 : ease(clamp01((t - tx.start) / tx.inDur))
  const outRaw = ghost || tx.outDur <= 0 || tx.outAnim === 'none' ? 1 : clamp01((tx.end - t) / tx.outDur)
  const outE = ease(outRaw)
  const blockE = tx.outAnim === 'reverse' ? Math.min(inE, outE) : inE
  const blockFx = ghost ? { alpha: 0.3 } : fx(perUnit ? 'none' : tx.anim, blockE, 0, 0)

  const L = layout(ctx, tx, W, H, blockFx.tracking || 0)
  const eff = ghost ? { alpha: 0.3 } : fx(perUnit ? 'none' : tx.anim, blockE, L.px, L.lh)
  let alpha = eff.alpha ?? 1
  if (!ghost && tx.outAnim === 'fade') alpha *= outE

  ctx.save()
  ctx.fillStyle = tx.color
  if (tx.fill === 'gradient' && tx.color2) {
    // gradient across the text block at the given angle
    const a = ((tx.gradAngle ?? 90) * Math.PI) / 180
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const half = (Math.abs(ux) * L.maxW + Math.abs(uy) * L.blockH) / 2
    const g = ctx.createLinearGradient(L.cx - ux * half, L.cy - uy * half, L.cx + ux * half, L.cy + uy * half)
    g.addColorStop(0, tx.color)
    g.addColorStop(1, tx.color2)
    ctx.fillStyle = g
  }
  if (tx.shadow > 0 && !ghost) {
    ctx.shadowColor = `rgba(0, 0, 0, ${(0.55 * tx.shadow).toFixed(3)})`
    ctx.shadowBlur = tx.shadow * L.px * 0.5
    ctx.shadowOffsetY = tx.shadow * L.px * 0.12
  }
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  if (eff.scale) {
    ctx.translate(L.cx, L.cy)
    ctx.scale(eff.scale, eff.scale)
    ctx.translate(-L.cx, -L.cy)
  }
  if (eff.blur > 0.2) ctx.filter = `blur(${eff.blur.toFixed(2)}px)`

  // callout shape behind the text, sharing the block's fade / rise / scale
  if ((tx.shape || 'none') !== 'none') {
    const shapeE = ghost ? 1 : perUnit ? ease(clamp01((t - tx.start) / Math.max(0.01, tx.inDur))) : blockE
    const shapeAlpha = ghost ? 0.3 : (perUnit ? shapeE : alpha)
    const shapeDy = eff.wipe !== undefined ? 0 : perUnit ? fx('fade-up', shapeE, L.px, L.lh).dy : eff.dy || 0
    ctx.save()
    ctx.globalAlpha = shapeAlpha * (tx.outAnim === 'fade' && perUnit ? outE : 1)
    const savedFill = ctx.fillStyle
    drawShape(ctx, L, tx, W, H, ghost ? 1 : tx.outAnim === 'reverse' ? Math.min(shapeE, outE) : shapeE, shapeDy)
    ctx.fillStyle = savedFill
    ctx.restore()
  }
  if ((tx.shape || 'none') === 'dot' && !displayText(tx).trim()) {
    ctx.restore()
    if (opts.preview && opts.selectedId === tx.id) drawSelection(ctx, tx, L)
    return
  }

  if (perUnit && !ghost) {
    let idx = 0
    for (const line of L.lines) {
      let x = line.left
      for (const unit of splitUnits(line.text, tx.anim)) {
        const w = ctx.measureText(unit).width
        if (unit.trim()) {
          const ue = ease(clamp01((t - tx.start - idx * tx.stagger) / Math.max(0.01, tx.inDur)))
          const e2 = tx.outAnim === 'reverse' ? Math.min(ue, outE) : ue
          const u = fx('fade-up', e2, L.px, L.lh)
          ctx.globalAlpha = (u.alpha ?? 1) * (tx.outAnim === 'fade' ? outE : 1)
          ctx.fillText(unit, x, line.y + (u.dy || 0))
          idx++
        }
        x += w
      }
    }
  } else {
    ctx.globalAlpha = alpha
    for (const line of L.lines) {
      if (eff.wipe !== undefined) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(line.left - L.px, line.y - L.lh / 2, line.w + L.px * 2, L.lh)
        ctx.clip()
        ctx.fillText(line.text, line.left, line.y + eff.dy)
        ctx.restore()
      } else {
        ctx.fillText(line.text, line.left, line.y + (eff.dy || 0))
      }
    }
  }
  ctx.restore()

  if (opts.preview && opts.selectedId === tx.id) drawSelection(ctx, tx, L, W, H)
}

function boundsOf(tx, L) {
  if ((tx.shape || 'none') === 'dot' && !displayText(tx).trim()) {
    const r = L.px * 0.55 * 1.4
    return { x: L.cx - r, y: L.cy - r, w: r * 2, h: r * 2 }
  }
  if ((tx.shape || 'none') !== 'none') {
    const b = shapeBox(L, tx)
    return { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }
  }
  return { x: L.left - 8, y: L.top - 6, w: L.maxW + 16, h: L.blockH + 12 }
}

function drawSelection(ctx, tx, L, W, H) {
  const b = boundsOf(tx, L)
  ctx.save()
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(99, 91, 255, 0.9)'
  ctx.strokeRect(b.x, b.y, b.w, b.h)
  if (tx.shape === 'arrow' && W) {
    ctx.setLineDash([])
    ctx.fillStyle = '#635bff'
    ctx.beginPath()
    ctx.arc(tx.ax * W, tx.ay * H, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }
  ctx.restore()
}

export function drawTexts(ctx, texts, t, W, H, opts = {}) {
  for (const tx of texts) {
    const visible = t >= tx.start && t < tx.end
    if (!visible && !(opts.preview && opts.selectedId === tx.id)) continue
    drawOne(ctx, tx, t, W, H, opts)
  }
}

export function textBounds(ctx, raw, W, H, t = raw.start) {
  const tx = resolveAt(raw, Math.min(Math.max(t, raw.start), raw.end))
  return boundsOf(tx, layout(ctx, tx, W, H))
}

// topmost layer under (px, py): { id, part: 'body' | 'target' } — only layers
// visible at t, or the selected one (whose arrow target is also grabbable)
export function hitTest(ctx, texts, t, W, H, px, py, selectedId) {
  const sel = texts.find((tx) => tx.id === selectedId)
  if (sel && sel.shape === 'arrow' && Math.hypot(px - sel.ax * W, py - sel.ay * H) <= 12) {
    return { id: sel.id, part: 'target' }
  }
  for (let i = texts.length - 1; i >= 0; i--) {
    const tx = texts[i]
    if (!(t >= tx.start && t < tx.end) && tx.id !== selectedId) continue
    const b = textBounds(ctx, tx, W, H, t)
    if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return { id: tx.id, part: 'body' }
  }
  return null
}

let scratch = null
export function compositeFrame(source, texts, t, w, h) {
  if (!scratch) scratch = document.createElement('canvas')
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
  }
  const ctx = scratch.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  drawTexts(ctx, texts, t, w, h)
  return scratch
}

// Map a [start, end] range through a clip-edit remap; null if it was cut away.
export function remapRange(remap, start, end) {
  let ns = remap(start)
  let ne = remap(end)
  if (ns == null) for (let s = start; s <= end && ns == null; s += 0.05) ns = remap(s)
  if (ne == null) for (let e = end; e >= start && ne == null; e -= 0.05) ne = remap(e)
  if (ns == null || ne == null || ne - ns < 0.1) return null
  return [Math.round(ns * 1000) / 1000, Math.round(ne * 1000) / 1000]
}

// ---- measurement helpers (frame-relative, for alignment and auto-fit) ----
let measureCtx = null
export function measureText(tx, aspect, t = tx.start) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  const W = 1000
  const H = Math.round((1000 * aspect.h) / aspect.w)
  const b = textBounds(measureCtx, tx, W, H, t)
  return { x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H }
}

// largest size (≤ current) whose rendered width fits inside maxW of the frame
export function fitTextSize(tx, aspect, maxW = 0.86) {
  let size = tx.size
  for (let i = 0; i < 60 && size > 0.012; i++) {
    if (measureText({ ...tx, size, keys: [] }, aspect).w <= maxW) break
    size *= 0.95
  }
  return Math.round(size * 1000) / 1000
}

// Fit text into the frame: prefer breaking a long single line into two
// balanced lines over shrinking it into a caption. Returns { text, size }.
export function fitText(tx, aspect, maxW = 0.86) {
  const single = { text: tx.text, size: fitTextSize(tx, aspect, maxW) }
  const words = (tx.text || '').trim().split(/\s+/)
  if ((tx.text || '').includes('\n') || words.length < 3 || single.size >= tx.size * 0.999) return single
  let best = null
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const diff = Math.abs(a.length - b.length)
    if (!best || diff < best.diff) best = { diff, text: `${a}\n${b}` }
  }
  const wrapped = { text: best.text, size: fitTextSize({ ...tx, text: best.text }, aspect, maxW) }
  // two lines win when they keep the text meaningfully bigger
  return wrapped.size > single.size * 1.25 ? wrapped : single
}
