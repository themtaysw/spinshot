import * as THREE from 'three'

// Virtual display resolution (iPhone 15 Pro class) and geometry aspect.
export const SCREEN_W = 1179
export const SCREEN_H = 2556
const CORNER_R = 150
const ISLAND_W = 372
const ISLAND_H = 108
const ISLAND_Y = 62

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawCover(ctx, source, sw, sh, w, h) {
  const ir = sw / sh
  const cr = w / h
  let dw, dh
  if (ir > cr) {
    dh = h
    dw = h * ir
  } else {
    dw = w
    dh = w / ir
  }
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function drawPlaceholderInto(ctx, w, h) {
  const base = ctx.createLinearGradient(0, 0, 0, h)
  base.addColorStop(0, '#15151d')
  base.addColorStop(1, '#0a0a10')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  const glow1 = ctx.createRadialGradient(w * 0.25, h * 0.3, 0, w * 0.25, h * 0.3, w * 0.9)
  glow1.addColorStop(0, 'rgba(93, 108, 255, 0.55)')
  glow1.addColorStop(1, 'rgba(93, 108, 255, 0)')
  ctx.fillStyle = glow1
  ctx.fillRect(0, 0, w, h)

  const glow2 = ctx.createRadialGradient(w * 0.85, h * 0.8, 0, w * 0.85, h * 0.8, w * 0.9)
  glow2.addColorStop(0, 'rgba(255, 94, 170, 0.4)')
  glow2.addColorStop(1, 'rgba(255, 94, 170, 0)')
  ctx.fillStyle = glow2
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '600 64px -apple-system, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('Drop a screenshot', w / 2, h / 2 - 10)
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '400 44px -apple-system, system-ui, sans-serif'
  ctx.fillText('or a screen recording', w / 2, h / 2 + 62)
}

// A persistent canvas-backed texture for the device screen. Repaintable, so it
// supports both still images and per-frame video redraws.
export function createScreenPainter() {
  const canvas = document.createElement('canvas')
  canvas.width = SCREEN_W
  canvas.height = SCREEN_H
  const ctx = canvas.getContext('2d')

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8

  function paint(drawContent) {
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H)
    ctx.save()
    roundRectPath(ctx, 0, 0, SCREEN_W, SCREEN_H, CORNER_R)
    ctx.clip()
    drawContent(ctx)
    ctx.restore()
    ctx.fillStyle = '#000'
    roundRectPath(ctx, (SCREEN_W - ISLAND_W) / 2, ISLAND_Y, ISLAND_W, ISLAND_H, ISLAND_H / 2)
    ctx.fill()
    texture.needsUpdate = true
  }

  return {
    texture,
    drawPlaceholder() {
      paint((c) => drawPlaceholderInto(c, SCREEN_W, SCREEN_H))
    },
    drawImage(img) {
      paint((c) => drawCover(c, img, img.width, img.height, SCREEN_W, SCREEN_H))
    },
    drawVideo(video) {
      if (!video.videoWidth) return
      paint((c) => drawCover(c, video, video.videoWidth, video.videoHeight, SCREEN_W, SCREEN_H))
    },
    dispose() {
      texture.dispose()
    },
  }
}

export function makeGradientTexture(c1, c2) {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 1024
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 0, c.height)
  g.addColorStop(0, c1)
  g.addColorStop(1, c2)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
