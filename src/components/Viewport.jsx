import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, Environment, Lightformer, MeshReflectorMaterial } from '@react-three/drei'
import Phone from './Phone.jsx'
import { useStore, ASPECTS } from '../store.js'
import { makeGradientTexture } from '../lib/screenTexture.js'
import { threeRef, controlsRef } from '../lib/refs.js'
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

function Background() {
  const scene = useThree((s) => s.scene)
  const bgType = useStore((s) => s.bgType)
  const bgColor1 = useStore((s) => s.bgColor1)
  const bgColor2 = useStore((s) => s.bgColor2)
  const bgImage = useStore((s) => s.bgImage)

  useEffect(() => {
    let disposable = null
    if (bgType === 'transparent') {
      scene.background = null
    } else if (bgType === 'solid') {
      scene.background = new THREE.Color(bgColor1)
    } else if (bgType === 'gradient') {
      disposable = makeGradientTexture(bgColor1, bgColor2)
      scene.background = disposable
    } else if (bgType === 'image' && bgImage) {
      const tex = new THREE.TextureLoader().load(bgImage)
      tex.colorSpace = THREE.SRGBColorSpace
      disposable = tex
      scene.background = tex
    } else {
      scene.background = null
    }
    return () => {
      disposable?.dispose()
    }
  }, [scene, bgType, bgColor1, bgColor2, bgImage])

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
        <ContactShadows position={[0, -0.82, 0]} opacity={0.55} scale={5} blur={2.6} far={2} resolution={512} />
      )}
    </>
  )
}

export default function Viewport() {
  const aspect = useStore((s) => s.aspect)
  const bgType = useStore((s) => s.bgType)
  const a = ASPECTS[aspect]
  const wrapRef = useRef(null)

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
            onEnd={() => autoCaptureKey()}
            target={[0, -0.02, 0]}
          />
        </Canvas>
      </div>
    </div>
  )
}
