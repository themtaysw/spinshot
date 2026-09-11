import { create } from 'zustand'
import * as THREE from 'three'
import { threeRef, controlsRef, phoneRef } from './refs.js'
import { useStore } from '../store.js'
import * as Clips from './clips.js'

// When looping, the animation eases back to its start pose over this many
// seconds instead of snapping — playback and exports both include it.
export const LOOP_RETURN = 1

export const useTimeline = create((set) => ({
  keys: [],
  t: 0,
  length: 6,
  playing: false,
  easing: 'ease', // 'ease' | 'linear'
  loop: true,
  autoKey: true,
  zoom: 1, // 1 = whole timeline fits the track width
  selectedClip: null, // index into store.clips
  set: (p) => set(p),
}))

export const MAX_LENGTH = 3600

// With a video loaded, the timeline length is the edited program's length.
export function syncLengthToProgram() {
  const { clips, screenType, screenSrc } = useStore.getState()
  if (screenType !== 'video' || !screenSrc || !clips.length) return
  const length = Math.max(Clips.MIN_CLIP, Math.round(Clips.programLength(clips) * 100) / 100)
  const tl = useTimeline.getState()
  useTimeline.setState({ length, t: Math.min(tl.t, length) })
}

function applyClipEdit(result) {
  const { clips, remap } = result
  const tl = useTimeline.getState()
  useStore.setState({ clips })
  const keys = Clips.remapKeys(tl.keys, remap)
  useTimeline.setState({ keys })
  syncLengthToProgram()
  const nt = remap(tl.t)
  const length = useTimeline.getState().length
  const t = Math.min(length, nt === null || nt === undefined ? tl.t : nt)
  useTimeline.setState({ t, playing: false })
  applySample(t)
}

export function editSplitAtPlayhead() {
  const { clips } = useStore.getState()
  if (!clips.length) return
  applyClipEdit(Clips.splitAt(clips, useTimeline.getState().t))
}

export function editDeleteClip(index) {
  const { clips } = useStore.getState()
  if (index == null || !clips[index] || clips.length < 2) return
  applyClipEdit(Clips.deleteClip(clips, index))
  useTimeline.setState({ selectedClip: null })
}

export function editSetSpeed(index, speed) {
  const { clips } = useStore.getState()
  if (!clips[index]) return
  applyClipEdit(Clips.setSpeed(clips, index, speed))
}

// Drag-trimming works from a snapshot taken at pointer-down so each move is idempotent.
export function editTrimFromSnapshot(snapshot, index, edge, newT) {
  const srcDur = useStore.getState().videoDur || Infinity
  const result = Clips.trimClip(snapshot.clips, index, edge, newT, srcDur)
  useStore.setState({ clips: result.clips })
  useTimeline.setState({ keys: Clips.remapKeys(snapshot.keys, result.remap) })
  syncLengthToProgram()
  const tl = useTimeline.getState()
  const t = Math.min(tl.length, snapshot.t)
  useTimeline.setState({ t, playing: false })
  applySample(t)
}

export function cycleLength() {
  const { length, loop, keys } = useTimeline.getState()
  return loop && keys.length >= 2 ? length + LOOP_RETURN : length
}

const EPS = 0.06
const rad = THREE.MathUtils.degToRad

function currentPose() {
  const three = threeRef.current
  const controls = controlsRef.current
  if (!three || !controls) return null
  const s = useStore.getState()
  return {
    camPos: three.camera.position.toArray(),
    target: controls.target.toArray(),
    fov: s.fov,
    rot: [s.rotX, s.rotY, s.rotZ],
  }
}

export function captureKey() {
  const pose = currentPose()
  if (!pose) return
  const { t, keys, length } = useTimeline.getState()
  const kt = Math.min(t, length)
  const next = keys
    .filter((k) => Math.abs(k.t - kt) > EPS)
    .concat({ t: kt, ...pose })
    .sort((a, b) => a.t - b.t)
  useTimeline.setState({ keys: next })
}

// Rotato-style recording: called whenever the user moves the camera or the
// device while an animation exists — silently writes/updates the keyframe at
// the playhead, but only if the pose actually differs from the animation.
export function autoCaptureKey() {
  const { autoKey, keys, t, playing } = useTimeline.getState()
  if (!autoKey || keys.length === 0 || playing) return
  const pose = currentPose()
  if (!pose) return
  const s = sample(t)
  if (s) {
    const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    const rotDiff = Math.max(...pose.rot.map((v, i) => Math.abs(v - s.rot[i])))
    if (
      d3(pose.camPos, s.camPos) < 0.004 &&
      d3(pose.target, s.target) < 0.004 &&
      Math.abs(pose.fov - s.fov) < 0.15 &&
      rotDiff < 0.25
    )
      return
  }
  captureKey()
}

export function deleteKeyNear(t) {
  const { keys } = useTimeline.getState()
  if (!keys.length) return
  let best = 0
  for (let i = 1; i < keys.length; i++) if (Math.abs(keys[i].t - t) < Math.abs(keys[best].t - t)) best = i
  useTimeline.setState({ keys: keys.filter((_, i) => i !== best) })
}

function easeU(u, mode) {
  return mode === 'linear' ? u : u * u * (3 - 2 * u)
}

const shortestAngle = (a, b) => a + (((b - a + 180) % 360 + 360) % 360 - 180)

export function sample(t) {
  const { keys, easing, loop, length } = useTimeline.getState()
  if (!keys.length) return null

  // Loop-return segment: ease from the end pose back to the first keyframe.
  if (loop && keys.length >= 2 && t > length) {
    const end = sampleAt(length, keys, easing)
    const start = keys[0]
    const u = easeU(Math.min(1, (t - length) / LOOP_RETURN), 'ease')
    const lerpA = (p, q) => p.map((v, j) => v + (q[j] - v) * u)
    return {
      camPos: lerpA(end.camPos, start.camPos),
      target: lerpA(end.target, start.target),
      fov: end.fov + (start.fov - end.fov) * u,
      // rotations take the shortest path so a 360° spin doesn't unwind
      rot: end.rot.map((v, j) => {
        const goal = shortestAngle(v, start.rot[j])
        return v + (goal - v) * u
      }),
    }
  }

  return sampleAt(t, keys, easing)
}

function sampleAt(t, keys, easing) {
  if (t <= keys[0].t) return keys[0]
  const last = keys[keys.length - 1]
  if (t >= last.t) return last
  let i = 0
  while (keys[i + 1].t < t) i++
  const a = keys[i]
  const b = keys[i + 1]
  const u = easeU((t - a.t) / (b.t - a.t), easing)
  const lerpA = (p, q) => p.map((v, j) => v + (q[j] - v) * u)
  return {
    camPos: lerpA(a.camPos, b.camPos),
    target: lerpA(a.target, b.target),
    fov: a.fov + (b.fov - a.fov) * u,
    rot: lerpA(a.rot, b.rot),
  }
}

export function applySample(t) {
  const s = sample(t)
  if (!s) return
  const three = threeRef.current
  const controls = controlsRef.current
  const phone = phoneRef.current
  if (!three) return
  three.camera.position.fromArray(s.camPos)
  three.camera.fov = s.fov
  three.camera.updateProjectionMatrix()
  if (controls) {
    controls.target.fromArray(s.target)
    controls.update()
  }
  // set the group directly (immediate, for deterministic export renders)…
  if (phone) phone.rotation.set(rad(s.rot[0]), rad(s.rot[1]), rad(s.rot[2]))
  // …and mirror into the store so the sliders track the animation
  const r = (v) => Math.round(v * 10) / 10
  useStore.setState({ rotX: r(s.rot[0]), rotY: r(s.rot[1]), rotZ: r(s.rot[2]), fov: r(s.fov) })
}

export const PRESETS = {
  spin: 'Hero spin',
  orbit: 'Orbit',
  dolly: 'Dolly in',
  sway: 'Sway',
}

export function applyPreset(name) {
  const pose = currentPose()
  if (!pose) return
  const { camPos, target, fov, rot } = pose
  const mk = (t, c, tg, f, r) => ({ t, camPos: c, target: tg, fov: f, rot: r })
  let keys = []
  let length = 6
  let easing = 'ease'

  if (name === 'spin') {
    easing = 'linear'
    keys = [
      mk(0, camPos, target, fov, rot),
      mk(length, camPos, target, fov, [rot[0], rot[1] + 360, rot[2]]),
    ]
  } else if (name === 'orbit') {
    easing = 'linear'
    const off = [camPos[0] - target[0], camPos[1] - target[1], camPos[2] - target[2]]
    const r0 = Math.hypot(off[0], off[2])
    const a0 = Math.atan2(off[0], off[2])
    const sweep = (Math.PI * 2) / 3
    const N = 12
    keys = Array.from({ length: N + 1 }, (_, i) => {
      const a = a0 - sweep / 2 + (sweep * i) / N
      return mk(
        (length * i) / N,
        [target[0] + Math.sin(a) * r0, camPos[1], target[2] + Math.cos(a) * r0],
        target,
        fov,
        rot
      )
    })
  } else if (name === 'dolly') {
    length = 5
    const near = camPos.map((v, i) => target[i] + (v - target[i]) * 0.55)
    keys = [mk(0, camPos, target, fov, rot), mk(length, near, target, fov, rot)]
  } else if (name === 'sway') {
    keys = [
      mk(0, camPos, target, fov, [rot[0], rot[1] - 16, rot[2]]),
      mk(length / 2, camPos, target, fov, [rot[0], rot[1] + 16, rot[2]]),
      mk(length, camPos, target, fov, [rot[0], rot[1] - 16, rot[2]]),
    ]
  }
  useTimeline.setState({ keys, length, easing, t: 0, playing: false })
  applySample(0)
}
