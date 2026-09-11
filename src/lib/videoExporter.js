import { Muxer, ArrayBufferTarget, StreamTarget } from 'mp4-muxer'
import { threeRef, screenMedia } from './refs.js'
import { applySample, cycleLength } from './timeline.js'
import { useStore } from '../store.js'
import { programToSource } from './clips.js'

export async function pickCodec(width, height, fps) {
  const candidates = ['avc1.640033', 'avc1.64002A', 'avc1.42E01E']
  for (const codec of candidates) {
    const config = {
      codec,
      width,
      height,
      bitrate: Math.min(45_000_000, Math.max(4_000_000, Math.round(width * height * fps * 0.1))),
      framerate: fps,
    }
    try {
      const res = await VideoEncoder.isConfigSupported(config)
      if (res.supported) return config
    } catch {
      /* try next */
    }
  }
  throw new Error('No supported H.264 encoder configuration found')
}

export async function seekVideo(video, t) {
  const dur = video.duration || 0
  if (!dur || !isFinite(dur)) return
  // clamp (don't wrap): past the video's end — e.g. the loop-return segment —
  // the screen holds the last frame
  const target = Math.min(Math.max(0, t), dur - 0.001)
  if (Math.abs(video.currentTime - target) < 1 / 120) return
  await new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      resolve()
    }
    video.addEventListener('seeked', done)
    video.currentTime = target
    setTimeout(done, 500) // safety net
  })
}

// Source-time for a program time, honouring the edited clip list.
export function sourceTimeAt(t) {
  const { clips } = useStore.getState()
  return programToSource(clips, t)
}

// Where the MP4 bytes go: the desktop app streams chunks straight to disk (so a
// multi-minute 4K export never sits in RAM); the browser fallback buffers in memory.
async function makeSink(name) {
  if (window.spinshot?.exportBegin) {
    const res = await window.spinshot.exportBegin(name)
    if (!res || res.canceled) return null
    const id = res.id
    const inflight = new Set()
    return {
      streaming: true,
      target: new StreamTarget({
        chunked: true,
        chunkSize: 4 * 1024 * 1024,
        onData: (data, position) => {
          const p = window.spinshot.exportWrite(id, position, new Uint8Array(data)).finally(() => inflight.delete(p))
          inflight.add(p)
        },
      }),
      async drain(max = 6) {
        while (inflight.size > max) await Promise.race(inflight)
      },
      async finish() {
        await Promise.all(inflight)
        return window.spinshot.exportEnd(id)
      },
      async abort() {
        await Promise.allSettled(inflight)
        return window.spinshot.exportAbort(id)
      },
    }
  }
  const target = new ArrayBufferTarget()
  return {
    streaming: false,
    target,
    async drain() {},
    async finish() {
      const blob = new Blob([target.buffer], { type: 'video/mp4' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      return { saved: true }
    },
    async abort() {},
  }
}

// Renders the timeline frame-by-frame, deterministically, and encodes via WebCodecs.
// mode: 'mp4' writes the file (returns the sink result); 'frames' calls onFrame(dataURL, index).
export async function exportTimeline({ width, height, fps, mode = 'mp4', name, onFrame, onProgress, shouldCancel }) {
  const three = threeRef.current
  if (!three) throw new Error('Renderer not ready')
  const { gl, scene, camera, setFrameloop, advance, size } = three

  width -= width % 2
  height -= height % 2

  const total = Math.max(1, Math.round(cycleLength() * fps))

  let muxer = null
  let encoder = null
  let sink = null
  if (mode === 'mp4') {
    sink = await makeSink(name || 'spinshot.mp4')
    if (!sink) return { saved: false, canceled: true }
    const config = await pickCodec(width, height, fps)
    muxer = new Muxer({
      target: sink.target,
      video: { codec: 'avc', width, height },
      fastStart: sink.streaming ? false : 'in-memory',
      firstTimestampBehavior: 'offset',
    })
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('encoder error', e),
    })
    encoder.configure(config)
  }

  const prevPR = gl.getPixelRatio()
  const prevBg = scene.background
  const video = screenMedia.current?.videoEl

  setFrameloop('never')
  gl.setPixelRatio(1)
  gl.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  if (video) video.pause()

  let ok = false
  try {
    for (let f = 0; f < total; f++) {
      if (shouldCancel?.()) throw new Error('cancelled')
      const t = f / fps
      applySample(t)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      if (video) {
        await seekVideo(video, sourceTimeAt(t))
        screenMedia.current?.draw()
      }
      advance(performance.now())

      if (mode === 'mp4') {
        const frame = new VideoFrame(gl.domElement, {
          timestamp: Math.round((f * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        })
        encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 })
        frame.close()
        while (encoder.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5))
        await sink.drain()
      } else {
        await onFrame(gl.domElement.toDataURL('image/png'), f)
      }

      onProgress?.((f + 1) / total)
      await new Promise((r) => setTimeout(r))
    }

    if (mode === 'mp4') {
      await encoder.flush()
      muxer.finalize()
      ok = true
      return await sink.finish()
    }
    return { saved: true }
  } finally {
    try {
      encoder?.close()
    } catch {
      /* already closed */
    }
    if (sink && !ok) await sink.abort()
    scene.background = prevBg
    gl.setPixelRatio(prevPR)
    gl.setSize(size.width, size.height, false)
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    setFrameloop('always')
  }
}
