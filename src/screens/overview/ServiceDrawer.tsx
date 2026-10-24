import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAnalysis, useMoney, useName, useStore } from '../../store'
import { useView } from '../../flow/timeline'
import { serviceStats } from '../../flow/services'
import { shortService } from '../../engine/explain'
import { headline } from '../../engine/narrate'
import { vsNormal } from '../../engine/narrate'
import { Button, Drawer, Segmented, Spark, VerdictChip } from '../../components/ui'

export function Shares({ items, fmt }: { items: { name: string; value: number }[]; fmt: (n: number) => string }) {
  const total = items.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div className="space-y-2">
      {items.slice(0, 8).map((x) => (
        <div key={x.name} className="text-[13px]">
          <div className="flex justify-between gap-2"><span className={`truncate ${x.name === 'untagged' ? 'italic text-muted' : ''}`}>{x.name}</span><span className="num shrink-0 text-muted">{fmt(x.value)} · {Math.round((x.value / total) * 100)}%</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-sunk"><div className="h-full rounded-full" style={{ width: `${(x.value / total) * 100}%`, background: x.name === 'untagged' ? 'var(--neutral)' : 'var(--accent)' }} /></div>
        </div>
      ))}
    </div>
  )
}

export function ServiceDrawer({ service, onClose }: { service: string | null; onClose: () => void }) {
  const a = useAnalysis()
  const v = useView()
  const money = useMoney()
  const name = useName()
  const nav = useNavigate()
  const params = useStore((s) => s.params)
  const idle = a.idle
  const [tab, setTab] = useState<'env' | 'app' | 'region'>('env')
  const st = useMemo(() => (service ? serviceStats(a.allRows, service, v.date, params) : null), [service, a, v.date, params])
  if (!service || !st) return <Drawer open={false} onClose={onClose} title="">{null}</Drawer>
  const today = st.series.at(-1)
  const cases = [...a.findings, ...a.signals].filter((f) => f.explanation.topPath.service === service)
  const svcIdle = idle.filter((r) => r.service === service)
  const markIdx = st.series.findIndex((p) => cases.some((c) => c.finding.day === p.day))
  return (
    <Drawer open onClose={onClose} title={<span>{shortService(name(service))}<div className="text-[12px] font-normal text-muted">{service}</div></span>}
      footer={<div className="flex gap-2 pb-1"><Button className="flex-1" onClick={() => nav(`/service/${encodeURIComponent(service)}`)}>Open profile</Button><Button variant="ghost" onClick={() => nav(`/trends?service=${encodeURIComponent(service)}`)}>Filter to this service</Button></div>}>
      <div className="grid grid-cols-2 gap-3">
        <div className="sunk p-3"><div className="text-[11.5px] text-muted">Spend to {v.date.slice(5)}</div><div className="num mt-1 font-display text-xl font-extrabold">{money(st.total)}</div><div className="text-[11.5px] text-muted">{(st.share * 100).toFixed(1)}% of total</div></div>
        <div className="sunk p-3"><div className="text-[11.5px] text-muted">On {v.date.slice(5)}</div><div className="num mt-1 font-display text-xl font-extrabold">{money(today?.cost ?? 0)}</div><div className="text-[11.5px] text-muted">{today?.median != null ? vsNormal(today.cost, today.median, money).split(' · ')[1] : 'learning normal'}</div></div>
      </div>
      <div className="mt-4"><div className="eyebrow mb-2">Daily trend</div><Spark data={st.series.map((p) => p.cost)} w={370} h={56} mark={markIdx} /></div>
      <div className="mt-5 flex items-center justify-between"><div className="eyebrow">Breakdown</div><Segmented size="sm" value={tab} onChange={setTab} options={[{ k: 'env', label: 'Environment' }, { k: 'app', label: 'Application' }, { k: 'region', label: 'Region' }]} /></div>
      <div className="mt-3"><Shares items={tab === 'env' ? st.byEnv : tab === 'app' ? st.byApp : st.byRegion} fmt={(n) => money(n)} /></div>
      <div className="mt-4 text-[12.5px] text-muted">Tag coverage: <b className="text-ink">{Math.round(st.tagged * 100)}%</b> of this service's spend has an environment tag.</div>
      <div className="mt-5"><div className="eyebrow mb-2">Linked cases</div>
        {cases.length ? cases.map((c) => (
          <button key={c.finding.id} onClick={() => nav(`/case/${c.finding.id}/understand`)} className="mb-2 block w-full rounded-xl border border-line p-3 text-left text-[13px] hover:border-[var(--border-strong)]">
            <div className="flex items-center gap-2"><VerdictChip kind={c.verdict.kind} />{c.finding.scope === 'service' && <span className="text-[11px] text-muted">service signal</span>}</div>
            <div className="mt-1.5">{headline(c, money)}</div>
          </button>
        )) : <div className="text-[13px] text-muted">No anomalies for this service.</div>}
      </div>
      {svcIdle.length > 0 && <div className="mt-4"><div className="eyebrow mb-2">Idle resources</div>{svcIdle.map((r) => <button key={r.id} onClick={() => nav(`/waste/${encodeURIComponent(r.id)}`)} className="link block text-[13px]">{r.id} · {money(r.netSaving, 0)}/mo net</button>)}</div>}
    </Drawer>
  )
}
