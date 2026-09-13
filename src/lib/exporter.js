import { threeRef } from './refs.js'
import { useStore, getAspect } from '../store.js'
import { useTimeline } from './timeline.js'
import { compositeFrame, renderLocale } from './textRender.js'

export function exportDims() {
  const s = useStore.getState()
  const a = getAspect(s)
  const short = s.exportRes
  const w = a.w <= a.h ? short : Math.round((short * a.w) / a.h)
  const h = a.w <= a.h ? Math.round((short * a.h) / a.w) : short
  return { w, h }
}

export async function exportCurrentPNG() {
  const { w, h } = exportDims()
  const dataURL = await exportPNG({ width: w, height: h, transparent: useStore.getState().bgType === 'transparent' })
  const res = await saveDataURL(dataURL, `spinshot-${w}x${h}.png`)
  return { ...res, w, h }
}

export async function exportPNG({ width, height, transparent }) {
  const three = threeRef.current
  if (!three) throw new Error('Renderer not ready')
  const { gl, scene, camera, size, viewport } = three

  const prevPR = gl.getPixelRatio()
  const prevBg = scene.background
  const prevAspect = camera.aspect

  try {
    if (transparent) scene.background = null
    gl.setPixelRatio(1)
    gl.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    gl.render(scene, camera)
    const { texts } = useStore.getState()
    renderLocale.current = useStore.getState().activeLocale || 'base'
    const tl = useTimeline.getState()
    const src = texts.length ? compositeFrame(gl.domElement, texts, Math.min(tl.t, tl.length), width, height) : gl.domElement
    return src.toDataURL('image/png')
  } finally {
    scene.background = prevBg
    gl.setPixelRatio(prevPR)
    gl.setSize(size.width, size.height, false)
    camera.aspect = prevAspect
    camera.updateProjectionMatrix()
    gl.render(scene, camera)
  }
}

export async function saveDataURL(dataURL, name) {
  if (window.spinshot?.savePNG) {
    return window.spinshot.savePNG(dataURL, name)
  }
  const a = document.createElement('a')
  a.href = dataURL
  a.download = name
  a.click()
  return { saved: true }
}

export async function saveText(text, name) {
  if (window.spinshot?.saveText) {
    return window.spinshot.saveText(text, name)
  }
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return { saved: true }
}
