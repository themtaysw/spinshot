import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useStore, FINISHES } from '../store.js'
import { createScreenPainter, SCREEN_W, SCREEN_H } from '../lib/screenTexture.js'
import { phoneRef, screenMedia } from '../lib/refs.js'
import { useTimeline, syncLengthToProgram } from '../lib/timeline.js'
import { programToSource, programLength, clipAt, defaultClips } from '../lib/clips.js'

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
  const colors = FINISHES[finish] || FINISHES.natural

  const painter = useMemo(() => createScreenPainter(), [])
  const videoRef = useRef(null)

  useEffect(() => () => painter.dispose(), [painter])

  useEffect(() => {
    let cancelled = false
    // tear down any previous video
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.src = ''
      videoRef.current = null
      screenMedia.current = null
    }
    if (!screenSrc) {
      painter.drawPlaceholder()
      return
    }
    if (screenType === 'video') {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.src = screenSrc
      // the screen video is driven by the timeline — fit the timeline to it
      // (only on a fresh user drop; opening a project keeps its saved timeline)
      const applyDuration = () => {
        if (!isFinite(video.duration) || video.duration <= 0) return false
        const dur = video.duration
        const s = useStore.getState()
        // ensure an edited program exists (fresh drop, legacy trim, or clamp a saved one)
        let clips = s.clips.length ? s.clips : defaultClips(dur, s.videoTrim || 0)
        clips = clips
          .map((c) => ({ ...c, srcStart: Math.min(c.srcStart, dur), srcEnd: Math.min(c.srcEnd, dur) }))
          .filter((c) => c.srcEnd - c.srcStart > 0.01)
        if (!clips.length) clips = defaultClips(dur)
        useStore.setState({ videoDur: dur, clips, videoTrim: 0 })
        syncLengthToProgram()
        if (s.pendingFit) {
          useTimeline.setState({ t: 0, playing: false, selectedClip: null })
          useStore.setState({ pendingFit: false })
        }
        video.currentTime = programToSource(clips, useTimeline.getState().t)
        return true
      }
      video.addEventListener('loadeddata', () => {
        if (cancelled) return
        painter.drawVideo(video)
        if (!applyDuration()) {
          // WebM recordings report Infinity until seeked to the end once
          video.addEventListener('durationchange', () => !cancelled && applyDuration(), { once: true })
          video.currentTime = 1e101
        }
      })
      videoRef.current = video
      screenMedia.current = { videoEl: video, draw: () => painter.drawVideo(video) }
    } else {
      const img = new Image()
      img.onload = () => {
        if (!cancelled) painter.drawImage(img)
      }
      img.src = screenSrc
    }
    return () => {
      cancelled = true
    }
  }, [screenSrc, screenType, painter])

  // Keep the screen video locked to the timeline: play/pause with it, follow
  // scrubbing, and correct drift. (Exports seek explicitly and skip this.)
  useFrame(() => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    const { exportingVideo, clips, videoDur } = useStore.getState()
    if (exportingVideo) return
    // not registered yet (duration still resolving) — don't fight the setup seeks
    if (!videoDur || !isFinite(video.duration)) return
    const tl = useTimeline.getState()
    const dur = isFinite(video.duration) ? video.duration : Infinity
    const progLen = clips.length ? programLength(clips) : dur
    const src = Math.min(programToSource(clips, tl.t), dur - 0.001 > 0 ? dur - 0.001 : Infinity)
    const speed = clips.length ? clipAt(clips, tl.t)?.clip.speed || 1 : 1
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
    <group
      ref={(g) => {
        phoneRef.current = g
      }}
      rotation={[THREE.MathUtils.degToRad(rotX), THREE.MathUtils.degToRad(rotY), THREE.MathUtils.degToRad(rotZ)]}
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
  )
}
