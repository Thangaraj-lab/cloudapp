// B3 Service profile, B4 Trends, B5 Ownership.
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Shield, UserPlus } from 'lucide-react'
import { useAnalysis, useMoney, useName, useStore } from '../../store'
import { useView, useProjection } from '../../flow/timeline'
import { serviceStats } from '../../flow/services'
import { shortService } from '../../engine/explain'
import { headline, vsNormal, dayName } from '../../engine/narrate'
import { addDays } from '../../engine/series'
import { Badge, Button, PageHeader, Panel, Segmented, StateView, VerdictChip, toast, Honest } from '../../components/ui'
import { BaselineChart, StackedTrend, Bars } from '../../viz/charts'
import { WorldView } from '../../world/World'
import { Shares } from './ServiceDrawer'
import { useTrendSeries } from './Overview'
import { Ring } from '../../viz/charts'

export function ServiceProfile() {
  const { id = '' } = useParams()
  const service = decodeURIComponent(id)
  const a = useAnalysis()
  const v = useView()
  const money = useMoney()
  const name = useName()
  const nav = useNavigate()
  const params = useStore((s) => s.params)
  const st = useMemo(() => serviceStats(a.allRows, service, v.date, params), [a, service, v.date, params])
  const [tab, setTab] = useState<'env' | 'app' | 'region'>('env')
  if (!st.total && !a.allRows.some((r) => r.service === service)) return <StateView kind="error" title="Service not found" action={<Button onClick={() => nav('/overview')}>Back to overview</Button>}>No billing rows mention “{service}”.</StateView>
  const cases = [...a.findings, ...a.signals].filter((f) => f.explanation.topPath.service === service)
  const today = st.series.at(-1)!
  const idle = a.idle.filter((r) => r.service === service)
  const sentence = `${shortService(name(service))} cost ${money(st.total)} up to ${dayName(v.date)}, ${(st.share * 100).toFixed(1)}% of all spend.${today.median !== null ? ` On ${dayName(v.date)}: ${vsNormal(today.cost, today.median, money)}.` : ''}`
  return (
    <div className="space-y-5">
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Back</button>
      <PageHeader eyebrow={`Service profile · ${service}`} title={sentence}
        right={<>{cases[0] && <Button onClick={() => nav(`/case/${cases[0].finding.id}/understand`)}>Open case <ArrowRight size={15} /></Button>}<Button variant="ghost" onClick={() => nav('/guardrails?add=1')}><Shield size={15} /> Add rule</Button></>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Panel title="Daily cost and its normal range">
          <BaselineChart points={st.series} fmt={money} height={300} asOf={v.date} anomalies={cases.map((c) => c.finding.day)} />
          <p className="mt-2 text-[12.5px] text-muted">Shaded band = normal range (trailing 7-day median ± MAD). Red dots = unusual days.</p>
        </Panel>
        <WorldView height={380} focus={service} labelMode="top" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Breakdown" right={<Segmented size="sm" value={tab} onChange={setTab} options={[{ k: 'env', label: 'Env' }, { k: 'app', label: 'App' }, { k: 'region', label: 'Region' }]} />}>
          <Shares items={tab === 'env' ? st.byEnv : tab === 'app' ? st.byApp : st.byRegion} fmt={(n) => money(n)} />
        </Panel>
        <Panel title="Owners">
          <div className="flex items-center gap-4"><Ring value={st.tagged} label="tagged" /><div className="text-[13px] text-muted">Owners come from the application tag. {st.byApp.filter((x) => x.name !== 'untagged').length} apps own this spend.</div></div>
          <div className="mt-3 space-y-1 text-[13px]">{st.byApp.slice(0, 5).map((x) => <div key={x.name} className="flex justify-between"><span className={x.name === 'untagged' ? 'italic text-muted' : ''}>{x.name}</span><span className="num text-muted">{money(x.value)}</span></div>)}</div>
        </Panel>
        <Panel title="Case history and idle">
          {cases.length ? cases.map((c) => (
            <button key={c.finding.id} onClick={() => nav(`/case/${c.finding.id}/understand`)} className="mb-2 block w-full rounded-xl border border-line p-3 text-left text-[13px] hover:border-[var(--border-strong)]">
              <VerdictChip kind={c.verdict.kind} /><div className="mt-1.5">{headline(c, money)}</div>
            </button>
          )) : <p className="text-[13px] text-muted">No anomalies for this service.</p>}
          {idle.map((r) => <button key={r.id} onClick={() => nav(`/waste/${encodeURIComponent(r.id)}`)} className="link mt-2 block text-[13px]">Idle: {r.id} · {money(r.netSaving, 0)}/mo net</button>)}
        </Panel>
      </div>
    </div>
  )
}

export function Trends() {
  const a = useAnalysis()
  const v = useView()
  const money = useMoney()
  const name = useName()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const only = params.get('service') ?? undefined
  const [period, setPeriod] = useState<'7' | '14'>('7')
  const trend = useTrendSeries(undefined, only)
  const proj = useProjection(v.leakPerDay)
  const days = a.series.length
  const movers = useMemo(() => {
    const n = Number(period)
    const last = a.series.at(-1)?.day ?? ''
    const curFrom = addDays(last, -n + 1), prevFrom = addDays(last, -2 * n + 1)
    const m = new Map<string, [number, number]>()
    for (const r of a.allRows) {
      const e = m.get(r.service) ?? [0, 0]
      if (r.day >= curFrom) e[0] += r.cost
      else if (r.day >= prevFrom) e[1] += r.cost
      m.set(r.service, e)
    }
    return [...m.entries()].map(([s, [c, p]]) => ({ name: s, value: c - p, cur: c, prev: p })).sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).slice(0, 6)
  }, [a, period])
  if (days < 14) return <StateView title="Need 14 days" action={<Button onClick={() => nav('/connect?merge=1')}>Add an older export</Button>}>Trends compare periods, so they need at least 14 days of billing data. This dataset has {days}.</StateView>
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Trends" title={only ? `${shortService(name(only))} over time` : 'Spend by service over time'} sub="Click a series to open that service. Dashed lines are a projection."
        right={only ? <Button variant="ghost" onClick={() => nav('/trends')}>Show all services</Button> : undefined} />
      <Panel title="Daily spend, stacked" right={<Honest k="projection" />}>
        <StackedTrend days={trend.days} series={trend.series} fmt={money} height={380} asOf={v.date} projection={proj} onPick={(s) => s !== 'Other' && nav(`/service/${encodeURIComponent(s)}`)} />
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Top movers" right={<Segmented size="sm" value={period} onChange={setPeriod} options={[{ k: '7', label: 'Last 7 vs prior 7' }, { k: '14', label: '14 vs 14' }]} />}>
          <div className="space-y-2">
            {movers.map((m) => (
              <button key={m.name} onClick={() => nav(`/service/${encodeURIComponent(m.name)}`)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[13px] hover:bg-sunk">
                <span className="min-w-0 flex-1 truncate">{shortService(name(m.name))}</span>
                <span className="num text-muted">{money(m.prev)} → {money(m.cur)}</span>
                <Badge tone={m.value > 0 ? 'waste' : 'growth'}>{m.value > 0 ? '+' : ''}{money(m.value)}</Badge>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Month-end projection">
          <div className="grid grid-cols-2 gap-3">
            <div className="sunk p-3"><div className="text-[12px] text-muted">Do nothing</div><div className="num mt-1 font-display text-xl font-extrabold">{money(proj.monthEndDoNothing, 0)}</div></div>
            <div className="sunk p-3"><div className="text-[12px] text-muted">Apply open fixes</div><div className="num mt-1 font-display text-xl font-extrabold text-growth">{money(proj.monthEndApplyFix, 0)}</div></div>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">Actual to date {money(proj.actualToDate, 0)} plus, for each remaining day, the median of the last 14 days on the same weekday. Labelled as a projection everywhere it appears.</p>
        </Panel>
      </div>
    </div>
  )
}

export function Ownership() {
  const a = useAnalysis()
  const money = useMoney()
  const name = useName()
  const { owners, set, log } = useStore()
  const [assign, setAssign] = useState<Record<string, string>>({})
  const total = a.allRows.reduce((s, r) => s + r.cost, 0) || 1
  const untaggedRows = a.allRows.filter((r) => r.environment === 'untagged' || r.application === 'untagged')
  const noOwner = untaggedRows.reduce((s, r) => s + r.cost, 0)
  const lines = useMemo(() => {
    const m = new Map<string, { service: string; env: string; app: string; cost: number }>()
    for (const r of untaggedRows) {
      const k = [r.service, r.environment, r.application].join('|')
      const e = m.get(k) ?? { service: r.service, env: r.environment, app: r.application, cost: 0 }
      e.cost += r.cost
      m.set(k, e)
    }
    return [...m.entries()].sort((x, y) => y[1].cost - x[1].cost)
  }, [untaggedRows])
  const byEnv = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of a.allRows) m.set(r.environment, (m.get(r.environment) ?? 0) + r.cost)
    return [...m.entries()].map(([n, v]) => ({ name: n, value: v })).sort((x, y) => y.value - x.value)
  }, [a])
  const byApp = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of a.allRows) m.set(r.application, (m.get(r.application) ?? 0) + r.cost)
    return [...m.entries()].map(([n, v]) => ({ name: n, value: v })).sort((x, y) => y.value - x.value).slice(0, 8)
  }, [a])
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Ownership" title={`${money(noOwner)} has no owner`} sub={`${((noOwner / total) * 100).toFixed(1)}% of spend is missing an environment or application tag, so nobody is responsible for it.`} />
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Panel title="Tag coverage"><div className="flex justify-center"><Ring value={1 - noOwner / total} label="has an owner" size={150} /></div></Panel>
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Spend by environment"><Bars items={byEnv} fmt={(n) => money(n)} height={Math.max(120, byEnv.length * 32)} /></Panel>
          <Panel title="Spend by application (owner)"><Bars items={byApp} fmt={(n) => money(n)} height={Math.max(120, byApp.length * 32)} color="var(--growth)" /></Panel>
        </div>
      </div>
      <Panel title="Untagged spend" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wider text-muted"><th className="px-5 py-2">Service</th><th>Environment</th><th>Application</th><th className="text-right">Cost</th><th className="px-5 text-right">Owner</th></tr></thead>
            <tbody>
              {lines.slice(0, 20).map(([k, l]) => (
                <tr key={k} className="border-b border-line last:border-0">
                  <td className="px-5 py-2.5">{shortService(name(l.service))}</td>
                  <td className={l.env === 'untagged' ? 'italic text-muted' : ''}>{l.env}</td>
                  <td className={l.app === 'untagged' ? 'italic text-muted' : ''}>{l.app}</td>
                  <td className="num text-right">{money(l.cost)}</td>
                  <td className="px-5 py-2 text-right">
                    {owners[k] ? <Badge tone="growth">{owners[k]}</Badge> : (
                      <span className="inline-flex gap-1">
                        <input value={assign[k] ?? ''} onChange={(e) => setAssign({ ...assign, [k]: e.target.value })} placeholder="team or person" className="h-8 w-32 rounded-lg border border-line bg-sunk px-2 text-[12.5px]" />
                        <Button size="sm" variant="ghost" disabled={!assign[k]?.trim()} onClick={() => { const who = assign[k].trim(); set({ owners: { ...owners, [k]: who } }); log('owner assigned', { line: k, owner: who }); toast(`Owner set to ${who}.`, () => useStore.getState().set({ owners: { ...useStore.getState().owners, [k]: '' } })) }}><UserPlus size={13} /> Assign</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
