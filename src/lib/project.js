import JSZip from 'jszip'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { useStore, SCENE_KEYS, deserializeScene } from '../store.js'
import { useTimeline } from './timeline.js'
import { screenMedia } from './refs.js'
import { pickCodec, seekVideo } from './videoExporter.js'
import { programToSource, programLength, isTrivial } from './clips.js'

// Re-encode the edited program (cuts, trims, speed changes applied) so a
// project file doesn't have to carry a long original capture.
async function bakeProgram(video, clips, seconds) {
  const fps = 30
  let w = video.videoWidth - (video.videoWidth % 2)
  let h = video.videoHeight - (video.videoHeight % 2)
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
  video.pause()
  try {
    for (let f = 0; f < total; f++) {
      await seekVideo(video, programToSource(clips, f / fps))
      ctx.drawImage(video, 0, 0, w, h)
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

  // bake: keep only the used section of the screen recording
  let baked = false
  const video = screenMedia.current?.videoEl
  if (state.screenType === 'video' && state.bakeTrim && video && isFinite(video.duration) && video.duration > 0) {
    const clips = state.clips
    if (clips.length && !isTrivial(clips, video.duration)) {
      useStore.setState({ exportingVideo: true })
      try {
        addBlob('screen', await bakeProgram(video, clips, Math.max(0.1, programLength(clips))))
        baked = true
      } finally {
        useStore.setState({ exportingVideo: false })
      }
    }
  }

  if (!baked) await addMedia('screen', state.screenSrc)
  await addMedia('bg', state.bgImage)

  const scene = {}
  for (const k of SCENE_KEYS) scene[k] = state[k]
  scene.screenSrc = null
  scene.bgImage = null
  if (baked) {
    scene.videoTrim = 0
    scene.clips = [] // the baked file *is* the program now
  }

  zip.file(
    'project.json',
    JSON.stringify(
      {
        app: 'spinshot',
        version: 2,
        scene,
        timeline: { keys: tl.keys, length: tl.length, easing: tl.easing, loop: tl.loop },
        media,
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
  applyProject(scene, data.timeline)
}

function applyProject(scene, timeline) {
  const patch = {}
  for (const k of SCENE_KEYS) if (k in scene) patch[k] = scene[k]
  if (!Array.isArray(patch.clips)) patch.clips = []
  useStore.setState({ ...patch, pendingFit: false, videoDur: 0 })
  if (timeline) useTimeline.setState({ ...timeline, t: 0, playing: false, selectedClip: null })
}

export async function saveProjectFile() {
  const blob = await buildProject()
  if (window.spinshot?.saveProject) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    return window.spinshot.saveProject(bytes)
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
