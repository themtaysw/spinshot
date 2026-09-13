// Music track: decoding, waveform peaks, timeline-locked preview playback,
// and rendering the program's audio for export.

let ctx = null
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

const cache = new Map() // src -> Promise<{ buffer, peaks, dur }>

export function loadAudio(src) {
  let p = cache.get(src)
  if (!p) {
    p = (async () => {
      const bytes = await (await fetch(src)).arrayBuffer()
      const buffer = await audioContext().decodeAudioData(bytes)
      return { buffer, peaks: computePeaks(buffer, 1600), dur: buffer.duration }
    })()
    cache.set(src, p)
    p.catch(() => cache.delete(src))
  }
  return p
}

// max |sample| per bucket, channels mixed — enough for a lane waveform
export function computePeaks(buffer, buckets) {
  const out = new Float32Array(buckets)
  const len = buffer.length
  const per = len / buckets
  const chans = []
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c))
  for (let b = 0; b < buckets; b++) {
    const s0 = Math.floor(b * per)
    const s1 = Math.min(len, Math.floor((b + 1) * per))
    let m = 0
    for (const ch of chans) for (let i = s0; i < s1; i += 4) m = Math.max(m, Math.abs(ch[i]))
    out[b] = m
  }
  return out
}

// gain envelope in program time
function scheduleEnvelope(gain, music, t0, now) {
  const end = music.offset + music.len
  const fi = Math.min(music.fadeIn || 0, music.len / 2)
  const fo = Math.min(music.fadeOut || 0, music.len / 2)
  const vol = music.volume ?? 1
  const at = (p) => now + Math.max(0, p - t0) // program time -> context time
  const envAt = (p) => {
    let v = vol
    if (fi > 0) v *= Math.min(1, Math.max(0, (p - music.offset) / fi))
    if (fo > 0) v *= Math.min(1, Math.max(0, (end - p) / fo))
    return v
  }
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(envAt(t0), now)
  if (fi > 0 && t0 < music.offset + fi) gain.gain.linearRampToValueAtTime(vol, at(music.offset + fi))
  if (fo > 0 && t0 < end) {
    gain.gain.setValueAtTime(vol * (fi > 0 && t0 > end - fo ? envAt(t0) / vol : 1), at(Math.max(t0, end - fo)))
    gain.gain.linearRampToValueAtTime(0, at(end))
  }
}

export class MusicPlayer {
  constructor() {
    this.src = null
    this.gen = 0
  }
  stop() {
    this.gen++
    try {
      this.src?.stop()
    } catch {
      /* not started */
    }
    this.src = null
  }
  async start(programT, music) {
    this.stop()
    if (!music) return
    const gen = this.gen
    const { buffer } = await loadAudio(music.src)
    if (gen !== this.gen) return
    const ac = audioContext()
    if (ac.state === 'suspended') await ac.resume()
    if (gen !== this.gen) return
    const end = music.offset + music.len
    if (programT >= end) return
    const src = ac.createBufferSource()
    src.buffer = buffer
    const gain = ac.createGain()
    src.connect(gain).connect(ac.destination)
    const now = ac.currentTime + 0.02
    scheduleEnvelope(gain, music, programT, now)
    if (programT >= music.offset) {
      src.start(now, music.trim + (programT - music.offset), end - programT)
    } else {
      src.start(now + (music.offset - programT), music.trim, music.len)
    }
    this.src = src
  }
}

// The whole program's audio as one buffer (what the MP4 gets).
export async function renderProgramAudio(music, totalSeconds, sampleRate = 48000, channels = 2) {
  const { buffer } = await loadAudio(music.src)
  const frames = Math.max(1, Math.ceil(totalSeconds * sampleRate))
  const off = new OfflineAudioContext(channels, frames, sampleRate)
  const src = off.createBufferSource()
  src.buffer = buffer
  const gain = off.createGain()
  src.connect(gain).connect(off.destination)
  scheduleEnvelope(gain, music, 0, 0)
  src.start(music.offset, music.trim, music.len)
  return off.startRendering()
}

export async function planAudioExport(music, totalSeconds) {
  if (!music || typeof AudioEncoder === 'undefined') return null
  const sampleRate = 48000
  const channels = 2
  const candidates = [
    { codec: 'mp4a.40.2', mux: 'aac', bitrate: 192000 },
    { codec: 'opus', mux: 'opus', bitrate: 128000 },
  ]
  for (const c of candidates) {
    const cfg = { codec: c.codec, sampleRate, numberOfChannels: channels, bitrate: c.bitrate }
    try {
      if ((await AudioEncoder.isConfigSupported(cfg)).supported) {
        const rendered = await renderProgramAudio(music, totalSeconds, sampleRate, channels)
        return { cfg, mux: c.mux, sampleRate, channels, rendered }
      }
    } catch {
      /* try next */
    }
  }
  return null
}

export async function encodeAudioInto(muxer, plan, onProgress) {
  const { rendered, sampleRate, channels } = plan
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => console.error('audio encoder error', e),
  })
  encoder.configure(plan.cfg)
  const total = rendered.length
  const step = 4096
  for (let i = 0; i < total; i += step) {
    const n = Math.min(step, total - i)
    const data = new Float32Array(n * channels)
    for (let c = 0; c < channels; c++) {
      rendered.copyFromChannel(data.subarray(c * n, c * n + n), Math.min(c, rendered.numberOfChannels - 1), i)
    }
    const ad = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: channels,
      timestamp: Math.round((i / sampleRate) * 1e6),
      data,
    })
    encoder.encode(ad)
    ad.close()
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
    onProgress?.(i / total)
  }
  await encoder.flush()
  encoder.close()
}
