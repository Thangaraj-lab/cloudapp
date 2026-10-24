import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, EyeOff, Eye, Pencil, SkipForward } from 'lucide-react'
import { useStore, useMoney, useName } from '../../store'
import { buildEstate } from '../../world/model'
import { WorldView } from '../../world/World'
import { shortService } from '../../engine/explain'
import { Button, Honest } from '../../components/ui'

export default function Reveal() {
  const nav = useNavigate()
  const money = useMoney()
  const name = useName()
  const { rows, excluded, renames, set, log, sourceKind } = useStore()
  const [phase, setPhase] = useState<'plug' | 'wide' | 'halo' | 'done'>('plug')
  const [hover, setHover] = useState<string | undefined>()
  const [editing, setEditing] = useState<string | null>(null)
  const last = useMemo(() => rows.reduce((m, r) => (r.day > m ? r.day : m), ''), [rows])
  // Reveal shows the whole period: building height = spend on the last day, list = whole period.
  const estate = useMemo(() => buildEstate(rows, last, [], {}, excluded), [rows, last, excluded])
  const stats = useMemo(() => {
    const by = new Map<string, { cost: number; regions: Set<string>; tagged: number }>()
    for (const r of rows) {
      const s = by.get(r.service) ?? { cost: 0, regions: new Set(), tagged: 0 }
      s.cost += r.cost; s.regions.add(r.region); if (r.environment !== 'untagged') s.tagged += r.cost
      by.set(r.service, s)
    }
    const total = rows.reduce((a, r) => a + r.cost, 0) || 1
    const untagged = rows.filter((r) => r.environment === 'untagged').reduce((a, r) => a + r.cost, 0) / total
    return {
      list: [...by.entries()].sort((a, b) => b[1].cost - a[1].cost),
      services: by.size, regions: new Set(rows.map((r) => r.region)).size, envs: new Set(rows.map((r) => r.environment).filter((e) => e !== 'untagged')).size, untagged,
    }
  }, [rows])
  const n = estate.buildings.length
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setPhase('done'); return }
    const t1 = setTimeout(() => setPhase('wide'), 1200)
    const t2 = setTimeout(() => setPhase('halo'), 900 + n * 400)
    const t3 = setTimeout(() => setPhase('done'), 900 + n * 400 + 3000)
    return () => [t1, t2, t3].forEach(clearTimeout)
  }, [])
  if (!rows.length) return <Navigate to="/welcome" replace />
  const enter = () => { set({ revealed: true }); log('estate revealed', { services: stats.services, excluded }); nav('/overview') }
  const toggle = (svc: string) => set({ excluded: excluded.includes(svc) ? excluded.filter((x) => x !== svc) : [...excluded, svc] })

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--scene-bg)]">
      <WorldView height="100%" className="!rounded-none !border-0" estate={estate} reveal halo={phase === 'halo' || phase === 'done'}
        shot={phase === 'plug' ? 'overview-3q' : 'reveal-wide'} focus={hover} follow={false} labelMode="top" toggle={false} chip={false} />
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="pointer-events-auto glass px-4 py-3">
            <div className="eyebrow">Estate reveal</div>
            <div className="mt-1 font-display text-xl font-bold">{phase === 'halo' ? 'Learning normal…' : phase === 'done' ? 'Your estate is connected' : 'Connecting services…'}</div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
              {[`${stats.services} services`, `${stats.regions} regions`, `${stats.envs} environments`, `${Math.round(stats.untagged * 100)}% untagged`].map((c) => <span key={c} className="num rounded-full border border-line px-2 py-0.5 text-muted">{c}</span>)}
            </div>
          </div>
          <div className="pointer-events-auto flex flex-wrap items-center gap-2">
            {sourceKind === 'sample' && <Honest k="real" />}
            <span className="glass px-2.5 py-1 text-[11.5px] text-muted">Links show where cost flows, not network traffic</span>
            {phase !== 'done' && <Button variant="ghost" size="sm" onClick={() => setPhase('done')}><SkipForward size={14} /> Skip</Button>}
          </div>
        </div>
        <motion.div initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.6 }}
          className="pointer-events-auto glass ml-auto flex max-h-[62vh] w-full max-w-[380px] flex-col">
          <div className="border-b border-line px-4 py-3"><div className="font-display text-lg font-bold"><span className="num">{stats.services}</span> services connected</div><div className="text-[12px] text-muted">Hover a row to find it in the estate. Hide or rename service groups.</div></div>
          <div className="flex-1 overflow-y-auto px-2 py-1">
            {stats.list.map(([svc, s]) => {
              const off = excluded.includes(svc)
              return (
                <div key={svc} onMouseEnter={() => setHover(svc)} onMouseLeave={() => setHover(undefined)} className={`group flex items-center gap-2 rounded-xl px-2 py-2 text-[13px] hover:bg-sunk ${off ? 'opacity-45' : ''}`}>
                  <div className="min-w-0 flex-1">
                    {editing === svc ? (
                      <input autoFocus defaultValue={name(svc)} onBlur={(e) => { const v = e.target.value.trim(); set({ renames: { ...renames, [svc]: v && v !== svc ? v : undefined! } }); setEditing(null) }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full rounded border border-line bg-solid px-1.5 py-0.5" />
                    ) : <div className="truncate font-medium">{shortService(name(svc))}</div>}
                    <div className="num text-[11.5px] text-muted">{[...s.regions].join(', ')} · {Math.round((s.tagged / (s.cost || 1)) * 100)}% tagged</div>
                  </div>
                  <span className="num shrink-0 font-semibold">{money(s.cost)}</span>
                  <button aria-label="Rename" onClick={() => setEditing(svc)} className="rounded p-1 text-muted opacity-0 hover:text-ink group-hover:opacity-100"><Pencil size={13} /></button>
                  <button aria-label={off ? 'Include' : 'Hide'} onClick={() => toggle(svc)} className="rounded p-1 text-muted hover:text-ink">{off ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                </div>
              )
            })}
          </div>
          <div className="border-t border-line p-3"><Button size="lg" className="w-full" onClick={enter}>Enter Overview <ArrowRight size={16} /></Button></div>
        </motion.div>
      </div>
    </div>
  )
}
