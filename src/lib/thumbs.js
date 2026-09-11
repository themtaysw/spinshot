import { useEffect, useState } from 'react'

// Filmstrip thumbnails for the video lane, generated from a private <video>
// so the on-device screen video is never disturbed.
const cache = new Map() // src -> { thumbs: [{ t, url }], w, h, done }

export const THUMB_H = 72

async function generate(src, entry) {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.src = src
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true })
    video.addEventListener('error', reject, { once: true })
  })
  if (!isFinite(video.duration)) {
    await new Promise((resolve) => {
      video.addEventListener('durationchange', () => isFinite(video.duration) && resolve(), { once: true })
      video.currentTime = 1e101
      setTimeout(resolve, 1500)
    })
  }
  const dur = isFinite(video.duration) ? video.duration : 0
  if (!dur || !video.videoWidth) return
  const w = Math.max(16, Math.round((THUMB_H * video.videoWidth) / video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = THUMB_H
  const ctx = canvas.getContext('2d')
  entry.w = w
  entry.h = THUMB_H
  entry.dur = dur

  const count = Math.min(120, Math.max(24, Math.round(dur / 1.5)))
  for (let i = 0; i < count; i++) {
    if (entry.cancelled) return
    const t = ((i + 0.5) / count) * dur
    await new Promise((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        resolve()
      }
      video.addEventListener('seeked', done)
      video.currentTime = t
      setTimeout(done, 400)
    })
    ctx.drawImage(video, 0, 0, w, THUMB_H)
    entry.thumbs.push({ t, url: canvas.toDataURL('image/jpeg', 0.6) })
    if (i % 4 === 3) entry.notify()
  }
  entry.done = true
  entry.notify()
  video.src = ''
}

function getEntry(src) {
  let entry = cache.get(src)
  if (!entry) {
    entry = { thumbs: [], w: 40, h: THUMB_H, dur: 0, done: false, listeners: new Set(), cancelled: false }
    entry.notify = () => entry.listeners.forEach((fn) => fn())
    cache.set(src, entry)
    generate(src, entry).catch(() => {
      entry.done = true
      entry.notify()
    })
  }
  return entry
}

export function useThumbs(src) {
  const [state, setState] = useState(() => (src ? { ...getEntry(src) } : null))
  useEffect(() => {
    if (!src) {
      setState(null)
      return
    }
    const entry = getEntry(src)
    const update = () => setState({ thumbs: entry.thumbs.slice(), w: entry.w, h: entry.h, dur: entry.dur, done: entry.done })
    entry.listeners.add(update)
    update()
    return () => entry.listeners.delete(update)
  }, [src])
  return state
}

export function nearestThumb(thumbs, t) {
  if (!thumbs?.length) return null
  let best = thumbs[0]
  for (const th of thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th
  return best
}
