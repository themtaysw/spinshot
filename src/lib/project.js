import JSZip from 'jszip'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { useStore, SCENE_KEYS, deserializeScene } from '../store.js'
import { useTimeline } from './timeline.js'
import { screenMedia } from './refs.js'
import { pickCodec, seekVideo } from './videoExporter.js'
import { loadFont } from './fonts.js'
import { resetHistory } from './history.js'
import { programToSource, programLength, isTrivialProgram } from './clips.js'

// Re-encode the edited program (cuts, trims, speed changes applied) so a
// project file doesn't have to carry a long original capture.
async function bakeProgram(sm, clips, seconds) {
  const fps = 30
  // frame size: the largest recording in the program
  let w = 0
  let h = 0
  for (const v of sm.videos.values()) {
    w = Math.max(w, v.videoWidth)
    h = Math.max(h, v.videoHeight)
  }
  w -= w % 2
  h -= h % 2
  if (!w || !h) throw new Error('recordings not loaded yet')
  const total = Math.max(1, Math.round(seconds * fps))
  const config = await pickCodec(w, h, fps)
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  })
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('bake encoder error', e),
  })
  encoder.configure(config)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  for (const v of sm.videos.values()) v.pause()
  try {
    for (let f = 0; f < total; f++) {
      const t = f / fps
      const video = sm.videoAt(t)
      if (video) {
        await seekVideo(video, programToSource(clips, t))
        // letterbox recordings of a different size onto the shared frame
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
        const s = Math.min(w / video.videoWidth, h / video.videoHeight)
        const dw = video.videoWidth * s
        const dh = video.videoHeight * s
        ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh)
      }
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((f * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      })
      encoder.encode(frame, { keyFrame: f % 60 === 0 })
      frame.close()
      while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5))
    }
    await encoder.flush()
    muxer.finalize()
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    try {
      encoder.close()
    } catch {
      /* already closed */
    }
  }
}

// A .spinshot project is a zip: project.json + the actual media bytes, so a
// project reopens exactly as it was saved — screen video included.

const extFor = (mime) =>
  ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' }[mime] ||
  (mime.startsWith('video/') ? 'mp4' : 'png'))

export async function buildProject() {
  const state = useStore.getState()
  const tl = useTimeline.getState()
  const zip = new JSZip()
  const media = {}

  const addBlob = (key, blob) => {
    const mime = blob.type || 'application/octet-stream'
    const file = `media/${key}.${extFor(mime)}`
    zip.file(file, blob)
    media[key] = { file, mime }
  }

  const addMedia = async (key, src) => {
    if (!src) return
    addBlob(key, await (await fetch(src)).blob())
  }

  // recordings: either every source as-is, or (bake) the edited program stitched into one file
  const sources = []
  let baked = false
  const sm = screenMedia.current
  if (state.screenType === 'video' && state.media.length) {
    const clips = state.clips
    const canBake = state.bakeTrim && sm && clips.length && state.media.every((m) => m.dur > 0) && !isTrivialProgram(clips, state.media)
    if (canBake) {
      useStore.setState({ exportingVideo: true })
      try {
        const blob = await bakeProgram(sm, clips, Math.max(0.1, programLength(clips)))
        const file = 'media/src-baked.mp4'
        zip.file(file, blob)
        sources.push({ id: 'baked', name: 'Edited', file, mime: 'video/mp4', ext: 'mp4', dur: Math.round(programLength(clips) * 100) / 100 })
        baked = true
      } finally {
        useStore.setState({ exportingVideo: false })
      }
    }
    if (!baked) {
      for (const m of state.media) {
        try {
          const blob = await (await fetch(m.src)).blob()
          const ext = m.ext || extFor(blob.type || 'video/mp4')
          const file = `media/src-${m.id}.${ext}`
          zip.file(file, blob)
          sources.push({ id: m.id, name: m.name, file, mime: blob.type || 'video/mp4', ext, dur: m.dur || 0 })
        } catch {
          /* source gone — skip it */
        }
      }
    }
  } else if (state.screenType === 'image') {
    await addMedia('screen', state.screenSrc)
  }
  await addMedia('bg', state.bgImage)

  // music track
  let audio = null
  if (state.music) {
    try {
      const m = state.music
      const blob = await (await fetch(m.src)).blob()
      const file = `media/audio-${m.id}.${m.ext || 'mp3'}`
      zip.file(file, blob)
      const { src, ...rest } = m
      audio = { ...rest, file, mime: blob.type || 'audio/mpeg' }
    } catch {
      /* source gone */
    }
  }

  // imported brand fonts travel with the project
  const fonts = []
  for (const f of state.fonts || []) {
    try {
      const blob = await (await fetch(f.src)).blob()
      const file = `media/fonts/${f.id}.${f.ext || 'ttf'}`
      zip.file(file, blob)
      fonts.push({ id: f.id, name: f.name, file, ext: f.ext || 'ttf' })
    } catch {
      /* font source gone — skip it */
    }
  }

  const scene = {}
  for (const k of SCENE_KEYS) scene[k] = state[k]
  scene.screenSrc = null
  scene.bgImage = null
  scene.fonts = [] // rebuilt from the manifest on open
  scene.media = [] // rebuilt from `sources`
  scene.music = null // rebuilt from `audio`
  if (baked) {
    scene.videoTrim = 0
    scene.clips = [] // the baked file *is* the program now (a full clip is created on open)
  }

  zip.file(
    'project.json',
    JSON.stringify(
      {
        app: 'spinshot',
        version: 3,
        scene,
        timeline: { keys: tl.keys, length: tl.length, easing: tl.easing, loop: tl.loop },
        media,
        sources,
        audio,
        fonts,
      },
      null,
      2
    )
  )
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

export async function openProject(fileOrBlob) {
  // legacy plain-JSON scenes still open
  const name = fileOrBlob.name || ''
  if (name.endsWith('.json')) {
    const text = await fileOrBlob.text()
    const { scene, timeline } = deserializeScene(text)
    applyProject(scene, timeline)
    return
  }

  const zip = await JSZip.loadAsync(fileOrBlob)
  const entry = zip.file('project.json')
  if (!entry) throw new Error('Not a Spinshot project file')
  const data = JSON.parse(await entry.async('string'))
  if (data.app !== 'spinshot') throw new Error('Not a Spinshot project file')

  const scene = { ...data.scene }
  for (const [key, m] of Object.entries(data.media || {})) {
    const f = zip.file(m.file)
    if (!f) continue
    const raw = await f.async('blob')
    const url = URL.createObjectURL(new Blob([raw], { type: m.mime }))
    if (key === 'screen') scene.screenSrc = url
    if (key === 'bg') scene.bgImage = url
  }
  // recordings (v3 `sources`); a v2 project's single screen video becomes source 'm0'
  const mediaList = []
  for (const src of data.sources || []) {
    const f = zip.file(src.file)
    if (!f) continue
    const url = URL.createObjectURL(new Blob([await f.async('blob')], { type: src.mime || 'video/mp4' }))
    mediaList.push({ id: src.id, name: src.name, src: url, ext: src.ext, dur: 0, pending: false })
  }
  if (scene.screenType === 'video') {
    if (!mediaList.length && scene.screenSrc) {
      mediaList.push({ id: 'm0', name: 'Recording', src: scene.screenSrc, ext: 'mp4', dur: 0, pending: false })
    }
    const clips = (scene.clips || []).map((c) => ({ ...c, mediaId: c.mediaId || mediaList[0]?.id }))
    // a recording no clip references (e.g. a baked file) gets a full clip once it loads
    scene.media = mediaList.map((m) => ({ ...m, pending: !clips.some((c) => c.mediaId === m.id) }))
    scene.clips = clips
    scene.screenSrc = mediaList[0]?.src || null
  } else {
    scene.media = []
  }
  if (data.audio?.file) {
    const f = zip.file(data.audio.file)
    if (f) {
      const { file, mime, ...rest } = data.audio
      const url = URL.createObjectURL(new Blob([await f.async('blob')], { type: mime || 'audio/mpeg' }))
      scene.music = { ...rest, src: url }
    }
  }
  const fonts = []
  for (const m of data.fonts || []) {
    const f = zip.file(m.file)
    if (!f) continue
    const url = URL.createObjectURL(await f.async('blob'))
    try {
      await loadFont(m.id, m.name, url)
      fonts.push({ id: m.id, name: m.name, src: url, ext: m.ext })
    } catch {
      /* unreadable font — texts fall back to the system font */
    }
  }
  scene.fonts = fonts
  applyProject(scene, data.timeline)
}

function applyProject(scene, timeline) {
  const patch = {}
  for (const k of SCENE_KEYS) if (k in scene) patch[k] = scene[k]
  if (!Array.isArray(patch.clips)) patch.clips = []
  if (!Array.isArray(patch.media)) patch.media = []
  useStore.setState({ ...patch, pendingFit: false, started: true })
  if (timeline) useTimeline.setState({ ...timeline, t: 0, playing: false, selectedClip: null })
  resetHistory()
}

export async function saveProjectFile() {
  const blob = await buildProject()
  if (window.spinshot?.saveProject) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return window.spinshot.saveProject(bytes, `${(useStore.getState().projectName || 'Untitled').replace(/[\/:]/g, '-')}.spinshot`)
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'project.spinshot'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return { saved: true }
}

// dev/testing hook
if (typeof window !== 'undefined') {
  window.__spinshotProject = { buildProject, openProject, JSZip }
}
