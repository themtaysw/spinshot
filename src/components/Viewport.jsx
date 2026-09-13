import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei'
import Phone from './Phone.jsx'
import TextOverlay from './TextOverlay.jsx'
import { useStore, getAspect } from '../store.js'
import { threeRef, controlsRef } from '../lib/refs.js'
import { bgAt, deviceStateAt } from '../lib/scenes.js'
import { renderTime } from '../lib/timeline.js'
import { useTimeline, applySample, cycleLength, autoCaptureKey } from '../lib/timeline.js'

function Player() {
  useFrame((_, delta) => {
    const tl = useTimeline.getState()
    if (!tl.playing || useStore.getState().exportingVideo) return
    const cycle = cycleLength()
    let t = tl.t + Math.min(delta, 0.1)
    let playing = true
    if (t >= cycle) {
      if (tl.loop) t -= cycle
      else {
        t = tl.length
        playing = false
      }
    }
    useTimeline.setState({ t, playing })
    applySample(t)
  })
  return null
}

function ThreeCapture() {
  const state = useThree()
  const fov = useStore((s) => s.fov)
  const lightIntensity = useStore((s) => s.lightIntensity)

  useEffect(() => {
    threeRef.current = state
  }, [state])

  useEffect(() => {
    state.camera.fov = fov
    state.camera.updateProjectionMatrix()
  }, [fov, state.camera])

  useEffect(() => {
    state.scene.environmentIntensity = lightIntensity
  }, [lightIntensity, state.scene])

  return null
}

// The stage background, evaluated per frame so keyed backgrounds crossfade
// (and exports, which drive frameTime directly, get the same result).
function Background() {
  const scene = useThree((s) => s.scene)
  const gradRef = useRef(null)
  const lastRef = useRef('')
  const imgCache = useRef(new Map())

  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 1024
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    gradRef.current = { canvas: c, ctx: c.getContext('2d'), tex }
    lastRef.current = ''
    return () => tex.dispose()
  }, [])

  useFrame(() => {
    const s = useStore.getState()
    const b = bgAt(s.bgKeys, renderTime(), s)
    const key = `${b.bgType}|${b.c1}|${b.c2}|${b.bgImage || ''}`
    if (key === lastRef.current || !gradRef.current) return
    lastRef.current = key
    if (b.bgType === 'transparent') {
      scene.background = null
    } else if (b.bgType === 'image' && b.bgImage) {
      let tex = imgCache.current.get(b.bgImage)
      if (!tex) {
        tex = new THREE.TextureLoader().load(b.bgImage)
        tex.colorSpace = THREE.SRGBColorSpace
        imgCache.current.set(b.bgImage, tex)
      }
      scene.background = tex
    } else {
      const { canvas, ctx, tex } = gradRef.current
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height)
      g.addColorStop(0, b.c1)
      g.addColorStop(1, b.bgType === 'gradient' ? b.c2 : b.c1)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      tex.needsUpdate = true
      scene.background = tex
    }
  })

  return null
}

function Lights() {
  const preset = useStore((s) => s.lightPreset)

  return (
    <>
      <ambientLight intensity={0.25} />
      <Environment key={preset} resolution={256}>
        {preset === 'studio' && (
          <>
            <Lightformer intensity={4} position={[0, 4, 2]} rotation={[-Math.PI / 2.5, 0, 0]} scale={[8, 4, 1]} />
            <Lightformer intensity={2.2} position={[-4, 1, 2]} rotation={[0, Math.PI / 3, 0]} scale={[3, 5, 1]} />
            <Lightformer intensity={1.6} position={[4, 0.5, 1]} rotation={[0, -Math.PI / 3, 0]} scale={[3, 5, 1]} />
            <Lightformer intensity={0.6} position={[0, 0, -5]} scale={[10, 6, 1]} color="#b9c4ff" />
          </>
        )}
        {preset === 'soft' && (
          <>
            <Lightformer intensity={2} position={[0, 5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
            <Lightformer intensity={1.2} position={[-5, 0, 3]} rotation={[0, Math.PI / 3, 0]} scale={[6, 8, 1]} />
            <Lightformer intensity={1.2} position={[5, 0, 3]} rotation={[0, -Math.PI / 3, 0]} scale={[6, 8, 1]} />
          </>
        )}
        {preset === 'dramatic' && (
          <>
            <Lightformer intensity={6} position={[-5, 2, 2]} rotation={[0, Math.PI / 3, 0]} scale={[2, 6, 1]} />
            <Lightformer intensity={1.5} position={[5, -1, -2]} rotation={[0, -Math.PI / 2.5, 0]} scale={[1.5, 6, 1]} color="#8fa4ff" />
            <Lightformer intensity={0.3} position={[0, 5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
          </>
        )}
      </Environment>
    </>
  )
}

function Floor() {
  const shadow = useStore((s) => s.shadow)
  const reflection = useStore((s) => s.reflection)
  const bgColor2 = useStore((s) => s.bgColor2)
  const shadowRef = useRef(null)

  // the contact shadow follows the phone on/off stage
  useFrame(() => {
    const g = shadowRef.current
    if (!g) return
    const st = deviceStateAt(useStore.getState().deviceSegs, renderTime())
    g.visible = st.visible && st.alpha > 0.35
    g.position.x = st.dx
  })

  return (
    <>
      {reflection && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.825, 0]}>
          <planeGeometry args={[14, 14]} />
          <MeshReflectorMaterial
            blur={[300, 80]}
            resolution={1024}
            mixBlur={1}
            mixStrength={12}
            roughness={0.9}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            color={bgColor2}
            metalness={0.4}
          />
        </mesh>
      )}
      {shadow && (
        <group ref={shadowRef}>
          <ContactShadows position={[0, -0.82, 0]} opacity={0.55} scale={5} blur={2.6} far={2} resolution={512} />
        </group>
      )}
    </>
  )
}

export default function Viewport() {
  const aspect = useStore((s) => s.aspect)
  const customAspect = useStore((s) => s.customAspect)
  const bgType = useStore((s) => s.bgType)
  const a = getAspect({ aspect, customAspect })
  const wrapRef = useRef(null)

  // ⌥-drag moves the phone in the plane facing the camera
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const raycaster = new THREE.Raycaster()
    const pointAt = (e, plane) => {
      const three = threeRef.current
      const r = el.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(ndc, three.camera)
      const hit = new THREE.Vector3()
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null
    }
    const onDown = (e) => {
      if (!e.altKey || e.button !== 0 || !threeRef.current) return
      e.stopPropagation()
      e.preventDefault()
      const s = useStore.getState()
      const p0 = new THREE.Vector3(s.posX || 0, s.posY || 0, s.posZ || 0)
      const normal = threeRef.current.camera.getWorldDirection(new THREE.Vector3())
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, p0)
      const h0 = pointAt(e, plane)
      if (!h0) return
      useTimeline.setState({ playing: false })
      const onMove = (ev) => {
        const h = pointAt(ev, plane)
        if (!h) return
        const r2 = (v) => Math.round(v * 100) / 100
        useStore.setState({ posX: r2(p0.x + h.x - h0.x), posY: r2(p0.y + h.y - h0.y), posZ: r2(p0.z + h.z - h0.z) })
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        autoCaptureKey()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
    el.addEventListener('pointerdown', onDown, true)
    return () => el.removeEventListener('pointerdown', onDown, true)
  }, [])

  return (
    <div className="viewport-outer">
      <div
        ref={wrapRef}
        className={`viewport-frame ${bgType === 'transparent' ? 'checker' : ''}`}
        style={{
          aspectRatio: `${a.w} / ${a.h}`,
          width: `min(100cqw, calc(100cqh * ${(a.w / a.h).toFixed(4)}))`,
        }}
      >
        <Canvas
          gl={{ preserveDrawingBuffer: true, alpha: true, antialias: true }}
          dpr={[1, 2]}
          camera={{ fov: 30, position: [0.42, 0.38, 3.75], near: 0.1, far: 50 }}
        >
          <ThreeCapture />
          <Player />
          <Background />
          <Lights />
          <Phone />
          <Floor />
          <OrbitControls
            ref={controlsRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minDistance={1.2}
            maxDistance={12}
            zoomSpeed={0.35}
            rotateSpeed={0.8}
            onEnd={() => autoCaptureKey()}
            target={[0, -0.02, 0]}
          />
        </Canvas>
        <TextOverlay frameRef={wrapRef} />
      </div>
    </div>
  )
}
