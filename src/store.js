import { create } from 'zustand'

export const ASPECTS = {
  '1:1': { w: 1, h: 1, label: 'Square' },
  '4:5': { w: 4, h: 5, label: 'Portrait' },
  '9:16': { w: 9, h: 16, label: 'Story' },
  '16:9': { w: 16, h: 9, label: 'Wide' },
}

export const FINISHES = {
  natural: { label: 'Natural', frame: '#a8a29a', back: '#c9c3b8' },
  blue: { label: 'Blue', frame: '#3f4859', back: '#525d72' },
  white: { label: 'White', frame: '#d9d7d2', back: '#efede8' },
  black: { label: 'Black', frame: '#37373a', back: '#1f1f22' },
}

export const LIGHT_PRESETS = {
  studio: 'Studio',
  soft: 'Soft',
  dramatic: 'Dramatic',
}

const initialScene = {
  screenSrc: null,
  screenType: 'image', // 'image' | 'video'
  videoTrim: 0, // legacy (pre-clip-editor) start offset; converted into clips on load
  clips: [], // edited program: [{ srcStart, srcEnd, speed }] — empty = whole recording
  bakeTrim: true, // project save keeps only the edited video
  finish: 'natural',
  rotX: 0,
  rotY: -22,
  rotZ: 0,
  fov: 30,
  bgType: 'solid', // transparent | solid | gradient | image
  bgColor1: '#ffffff',
  bgColor2: '#c7d0e2',
  bgImage: null,
  lightPreset: 'studio',
  lightIntensity: 1,
  shadow: false,
  reflection: false,
  aspect: '4:5',
}

export const useStore = create((set) => ({
  ...initialScene,
  exportRes: 1080, // short side in px
  exportingVideo: false,
  videoDur: 0, // runtime: duration of the loaded screen video
  pendingFit: false, // runtime: fit the timeline to the next loaded video (user drop, not project open)
  videoFormat: 'mp4', // 'mp4' | 'frames'
  videoFps: 30,
  set: (patch) => set(patch),
  reset: () => set({ ...initialScene }),
}))

export const SCENE_KEYS = Object.keys(initialScene)

export function serializeScene(state, timeline) {
  const out = {}
  for (const k of SCENE_KEYS) out[k] = state[k]
  // videos are blob URLs — they can't survive a save file, so drop them
  if (out.screenType === 'video') {
    out.screenSrc = null
    out.screenType = 'image'
  }
  const tl = timeline
    ? { keys: timeline.keys, length: timeline.length, easing: timeline.easing, loop: timeline.loop }
    : null
  return JSON.stringify({ app: 'spinshot', version: 1, scene: out, timeline: tl }, null, 2)
}

export function deserializeScene(text) {
  const data = JSON.parse(text)
  if (data.app !== 'spinshot' || !data.scene) throw new Error('Not a Spinshot scene file')
  const patch = {}
  for (const k of SCENE_KEYS) if (k in data.scene) patch[k] = data.scene[k]
  return { scene: patch, timeline: data.timeline || null }
}
