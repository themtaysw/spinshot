import React, { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { useTimeline, updateText, setTextPosition } from '../lib/timeline.js'
import { resolveAt } from '../lib/textRender.js'
import { drawTexts, hitTest, renderLocale } from '../lib/textRender.js'

// Live text layers over the 3D viewport. Draws with the same renderer the
// exporter uses, and lets you drag text to position it.
export default function TextOverlay({ frameRef }) {
  const canvasRef = useRef(null)
  const texts = useStore((s) => s.texts)
  const activeLocale = useStore((s) => s.activeLocale)
  const t = useTimeline((s) => Math.min(s.t, s.length))
  const selectedText = useTimeline((s) => s.selectedText)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [frameRef])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !size.w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr)
      c.height = Math.round(size.h * dpr)
    }
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    renderLocale.current = activeLocale || 'base'
    if (texts.length) drawTexts(ctx, texts, t, size.w, size.h, { preview: true, selectedId: selectedText })
  }, [texts, t, selectedText, size, activeLocale])

  // drag-to-position: capture-phase so OrbitControls never sees a text drag
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const probe = document.createElement('canvas').getContext('2d')

    const hit = (e) => {
      const r = frame.getBoundingClientRect()
      const { texts: list } = useStore.getState()
      if (!list.length) return null
      const tl = useTimeline.getState()
      const hitInfo = hitTest(probe, list, Math.min(tl.t, tl.length), r.width, r.height, e.clientX - r.left, e.clientY - r.top, tl.selectedText)
      return hitInfo ? { ...hitInfo, r } : null
    }

    const onMoveHover = (e) => {
      if (e.buttons) return
      const h = hit(e)
      frame.style.cursor = h ? (h.part === 'target' ? 'crosshair' : 'move') : ''
    }

    const onDown = (e) => {
      if (e.button !== 0 || e.altKey) return // ⌥-drag moves the phone instead
      const h = hit(e)
      if (!h) return
      e.stopPropagation()
      e.preventDefault()
      useTimeline.setState({ selectedText: h.id, selectedClip: null, playing: false })
      const raw = useStore.getState().texts.find((x) => x.id === h.id)
      const tl = useTimeline.getState()
      const tx = resolveAt(raw, Math.min(Math.max(tl.t, raw.start), raw.end))
      const sx = e.clientX
      const sy = e.clientY
      const isTarget = h.part === 'target'
      const x0 = isTarget ? tx.ax : tx.x
      const y0 = isTarget ? tx.ay : tx.y
      const onMove = (ev) => {
        const nx = Math.min(1, Math.max(0, x0 + (ev.clientX - sx) / h.r.width))
        const ny = Math.min(1, Math.max(0, y0 + (ev.clientY - sy) / h.r.height))
        if (isTarget) updateText(h.id, { ax: nx, ay: ny })
        else setTextPosition(h.id, { x: nx, y: ny })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    frame.addEventListener('pointerdown', onDown, true)
    frame.addEventListener('pointermove', onMoveHover)
    return () => {
      frame.removeEventListener('pointerdown', onDown, true)
      frame.removeEventListener('pointermove', onMoveHover)
      frame.style.cursor = ''
    }
  }, [frameRef])

  return <canvas ref={canvasRef} className="text-overlay" style={{ width: size.w, height: size.h }} />
}
