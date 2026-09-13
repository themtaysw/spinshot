// Renderer-side Claude features. All API calls happen in the Electron main
// process (see electron/ai.cjs); this module prepares inputs and applies results.
import { useStore } from '../store.js'
import { useTimeline } from './timeline.js'
import { screenMedia } from './refs.js'
import { exportTimeline } from './videoExporter.js'
import { exportDims } from './exporter.js'
import { applyPlan } from './storyboard.js'
import { getAspect } from '../store.js'

// what the model needs to know about the sequence it's planning for
function sequenceInfo() {
  const s = useStore.getState()
  const a = getAspect(s)
  const orientation = a.w > a.h * 1.15 ? 'landscape' : a.h > a.w * 1.15 ? 'portrait' : 'square'
  return { aspect: a.label, orientation, fps: s.videoFps, length: useTimeline.getState().length }
}

export const LANGUAGES = [
  ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'],
  ['nl', 'Dutch'], ['sv', 'Swedish'], ['pl', 'Polish'], ['cs', 'Czech'], ['sk', 'Slovak'], ['tr', 'Turkish'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-Hans', 'Chinese (Simplified)'], ['ar', 'Arabic'], ['hi', 'Hindi'],
  ['en', 'English'],
].map(([code, name]) => ({ code, name }))

export const aiApi = () => window.spinshot?.ai || null

function busy(label) {
  useStore.setState({ aiBusy: label })
}

export async function translateTexts(codes, context) {
  const api = aiApi()
  if (!api) throw new Error('Claude features need the desktop app')
  const s = useStore.getState()
  const items = s.texts.filter((t) => (t.text || '').trim()).map((t) => ({ id: t.id, text: t.text }))
  if (!items.length) throw new Error('No text layers to translate')
  const languages = LANGUAGES.filter((l) => codes.includes(l.code))
  busy(`Translating ${items.length} text layers into ${languages.length} languages…`)
  try {
    const res = await api.translate({ items, languages, context })
    if (!res.ok) throw new Error(res.error)
    const st = useStore.getState()
    const texts = st.texts.map((t) => {
      const i18n = { ...(t.i18n || {}) }
      for (const l of languages) if (res.translations[l.code]?.[t.id] != null) i18n[l.code] = res.translations[l.code][t.id]
      return { ...t, i18n }
    })
    const known = new Map(st.locales.map((l) => [l.code, l]))
    for (const l of languages) known.set(l.code, l)
    useStore.setState({ texts, locales: [...known.values()] })
    return res.usage
  } finally {
    busy('')
  }
}

export async function estimateTranslate(codes, context) {
  const api = aiApi()
  if (!api) return null
  const s = useStore.getState()
  const items = s.texts.filter((t) => (t.text || '').trim()).map((t) => ({ id: t.id, text: t.text }))
  const languages = LANGUAGES.filter((l) => codes.includes(l.code))
  if (!items.length || !languages.length) return null
  return api.estimate({ kind: 'translate', payload: { items, languages, context } })
}

export async function copyVariants(text, mode, context) {
  const api = aiApi()
  if (!api) throw new Error('Claude features need the desktop app')
  busy('Asking Claude for copy…')
  try {
    const res = await api.copy({ text, mode, context })
    if (!res.ok) throw new Error(res.error)
    return res.variants
  } finally {
    busy('')
  }
}

// evenly spaced JPEG frames from each recording, small enough to be cheap
export async function sampleFrames(perSource = 5) {
  const sm = screenMedia.current
  const { media } = useStore.getState()
  const out = []
  if (!sm || !media.length) return out
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  for (const m of media) {
    const v = sm.videos.get(m.id)
    if (!v || !m.dur || !v.videoWidth) continue
    const w = 320
    const h = Math.round((w * v.videoHeight) / v.videoWidth)
    canvas.width = w
    canvas.height = h
    const frames = []
    v.pause()
    for (let i = 0; i < perSource; i++) {
      const t = ((i + 0.5) / perSource) * m.dur
      await new Promise((resolve) => {
        const done = () => {
          v.removeEventListener('seeked', done)
          resolve()
        }
        v.addEventListener('seeked', done)
        v.currentTime = t
        setTimeout(done, 700)
      })
      ctx.drawImage(v, 0, 0, w, h)
      frames.push(canvas.toDataURL('image/jpeg', 0.6).split(',')[1])
    }
    out.push({ id: m.id, name: m.name, dur: m.dur, frames })
  }
  return out
}

export async function estimateStoryboard(brief, seconds, perSource = 5) {
  const api = aiApi()
  if (!api) return null
  const { media, screenType } = useStore.getState()
  const frameCount = screenType === 'video' ? media.length * perSource : 0
  return api.estimate({ kind: 'storyboard', payload: { brief, seconds, frameCount } })
}

export async function generateStoryboard(brief, seconds, context = '') {
  const api = aiApi()
  if (!api) throw new Error('AI features need the desktop app')
  const s = useStore.getState()
  const hasVideo = s.screenType === 'video' && s.media.length > 0
  busy('Sampling frames from your recordings…')
  try {
    const media = hasVideo ? await sampleFrames(5) : []
    busy('Drafting the storyboard…')
    const res = await api.storyboard({ brief, seconds, media, hasVideo, context, sequence: sequenceInfo() })
    if (!res.ok) throw new Error(res.error)
    applyPlan(res.plan)
    return res
  } finally {
    busy('')
  }
}

// one MP4 per language (plus the base) into a folder
export async function exportAllLocales(onProgress) {
  const sp = window.spinshot
  if (!sp?.chooseDir) throw new Error('Batch export needs the desktop app')
  const dir = await sp.chooseDir()
  if (!dir) return { canceled: true }
  const s = useStore.getState()
  const variants = ['base', ...s.locales.map((l) => l.code)]
  const { w, h } = exportDims()
  const prev = s.activeLocale
  useStore.setState({ exportingVideo: true })
  useTimeline.setState({ playing: false })
  let done = 0
  try {
    for (const code of variants) {
      useStore.setState({ activeLocale: code })
      const name = `spinshot-${code === 'base' ? 'original' : code}-${w}x${h}.mp4`
      await exportTimeline({
        width: w,
        height: h,
        fps: s.videoFps,
        mode: 'mp4',
        filePath: `${dir}/${name}`,
        onProgress: (p) => onProgress?.((done + p) / variants.length, code),
      })
      done++
    }
    return { saved: true, count: variants.length, dir }
  } finally {
    useStore.setState({ activeLocale: prev, exportingVideo: false })
  }
}
