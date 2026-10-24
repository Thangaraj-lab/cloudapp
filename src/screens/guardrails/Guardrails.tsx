import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Plus, Play, Power } from 'lucide-react'
import { useAnalysis, useMoney, useStore } from '../../store'
import { useView } from '../../flow/timeline'
import { findCase } from '../../engine/analyze'
import { backtest, RULE_TEMPLATES, type Rule, type RuleKind } from '../../engine/rules'
import { randomHex } from '../../engine/hash'
import { dayName } from '../../engine/narrate'
import { heightFor } from '../../world/model'
import { useEstate, WorldView } from '../../world/World'
import type { BuildingFx } from '../../world/Estate'
import { Badge, Button, PageHeader, Panel, StateView, toast } from '../../components/ui'
import { TwinCurves } from '../../viz/charts'

const LADDER = [
  { name: 'Observe', text: 'Find and explain only. No plans.' },
  { name: 'Recommend', text: 'Plans and savings, nothing runs.' },
  { name: 'Approve-first', text: 'Every change needs a named approver. Default.' },
  { name: 'Auto for dev/test', text: 'dev/test changes under the cost limit run without sign-off. Production never.' },
]

const unit = (k: RuleKind) => (k === 'idle-nonprod' ? 'days in a row' : '× normal day')

export function useRuleSuggestion(fromCase?: string | null): RuleKind {
  const a = useAnalysis()
  if (!fromCase) return 'idle-nonprod'
  const f = findCase(a, fromCase)
  if (fromCase.startsWith('w-') || f?.verdict.kind === 'Waste') return 'idle-nonprod'
  return /nat|transfer|vpc/i.test(f?.explanation.topPath.service ?? '') ? 'nat-spike' : 'spike-alert'
}

export default function Guardrails() {
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { trust, policy, rules, set, log } = useStore()
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [kind, setKind] = useState<RuleKind>('idle-nonprod')
  const [threshold, setThreshold] = useState(7)
  const preview = useMemo(() => backtest(a.allRows, { kind, threshold }), [a, kind, threshold])
  const addRule = (k: RuleKind, t: number, name?: string, from?: string) => {
    const tpl = RULE_TEMPLATES.find((x) => x.kind === k)!
    const r: Rule = { id: 'r-' + randomHex(3), kind: k, threshold: t, name: name ?? tpl.name.replace(/\d+(?=[ ×])/, String(t)), enabled: false, createdAt: Date.now(), fromCase: from }
    set({ rules: [...useStore.getState().rules, r] })
    log('rule created', { id: r.id, kind: k, threshold: t })
    return r
  }
  const setTrust = (i: number) => {
    const prev = { trust, policy }
    set({ trust: i, policy: { ...policy, autoApply: i === 3 } })
    log('policy changed', { trust: LADDER[i].name })
    toast(`Trust level: ${LADDER[i].name}.`, () => useStore.getState().set(prev))
  }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Guardrails" title="Stop the same problem from coming back" sub="Rules watch new billing data. Every rule can be backtested against your history before you turn it on."
        right={<Button onClick={() => setAdding(true)}><Plus size={15} /> Add rule</Button>} />
      <Panel title="Trust ladder">
        <div className="grid gap-2 md:grid-cols-4">
          {LADDER.map((l, i) => (
            <button key={l.name} onClick={() => setTrust(i)} className={`rounded-2xl border p-4 text-left transition-colors ${trust === i ? 'border-accent bg-accent/10' : 'border-line hover:border-[var(--border-strong)]'}`}>
              <div className="flex items-center gap-2"><span className={`num grid h-6 w-6 place-items-center rounded-full text-[12px] font-bold ${trust >= i ? 'bg-accent text-[var(--accent-ink)]' : 'bg-sunk text-muted'}`}>{i + 1}</span><span className="font-semibold">{l.name}</span></div>
              <p className="mt-2 text-[12.5px] text-muted">{l.text}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-muted">Production-tagged resources are {policy.blockProd ? 'never changed' : 'allowed'} · second approver above {money(policy.maxActionCostPerDay)}/day · rollback plan {policy.requireRollbackPlan ? 'required' : 'optional'}. Change these in Settings.</p>
      </Panel>
      {adding && (
        <Panel title="New rule">
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="space-y-3">
              {RULE_TEMPLATES.map((t) => (
                <label key={t.kind} className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-[13.5px] ${kind === t.kind ? 'border-accent bg-accent/8' : 'border-line'}`}>
                  <input type="radio" checked={kind === t.kind} onChange={() => { setKind(t.kind); setThreshold(t.threshold) }} className="mt-0.5 accent-[var(--accent)]" />
                  <span><b>{t.kind === 'idle-nonprod' ? 'Park' : 'Alert'}</b> · {t.name}</span>
                </label>
              ))}
              <label className="flex items-center gap-3 text-[13px]"><span className="text-muted">Threshold</span><input type="number" min={1} max={30} value={threshold} onChange={(e) => setThreshold(Math.max(1, +e.target.value))} className="num h-9 w-20 rounded-lg border border-line bg-sunk px-2" /><span className="text-muted">{unit(kind)}</span></label>
            </div>
            <div className="sunk p-4 text-[13px]">
              <div className="eyebrow">Backtest on your data</div>
              <div className="num mt-2 font-display text-2xl font-extrabold text-growth">{preview.alertOnly ? `${preview.fired.length} alert${preview.fired.length === 1 ? '' : 's'}` : money(preview.saved)}</div>
              <div className="mt-1 text-muted">{preview.alertOnly ? (preview.fired[0] ? `First would have fired on ${dayName(preview.fired[0].day)}.` : 'Would not have fired on this data.') : preview.saved > 0 ? 'would have been saved over this period' : 'Would have saved $0 on this data.'}</div>
              <div className="mt-4 flex gap-2"><Button size="sm" onClick={() => { addRule(kind, threshold); setAdding(false); toast('Rule added (off). Turn it on after the backtest.') }}>Add rule</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
            </div>
          </div>
        </Panel>
      )}
      <Panel title="Rules" pad={false}>
        {rules.length ? rules.map((r) => {
          const b = backtest(a.allRows, r)
          return (
            <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <button aria-label={r.enabled ? 'Turn off' : 'Turn on'} onClick={() => { set({ rules: rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) }); log(r.enabled ? 'rule disabled' : 'rule enabled', { id: r.id }) }}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-accent' : 'bg-sunk border border-line'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} /></button>
              <div className="min-w-0 flex-1"><div className="text-[14px] font-medium">{r.name}</div><div className="text-[12px] text-muted">{b.alertOnly ? `${b.fired.length} alert(s) in history` : `would have saved ${money(b.saved)}`}{r.fromCase ? ` · from case ${r.fromCase}` : ''}</div></div>
              <Button size="sm" variant="ghost" onClick={() => nav(`/guardrails/backtest?rule=${r.id}`)}><Play size={13} /> Backtest</Button>
            </div>
          )
        }) : <div className="px-5 py-8 text-center text-[13.5px] text-muted">No rules yet. Start from a suggestion below or add one.</div>}
      </Panel>
      <Panel title="Starter suggestions">
        <div className="grid gap-3 md:grid-cols-3">
          {RULE_TEMPLATES.map((t) => {
            const b = backtest(a.allRows, t)
            return (
              <div key={t.kind} className="flex flex-col rounded-2xl border border-line p-4">
                <div className="flex-1 text-[13.5px]">{t.name}</div>
                <div className="mt-3 text-[12.5px] text-muted">{b.alertOnly ? `${b.fired.length} alert(s) on your data` : `${money(b.saved)} saved on your data`}</div>
                <Button size="sm" variant="ghost" className="mt-3" onClick={() => { const r = addRule(t.kind, t.threshold, t.name); nav(`/guardrails/backtest?rule=${r.id}`) }}>Backtest <ArrowRight size={13} /></Button>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

export function Backtest() {
  const a = useAnalysis()
  const v = useView()
  const money = useMoney()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const { rules, set, log, notify } = useStore()
  const suggested = useRuleSuggestion(params.get('from'))
  const existing = rules.find((r) => r.id === params.get('rule'))
  const tpl = RULE_TEMPLATES.find((t) => t.kind === suggested)!
  const rule = existing ?? { ...tpl, id: '', enabled: false, createdAt: 0 }
  const b = useMemo(() => backtest(a.allRows, rule), [a, rule.kind, rule.threshold])
  const estate = useEstate()
  // Ghost twin: buildings as they would have been on the viewed day with the rule on.
  const fx = useMemo(() => {
    const out: Record<string, BuildingFx> = {}
    if (b.alertOnly) return out
    for (const bd of estate.buildings) {
      const parked = b.fired.filter((f) => f.line.startsWith(bd.service + ' · ') && f.day < v.date)
      if (!parked.length) continue
      const removed = a.allRows.filter((r) => r.day === v.date && r.service === bd.service && parked.some((f) => f.line === `${r.service} · ${r.environment} · ${r.application}`)).reduce((s, r) => s + r.cost, 0)
      out[bd.id] = { twin: heightFor(Math.max(0, bd.cost - removed), estate.maxDay) }
    }
    return out
  }, [b, estate, v.date, a])
  const savedToDate = b.days.reduce((s, d, i) => (d <= v.date ? s + b.actual[i] - b.withRule[i] : s), 0)
  if (!a.series.length) return <StateView title="No data" />
  const turnOn = () => {
    if (existing) set({ rules: rules.map((r) => (r.id === existing.id ? { ...r, enabled: true } : r)) })
    else set({ rules: [...rules, { ...rule, id: 'r-' + randomHex(3), enabled: true, createdAt: Date.now(), fromCase: params.get('from') ?? undefined }] })
    log('rule enabled', { kind: rule.kind, threshold: rule.threshold, backtestSaved: +b.saved.toFixed(2) })
    notify({ kind: 'rule', text: `Rule on: ${rule.name}`, to: '/guardrails' })
    toast('Rule turned on.')
    nav('/guardrails')
  }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Guardrails · backtest" title={b.alertOnly ? (b.fired.length ? `Would have alerted ${b.fired.length} time${b.fired.length === 1 ? '' : 's'}, first on ${dayName(b.fired[0].day)}` : 'Would not have fired on this data') : b.saved > 0 ? `Would have saved ${money(b.saved)} over this period` : 'Would have saved $0 on this data'}
        sub={`${rule.name}. Replayed day by day using only the data available up to each day.`}
        right={<Button size="lg" onClick={turnOn}><Power size={16} /> Turn on</Button>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <WorldView height={420} fx={fx} labelMode="top" overlay={<div className="glass absolute bottom-3 left-3 px-3 py-2 text-[12.5px] text-muted">Ghost twin (translucent emerald) = the estate with the rule on · {dayName(v.date)}: <b className="text-ink">{money(savedToDate)}</b> saved so far</div>} />
        <Panel title="Two cost curves">
          <TwinCurves days={b.days} actual={b.actual} withRule={b.withRule} fmt={money} asOf={v.date} />
          {b.alertOnly && <p className="mt-2 text-[12.5px] text-muted">Alert rules do not change cost by themselves; they warn early so a person can act.</p>}
          {!b.alertOnly && b.saved === 0 && <p className="mt-2 text-[12.5px] text-muted">Nothing in this data ran long enough to trigger it. It still protects future data.</p>}
        </Panel>
      </div>
      {b.fired.length > 0 && (
        <Panel title="When it would have fired">
          <div className="space-y-1.5 text-[13px]">{b.fired.slice(0, 12).map((f, i) => <div key={i} className="flex flex-wrap gap-2"><Badge tone="accent">{dayName(f.day)}</Badge><span>{f.line}</span><span className="text-muted">— {f.detail}</span></div>)}</div>
        </Panel>
      )}
    </div>
  )
}
