// Turns a Claude storyboard plan into a real, editable timeline.
import { useStore } from '../store.js'
import { useTimeline, syncLengthToProgram, fitTexts } from './timeline.js'
import { threeRef, controlsRef } from './refs.js'
import { makeText, makeBadge, STYLES, isLightColor, newTextId } from './textRender.js'
import { makeDeviceSeg, makeBgKey } from './scenes.js'
import { programLength } from './clips.js'

const r2 = (v) => Math.round(v * 100) / 100

export function applyPlan(plan) {
  const s = useStore.getState()
  const media = s.media
  const hasVideo = s.screenType === 'video' && media.length > 0
  const scenes = (plan.scenes || []).filter((sc) => sc && sc.duration > 0)
  if (!scenes.length) throw new Error('The plan had no scenes')

  const clips = []
  const segs = []
  const bgKeys = []
  const texts = []
  const keys = []
  const used = {} // filler-footage cursor per recording
  let t = 0

  const cameraKey = (time, rotY) => {
    const three = threeRef.current
    const controls = controlsRef.current
    if (!three || !controls) return null
    return {
      t: r2(time),
      camPos: three.camera.position.toArray(),
      target: controls.target.toArray(),
      fov: s.fov,
      rot: [0, rotY, 0],
      pos: [0, 0, 0],
    }
  }

  scenes.forEach((sc, i) => {
    let dur = Math.min(6, Math.max(1.5, sc.duration))
    const start = t

    if (hasVideo) {
      let m = media.find((x) => x.id === sc.mediaId)
      let a = sc.srcStart
      let b = sc.srcEnd
      const valid = sc.kind === 'phone' && m && a != null && b != null && b - a >= 0.5 && a >= 0 && b <= m.dur + 0.05
      if (!valid) {
        // any footage will do behind a text scene (the phone is off stage), or when the plan's pick is unusable
        m = media.reduce((best, x) => ((used[x.id] || 0) < x.dur - 0.5 && (!best || (used[x.id] || 0) < (used[best.id] || 0)) ? x : best), null) || media[0]
        a = Math.min(used[m.id] || 0, Math.max(0, m.dur - dur))
        b = Math.min(m.dur, a + dur)
      }
      b = Math.min(b, m.dur)
      dur = Math.max(0.5, Math.min(dur, b - a))
      b = a + dur
      used[m.id] = Math.max(used[m.id] || 0, b)
      clips.push({ mediaId: m.id, srcStart: r2(a), srcEnd: r2(b), speed: 1 })
    }

    const end = start + dur
    const light = isLightColor(sc.bgColor1)

    if (sc.kind === 'phone') {
      segs.push(makeDeviceSeg(r2(start), r2(end), { intro: i === 0 ? 'cut' : 'rise', outro: i === scenes.length - 1 ? 'cut' : 'fade' }))
      const k1 = cameraKey(start, -18)
      const k2 = cameraKey(end, 4)
      if (k1 && k2) keys.push(k1, k2)
    }

    bgKeys.push(
      makeBgKey(
        r2(start),
        { bgType: 'gradient', bgColor1: sc.bgColor1 || '#ffffff', bgColor2: sc.bgColor2 || sc.bgColor1 || '#ffffff' },
        { transition: i === 0 ? 'cut' : 'fade', dur: 0.5 }
      )
    )

    const titleY = sc.kind === 'text' ? 0.42 : 0.13
    const title = {
      ...makeText({ t: start + 0.1, length: 1e9, light }),
      text: sc.headline || '',
      anim: sc.reveal || 'fade-up',
      inDur: 0.7,
      outDur: 0.35,
      y: titleY,
      end: r2(Math.max(start + 0.6, end - 0.15)),
    }
    title.start = r2(start + 0.1)
    if (title.text.trim()) texts.push(title)

    if (sc.subline && sc.subline.trim()) {
      const { label, ...sub } = STYLES.subtitle
      texts.push({
        ...makeText({ t: start + 0.4, length: 1e9, light }),
        ...sub,
        id: newTextId(),
        text: sc.subline,
        y: titleY + STYLES.title.size * STYLES.title.lineHeight * 0.5 + sub.size * 1.15,
        color: light ? '#5c5c66' : '#c9c9d4',
        start: r2(start + 0.4),
        end: r2(Math.max(start + 0.8, end - 0.15)),
        anim: 'fade-up',
        inDur: 0.7,
        outDur: 0.35,
      })
    }

    if (sc.badge && sc.badge.trim()) {
      texts.push({
        ...makeBadge({ t: start + 0.25, length: 1e9, light }),
        text: sc.badge,
        y: sc.kind === 'text' ? 0.3 : 0.06,
        start: r2(start + 0.25),
        end: r2(Math.max(start + 0.8, end - 0.15)),
      })
    }

    t = end
  })

  useStore.setState({
    clips: hasVideo ? clips : s.clips,
    deviceSegs: segs.length || hasVideo ? segs : [],
    bgKeys,
    texts: fitTexts(texts),
    bgType: 'gradient',
    bgColor1: scenes[0].bgColor1 || s.bgColor1,
    bgColor2: scenes[0].bgColor2 || s.bgColor2,
  })
  useTimeline.setState({
    keys: keys.sort((a, b) => a.t - b.t),
    length: hasVideo ? Math.round(programLength(clips) * 100) / 100 : r2(t),
    t: 0,
    playing: false,
    easing: 'ease',
    selectedClip: null,
    selectedText: null,
    selectedDevice: null,
  })
  if (hasVideo) syncLengthToProgram()
  return { scenes: scenes.length, seconds: r2(t) }
}
