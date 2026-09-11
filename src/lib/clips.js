// The "program" timeline is a sequence of clips cut from the source recording.
// clip: { srcStart, srcEnd, speed } in source seconds; its program duration is
// (srcEnd - srcStart) / speed. Every edit returns the new clip list plus a
// remap(oldProgramTime) -> newProgramTime | null so keyframes can ripple along.

export const MIN_CLIP = 0.1

export const clipDur = (c) => (c.srcEnd - c.srcStart) / c.speed

export function programLength(clips) {
  return clips.reduce((a, c) => a + clipDur(c), 0)
}

export function clipStarts(clips) {
  const out = []
  let acc = 0
  for (const c of clips) {
    out.push(acc)
    acc += clipDur(c)
  }
  return out
}

export function clipAt(clips, t) {
  let acc = 0
  for (let i = 0; i < clips.length; i++) {
    const d = clipDur(clips[i])
    if (t < acc + d || i === clips.length - 1) return { index: i, start: acc, end: acc + d, clip: clips[i] }
    acc += d
  }
  return null
}

export function programToSource(clips, t) {
  if (!clips.length) return t
  let acc = 0
  for (const c of clips) {
    const d = clipDur(c)
    if (t < acc + d) return c.srcStart + Math.max(0, t - acc) * c.speed
    acc += d
  }
  const last = clips[clips.length - 1]
  return Math.max(last.srcStart, last.srcEnd - 0.001)
}

export function defaultClips(srcDur, trim = 0) {
  return [{ srcStart: Math.min(trim, Math.max(0, srcDur - MIN_CLIP)), srcEnd: srcDur, speed: 1 }]
}

export function isTrivial(clips, srcDur) {
  return (
    clips.length === 1 &&
    clips[0].speed === 1 &&
    clips[0].srcStart <= 0.01 &&
    clips[0].srcEnd >= srcDur - 0.01
  )
}

const identity = (t) => t

export function splitAt(clips, t) {
  const hit = clipAt(clips, t)
  if (!hit) return { clips, remap: identity }
  const { index, start, clip } = hit
  const src = clip.srcStart + (t - start) * clip.speed
  if (src - clip.srcStart < MIN_CLIP * clip.speed || clip.srcEnd - src < MIN_CLIP * clip.speed) {
    return { clips, remap: identity }
  }
  const next = clips.slice()
  next.splice(index, 1, { ...clip, srcEnd: src }, { ...clip, srcStart: src })
  return { clips: next, remap: identity }
}

export function deleteClip(clips, index) {
  if (clips.length <= 1) return { clips, remap: identity }
  const starts = clipStarts(clips)
  const a = starts[index]
  const b = a + clipDur(clips[index])
  const next = clips.filter((_, i) => i !== index)
  return {
    clips: next,
    remap: (t) => (t < a ? t : t < b ? null : t - (b - a)),
  }
}

export function setSpeed(clips, index, speed) {
  const starts = clipStarts(clips)
  const a = starts[index]
  const d = clipDur(clips[index])
  const next = clips.map((c, i) => (i === index ? { ...c, speed } : c))
  const d2 = clipDur(next[index])
  return {
    clips: next,
    remap: (t) => (t < a ? t : t < a + d ? a + (t - a) * (d2 / d) : t + (d2 - d)),
  }
}

// Move one edge of a clip to a new program time (as measured on the *current*
// program), extending into unused source footage when there's room.
export function trimClip(clips, index, edge, newT, srcDur) {
  const starts = clipStarts(clips)
  const c = clips[index]
  const a = starts[index]
  const b = a + clipDur(c)
  const next = clips.slice()

  if (edge === 'start') {
    const minT = a - c.srcStart / c.speed // can't go before source 0
    const maxT = b - MIN_CLIP
    const nt = Math.min(maxT, Math.max(minT, newT))
    next[index] = { ...c, srcStart: c.srcStart + (nt - a) * c.speed }
    const shift = nt - a
    return {
      clips: next,
      remap:
        shift > 0
          ? (t) => (t < a ? t : t < nt ? null : t - shift)
          : (t) => (t < a ? t : t - shift),
    }
  }

  const maxT = b + (srcDur - c.srcEnd) / c.speed
  const minT = a + MIN_CLIP
  const nt = Math.min(maxT, Math.max(minT, newT))
  next[index] = { ...c, srcEnd: c.srcEnd + (nt - b) * c.speed }
  const shift = nt - b
  return {
    clips: next,
    remap:
      shift < 0
        ? (t) => (t < nt ? t : t < b ? null : t + shift)
        : (t) => (t < b ? t : t + shift),
  }
}

export function remapKeys(keys, remap) {
  const out = []
  for (const k of keys) {
    const nt = remap(k.t)
    if (nt === null || nt === undefined) continue
    out.push({ ...k, t: Math.round(nt * 1000) / 1000 })
  }
  out.sort((x, y) => x.t - y.t)
  // drop keys that collapsed onto each other
  return out.filter((k, i) => i === 0 || k.t - out[i - 1].t > 0.02)
}
