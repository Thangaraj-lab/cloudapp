// Studio stage shared by every 3D view: matte architectural model on a dark table.
import { useEffect, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { EffectComposer, N8AO, Bloom, Vignette, ToneMapping, DepthOfField } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { easing } from 'maath'
import * as THREE from 'three'
import type { OrbitControls as OC } from 'three-stdlib'
import type { Tier } from './quality'
import { cssVar } from '../theme'
import { useStore } from '../store'

export interface Shot { pos: [number, number, number]; target: [number, number, number] }
export const SHOTS = {
  'reveal-wide': { pos: [16, 15, 22], target: [0, 0, 2.5] },
  'overview-3q': { pos: [11, 9.5, 15], target: [0, 0.6, 3] },
  'case-side': { pos: [9, 5, 9], target: [0, 1, 4] },
  'liverun-profile': { pos: [0, 4.6, 9.4], target: [0, 1.1, 1] },
  dome: { pos: [0, 5, 11], target: [0, 1.2, 0] },
} satisfies Record<string, Shot>

/** Service focus: a three-quarter view of one building. */
export const focusShot = (p: [number, number, number], h = 2): Shot => ({ pos: [p[0] + 6.8, h + 5.6, p[2] + 8.6], target: [p[0] + 0.6, h * 0.42, p[2] + 0.6] })

declare global { interface Window { __worldReady?: boolean } }

function Rig({ shot, onSettle }: { shot: Shot; onSettle?: () => void }) {
  const { camera, invalidate, controls } = useThree()
  const user = useRef(false)
  const settled = useRef(false)
  const target = useRef(new THREE.Vector3(...shot.target))
  // Where the camera looks right now; eased toward the shot's target.
  const look = useRef(new THREE.Vector3(...shot.target))
  useEffect(() => { user.current = false; settled.current = false; target.current.set(...shot.target); invalidate() }, [shot.pos.join(), shot.target.join()])
  useEffect(() => {
    const c = controls as unknown as OC | null
    // On-demand rendering: when the controls register, ask for a frame so the camera is aimed.
    invalidate()
    if (!c) return
    c.target.copy(look.current)
    const start = () => { user.current = true }
    c.addEventListener('start', start)
    return () => c.removeEventListener('start', start)
  }, [controls])
  useFrame((_, dt) => {
    const c = controls as unknown as OC | null
    if (c && user.current) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.position.set(...shot.pos); look.current.copy(target.current) }
    else {
      easing.damp3(camera.position, shot.pos, 0.55, Math.min(dt, 0.05))
      easing.damp3(look.current, target.current, 0.55, Math.min(dt, 0.05))
    }
    if (c) { c.target.copy(look.current); c.update() } else camera.lookAt(look.current)
    const far = camera.position.distanceTo(new THREE.Vector3(...shot.pos)) + look.current.distanceTo(target.current)
    if (far > 0.01) invalidate()
    else if (!settled.current) { settled.current = true; onSettle?.() }
  })
  return null
}

function Ready() {
  const n = useRef(0)
  useFrame(() => { if (++n.current === 2) window.__worldReady = true })
  useEffect(() => () => { window.__worldReady = false }, [])
  return null
}

/** Pause rendering while the tab is hidden; resume on return. */
function Visibility() {
  const { invalidate } = useThree()
  useEffect(() => {
    const v = () => { if (!document.hidden) invalidate() }
    document.addEventListener('visibilitychange', v)
    return () => document.removeEventListener('visibilitychange', v)
  }, [])
  return null
}

export function Stage({ tier, shot, children, controls = true, onSettle, onLost, dof = false }: { tier: Tier; shot: Shot; children: ReactNode; controls?: boolean; onSettle?: () => void; onLost?: () => void; dof?: boolean }) {
  const theme = useStore((s) => s.theme)
  const bg = cssVar('scene-bg') || '#04140F'
  const dark = theme === 'dark'
  const fx = tier === 'high' || tier === 'medium'
  return (
    <Canvas key={theme} frameloop="demand" shadows={tier !== 'low'} dpr={[1, tier === 'high' ? 2 : 1.5]}
      camera={{ fov: 30, position: shot.pos, near: 0.5, far: 120 }}
      gl={{ antialias: !fx, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: false }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onLost?.() })
      }}>
      <color attach="background" args={[bg]} />
      <fog attach="fog" args={[bg, 34, 80]} />
      <hemisphereLight args={[dark ? '#CFEFE6' : '#FFFFFF', dark ? '#0C4137' : '#BFD9D0', dark ? 0.55 : 0.9]} />
      <directionalLight position={[9, 16, 7]} intensity={dark ? 2.1 : 2.6} castShadow={tier !== 'low'}
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={16} shadow-camera-bottom={-16} shadow-radius={6} />
      <directionalLight position={[-8, 6, -10]} intensity={0.5} color="#9FE8D4" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="rect" intensity={dark ? 1.2 : 2} position={[0, 6, -8]} scale={[16, 4, 1]} color="#E5FBF6" />
        <Lightformer form="rect" intensity={0.6} position={[-8, 3, 4]} scale={[6, 3, 1]} color="#06D6A0" />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[60, 96]} />
        <meshStandardMaterial color={dark ? '#071E19' : '#D6EAE3'} roughness={0.95} metalness={0} />
      </mesh>
      {children}
      {controls && <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.12} minDistance={6} maxDistance={42} minPolarAngle={0.45} maxPolarAngle={1.22} minAzimuthAngle={-1.1} maxAzimuthAngle={1.5} />}
      <Rig shot={shot} onSettle={onSettle} />
      <Ready />
      <Visibility />
      {fx && (
        <EffectComposer multisampling={tier === 'high' ? 4 : 0} enableNormalPass={false}>
          <N8AO halfRes={tier !== 'high'} aoRadius={1.1} intensity={dark ? 2.2 : 1.6} distanceFalloff={0.6} color={dark ? '#020a08' : '#0c4137'} />
          <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.1} intensity={0.22} />
          {tier === 'high' && dof ? <DepthOfField focusDistance={0.02} focalLength={0.06} bokehScale={1.4} /> : <></>}
          <Vignette offset={0.32} darkness={dark ? 0.55 : 0.25} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  )
}
