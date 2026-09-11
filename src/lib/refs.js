// Shared escape hatches so UI outside the Canvas can reach three.js internals.
export const threeRef = { current: null }
export const controlsRef = { current: null }
export const phoneRef = { current: null }
// Set when the screen shows a video: { videoEl, draw } — draw() repaints the screen canvas texture.
export const screenMedia = { current: null }
