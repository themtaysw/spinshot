// Shared escape hatches so UI outside the Canvas can reach three.js internals.
export const threeRef = { current: null }
export const controlsRef = { current: null }
export const phoneRef = { current: null }
// Set when the screen shows video: { videos: Map<id, <video>>, videoAt(t), draw(t) } — draw() repaints the screen texture.
export const screenMedia = { current: null }
// >0 while state is being written by playback/scrubbing/undo — history must not record it
export const historyGate = { suspend: 0 }
// program time of the frame being rendered (set by applySample; exports drive it frame by frame)
export const frameTime = { current: 0 }
