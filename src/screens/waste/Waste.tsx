import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, EyeOff, Power } from 'lucide-react'
import { useAnalysis, useMoney, useStore } from '../../store'
import { wasteId, fromIdle } from '../../flow/subject'
import { buildEstate } from '../../world/model'
import { WorldView } from '../../world/World'
import type { BuildingFx } from '../../world/Estate'
import type { IdleResource, Row } from '../../engine/types'
import { cpuHistory } from '../../engine/risk'
import { headline } from '../../engine/narrate'
import { Badge, Button, Honest, PageHeader, Panel, Spark, StateView, StatusChip, toast } from '../../components/ui'
import { IdleScatter } from '../../viz/charts'
import { Chart } from '../../viz/Chart'
import { chartColors } from '../../theme'
import { riskTone } from '../cases/CaseFlow'

function useIdle() {
  const a = useAnalysis()
  const ignored = useStore((s) => s.ignoredWaste)
  return { all: a.idle, idle: a.idle.filter((r) => !ignored.includes(r.id)), ignored }
}

/** Idle resources as their own little estate: lights off, parked ones powered down. */
function IdleWorld({ items }: { items: IdleResource[] }) {
  const status = useStore((s) => s.status)
  const estate = useMemo(() => {
    const rows: Row[] = items.slice(0, 12).map((r) => ({ day: '2000-01-01', service: r.id, region: r.source === 'paired' ? 'paired sample' : r.region, environment: r.environment, application: r.id, cost: r.monthlyCost / 30, injected: r.source === 'injected' ? 'A' : undefined }))
    return buildEstate(rows, '2000-01-01', [], {})
  }, [items])
  const fx: Record<string, BuildingFx> = {}
  for (const r of items) { const st = status[wasteId(r)]; fx[r.id] = st === 'applied' || st === 'verified' ? { lights: 0, dim: 0.8, beam: 0, tone: 'verified' } : { lights: 0, tone: 'waste' } }
  return <WorldView height={300} estate={estate} fx={fx} labelMode="top" chip={false} shot="overview-3q" account="Idle resources" />
}

export default function Waste() {
  const { idle, all } = useIdle()
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const status = useStore((s) => s.status)
  const util = useStore((s) => s.utilization)
  const steady = a.signals.filter((f) => f.finding.kind === 'steady')
  const net = idle.reduce((s, r) => s + r.netSaving, 0)
  const hasPaired = idle.some((r) => r.source === 'paired')
  if (!all.length && !steady.length)
    return <StateView title="No idle resources" action={<Button onClick={() => nav('/sources')}>Add a utilization file</Button>}>Nothing has run below 5% average CPU and 20% peak for 14 days. Idle detection needs CPU data; load a utilization export to check more resources.</StateView>
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={<span className="flex items-center gap-2">Waste Finder {hasPaired && <Honest k="paired" />}</span>}
        title={`${idle.length} idle · ${money(net, 0)}/month net`}
        sub="Idle = average CPU under 5% and peak under 20% for at least 14 days. Net saving = monthly cost minus what keeps billing after a stop (storage, snapshots, IPs)." />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <Panel title="Idle resources" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-muted"><th className="px-5 py-2">Resource</th><th>CPU 14 days</th><th className="text-right">Days idle</th><th className="text-right">Cost/mo</th><th className="text-right">Net saving</th><th className="px-5" /></tr></thead>
              <tbody>
                {idle.map((r) => (
                  <tr key={r.id} onClick={() => nav(`/waste/${encodeURIComponent(r.id)}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-sunk">
                    <td className="px-5 py-3"><div className="font-medium">{r.id}</div><div className="text-[11.5px] text-muted">{r.service} · {r.environment}{r.source === 'injected' ? ' · injected demo' : r.source === 'paired' ? ' · paired sample' : ''}</div></td>
                    <td><Spark data={r.cpuSpark} w={90} h={22} color="var(--muted)" /></td>
                    <td className="num text-right">{r.daysIdle}</td>
                    <td className="num text-right">{money(r.monthlyCost, 0)}</td>
                    <td className="num text-right font-semibold text-growth">{money(r.netSaving, 0)}</td>
                    <td className="px-5 text-right">{status[wasteId(r)] ? <StatusChip s={status[wasteId(r)]} /> : <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); nav(`/case/${wasteId(r)}/fix`) }}><Power size={13} /> Park</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {util?.mode === 'paired' && <p className="border-t border-line px-5 py-3 text-[12px] text-muted">Paired demo data: public Azure VM trace statistics, not linked to the AWS account. Cost uses a stated demo price per core-month.</p>}
        </Panel>
        <div className="space-y-5">
          <IdleWorld items={idle} />
          <Panel title="CPU vs cost"><IdleScatter items={idle} fmt={money} height={240} onPick={(id) => nav(`/waste/${encodeURIComponent(id)}`)} /></Panel>
        </div>
      </div>
      {steady.length > 0 && (
        <Panel title="Always-on non-production spend">
          <div className="space-y-2">{steady.map((f) => (
            <button key={f.finding.id} onClick={() => nav(`/case/${f.finding.id}/understand`)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line p-3 text-left text-[13px] hover:border-[var(--border-strong)]">
              <span>{headline(f, money)}</span><span className="num shrink-0 font-semibold text-growth">{money(f.recommendation.netMonthlySaving, 0)}/mo</span>
            </button>
          ))}</div>
        </Panel>
      )}
    </div>
  )
}

export function WasteDetail() {
  const { id = '' } = useParams()
  const rid = decodeURIComponent(id)
  const { all } = useIdle()
  const money = useMoney()
  const nav = useNavigate()
  const { ignoredWaste, set, log } = useStore()
  const r = all.find((x) => x.id === rid)
  const hist = useMemo(() => (r ? cpuHistory(r.avgCpu, r.maxCpu, 1) : []), [r])
  if (!r) return <StateView kind="error" title="Resource not found" action={<Button onClick={() => nav('/waste')}>Back to Waste</Button>}>It is not in the current utilization data.</StateView>
  const s = fromIdle(r, money)
  const c = chartColors()
  const ignored = ignoredWaste.includes(r.id)
  return (
    <div className="space-y-5">
      <button onClick={() => nav('/waste')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Waste</button>
      <PageHeader eyebrow={<span className="flex items-center gap-2">Idle resource {r.source === 'injected' && <Honest k="injected" />}{r.source === 'paired' && <Honest k="paired" />}</span>} title={s.title}
        right={<><Button variant="ghost" onClick={() => {
          const next = ignored ? ignoredWaste.filter((x) => x !== r.id) : [...ignoredWaste, r.id]
          set({ ignoredWaste: next }); log(ignored ? 'waste un-ignored' : 'waste ignored', { resource: r.id })
          toast(ignored ? 'Back in the list.' : 'Ignored. Stored as a label.', () => useStore.getState().set({ ignoredWaste: ignoredWaste }))
        }}><EyeOff size={15} /> {ignored ? 'Un-ignore' : 'Ignore'}</Button><Button size="lg" onClick={() => nav(`/case/${wasteId(r)}/fix`)}>Plan the fix <ArrowRight size={16} /></Button></>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="CPU, last 14 days (hourly)">
          <Chart height={260} option={{
            grid: { left: 40, right: 12, top: 14, bottom: 26 },
            xAxis: { type: 'category', data: hist.map((_, i) => `d${Math.floor(i / 24) + 1}`), axisLabel: { color: c.muted, fontSize: 10, interval: 23 }, axisLine: { lineStyle: { color: c.border } }, axisTick: { show: false } },
            yAxis: { type: 'value', max: 100, axisLabel: { color: c.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: c.border } } },
            series: [{ type: 'line', data: hist.map((v) => +v.toFixed(2)), showSymbol: false, lineStyle: { color: c.accent, width: 1 }, areaStyle: { color: c.accent, opacity: 0.12 },
              markLine: { silent: true, symbol: 'none', lineStyle: { color: c.waste, type: 'dashed' }, data: [{ yAxis: 5, label: { formatter: 'idle line 5%', color: c.muted } }] } }],
          }} />
          <p className="mt-2 text-[12px] text-muted">Hourly shape rebuilt (seeded) from the file's average {r.avgCpu.toFixed(1)}% and peak {r.maxCpu.toFixed(1)}% CPU.</p>
        </Panel>
        <div className="space-y-5">
          <Panel title="Money">
            <div className="space-y-2 text-[13.5px]">
              <div className="flex justify-between"><span className="text-muted">Monthly cost</span><span className="num">{money(r.monthlyCost, 2)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Keeps billing after stop</span><span className="num">−{money(r.residual, 2)}</span></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold"><span>Net saving</span><span className="num text-growth">{money(r.netSaving, 2)}/mo</span></div>
            </div>
            <p className="mt-3 text-[12px] text-muted">Attached storage, snapshots and IP addresses keep billing after the instance stops ({Math.round(s.residualPct * 100)}% here).</p>
          </Panel>
          <Panel title="Risk"><Badge tone={riskTone[s.risk]}>{s.risk}</Badge><p className="mt-2 text-[12.5px] text-muted">From 500 seeded simulations of its CPU history at 1×, 1.5× and 3× traffic.</p></Panel>
        </div>
      </div>
    </div>
  )
}
