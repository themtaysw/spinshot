import React, { useEffect, useRef, useState } from 'react'
import { loadAudio } from '../lib/audio.js'

// Waveform of the used section [trim, trim + len] of an audio file.
export default function Waveform({ src, dur, trim, len, width, height, color = 'rgba(125, 216, 143, 0.9)' }) {
  const ref = useRef(null)
  const [peaks, setPeaks] = useState(null)

  useEffect(() => {
    let alive = true
    setPeaks(null)
    loadAudio(src)
      .then((a) => alive && setPeaks(a.peaks))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [src])

  useEffect(() => {
    const c = ref.current
    if (!c || !peaks || !width || !height) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = color
    const n = peaks.length
    const b0 = (trim / dur) * n
    const b1 = ((trim + len) / dur) * n
    const cols = Math.max(1, Math.floor(width / 2))
    const mid = height / 2
    for (let i = 0; i < cols; i++) {
      const a = b0 + ((b1 - b0) * i) / cols
      const b = b0 + ((b1 - b0) * (i + 1)) / cols
      let m = 0
      for (let j = Math.floor(a); j <= Math.min(n - 1, Math.floor(b)); j++) m = Math.max(m, peaks[j])
      const h = Math.max(1, m * (height - 4))
      ctx.fillRect(i * 2, mid - h / 2, 1.4, h)
    }
  }, [peaks, trim, len, dur, width, height, color])

  return <canvas ref={ref} className="waveform" style={{ width, height }} />
}
