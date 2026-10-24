// Focused 3D simulations: make-before-break (C5), the data dome (E4) and the audit chain.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { easing } from 'maath'
import * as THREE from 'three'
import { Stage, SHOTS } from './Stage'
import { Labels, type LabelPoint } from './Estate'
import { useTier } from './quality'
import { Skeleton } from '../components/ui'

const EM = '#06D6A0', WASTE = '#FF7A68', AMBER = '#F4BE6E'

function useDamped(target: number, smooth = 0.35) {
  const v = useRef({ x: target })
  const { invalidate } = useThree()
  useEffect(() => { invalidate() }, [target])
  useFrame((_, dt) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) v.current.x = target
    else easing.damp(v.current, 'x', target, smooth, Math.min(dt, 0.05))
    if (Math.abs(v.current.x - target) > 0.002) invalidate()
  })
  return v
}

function Module({ x, solid, lights, color = '#DCE8E3', floors = 4, name }: { x: number; solid: React.MutableRefObject<{ x: number }>; lights: React.MutableRefObject<{ x: number }>; color?: string; floors?: number; name: string }) {
  const body = useRef<THREE.MeshStandardMaterial[]>([])
  const wins = useRef<THREE.MeshStandardMaterial[]>([])
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, floors * 0.42, 1.3)), [floors])
  useFrame(() => {
    body.current.forEach((m) => { m.opacity = 0.08 + 0.92 * solid.current.x; m.transparent = solid.current.x < 0.99 })
    wins.current.forEach((m) => { m.emissiveIntensity = 1.2 * lights.current.x })
  })
  return (
    <group position={[x, 0.2, 0]} name={name}>
      {Array.from({ length: floors }, (_, i) => (
        <group key={i} position={[0, i * 0.42, 0]}>
          <RoundedBox args={[1.2, 0.36, 1.2]} radius={0.05} smoothness={2} position={[0, 0.18, 0]} castShadow receiveShadow>
            <meshStandardMaterial ref={(m) => { if (m) body.current[i] = m }} color={color} roughness={0.78} transparent />
          </RoundedBox>
          <mesh position={[0, 0.18, 0.605]}><boxGeometry args={[0.9, 0.09, 0.01]} /><meshStandardMaterial ref={(m) => { if (m) wins.current[i] = m }} color="#0C4137" emissive="#B6FFE9" toneMapped={false} /></mesh>
        </group>
      ))}
      <lineSegments geometry={edges} position={[0, (floors * 0.42) / 2, 0]}><lineBasicMaterial color={EM} transparent opacity={0.5} /></lineSegments>
    </group>
  )
}

/** Traffic lane from the source to whichever module is live (0 = old, 1 = new). */
function Lane({ to, color }: { to: React.MutableRefObject<{ x: number }>; color: string }) {
  const m = useRef<THREE.Mesh>(null)
  useFrame(() => {
    if (!m.current) return
    const tx = -1.6 + 3.2 * to.current.x
    const from = new THREE.Vector3(0, 0.35, 3)
    const dest = new THREE.Vector3(tx, 0.35, 0.7)
    const mid = from.clone().lerp(dest, 0.5)
    m.current.position.copy(mid)
    m.current.lookAt(dest)
    m.current.scale.set(1, 1, from.distanceTo(dest))
  })
  return <mesh ref={m}><boxGeometry args={[0.09, 0.03, 1]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} toneMapped={false} /></mesh>
}

function ScanLine({ on, x }: { on: boolean; x: number }) {
  const m = useRef<THREE.Mesh>(null)
  const t0 = useRef<number | null>(null)
  const { invalidate } = useThree()
  useEffect(() => { t0.current = null; invalidate() }, [on])
  useFrame((s) => {
    if (!m.current) return
    m.current.visible = on
    if (!on) return
    if (t0.current === null) t0.current = s.clock.elapsedTime
    const t = Math.min(1, (s.clock.elapsedTime - t0.current) / 0.7)
    m.current.position.y = 0.2 + t * 1.7
    if (t < 1) invalidate()
  })
  return <mesh ref={m} position={[x, 0.2, 0]}><boxGeometry args={[1.45, 0.025, 1.45]} /><meshBasicMaterial color={EM} transparent opacity={0.8} toneMapped={false} /></mesh>
}

/** Make-before-break: the replacement goes ghost → solid, passes a health check, traffic switches, the old module dims. */
export function RunScene({ step, failed, rolledBack, oldLabel, newLabel, height = 380 }: { step: number; failed: boolean; rolledBack: boolean; oldLabel: string; newLabel: string; height?: number }) {
  const tier = useTier()
  const host = useRef<HTMLDivElement>(null)
  if (!tier) return <Skeleton className="w-full" />
  if (tier === 'none') return null
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-line" style={{ height }}>
      <Stage tier={tier} shot={SHOTS['liverun-profile']} controls={false}>
        <RunContent step={step} failed={failed} rolledBack={rolledBack} host={host} oldLabel={oldLabel} newLabel={newLabel} />
      </Stage>
      <div ref={host} className="pointer-events-none absolute inset-0" />
    </div>
  )
}

function RunContent({ step, failed, rolledBack, host, oldLabel, newLabel }: { step: number; failed: boolean; rolledBack: boolean; host: React.RefObject<HTMLDivElement | null>; oldLabel: string; newLabel: string }) {
  // Steps: 0 pre-check, 1 snapshot, 2 start replacement, 3 health check, 4 switch, 5 verify, 6 done.
  const live = rolledBack ? 0 : step >= 4 ? 1 : 0
  const newSolid = useDamped(rolledBack ? 0 : step >= 2 ? 1 : 0.0)
  const oldLights = useDamped(rolledBack ? 1 : step >= 4 ? 0 : 1)
  const newLights = useDamped(rolledBack ? 0 : step >= 3 ? 1 : 0)
  const oldSolid = useDamped(rolledBack ? 1 : step >= 4 ? 0.55 : 1)
  const lane = useDamped(live, 0.5)
  const points: LabelPoint[] = useMemo(() => [
    { id: 'old', pos: new THREE.Vector3(-1.6, 2.2, 0), text: oldLabel, sub: step >= 4 && !rolledBack ? 'stopped' : 'running', priority: 2 },
    { id: 'new', pos: new THREE.Vector3(1.6, 2.2, 0), text: newLabel, sub: rolledBack ? 'removed' : step >= 3 ? 'healthy' : step >= 2 ? 'starting' : 'planned', tone: rolledBack ? 'var(--waste)' : undefined, priority: 2 },
    { id: 'src', pos: new THREE.Vector3(0, 0.9, 3), text: 'Traffic / jobs', priority: 1 },
  ], [step, rolledBack, oldLabel, newLabel])
  return (
    <group>
      <RoundedBox args={[6.4, 0.2, 5.2]} radius={0.08} position={[0, 0.1, 1]} receiveShadow><meshStandardMaterial color="#0E3029" roughness={0.85} /></RoundedBox>
      <Module x={-1.6} solid={oldSolid} lights={oldLights} name="old" />
      <Module x={1.6} solid={newSolid} lights={newLights} color={failed ? '#F3C9C2' : '#DCE8E3'} floors={3} name="new" />
      <ScanLine on={step === 3 && !rolledBack} x={1.6} />
      <RoundedBox args={[0.8, 0.5, 0.5]} radius={0.06} position={[0, 0.45, 3]} castShadow><meshStandardMaterial color="#0C4137" roughness={0.6} /></RoundedBox>
      <Lane to={lane} color={failed ? WASTE : EM} />
      {failed && <pointLight position={[1.6, 2.4, 0.8]} color={WASTE} intensity={6} distance={4} />}
      <Labels points={points} host={host} />
    </group>
  )
}

/** Trust Center: raw rows stay inside the dome; only a signed action passes the gate. Audit blocks sit outside. */
export function DomeScene({ rows, blocks, broken, sent, height = 360 }: { rows: number; blocks: number; broken: number | null; sent: number; height?: number }) {
  const tier = useTier()
  const host = useRef<HTMLDivElement>(null)
  if (!tier) return <Skeleton className="w-full" />
  if (tier === 'none') return null
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-line" style={{ height }}>
      <Stage tier={tier} shot={SHOTS.dome} controls={false}>
        <DomeContent rows={rows} blocks={blocks} broken={broken} sent={sent} host={host} />
      </Stage>
      <div ref={host} className="pointer-events-none absolute inset-0" />
    </div>
  )
}

function DomeContent({ rows, blocks, broken, sent, host }: { rows: number; blocks: number; broken: number | null; sent: number; host: React.RefObject<HTMLDivElement | null> }) {
  const n = Math.min(360, Math.max(24, Math.round(rows / 2)))
  const inst = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    if (!inst.current) return
    const m = new THREE.Matrix4()
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, r = 0.25 + 2.1 * Math.sqrt(i / n)
      m.makeTranslation(Math.cos(a) * r, 0.28 + (i % 3) * 0.12, Math.sin(a) * r)
      inst.current.setMatrixAt(i, m)
    }
    inst.current.instanceMatrix.needsUpdate = true
  }, [n])
  const token = useRef<THREE.Mesh>(null)
  const t0 = useRef<number | null>(null)
  const { invalidate } = useThree()
  useEffect(() => { t0.current = null; if (sent) invalidate() }, [sent])
  useFrame((s) => {
    if (!token.current) return
    if (!sent) { token.current.visible = false; return }
    if (t0.current === null) t0.current = s.clock.elapsedTime
    const t = Math.min(1, (s.clock.elapsedTime - t0.current) / 1.6)
    token.current.visible = true
    token.current.position.set(0, 0.6 + Math.sin(t * Math.PI) * 0.4, -0.2 + t * 4.6)
    if (t < 1) invalidate()
  })
  const shown = Math.min(blocks, 14)
  const points: LabelPoint[] = useMemo(() => [
    { id: 'dome', pos: new THREE.Vector3(0, 3.2, 0), text: 'Your data stays on this device', sub: `${rows.toLocaleString()} rows · raw rows uploaded: 0`, priority: 3 },
    { id: 'gate', pos: new THREE.Vector3(0, 1.9, 2.9), text: 'Gate', sub: 'only signed actions pass', priority: 2 },
    { id: 'chain', pos: new THREE.Vector3(-4.6, 0.9, 3.2), text: 'Audit chain', sub: broken !== null ? `broken at #${broken}` : `${blocks} blocks`, tone: broken !== null ? 'var(--waste)' : undefined, priority: 1 },
  ], [rows, blocks, broken])
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow><circleGeometry args={[2.9, 64]} /><meshStandardMaterial color="#0E3029" roughness={0.9} /></mesh>
      <instancedMesh ref={inst} args={[undefined, undefined, n]} castShadow><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color="#DCE8E3" roughness={0.7} /></instancedMesh>
      <mesh position={[0, 0, 0]}><sphereGeometry args={[2.9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#E5FBF6" transparent opacity={0.09} roughness={0.1} metalness={0.2} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.88, 2.95, 96]} /><meshBasicMaterial color={EM} toneMapped={false} /></mesh>
      {/* Gate arch on the dome's edge */}
      <group position={[0, 0, 2.95]}>
        <RoundedBox args={[0.18, 1.3, 0.3]} radius={0.04} position={[-0.55, 0.65, 0]} castShadow><meshStandardMaterial color="#0C4137" /></RoundedBox>
        <RoundedBox args={[0.18, 1.3, 0.3]} radius={0.04} position={[0.55, 0.65, 0]} castShadow><meshStandardMaterial color="#0C4137" /></RoundedBox>
        <RoundedBox args={[1.3, 0.18, 0.32]} radius={0.04} position={[0, 1.36, 0]} castShadow><meshStandardMaterial color="#0C4137" /></RoundedBox>
        <mesh position={[0, 1.24, 0.17]}><boxGeometry args={[0.9, 0.03, 0.01]} /><meshStandardMaterial color={EM} emissive={EM} emissiveIntensity={1.4} toneMapped={false} /></mesh>
      </group>
      <mesh ref={token} visible={false}><boxGeometry args={[0.26, 0.18, 0.06]} /><meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.1} toneMapped={false} /></mesh>
      <Chain count={shown} broken={broken !== null ? Math.min(broken, shown - 1) : null} origin={[-4.6, 0, 1.5]} />
      <Labels points={points} host={host} />
    </group>
  )
}

/** A row of audit blocks; the broken one turns red and splits. The newest block seals in from above. */
export function Chain({ count, broken, origin = [0, 0, 0] }: { count: number; broken: number | null; origin?: [number, number, number] }) {
  return (
    <group position={origin}>
      {Array.from({ length: count }, (_, i) => <Block key={i} i={i} bad={broken === i} last={i === count - 1} />)}
    </group>
  )
}

function Block({ i, bad, last }: { i: number; bad: boolean; last: boolean }) {
  const g = useRef<THREE.Group>(null)
  const y = useRef({ v: last ? 1.2 : 0 })
  const { invalidate } = useThree()
  useEffect(() => { invalidate() }, [])
  useFrame((_, dt) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) y.current.v = 0
    else easing.damp(y.current, 'v', 0, 0.3, Math.min(dt, 0.05))
    if (g.current) g.current.position.y = 0.2 + y.current.v
    if (y.current.v > 0.002) invalidate()
  })
  const x = (i % 7) * 0.62, z = Math.floor(i / 7) * 0.7
  return (
    <group ref={g} position={[x, 0.2, z]}>
      {bad ? (
        <>
          <RoundedBox args={[0.24, 0.32, 0.4]} radius={0.04} position={[-0.15, 0, 0]} rotation={[0, 0, 0.12]}><meshStandardMaterial color={WASTE} emissive={WASTE} emissiveIntensity={0.5} /></RoundedBox>
          <RoundedBox args={[0.24, 0.32, 0.4]} radius={0.04} position={[0.15, -0.02, 0]} rotation={[0, 0, -0.1]}><meshStandardMaterial color={WASTE} emissive={WASTE} emissiveIntensity={0.5} /></RoundedBox>
        </>
      ) : (
        <RoundedBox args={[0.5, 0.32, 0.4]} radius={0.05} castShadow><meshStandardMaterial color={last ? '#BFF5E3' : '#DCE8E3'} roughness={0.7} /></RoundedBox>
      )}
      {i > 0 && <mesh position={[-0.31, 0, 0]}><boxGeometry args={[0.12, 0.04, 0.04]} /><meshStandardMaterial color={EM} emissive={EM} emissiveIntensity={0.8} toneMapped={false} /></mesh>}
    </group>
  )
}

/** Small scene with only the audit chain (Approval: a new block seals on). */
export function ChainScene({ count, height = 150 }: { count: number; height?: number }) {
  const tier = useTier()
  if (!tier) return <Skeleton className="w-full" />
  if (tier === 'none') return null
  return (
    <div className="overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <Stage tier={tier === 'high' ? 'medium' : tier} shot={{ pos: [1.9, 2.6, 5.2], target: [1.9, 0.2, 0.4] }} controls={false}>
        <Chain count={Math.min(count, 7)} broken={null} />
      </Stage>
    </div>
  )
}
