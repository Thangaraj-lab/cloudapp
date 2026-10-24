import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { useAnalysis, useMoney, useStore, useName } from '../../store'
import { useView, useProjection, needsAction } from '../../flow/timeline'
import { byService } from '../../flow/services'
import { headline, vsNormal, dayName } from '../../engine/narrate'
import { shortService } from '../../engine/explain'
import { Button, CountUp, Honest, KPI, PageHeader, Panel, Segmented, VerdictChip, StatusChip } from '../../components/ui'
import { LeakMeter } from '../../components/Signature'
import { WorldView, Legend } from '../../world/World'
import { StackedTrend, SpendTreemap, Pareto, CalendarHeat, Ring, ForecastChart, type TreeNode } from '../../viz/charts'
import { ServiceDrawer } from './ServiceDrawer'

export function useTrendSeries(upTo?: string, only?: string) {
  const a = useAnalysis()
  return useMemo(() => {
    const days = a.series.map((p) => p.day).filter((d) => !upTo || d <= upTo)
    const top = byService(a.allRows).slice(0, 6).map((x) => x.name)
    const keys = only ? [only] : top
    const m = new Map<string, Map<string, number>>()
    for (const r of a.allRows) {
      const k = keys.includes(r.service) ? r.service : 'Other'
      if (only && k === 'Other') continue
      if (!m.has(k)) m.set(k, new Map())
      m.get(k)!.set(r.day, (m.get(k)!.get(r.day) ?? 0) + r.cost)
    }
    return { days, series: [...m.entries()].sort((x, y) => (x[0] === 'Other' ? 1 : y[0] === 'Other' ? -1 : 0)).map(([name, mm]) => ({ name, values: days.map((d) => mm.get(d) ?? 0) })) }
  }, [a, upTo, only])
}

export function Breakdown({ upTo, onPick }: { upTo: string; onPick: (s: string) => void }) {
  const a = useAnalysis()
  const money = useMoney()
  const rows = useMemo(() => a.allRows.filter((r) => r.day <= upTo), [a, upTo])
  const tree: TreeNode[] = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const r of rows) {
      if (!m.has(r.service)) m.set(r.service, new Map())
      const e = m.get(r.service)!
      e.set(r.environment, (e.get(r.environment) ?? 0) + r.cost)
    }
    return [...m.entries()].map(([name, envs]) => ({ name, children: [...envs.entries()].map(([n, v]) => ({ name: n, value: +v.toFixed(4) })) }))
  }, [rows])
  const total = rows.reduce((s, r) => s + r.cost, 0) || 1
  const tagged = rows.filter((r) => r.environment !== 'untagged').reduce((s, r) => s + r.cost, 0) / total
  const appTagged = rows.filter((r) => r.application !== 'untagged').reduce((s, r) => s + r.cost, 0) / total
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2"><div className="eyebrow mb-2">Where the money goes · service → environment</div><SpendTreemap data={tree} fmt={money} height={280} onPick={onPick} /></div>
      <div><div className="eyebrow mb-2">Pareto · top services</div><Pareto items={byService(rows).slice(0, 10)} fmt={money} /></div>
      <div>
        <div className="eyebrow mb-2">Daily spend calendar</div>
        <CalendarHeat points={a.series.filter((p) => p.day <= upTo)} fmt={money} anomalies={a.findings.map((f) => f.finding.day)} />
        <div className="mt-2 flex items-center gap-5"><Ring value={tagged} label="env tagged" /><Ring value={appTagged} label="app tagged" color="var(--growth)" /><p className="text-[12.5px] text-muted">Tagged spend can be traced to an owner. Untagged spend is listed in Ownership.</p></div>
      </div>
    </div>
  )
}

export default function Overview() {
  const v = useView()
  const a = v.a
  const money = useMoney()
  const name = useName()
  const nav = useNavigate()
  const status = useStore((s) => s.status)
  const lens = useStore((s) => s.lens)
  const tm = useStore((s) => s.tm)
  const set = useStore((s) => s.set)
  const source = useStore((s) => s.sourceKind)
  const [drawer, setDrawer] = useState<string | null>(null)
  const trend = useTrendSeries(v.date)
  const open = a.findings.filter((f) => needsAction(f, status[f.finding.id])).sort((x, y) => y.finding.moneyAtRisk - x.finding.moneyAtRisk)
  const attention = (v.isLatest ? open : v.live).slice(0, 3)
  const proj = useProjection(v.isLatest ? v.leakPerDay : 0)
  const projection = tm.mode === 'projection'
  const first = a.series[0]?.day
  const top = attention[0]
  const sentence = !a.findings.length
    ? `${money(v.spendToDate)} spent from ${dayName(first)} to ${dayName(v.date)}. Every day looked normal.`
    : `${money(v.spendToDate)} spent from ${dayName(first)} to ${dayName(v.date)}. ${v.visible.length} unusual day${v.visible.length === 1 ? '' : 's'} so far${v.leakPerDay > 0 ? `; ${money(v.leakPerDay)}/day is still leaking` : '; nothing is leaking now'}.`

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={<span className="flex items-center gap-2">Overview {source === 'sample' && <Honest k="real" />}{!v.isLatest && <span className="normal-case tracking-normal text-accent">· viewing {dayName(v.date)}</span>}</span>}
        title={sentence}
        right={top ? <Button size="lg" onClick={() => nav(`/case/${top.finding.id}/understand`)}>Open top case <ArrowRight size={16} /></Button> : <Button size="lg" onClick={() => nav('/waste')}>Review waste <ArrowRight size={16} /></Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {projection ? (
          <>
            <KPI label="Month-end · do nothing" value={<CountUp value={proj.monthEndDoNothing} format={(n) => money(n, 0)} />} sentence={<span className="flex items-center gap-1.5"><Honest k="projection" /></span>} />
            <KPI label="Month-end · apply fixes" value={<CountUp value={proj.monthEndApplyFix} format={(n) => money(n, 0)} />} tone="growth" sentence={`${money(proj.monthEndDoNothing - proj.monthEndApplyFix, 0)} less if open leaks stop tomorrow`} />
          </>
        ) : (
          <>
            <KPI label="Spend" value={<CountUp value={v.spendToDate} format={(n) => money(n)} />} sentence={`${money(v.monthToDate)} this month to ${dayName(v.date)}`} />
            <KPI label="Vs normal" value={money(v.cost)} tone={v.anomalyDays.has(v.date) ? 'waste' : undefined} sentence={v.normal !== null ? vsNormal(v.cost, v.normal, money).split(' · ')[1] + ` on ${dayName(v.date)}` : 'Learning normal (first 7 days)'} />
          </>
        )}
        <KPI label="Money at risk" value={<CountUp value={v.atRisk} format={(n) => money(n, 0)} />} tone={v.atRisk > 0 ? 'waste' : undefined} sentence={v.atRisk > 0 ? 'if open anomalies continue to month end' : 'Nothing at risk'} />
        <KPI label="Verified savings" value={<CountUp value={v.verified} format={(n) => money(n, 0)} />} tone="growth" sentence={v.pending > 0 ? `${money(v.pending, 0)}/mo waiting for verification` : 'per month, measured after each fix'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel pad={false} title={projection ? 'Projection' : undefined} right={!projection && <Segmented value={lens} onChange={(k) => set({ lens: k })} options={[{ k: 'skyline', label: 'Skyline' }, { k: 'trends', label: 'Trends' }, { k: 'breakdown', label: 'Breakdown' }]} />} className="min-w-0">
          <div className={projection ? 'px-5 pb-5' : 'px-5 pb-5 pt-4'}>
            {projection ? (
              <><ForecastChart days={a.series.map((p) => p.day)} actual={a.series.map((p) => p.cost)} projection={proj} fmt={money} height={380} />
                <p className="mt-2 text-[12.5px] text-muted">Dashed lines are a projection: the median of the last 14 days for each weekday. "Apply fixes" removes the {money(v.leakPerDay)}/day that is still leaking from tomorrow on.</p></>
            ) : lens === 'skyline' ? (
              <>
                <WorldView height={460} onPick={(b) => setDrawer(b.service)} showGhost={!v.isLatest} focus={tm.paused ? attention[0]?.explanation.topPath.service : undefined} />
                <div className="mt-3"><Legend /></div>
              </>
            ) : lens === 'trends' ? (
              <StackedTrend days={trend.days} series={trend.series} fmt={money} height={420} asOf={v.date} onPick={(s) => s !== 'Other' && setDrawer(s)} />
            ) : (
              <Breakdown upTo={v.date} onPick={(s) => setDrawer(s)} />
            )}
          </div>
        </Panel>

        <div className="space-y-4">
          <LeakMeter perDay={v.leakPerDay} />
          <Panel title="Needs attention" right={<button className="link text-[13px]" onClick={() => nav('/cases')}>All cases</button>}>
            {attention.length ? (
              <div className="space-y-2.5">
                {attention.map((f) => (
                  <button key={f.finding.id} onClick={() => nav(`/case/${f.finding.id}/understand`)} className={`panel-hover block w-full rounded-2xl border border-line bg-sunk p-3 text-left edge-${f.verdict.kind.toLowerCase()}`}>
                    <div className="flex flex-wrap items-center gap-2"><VerdictChip kind={f.verdict.kind} confidence={f.verdict.confidence} />{status[f.finding.id] && <StatusChip s={status[f.finding.id]} />}{f.finding.injected && <Honest k="injected" />}</div>
                    <div className="mt-2 text-[13.5px] leading-snug">{headline(f, money)}</div>
                    <div className="num mt-1.5 text-[12px] text-muted">{money(f.finding.moneyAtRisk, 0)} at risk · {money(f.state.currentExtraPerDay || f.finding.deltaPerDay)}/day</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-growth/30 bg-growth/8 p-4 text-[13.5px]">
                <div className="flex items-center gap-2 font-semibold text-growth"><CheckCircle2 size={16} /> All normal</div>
                <p className="mt-1 text-muted">No open anomalies{v.isLatest ? '' : ` on ${dayName(v.date)}`}. Idle resources may still be costing money.</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={() => nav('/waste')}>Open Waste Finder</Button>
              </div>
            )}
          </Panel>
          <Panel title="Top services">
            <div className="space-y-2">
              {byService(a.allRows, v.date).slice(0, 5).map((s) => (
                <button key={s.name} onClick={() => setDrawer(s.name)} className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-sunk"><span className="truncate">{shortService(name(s.name))}</span><span className="num text-muted">{money(s.value)}</span></button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <ServiceDrawer service={drawer} onClose={() => setDrawer(null)} />
    </div>
  )
}
