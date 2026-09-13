import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore, FINISHES } from '../store.js'
import { createScreenPainter, SCREEN_W, SCREEN_H } from '../lib/screenTexture.js'
import { phoneRef, screenMedia } from '../lib/refs.js'
import { useTimeline, registerMediaDuration, renderTime } from '../lib/timeline.js'
import { programLength, sourceAt } from '../lib/clips.js'
import { deviceStateAt } from '../lib/scenes.js'

const BODY_W = 0.72
const BODY_H = 1.5
const BODY_R = 0.115
const BODY_D = 0.045
const BEVEL = 0.016
const FRONT_Z = BODY_D / 2 + BEVEL

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  return s
}

export default function Phone() {
  const finish = useStore((s) => s.finish)
  const screenSrc = useStore((s) => s.screenSrc)
  const screenType = useStore((s) => s.screenType)
  const rotX = useStore((s) => s.rotX)
  const rotY = useStore((s) => s.rotY)
  const rotZ = useStore((s) => s.rotZ)
  const posX = useStore((s) => s.posX)
  const posY = useStore((s) => s.posY)
  const posZ = useStore((s) => s.posZ)
  const colors = FINISHES[finish] || FINISHES.natural

  const painter = useMemo(() => createScreenPainter(), [])
  const media = useStore((s) => s.media)
  const videosRef = useRef(new Map()) // media id -> <video>
  const stageRef = useRef(null) // scene intro/outro transform wrapper
  const matsRef = useRef([]) // materials with their base opacity, for fades
  const lastAlphaRef = useRef(1)

  // collect materials once the phone exists (and again when the finish changes)
  useEffect(() => {
    const list = []
    phoneRef.current?.traverse((o) => {
      if (o.material) {
        const m = o.material
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity
          m.userData.baseTransparent = m.transparent
        }
        list.push(m)
      }
    })
    matsRef.current = list
    lastAlphaRef.current = -1
  }, [finish])

  // scene visibility: on/off stage with intro/outro animation
  useFrame(() => {
    const st = deviceStateAt(useStore.getState().deviceSegs, renderTime())
    const g = stageRef.current
    if (!g) return
    g.visible = st.visible && st.alpha > 0.01
    g.position.set(st.dx, st.dy, 0)
    g.scale.setScalar(st.scale)
    const alpha = Math.min(1, Math.max(0, st.alpha))
    if (Math.abs(alpha - lastAlphaRef.current) > 0.002) {
      lastAlphaRef.current = alpha
      for (const m of matsRef.current) {
        if (alpha < 0.999) {
          m.transparent = true
          m.opacity = m.userData.baseOpacity * alpha
        } else {
          m.transparent = m.userData.baseTransparent
          m.opacity = m.userData.baseOpacity
        }
      }
    }
  })

  useEffect(() => () => painter.dispose(), [painter])

  // stills and the placeholder
  useEffect(() => {
    if (screenType === 'video') return
    if (!screenSrc) {
      painter.drawPlaceholder()
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) painter.drawImage(img)
    }
    img.src = screenSrc
    return () => {
      cancelled = true
    }
  }, [screenSrc, screenType, painter])

  // one <video> per imported recording; the timeline decides which one shows
  useEffect(() => {
    const vids = videosRef.current
    for (const [id, v] of vids) {
      if (!media.find((m) => m.id === id)) {
        v.pause()
        v.src = ''
        vids.delete(id)
      }
    }
    for (const m of media) {
      if (vids.has(m.id)) continue
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.src = m.src
      const register = () => {
        if (!isFinite(video.duration) || video.duration <= 0) return false
        registerMediaDuration(m.id, video.duration)
        video.currentTime = 0
        return true
      }
      video.addEventListener('loadeddata', () => {
        if (!vids.has(m.id)) return
        if (!register()) {
          // WebM recordings report Infinity until seeked to the end once
          video.addEventListener('durationchange', () => vids.has(m.id) && register(), { once: true })
          video.currentTime = 1e101
        }
      })
      vids.set(m.id, video)
    }
    if (screenType === 'video' && !media.length) painter.drawPlaceholder()
    screenMedia.current = media.length
      ? {
          videos: vids,
          videoAt: (t) => {
            const at = sourceAt(useStore.getState().clips, t)
            return at ? vids.get(at.mediaId) || null : null
          },
          draw: (t) => {
            const v = screenMedia.current?.videoAt(t ?? useTimeline.getState().t)
            if (v && v.readyState >= 2) painter.drawVideo(v)
          },
        }
      : null
  }, [media, screenType, painter])

  // Keep the screen video locked to the timeline: play/pause with it, follow
  // scrubbing, and correct drift. (Exports seek explicitly and skip this.)
  useFrame(() => {
    const { exportingVideo, clips, media: list } = useStore.getState()
    if (exportingVideo || !list.length || !clips.length) return
    const tl = useTimeline.getState()
    const at = sourceAt(clips, tl.t)
    if (!at) return
    const video = videosRef.current.get(at.mediaId)
    const m = list.find((x) => x.id === at.mediaId)
    // not registered yet (duration still resolving) — don't fight the setup seeks
    if (!video || video.readyState < 2 || !m?.dur || !isFinite(video.duration)) return
    for (const [id, v] of videosRef.current) if (id !== at.mediaId && !v.paused) v.pause()
    const dur = video.duration
    const progLen = programLength(clips)
    const src = Math.min(at.src, Math.max(0, dur - 0.001))
    const speed = at.clip.speed || 1
    if (tl.playing && tl.t < progLen) {
      if (video.playbackRate !== speed) video.playbackRate = speed
      if (video.paused) video.play().catch(() => {})
      if (Math.abs(video.currentTime - src) > 0.12 * speed + 0.05) video.currentTime = src
    } else {
      if (!video.paused) video.pause()
      if (Math.abs(video.currentTime - src) > 0.04) video.currentTime = src
    }
    painter.drawVideo(video)
  })

  const bodyGeo = useMemo(() => {
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(BODY_W, BODY_H, BODY_R), {
      depth: BODY_D,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 6,
      curveSegments: 32,
    })
    geo.translate(0, 0, -BODY_D / 2)
    return geo
  }, [])

  const frontGlassGeo = useMemo(
    () => new THREE.ShapeGeometry(roundedRectShape(BODY_W - 0.006, BODY_H - 0.006, BODY_R - 0.003), 32),
    []
  )

  const screenH = BODY_H - 0.05
  const screenW = screenH / (SCREEN_H / SCREEN_W)

  const islandGeo = useMemo(() => {
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(0.3, 0.3, 0.09), {
      depth: 0.012,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 3,
      curveSegments: 24,
    })
    return geo
  }, [])

  const lensPositions = [
    [-0.065, 0.065, 0],
    [-0.065, -0.065, 0],
    [0.065, 0, 0],
  ]

  return (
    <group ref={stageRef}>
    <group
      ref={(g) => {
        phoneRef.current = g
      }}
      rotation={[THREE.MathUtils.degToRad(rotX), THREE.MathUtils.degToRad(rotY), THREE.MathUtils.degToRad(rotZ)]}
      position={[posX || 0, posY || 0, posZ || 0]}
    >
      {/* Titanium frame + body */}
      <mesh geometry={bodyGeo} castShadow>
        <meshStandardMaterial color={colors.frame} metalness={0.85} roughness={0.35} />
      </mesh>

      {/* Back glass */}
      <mesh position={[0, 0, -(FRONT_Z + 0.0006)]} rotation={[0, Math.PI, 0]}>
        <shapeGeometry args={[roundedRectShape(BODY_W - 0.006, BODY_H - 0.006, BODY_R - 0.003), 32]} />
        <meshStandardMaterial color={colors.back} metalness={0.2} roughness={0.42} />
      </mesh>

      {/* Front glass */}
      <mesh geometry={frontGlassGeo} position={[0, 0, FRONT_Z + 0.0006]}>
        <meshStandardMaterial color="#050506" metalness={0.4} roughness={0.28} />
      </mesh>

      {/* Screen */}
      <mesh position={[0, 0, FRONT_Z + 0.0018]}>
        <planeGeometry args={[screenW, screenH]} />
        <meshBasicMaterial map={painter.texture} transparent toneMapped={false} />
      </mesh>

      {/* Screen glass sheen */}
      <mesh position={[0, 0, FRONT_Z + 0.0026]}>
        <planeGeometry args={[screenW, screenH]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.06}
          roughness={0.05}
          metalness={0}
          color="#ffffff"
          depthWrite={false}
        />
      </mesh>

      {/* Camera island */}
      <group position={[BODY_W / 2 - 0.19, BODY_H / 2 - 0.19, -(FRONT_Z + 0.011)]}>
        <mesh geometry={islandGeo}>
          <meshStandardMaterial color={colors.back} metalness={0.3} roughness={0.4} />
        </mesh>
        {lensPositions.map((p, i) => (
          <group key={i} position={[p[0], p[1], -0.008]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.016, 32]} />
              <meshStandardMaterial color="#2a2a2e" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.009]}>
              <cylinderGeometry args={[0.038, 0.038, 0.004, 32]} />
              <meshPhysicalMaterial color="#0a0a1a" metalness={0.1} roughness={0.05} clearcoat={1} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Side buttons */}
      <mesh position={[BODY_W / 2 + BEVEL, 0.28, 0]}>
        <boxGeometry args={[0.012, 0.16, 0.03]} />
        <meshStandardMaterial color={colors.frame} metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[-(BODY_W / 2 + BEVEL), 0.32, 0]}>
        <boxGeometry args={[0.012, 0.1, 0.03]} />
        <meshStandardMaterial color={colors.frame} metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[-(BODY_W / 2 + BEVEL), 0.17, 0]}>
        <boxGeometry args={[0.012, 0.1, 0.03]} />
        <meshStandardMaterial color={colors.frame} metalness={0.85} roughness={0.35} />
      </mesh>
    </group>
    </group>
  )
}
