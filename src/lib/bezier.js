// CSS-style cubic-bezier easing: curve = [x1, y1, x2, y2] from (0,0) to (1,1).
// y may overshoot the 0..1 range (bounce-back / anticipation curves).

export const PRESET_CURVES = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inout: [0.42, 0, 0.58, 1],
  snappy: [0.2, 0.8, 0.2, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
}

export const PRESET_LABELS = {
  linear: 'Linear',
  ease: 'Ease',
  in: 'Ease in',
  out: 'Ease out',
  inout: 'In-out',
  snappy: 'Snappy',
  overshoot: 'Overshoot',
}

export const DEFAULT_CURVE = PRESET_CURVES.inout

export function presetOf(curve) {
  if (!Array.isArray(curve)) return null
  for (const [k, c] of Object.entries(PRESET_CURVES)) {
    if (c.every((v, i) => Math.abs(v - curve[i]) < 0.005)) return k
  }
  return null
}

function bezierAt(a, b, t) {
  // one axis of the cubic from 0 to 1 with control values a, b
  const mt = 1 - t
  return 3 * mt * mt * t * a + 3 * mt * t * t * b + t * t * t
}

function solveT(x1, x2, x) {
  // Newton–Raphson then bisection fallback: find t with bezierAt(x1, x2, t) = x
  let t = x
  for (let i = 0; i < 8; i++) {
    const cx = bezierAt(x1, x2, t) - x
    if (Math.abs(cx) < 1e-5) return t
    const mt = 1 - t
    const d = 3 * mt * mt * x1 + 6 * mt * t * (x2 - x1) + 3 * t * t * (1 - x2)
    if (Math.abs(d) < 1e-6) break
    t -= cx / d
    if (t < 0 || t > 1) break
  }
  let lo = 0
  let hi = 1
  t = x
  for (let i = 0; i < 24; i++) {
    const cx = bezierAt(x1, x2, t)
    if (Math.abs(cx - x) < 1e-5) return t
    if (cx < x) lo = t
    else hi = t
    t = (lo + hi) / 2
  }
  return t
}

const cache = new Map()

export function cubicBezier(curve) {
  const key = curve.join(',')
  let fn = cache.get(key)
  if (fn) return fn
  const [x1, y1, x2, y2] = curve
  fn = (p) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    return bezierAt(y1, y2, solveT(x1, x2, p))
  }
  cache.set(key, fn)
  return fn
}

export const easeCurve = (curve, p) => cubicBezier(curve || DEFAULT_CURVE)(p)

export const curveLabel = (curve) =>
  `cubic-bezier(${curve.map((v) => (Math.round(v * 100) / 100).toString()).join(', ')})`
