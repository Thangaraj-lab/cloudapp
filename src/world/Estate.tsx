// The Estate World: hub = billing account, platforms = regions, buildings = services.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { easing } from 'maath'
import * as THREE from 'three'
import type { Building, Estate, Health } from './model'

export interface BuildingFx {
  lights?: number // 0 = lights off (idle / forgotten), 1 = normal
  beam?: number // beam thickness multiplier (0 = leak stopped)
  tone?: Health
  stress?: number // 0..1 (What-if slider)
  dim?: number // 0..1 (parked / powered down)
  twin?: number // ghost-twin height (rule on)
  split?: boolean // floors split by environment
  rise?: number // extra height multiplier (growth replay)
}

export const HEALTH_COLOR: Record<Health, string> = { neutral: '#8FB5AB', waste: '#FF7A68', misconfig: '#F4BE6E', growth: '#B9EE8C', verified: '#7FE3B5' }
export const ENV_COLOR = (env: string) => (/^prod/i.test(env) ? '#06D6A0' : /^(dev|development)$/i.test(env) ? '#7FB2FF' : /^(test|qa|staging|stage|uat|sandbox)$/i.test(env) ? '#C9A7FF' : env === 'shared' ? '#E5FBF6' : '#6E9188')
const BODY = { dark: '#DCE8E3', light: '#F4F8F6' }

function useDark() { return document.documentElement.dataset.theme !== 'light' }

/** Animated 0→1 for appearing; respects reduced motion. */
function useAppear(delay: number, on: boolean) {
  const v = useRef(on ? 0 : 1)
  const t0 = useRef<number | null>(null)
  const { invalidate } = useThree()
  useEffect(() => { if (on) { v.current = 0; t0.current = null; invalidate() } }, [on])
  useFrame((s) => {
    if (v.current >= 1) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.current = 1; return }
    if (t0.current === null) t0.current = s.clock.elapsedTime
    const t = (s.clock.elapsedTime - t0.current - delay) / 0.7
    v.current = Math.max(0, Math.min(1, t < 0 ? 0 : 1 - Math.pow(1 - t, 3)))
    invalidate()
  })
  return v
}

function Hub({ label }: { label: string }) {
  const dark = useDark()
  return (
    <group>
      <mesh position={[0, 0.12, 0]} receiveShadow castShadow><cylinderGeometry args={[1.5, 1.65, 0.24, 64]} /><meshStandardMaterial color={dark ? '#0F3A31' : '#C9E3DA'} roughness={0.8} /></mesh>
      <RoundedBox args={[1.25, 1.25, 1.25]} radius={0.12} smoothness={4} position={[0, 0.88, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#0C4137" roughness={0.55} metalness={0.1} />
      </RoundedBox>
      <mesh position={[0, 1.52, 0]}><boxGeometry args={[1.05, 0.03, 1.05]} /><meshStandardMaterial color="#06D6A0" emissive="#06D6A0" emissiveIntensity={0.55} roughness={0.6} /></mesh>
      <group userData={{ label }} />
    </group>
  )
}

function Platform({ pos, size }: { pos: [number, number, number]; size: [number, number] }) {
  const dark = useDark()
  return (
    <group position={pos}>
      <RoundedBox args={[size[0], 0.18, size[1]]} radius={0.08} smoothness={3} position={[0, 0.09, 0]} receiveShadow castShadow>
        <meshStandardMaterial color={dark ? '#0E3029' : '#E7F3EF'} roughness={0.85} />
      </RoundedBox>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.185, 0]}><planeGeometry args={[size[0] - 0.3, size[1] - 0.3]} /><meshStandardMaterial color={dark ? '#123A32' : '#DCEDE7'} roughness={0.9} /></mesh>
    </group>
  )
}

/** Cost beam hub → building. Thickness ∝ share of the day's spend. */
function Beam({ to, share, mult = 1, appear, tone }: { to: [number, number, number]; share: number; mult?: number; appear: React.MutableRefObject<number>; tone: string }) {
  const mesh = useRef<THREE.Mesh>(null)
  const target = (0.012 + 0.07 * Math.sqrt(Math.max(0, share))) * mult
  // Radius eases to its target (e.g. to zero when a leak stops); the tube is rebuilt
  // only when the radius moved noticeably. It grows along its length when it appears.
  const [r, setR] = useState(target)
  const cur = useRef(target)
  const curve = useMemo(() => {
    const a = new THREE.Vector3(0, 0.3, 0), b = new THREE.Vector3(to[0], 0.3, to[2])
    const mid = a.clone().lerp(b, 0.5).setY(0.3 + a.distanceTo(b) * 0.08)
    return new THREE.QuadraticBezierCurve3(a, mid, b)
  }, [to[0], to[2]])
  const geo = useMemo(() => new THREE.TubeGeometry(curve, 48, Math.max(r, 0.001), 8, false), [curve, r])
  useEffect(() => () => geo.dispose(), [geo])
  const { invalidate } = useThree()
  useEffect(() => { invalidate() }, [target])
  useFrame((_, dt) => {
    if (!mesh.current) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    cur.current = reduce ? target : THREE.MathUtils.damp(cur.current, target, 5, Math.min(dt, 0.05))
    if (Math.abs(cur.current - r) > Math.max(0.002, r * 0.06) || (target === 0 && r !== 0 && cur.current < 0.002)) setR(cur.current < 0.002 ? 0 : cur.current)
    if (Math.abs(cur.current - target) > 0.0005) invalidate()
    const n = geo.index?.count ?? 0
    geo.setDrawRange(0, Math.floor((n * Math.min(1, appear.current)) / 6) * 6)
    mesh.current.visible = r > 0.0015 && appear.current > 0
  })
  return (
    <mesh ref={mesh} geometry={geo}>
      <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.9} roughness={0.4} transparent opacity={0.85} toneMapped={false} />
    </mesh>
  )
}

function Dashed({ w, h, d }: { w: number; h: number; d: number }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 0.25, h + 0.2, d + 0.25)), [w, h, d])
  return (
    <lineSegments geometry={geo} position={[0, (h + 0.2) / 2, 0]} onUpdate={(l) => l.computeLineDistances()}>
      <lineDashedMaterial color="#F4BE6E" dashSize={0.14} gapSize={0.1} />
    </lineSegments>
  )
}

/** Matte body in a category silhouette, windows that can switch off, a roof cap that carries health. */
function Body({ b, h, lights, tone, dim, split }: { b: Building; h: number; lights: number; tone: string; dim: number; split?: boolean }) {
  const dark = useDark()
  const body = new THREE.Color(BODY[dark ? 'dark' : 'light']).lerp(new THREE.Color(dark ? '#2B4842' : '#9DB5AD'), dim)
  const mat = <meshStandardMaterial color={body} roughness={0.78} metalness={0.02} />
  const win = <meshStandardMaterial color="#0C4137" emissive="#B6FFE9" emissiveIntensity={1.1 * lights * (1 - dim)} toneMapped={false} />
  const cap = <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={tone === HEALTH_COLOR.neutral ? 0.15 : 1.4} roughness={0.5} toneMapped={false} />
  const H = Math.max(0.12, h)
  if (split && b.envMix.length) {
    let y = 0
    return (
      <group>
        {b.envMix.map((m) => {
          const seg = Math.max(0.06, H * m.share)
          const g = <RoundedBox key={m.env} args={[0.9, seg - 0.02, 0.9]} radius={0.04} smoothness={2} position={[0, y + seg / 2, 0]} castShadow>
            <meshStandardMaterial color={ENV_COLOR(m.env)} roughness={0.7} />
          </RoundedBox>
          y += seg
          return g
        })}
        <mesh position={[0, y + 0.02, 0]}><boxGeometry args={[0.92, 0.04, 0.92]} />{cap}</mesh>
      </group>
    )
  }
  switch (b.category) {
    case 'compute': {
      const floors = Math.max(1, Math.round(H / 0.32))
      const fh = H / floors
      return (
        <group>
          {Array.from({ length: floors }, (_, i) => (
            <group key={i} position={[0, i * fh, 0]}>
              <RoundedBox args={[0.92, fh * 0.86, 0.92]} radius={0.05} smoothness={2} position={[0, fh * 0.43, 0]} castShadow receiveShadow>{mat}</RoundedBox>
              <mesh position={[0, fh * 0.43, 0.465]}><boxGeometry args={[0.7, fh * 0.22, 0.01]} />{win}</mesh>
              <mesh position={[0.465, fh * 0.43, 0]}><boxGeometry args={[0.01, fh * 0.22, 0.7]} />{win}</mesh>
            </group>
          ))}
          <mesh position={[0, H + 0.02, 0]}><boxGeometry args={[0.8, 0.04, 0.8]} />{cap}</mesh>
        </group>
      )
    }
    case 'database': {
      const n = Math.max(1, Math.min(5, Math.round(H / 0.35)))
      const sh = H / n
      return (
        <group>
          {Array.from({ length: n }, (_, i) => (
            <mesh key={i} position={[0, i * sh + sh * 0.45, 0]} castShadow receiveShadow><cylinderGeometry args={[0.46, 0.46, sh * 0.88, 40]} />{mat}</mesh>
          ))}
          <mesh position={[0, H * 0.5, 0]}><cylinderGeometry args={[0.47, 0.47, 0.05, 40]} />{win}</mesh>
          <mesh position={[0, H + 0.01, 0]}><cylinderGeometry args={[0.4, 0.4, 0.04, 40]} />{cap}</mesh>
        </group>
      )
    }
    case 'storage':
      return (
        <group>
          <RoundedBox args={[1.25, Math.max(0.2, H * 0.6), 1.05]} radius={0.08} smoothness={3} position={[0, Math.max(0.2, H * 0.6) / 2, 0]} castShadow receiveShadow>{mat}</RoundedBox>
          <mesh position={[0, Math.max(0.2, H * 0.6) * 0.5, 0.53]}><boxGeometry args={[0.9, 0.05, 0.01]} />{win}</mesh>
          <mesh position={[0, Math.max(0.2, H * 0.6) + 0.02, 0]}><boxGeometry args={[1.05, 0.04, 0.85]} />{cap}</mesh>
        </group>
      )
    case 'network':
      return (
        <group>
          <RoundedBox args={[0.24, H, 0.6]} radius={0.04} smoothness={2} position={[-0.42, H / 2, 0]} castShadow>{mat}</RoundedBox>
          <RoundedBox args={[0.24, H, 0.6]} radius={0.04} smoothness={2} position={[0.42, H / 2, 0]} castShadow>{mat}</RoundedBox>
          <RoundedBox args={[1.1, 0.2, 0.62]} radius={0.04} smoothness={2} position={[0, H + 0.1, 0]} castShadow>{mat}</RoundedBox>
          <mesh position={[0, H * 0.5, 0]}><boxGeometry args={[0.55, 0.03, 0.03]} />{win}</mesh>
          <mesh position={[0, H + 0.22, 0]}><boxGeometry args={[1, 0.035, 0.5]} />{cap}</mesh>
        </group>
      )
    case 'serverless':
      return (
        <group>
          {[[-0.27, -0.2], [0.27, -0.2], [0, 0.26]].map(([x, z], i) => (
            <group key={i}>
              <RoundedBox args={[0.42, H * (0.75 + i * 0.12), 0.42]} radius={0.06} smoothness={2} position={[x, (H * (0.75 + i * 0.12)) / 2, z]} castShadow>{mat}</RoundedBox>
              <mesh position={[x, H * (0.75 + i * 0.12) + 0.015, z]}><boxGeometry args={[0.34, 0.03, 0.34]} />{cap}</mesh>
            </group>
          ))}
        </group>
      )
    default:
      return (
        <group>
          <RoundedBox args={[0.82, H, 0.82]} radius={0.06} smoothness={2} position={[0, H / 2, 0]} castShadow receiveShadow>{mat}</RoundedBox>
          <mesh position={[0, H + 0.02, 0]}><boxGeometry args={[0.7, 0.04, 0.7]} />{cap}</mesh>
        </group>
      )
  }
}

function BuildingView({ b, i, reveal, fx, focus, hover, onPick, onHover, showGhost }: { b: Building; i: number; reveal: boolean; fx?: BuildingFx; focus: boolean; hover: boolean; onPick?: (b: Building) => void; onHover: (id: string | null) => void; showGhost: boolean }) {
  const appear = useAppear(reveal ? 0.4 + i * 0.4 : 0, reveal)
  const g = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const { invalidate } = useThree()
  // Geometry is built once at the target height; a scale animation eases from the
  // previous visual height, so a Time Machine step rebuilds each building only once.
  const h = Math.max(0.12, b.height * (fx?.rise ?? 1))
  const scale = useRef({ v: 1 })
  const prev = useRef(h)
  if (prev.current !== h) { scale.current.v = (prev.current * scale.current.v) / h; prev.current = h }
  useEffect(() => { invalidate() }, [h])
  useFrame((_, dt) => {
    if (g.current) g.current.scale.y = Math.max(0.001, appear.current)
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) scale.current.v = 1
    else easing.damp(scale.current, 'v', 1, 0.25, Math.min(dt, 0.05))
    if (body.current) body.current.scale.y = scale.current.v
    if (Math.abs(scale.current.v - 1) > 0.002) invalidate()
  })
  const tone = HEALTH_COLOR[fx?.tone ?? (b.anomaly ? 'waste' : b.health)]
  const lights = fx?.lights ?? (b.cost > 0 ? 1 : 0.15)
  const stressColor = fx?.stress !== undefined ? new THREE.Color('#06D6A0').lerp(new THREE.Color('#FF7A68'), fx.stress).getStyle() : null
  const pick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onPick?.(b) }
  return (
    <group position={b.pos}>
      <group ref={g}
        onClick={pick}
        onPointerOver={(e) => { e.stopPropagation(); onHover(b.id); document.body.style.cursor = onPick ? 'pointer' : '' }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = '' }}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}><ringGeometry args={[0.62, 0.72, 48]} /><meshStandardMaterial color={ENV_COLOR(b.env)} emissive={ENV_COLOR(b.env)} emissiveIntensity={0.5} toneMapped={false} /></mesh>
        <group position={[0, 0.19, 0]}>
          <group ref={body}><Body b={b} h={h} lights={lights} tone={stressColor ?? tone} dim={fx?.dim ?? 0} split={fx?.split} /></group>
          {b.anomaly && !fx?.tone && <pointLight position={[0, h + 0.5, 0]} color="#FF7A68" intensity={3} distance={2.5} />}
          {(hover || focus) && <mesh position={[0, Math.max(h, 0.2) / 2, 0]}><boxGeometry args={[1.18, Math.max(h, 0.2) + 0.12, 1.18]} /><meshBasicMaterial color="#06D6A0" transparent opacity={0.08} depthWrite={false} /></mesh>}
          {showGhost && b.ghost > h + 0.05 && (
            <mesh position={[0, b.ghost / 2, 0]}><boxGeometry args={[0.96, b.ghost, 0.96]} /><meshBasicMaterial color="#E5FBF6" transparent opacity={0.07} depthWrite={false} /></mesh>
          )}
          {fx?.twin !== undefined && (
            <mesh position={[0, fx.twin / 2, 0.0]}><boxGeometry args={[1.02, Math.max(0.05, fx.twin), 1.02]} /><meshBasicMaterial color="#06D6A0" transparent opacity={0.16} depthWrite={false} /></mesh>
          )}
          {b.injected && <Dashed w={1} h={Math.max(h, 0.3)} d={1} />}
        </group>
      </group>
    </group>
  )
}

/** Normal-range halo sweep (reveal finale): a ring travels outward from the hub. */
function HaloSweep({ on, radius }: { on: boolean; radius: number }) {
  const m = useRef<THREE.Mesh>(null)
  const t0 = useRef<number | null>(null)
  const { invalidate } = useThree()
  useEffect(() => { t0.current = null; if (on) invalidate() }, [on])
  useFrame((s) => {
    if (!on || !m.current) return
    if (t0.current === null) t0.current = s.clock.elapsedTime
    const t = Math.min(1, (s.clock.elapsedTime - t0.current) / 3)
    const r = 0.5 + t * radius
    m.current.scale.set(r, r, 1)
    ;(m.current.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - t)
    if (t < 1) invalidate()
  })
  return <mesh ref={m} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 0]}><ringGeometry args={[0.96, 1, 128]} /><meshBasicMaterial color="#06D6A0" transparent opacity={0} depthWrite={false} /></mesh>
}

export interface LabelPoint { id: string; pos: THREE.Vector3; text: string; sub?: string; tone?: string; priority: number }

/** Screen-space labels (HTML), placed without collisions, highest priority first. */
export function Labels({ points, host }: { points: LabelPoint[]; host: React.RefObject<HTMLDivElement | null> }) {
  const { camera, size } = useThree()
  const els = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    const el = host.current
    if (!el) return
    const live = new Set(points.map((p) => p.id))
    for (const [id, d] of els.current) if (!live.has(id)) { d.remove(); els.current.delete(id) }
    for (const p of points) {
      let d = els.current.get(p.id)
      if (!d) {
        d = document.createElement('div')
        d.className = 'pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-lg border border-line bg-[color-mix(in_srgb,var(--panel-solid)_86%,transparent)] px-2 py-1 text-[11.5px] leading-tight shadow-sm backdrop-blur'
        el.appendChild(d)
        els.current.set(p.id, d)
      }
      d.innerHTML = `<div class="font-semibold" style="color:${p.tone ?? 'var(--text)'}">${p.text}</div>${p.sub ? `<div class="num" style="color:var(--muted)">${p.sub}</div>` : ''}`
    }
  }, [points])
  useEffect(() => () => { for (const d of els.current.values()) d.remove(); els.current.clear() }, [])
  useFrame(() => {
    const placed: [number, number, number, number][] = []
    const sorted = [...points].sort((a, b) => b.priority - a.priority)
    for (const p of sorted) {
      const d = els.current.get(p.id)
      if (!d) continue
      const v = p.pos.clone().project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height
      const w = d.offsetWidth || 90, hgt = d.offsetHeight || 30
      // Keep labels below the chips along the top edge of the view.
      const r: [number, number, number, number] = [Math.min(Math.max(4, x - w / 2), size.width - w - 4), Math.max(52, y - hgt - 8), w, hgt]
      const hit = v.z > 1 || placed.some(([px, py, pw, ph]) => r[0] < px + pw && r[0] + r[2] > px && r[1] < py + ph && r[1] + r[3] > py)
      d.style.opacity = hit ? '0' : '1'
      d.style.transform = `translate(${Math.round(r[0])}px, ${Math.round(r[1])}px)`
      if (!hit) placed.push(r)
    }
  })
  return null
}

export function EstateScene({ estate, reveal = false, halo = false, fx = {}, focus, onPick, labelHost, labelMode = 'top', showGhost = false, account }: {
  estate: Estate; reveal?: boolean; halo?: boolean; fx?: Record<string, BuildingFx>; focus?: string; onPick?: (b: Building) => void
  labelHost: React.RefObject<HTMLDivElement | null>; labelMode?: 'top' | 'all' | 'none'; showGhost?: boolean; account: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const { invalidate } = useThree()
  useEffect(() => { invalidate() }, [hover, estate])
  const fxFor = (b: Building) => fx[b.id] ?? fx[b.service]
  const radius = Math.max(...estate.platforms.map((p) => Math.hypot(p.pos[0], p.pos[2]) + Math.max(...p.size) / 2), 6)
  const points: LabelPoint[] = useMemo(() => {
    if (labelMode === 'none') return []
    const sorted = [...estate.buildings].sort((a, b) => b.cost - a.cost)
    const pick = labelMode === 'all' ? sorted : sorted.filter((b, i) => i < 4 || b.anomaly || b.id === focus || b.service === focus || b.id === hover || b.health !== 'neutral')
    return [
      { id: '__hub', pos: new THREE.Vector3(0, 1.7, 0), text: account, sub: 'billing account', priority: 100 },
      ...pick.map((b) => ({
        id: b.id, pos: new THREE.Vector3(b.pos[0], b.height + 0.55, b.pos[2]), text: b.service.replace('Amazon Elastic Compute Cloud', 'EC2').replace(/^(Amazon|AWS) ?/, ''),
        sub: `$${b.cost.toFixed(2)}/day`, tone: b.anomaly ? 'var(--waste)' : b.health === 'waste' ? 'var(--waste)' : b.health === 'misconfig' ? 'var(--misconfig)' : undefined,
        priority: (b.id === hover ? 1000 : 0) + (b.anomaly ? 500 : 0) + (b.id === focus || b.service === focus ? 400 : 0) + b.cost,
      })),
      ...estate.platforms.filter((p) => p.buildings.length).map((p) => ({ id: '__r' + p.region, pos: new THREE.Vector3(p.pos[0], 0.3, p.pos[2] + p.size[1] / 2 + 0.2), text: p.region, sub: `${p.buildings.length} services`, priority: 50 })),
    ]
  }, [estate, labelMode, focus, hover, account])
  return (
    <group onPointerMissed={() => setHover(null)}>
      <Hub label={account} />
      {estate.platforms.map((p) => <Platform key={p.region} pos={p.pos} size={p.size} />)}
      {estate.buildings.map((b, i) => {
        const f = fxFor(b)
        return (
          <group key={b.id}>
            <BeamFor b={b} i={i} reveal={reveal} mult={f?.beam ?? 1} tone={f?.tone ? HEALTH_COLOR[f.tone] : b.anomaly ? HEALTH_COLOR.waste : '#06D6A0'} />
            <BuildingView b={b} i={i} reveal={reveal} fx={f} focus={b.id === focus || b.service === focus} hover={hover === b.id} onPick={onPick} onHover={setHover} showGhost={showGhost} />
          </group>
        )
      })}
      <HaloSweep on={halo} radius={radius} />
      <Labels points={points} host={labelHost} />
    </group>
  )
}

function BeamFor({ b, i, reveal, mult, tone }: { b: Building; i: number; reveal: boolean; mult: number; tone: string }) {
  const appear = useAppear(reveal ? 0.55 + i * 0.4 : 0, reveal)
  return <Beam to={b.pos} share={b.share} mult={mult} appear={appear} tone={tone} />
}
