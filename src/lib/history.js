import { useSyncExternalStore } from 'react'
import { useStore, SCENE_KEYS } from '../store.js'
import { useTimeline } from './timeline.js'
import { historyGate } from './refs.js'

// Undo/redo over the document state: every scene field plus the animation
// (keys, length, easing, loop). Playhead, zoom and selection are not part of it.
const TL_KEYS = ['keys', 'length', 'easing', 'loop']
const LIMIT = 120
const COALESCE_MS = 450

const h = { past: [], present: null, future: [], lastAt: 0, lastKeys: '' }
if (typeof window !== 'undefined') window.__spinshotHistory = h // dev/testing hook
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

function snapshot() {
  const s = useStore.getState()
  const t = useTimeline.getState()
  const store = {}
  for (const k of SCENE_KEYS) store[k] = s[k]
  const tl = {}
  for (const k of TL_KEYS) tl[k] = t[k]
  return { store, tl }
}

function changedKeys(a, b) {
  const out = []
  for (const k of SCENE_KEYS) if (a.store[k] !== b.store[k]) out.push(k)
  for (const k of TL_KEYS) if (a.tl[k] !== b.tl[k]) out.push('tl.' + k)
  return out
}

function onChange() {
  if (historyGate.suspend > 0 || !h.present) return
  const next = snapshot()
  const changed = changedKeys(h.present, next)
  if (!changed.length) return
  const key = changed.join(',')
  const now = performance.now()
  // a slider drag or a typing burst becomes one undo step
  const coalesce = now - h.lastAt < COALESCE_MS && key === h.lastKeys
  if (!coalesce) {
    h.past.push(h.present)
    if (h.past.length > LIMIT) h.past.shift()
    h.future = []
  }
  h.present = next
  h.lastAt = now
  h.lastKeys = key
  notify()
}

let inited = false
export function initHistory() {
  if (inited) return
  inited = true
  h.present = snapshot()
  useStore.subscribe(onChange)
  useTimeline.subscribe(onChange)
}

// forget everything (new sequence / project opened)
export function resetHistory() {
  h.past = []
  h.future = []
  h.present = snapshot()
  h.lastAt = 0
  h.lastKeys = ''
  notify()
}

export function suspendHistory(fn) {
  historyGate.suspend++
  try {
    fn()
  } finally {
    historyGate.suspend--
  }
}

function apply(snap) {
  suspendHistory(() => {
    useStore.setState(snap.store)
    useTimeline.setState({ ...snap.tl, playing: false })
  })
  h.lastAt = 0
  h.lastKeys = ''
}

export function undo() {
  if (!h.past.length) return false
  h.future.push(h.present)
  h.present = h.past.pop()
  apply(h.present)
  notify()
  return true
}

export function redo() {
  if (!h.future.length) return false
  h.past.push(h.present)
  h.present = h.future.pop()
  apply(h.present)
  notify()
  return true
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const getSnap = () => `${h.past.length}:${h.future.length}`

export function useHistoryState() {
  useSyncExternalStore(subscribe, getSnap)
  return { canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
