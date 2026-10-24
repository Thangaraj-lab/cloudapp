import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, List } from 'lucide-react'
import { useAnalysis, useStore, useMoney, useName } from '../store'
import { useView } from '../flow/timeline'
import { shortService } from '../engine/explain'
import { buildEstate, type Building, type Estate } from './model'
import { EstateScene, ENV_COLOR, HEALTH_COLOR, type BuildingFx } from './Estate'
import { Stage, SHOTS, focusShot, type Shot } from './Stage'
import { useTier } from './quality'
import { Segmented, Skeleton } from '../components/ui'

export function useEstate(date?: string) {
  const a = useAnalysis()
  const v = useView()
  const status = useStore((s) => s.status)
  const excluded = useStore((s) => s.excluded)
  const d = date ?? v.date
  return useMemo(() => buildEstate(a.allRows, d, a.findings, status, excluded), [a, d, status, excluded])
}

/** 2D fallback with identical data: one bar per service, tinted by health. */
export function EstateList({ estate, onPick, focus }: { estate: Estate; onPick?: (b: Building) => void; focus?: string }) {
  const money = useMoney()
  const name = useName()
  const max = Math.max(...estate.buildings.map((b) => b.cost), 1e-9)
  return (
    <div className="space-y-1.5 p-4">
      {estate.platforms.map((p) => (
        <div key={p.region}>
          <div className="eyebrow mb-1.5 mt-2">{p.region} · {p.buildings.length} services</div>
          {p.buildings.map((b) => (
            <button key={b.id} onClick={() => onPick?.(b)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-[13px] hover:bg-sunk ${focus === b.service ? 'bg-sunk' : ''}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ENV_COLOR(b.env) }} title={`environment: ${b.env}`} />
              <span className="w-40 shrink-0 truncate">{shortService(name(b.service))}</span>
              <span className="relative h-2 flex-1 rounded-full bg-sunk"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(1.5, (Math.log1p(b.cost / (max * 0.002)) / Math.log1p(500)) * 100)}%`, background: b.anomaly ? HEALTH_COLOR.waste : b.health !== 'neutral' ? HEALTH_COLOR[b.health] : 'var(--accent)' }} /></span>
              <span className="num w-20 shrink-0 text-right">{money(b.cost)}</span>
              {b.injected && <span className="rounded border border-dashed border-misconfig px-1 text-[10px] text-misconfig">injected</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      {['prod', 'dev', 'test', 'untagged'].map((e) => <span key={e} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: ENV_COLOR(e) }} />{e}</span>)}
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: HEALTH_COLOR.waste }} />waste</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: HEALTH_COLOR.misconfig }} />misconfig</span>
      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: HEALTH_COLOR.growth }} />growth / verified</span>
      <span>height: spend on a log scale</span>
    </div>
  )
}

export function WorldView({ height = 460, shot = 'overview-3q', focus, fx, reveal, halo, onPick, labelMode, showGhost, estate: given, overlay, chip = true, toggle = true, follow = true, account, className = '' }: {
  height?: number | string; shot?: keyof typeof SHOTS | Shot; focus?: string; fx?: Record<string, BuildingFx>; reveal?: boolean; halo?: boolean
  onPick?: (b: Building) => void; labelMode?: 'top' | 'all' | 'none'; showGhost?: boolean; estate?: Estate; overlay?: ReactNode; chip?: boolean; toggle?: boolean; follow?: boolean; account?: string; className?: string
}) {
  const own = useEstate()
  const estate = given ?? own
  const tier = useTier()
  const mode = useStore((s) => s.worldMode)
  const set = useStore((s) => s.set)
  const source = useStore((s) => s.sourceKind)
  const host = useRef<HTMLDivElement>(null)
  const [lost, setLost] = useState(false)
  const target = focus ? estate.buildings.find((b) => b.service === focus || b.id === focus) : undefined
  const s: Shot = typeof shot === 'string' ? (target && follow ? focusShot(target.pos, target.height) : SHOTS[shot]) : shot
  // Reduced motion keeps the 3D view but every animation jumps to its end state.
  const use3d = mode === '3d' && tier !== 'none' && !lost
  return (
    <div className={`relative overflow-hidden rounded-[20px] border border-line bg-[var(--scene-bg)] ${className}`} style={{ height }}>
      {use3d ? (
        tier === null ? <Skeleton className="absolute inset-4" /> : (
          <>
            <Stage tier={tier} shot={s} onLost={() => setLost(true)} dof={!!focus}>
              <EstateScene estate={estate} reveal={reveal} halo={halo} fx={fx} focus={focus} onPick={onPick} labelHost={host} labelMode={labelMode} showGhost={showGhost}
                account={account ?? (source === 'sample' ? 'AWS 11353890204' : 'Billing account')} />
            </Stage>
            <div ref={host} className="pointer-events-none absolute inset-0" />
          </>
        )
      ) : (
        <div className="absolute inset-0 overflow-y-auto">
          {lost && <div className="mx-4 mt-4 rounded-xl bg-misconfig/10 px-3 py-2 text-[12px] text-misconfig">3D stopped (graphics context lost). Showing the list view with the same data.</div>}
          {tier === 'none' && <div className="mx-4 mt-4 rounded-xl bg-sunk px-3 py-2 text-[12px] text-muted">3D is not available in this browser. Showing the list view with the same data.</div>}
          <EstateList estate={estate} onPick={onPick} focus={focus} />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap gap-2">{chip && <span className="glass px-2.5 py-1 text-[11.5px] text-muted"><span className="hidden sm:inline">Links show where cost flows, not network traffic</span><span className="sm:hidden">Links = cost flow, not traffic</span></span>}</div>
        {toggle && tier !== 'none' && (
          <div className="pointer-events-auto"><Segmented size="sm" value={mode} onChange={(k) => set({ worldMode: k })} options={[{ k: '3d', label: <span className="flex items-center gap-1"><Box size={13} />3D</span> }, { k: 'list', label: <span className="flex items-center gap-1"><List size={13} />List</span> }]} /></div>
        )}
      </div>
      {overlay}
    </div>
  )
}
