import React, { useRef, useState } from 'react'
import { PRESET_CURVES, PRESET_LABELS, presetOf, curveLabel, cubicBezier } from '../lib/bezier.js'

// After-Effects-style easing graph: drag the two handles, or pick a preset.
// Coordinates: x = time 0..1, y = progress (may overshoot past 0..1).
const W = 220
const H = 150
const PAD = 14
const YMIN = -0.4
const YMAX = 1.4

const sx = (x) => PAD + x * (W - PAD * 2)
const sy = (y) => H - PAD - ((y - YMIN) / (YMAX - YMIN)) * (H - PAD * 2)

export default function CurveEditor({ value, onChange, compact = false }) {
  const svgRef = useRef(null)
  const dragRef = useRef(null) // 1 | 2 — a ref so the very next move counts
  const [drag, setDragState] = useState(null)
  const setDrag = (v) => {
    dragRef.current = v
    setDragState(v)
  }
  const [x1, y1, x2, y2] = value
  const preset = presetOf(value)

  const toCurve = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    const x = Math.min(1, Math.max(0, (px - PAD) / (W - PAD * 2)))
    const y = YMIN + ((H - PAD - py) / (H - PAD * 2)) * (YMAX - YMIN)
    return [x, Math.min(YMAX, Math.max(YMIN, y))]
  }

  const onDown = (e) => {
    if (e.button !== 0) return
    const r = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    const py = ((e.clientY - r.top) / r.height) * H
    const d1 = Math.hypot(px - sx(x1), py - sy(y1))
    const d2 = Math.hypot(px - sx(x2), py - sy(y2))
    const which = d1 < d2 ? 1 : 2
    if (Math.min(d1, d2) > 22) return
    e.preventDefault()
    try {
      svgRef.current.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointer */
    }
    setDrag(which)
  }
  const onMove = (e) => {
    const d = dragRef.current
    if (!d || !(e.buttons & 1)) return
    const [x, y] = toCurve(e)
    const r2 = (v) => Math.round(v * 100) / 100
    onChange(d === 1 ? [r2(x), r2(y), x2, y2] : [x1, y1, r2(x), r2(y)])
  }
  const onUp = () => setDrag(null)

  // sample the curve as y(t) so overshoot shapes draw correctly
  const fn = cubicBezier(value)
  const pts = []
  for (let i = 0; i <= 60; i++) {
    const p = i / 60
    pts.push(`${sx(p).toFixed(1)},${sy(fn(p)).toFixed(1)}`)
  }

  return (
    <div className={`curve-editor ${compact ? 'compact' : ''}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className={drag ? 'dragging' : ''}
      >
        <rect className="ce-bg" x={0} y={0} width={W} height={H} rx={8} />
        {/* the 0..1 box */}
        <rect className="ce-box" x={sx(0)} y={sy(1)} width={sx(1) - sx(0)} height={sy(0) - sy(1)} />
        {[0.25, 0.5, 0.75].map((g) => (
          <React.Fragment key={g}>
            <line className="ce-grid" x1={sx(g)} y1={sy(0)} x2={sx(g)} y2={sy(1)} />
            <line className="ce-grid" x1={sx(0)} y1={sy(g)} x2={sx(1)} y2={sy(g)} />
          </React.Fragment>
        ))}
        <line className="ce-diag" x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} />
        <line className="ce-arm" x1={sx(0)} y1={sy(0)} x2={sx(x1)} y2={sy(y1)} />
        <line className="ce-arm" x1={sx(1)} y1={sy(1)} x2={sx(x2)} y2={sy(y2)} />
        <polyline className="ce-curve" points={pts.join(' ')} />
        <circle className="ce-anchor" cx={sx(0)} cy={sy(0)} r={3.5} />
        <circle className="ce-anchor" cx={sx(1)} cy={sy(1)} r={3.5} />
        <circle className={`ce-handle ${drag === 1 ? 'active' : ''}`} cx={sx(x1)} cy={sy(y1)} r={6} />
        <circle className={`ce-handle ${drag === 2 ? 'active' : ''}`} cx={sx(x2)} cy={sy(y2)} r={6} />
      </svg>
      <div className="curve-presets">
        {Object.entries(PRESET_CURVES).map(([k, c]) => (
          <button
            key={k}
            className={`curve-chip ${preset === k ? 'active' : ''}`}
            onClick={() => onChange(c)}
            title={curveLabel(c)}
          >
            {PRESET_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="curve-readout">{curveLabel(value)}</div>
    </div>
  )
}
