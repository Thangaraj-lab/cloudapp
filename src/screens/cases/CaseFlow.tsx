import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, ChevronDown, Copy, Layers, Play, RotateCcw, Shield, AlertTriangle, CheckCircle2, Receipt } from 'lucide-react'
import { useMoney, useStore, useAnalysis } from '../../store'
import { useSubject, type Subject } from '../../flow/subject'
import { entryFor, finishRun, receiptHash } from '../../flow/actions'
import { useEstate, WorldView } from '../../world/World'
import type { BuildingFx } from '../../world/Estate'
import { RunScene } from '../../world/Sims'
import { BaselineChart, DeltaSunburst, Waterfall, DotCloud } from '../../viz/charts'
import { LeakMeter, VerdictCard } from '../../components/Signature'
import { Badge, Button, Honest, Panel, Segmented, StateView, Stepper, toast } from '../../components/ui'
import { cpuHistory, riskProfile, simulate } from '../../engine/risk'
import { STEPS, plan as sagaPlan } from '../../engine/execute'
import { planAsText } from '../../engine/plan'
import { shortService } from '../../engine/explain'
import { dayName } from '../../engine/narrate'
import { ApprovalStep } from './Approve'
import { api, useBackend } from '../../flow/backend'
import { create } from 'zustand'
import { pairingKey, sign } from '../../engine/approval'

const STEP_INDEX = { understand: 2, fix: 3, approve: 4, run: 5, result: 6 } as const
type StepName = keyof typeof STEP_INDEX
const phone = typeof window !== 'undefined' && window.innerWidth < 640
export const riskTone = { Low: 'growth', Medium: 'misconfig', High: 'waste', Unknown: 'neutral' } as const

function useCurrentDone(s: Subject) {
  const st = useStore((x) => x.status[s.id])
  return st === 'verified' || st === 'applied' ? 6 : st === 'approved' || st === 'running' ? 4 : st === 'rolled-back' ? 4 : 2
}

export default function CaseFlow() {
  const { id = '', step = 'understand' } = useParams()
  const s = useSubject(id)
  const nav = useNavigate()
  const done = useCurrentDone(s ?? ({ id } as Subject))
  if (!s) return <StateView kind="error" title="This case is not in the current data" action={<Button onClick={() => nav('/cases')}>Back to cases</Button>}>It may belong to an earlier dataset or the injected scenarios were switched off.</StateView>
  if (!(step in STEP_INDEX)) return <Navigate to={`/case/${id}/understand`} replace />
  if (s.kind === 'waste' && step === 'understand') return <Navigate to={`/waste/${encodeURIComponent(s.idle!.id)}`} replace />
  const k = step as StepName
  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 -mx-4 border-b border-line bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => nav(s.kind === 'waste' ? '/waste' : '/cases')} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} /> {s.kind === 'waste' ? 'Waste' : 'Cases'}</button>
          <Stepper current={STEP_INDEX[k]} done={done} />
          <div className="ml-auto flex gap-2">{s.injected && <Honest k="injected" />}</div>
        </div>
      </div>
      <div>
        <div className="eyebrow">{s.kind === 'waste' ? 'Idle resource' : `Case · ${dayName(s.analyzed!.finding.day)}`}</div>
        <h1 className="mt-1 max-w-4xl text-[22px] font-extrabold leading-snug sm:text-[26px]">{s.title}</h1>
      </div>
      {k === 'understand' && <Understand s={s} />}
      {k === 'fix' && <Fix s={s} />}
      {k === 'approve' && <ApprovalStep s={s} />}
      {k === 'run' && <Run s={s} />}
      {k === 'result' && <Result s={s} />}
    </div>
  )
}

/** C2: incident replay + What / Where / Verdict. */
function Understand({ s }: { s: Subject }) {
  const f = s.analyzed!
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const { status, setStatus, log } = useStore()
  const params = useStore((x) => x.params)
  const [where, setWhere] = useState<'sunburst' | 'waterfall' | 'region'>('sunburst')
  const [split, setSplit] = useState(false)
  const estate = useEstate(f.finding.day)
  const v = f.verdict.kind
  const fx: Record<string, BuildingFx> = { [s.service]: v === 'Waste' ? { lights: 0, beam: 2.2, tone: 'waste', split } : v === 'Misconfig' ? { beam: 3.4, tone: 'misconfig', split } : { tone: 'growth', rise: 1.15, split } }
  const points = useMemo(() => {
    if (f.finding.scope === 'service') {
      const m = new Map<string, number>()
      for (const r of a.allRows) if (r.service === s.service) m.set(r.day, (m.get(r.day) ?? 0) + r.cost)
      return a.baseline.map((p) => ({ ...p, cost: m.get(p.day) ?? 0, median: null, mad: null, z: null }))
    }
    return a.baseline
  }, [a, f, s.service, params])
  const ex = f.explanation
  const replay = v === 'Waste' ? 'Replay: the building keeps billing with its lights off, so the cost beam stays thick.' : v === 'Misconfig' ? 'Replay: the cost pipe through this service swells while the rest of the estate stays flat.' : 'Replay: the production building rises with demand and stays balanced.'
  const st = status[f.finding.id]
  return (
    <div className="grid gap-5 lg:grid-cols-[45%_1fr]">
      <div className="lg:sticky lg:top-32 lg:self-start">
        <WorldView height={phone ? 300 : 520} estate={estate} focus={s.service} fx={fx} labelMode="top"
          overlay={<div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
            <div className="glass max-w-[70%] px-3 py-2 text-[12.5px] text-muted">{replay}</div>
            <button onClick={() => setSplit(!split)} className={`glass flex items-center gap-1.5 px-3 py-2 text-[12.5px] ${split ? 'text-accent' : 'text-muted'}`}><Layers size={14} /> Split floors by environment</button>
          </div>} />
      </div>
      <div className="space-y-5">
        <Panel title="What happened" right={<AiWording findingId={f.finding.id} enabled={f.finding.scope !== 'service' && f.finding.kind !== 'steady'} />}>
          <p className="text-[15px] leading-relaxed">{ex.sentence.replace(/\$(\d+\.\d+)/g, (_, n) => money(Number(n)))}</p>
          <AiSentence findingId={f.finding.id} />
          <div className="mt-4"><BaselineChart points={points} fmt={money} height={230} anomalies={[f.finding.day]} focus={f.finding.day} label={f.finding.scope === 'service' ? shortService(s.service) : 'Daily total'} /></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <LeakMeter perDay={f.verdict.kind === 'Growth' ? 0 : f.state.currentExtraPerDay} stopped={st === 'applied' || st === 'verified'} size="sm"
              label={f.verdict.kind === 'Growth' ? 'Growth is demand, not a leak' : !f.state.ongoing ? `Stopped by itself ${f.state.stoppedOn ? 'on ' + dayName(f.state.stoppedOn) : ''}` : undefined} />
            <div className="sunk p-4 text-[13px]">
              <div className="flex justify-between"><span className="text-muted">That day</span><span className="num font-semibold">{money(f.finding.cost)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Normal (7-day median)</span><span className="num">{money(f.finding.baselineMedian)}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Robust z</span><span className="num">{f.finding.z ? f.finding.z.toFixed(1) : '—'}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted">Money at risk</span><span className="num text-waste">{money(f.finding.moneyAtRisk, 0)}</span></div>
            </div>
          </div>
        </Panel>
        <Panel title="Where it came from" right={<Segmented size="sm" value={where} onChange={setWhere} options={[{ k: 'sunburst', label: 'Tree' }, { k: 'waterfall', label: 'Waterfall' }, { k: 'region', label: 'Region' }]} />}>
          {where === 'sunburst' && <DeltaSunburst tree={ex.tree} fmt={money} />}
          {where === 'waterfall' && <Waterfall base={f.finding.baselineMedian} parts={ex.byService.slice(0, 5).map((n) => ({ name: n.name, delta: n.delta }))} total={f.finding.cost} fmt={money} />}
          {where === 'region' && <div className="space-y-2">{ex.byRegion.map((r) => <div key={r.name} className="flex justify-between text-[13px]"><span>{r.name}</span><span className="num text-muted">{r.delta >= 0 ? '+' : ''}{money(r.delta)}/day · {Math.round(r.share * 100)}%</span></div>)}</div>}
          <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-3">
            {[['Service', ex.byService[0]], ['Environment', ex.byEnvironment[0]], ['Application', ex.byApplication[0]]].map(([l, n]) => n && typeof n === 'object' && (
              <div key={l as string} className="sunk p-3"><div className="text-[11.5px] text-muted">{l as string}</div><div className={`mt-0.5 truncate font-semibold ${n.name === 'untagged' ? 'italic text-muted' : ''}`}>{shortService(n.name)}</div><div className="num text-[12px] text-muted">{Math.round(n.share * 100)}% of the jump</div></div>
            ))}
          </div>
          {ex.hasNegativeLines && <p className="mt-2 text-[12px] text-muted">Shares can pass 100% when other lines moved slightly down that day.</p>}
        </Panel>
        <Panel title="Verdict"><VerdictCard f={f} /></Panel>
        <div className="flex flex-wrap gap-2">
          {f.verdict.kind === 'Growth' ? (
            <Button size="lg" onClick={() => { setStatus(f.finding.id, 'expected'); log('marked expected', { findingId: f.finding.id }); toast('Marked as expected growth.', () => useStore.getState().setStatus(f.finding.id, 'new')); nav('/cases') }}>Mark as expected <CheckCircle2 size={16} /></Button>
          ) : !f.state.ongoing ? (
            <Button size="lg" onClick={() => { setStatus(f.finding.id, 'resolved'); log('marked resolved', { findingId: f.finding.id }); toast('Marked resolved.', () => useStore.getState().setStatus(f.finding.id, 'new')); nav('/cases') }}>Mark resolved</Button>
          ) : (
            <Button size="lg" onClick={() => nav(`/case/${f.finding.id}/fix`)}>Plan the fix <ArrowRight size={16} /></Button>
          )}
          {!f.state.ongoing && f.verdict.kind !== 'Growth' && <Button variant="ghost" onClick={() => nav('/guardrails/backtest')}><Shield size={15} /> Add never-again rule</Button>}
        </div>
      </div>
    </div>
  )
}

/** Local LLM wording (backend + Ollama). The engine decides; the model only words the facts. */
const useAi = create<Record<string, { text: string; source: string; reason?: string; model?: string; ms: number } | 'loading'>>(() => ({}))
function AiWording({ findingId, enabled }: { findingId: string; enabled: boolean }) {
  const up = useBackend((b) => b.status === 'up' && !!b.health?.llm.available)
  const r = useAi((x) => x[findingId])
  if (!up || !enabled) return null
  return <Button size="sm" variant="ghost" disabled={r === 'loading'} onClick={() => { useAi.setState({ [findingId]: 'loading' }); api<{ text: string; source: string; ms: number }>('/narrate', { json: { findingId } }).then((x) => useAi.setState({ [findingId]: x })).catch(() => useAi.setState({ [findingId]: { text: '', source: 'error', ms: 0 } })) }}>{r === 'loading' ? 'Asking local AI…' : 'Local AI wording'}</Button>
}
function AiSentence({ findingId }: { findingId: string }) {
  const r = useAi((x) => x[findingId])
  if (!r || r === 'loading' || !r.text) return null
  return (
    <div className="mt-3 rounded-xl border border-accent/30 bg-accent/6 px-3 py-2 text-[13.5px]">
      <div>{r.text}</div>
      <div className="mt-1 text-[11px] text-muted">{r.source === 'llm' ? `${r.model} on this laptop · ${r.ms} ms · numbers checked against the engine` : `Template sentence (${r.reason})`}</div>
    </div>
  )
}

/** C3: action, net saving, risk with a What-if slider, rollback plan. */
function Fix({ s }: { s: Subject }) {
  const money = useMoney()
  const nav = useNavigate()
  const [mult, setMult] = useState(1)
  const hist = useMemo(() => (s.cpu ? cpuHistory(s.cpu.avg, s.cpu.max, 1) : null), [s.cpu?.avg, s.cpu?.max])
  const profile = useMemo(() => (hist ? riskProfile(hist) : null), [hist])
  const [res, setRes] = useState(() => (hist ? simulate(hist, 1) : null))
  const t = useRef(0)
  useEffect(() => { if (!hist) return; clearTimeout(t.current); t.current = window.setTimeout(() => setRes(simulate(hist, mult)), 120) }, [mult, hist])
  const [open, setOpen] = useState(false)
  const estate = useEstate()
  const stress = res ? Math.min(1, res.failRate * 3 + (res.peaks.reduce((a, b) => a + b, 0) / res.peaks.length) / 160) : undefined
  const high = (profile?.level ?? s.risk) === 'High'
  if (s.growth) return <StateView title="Growth needs no fix" action={<Button onClick={() => nav(`/case/${s.id}/understand`)}>Back</Button>}>This cost follows demand. Mark it as expected instead.</StateView>
  return (
    <div className="grid gap-5 lg:grid-cols-[45%_1fr]">
      <WorldView height={phone ? 300 : 480} estate={estate} focus={s.service} fx={{ [s.service]: { stress, tone: undefined } }} labelMode="top"
        overlay={stress !== undefined && <div className="glass absolute bottom-3 left-3 right-3 px-3 py-2 text-[12.5px]"><div className="flex justify-between"><span className="text-muted">Stress on the target at {mult.toFixed(1)}× traffic</span><span className="num font-semibold">{Math.round(stress * 100)}%</span></div><div className="mt-1.5 h-1.5 rounded-full bg-sunk"><div className="h-full rounded-full" style={{ width: `${stress * 100}%`, background: stress > 0.6 ? 'var(--waste)' : stress > 0.35 ? 'var(--misconfig)' : 'var(--accent)' }} /></div></div>} />
      <div className="space-y-5">
        <Panel title="Recommended action">
          <p className="text-[16px] font-semibold leading-snug">{s.action}</p>
          <p className="mt-1 text-[12.5px] text-muted">{s.service} · {s.region} · env {s.environment} · {s.kind === 'waste' ? 'resource' : 'app'} {s.application}</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="sunk p-3"><div className="text-[11.5px] text-muted">Net saving</div><div className="num mt-1 font-display text-lg font-extrabold text-growth">{money(s.netMonthly, 0)}/mo</div><div className="text-[11px] text-muted">after {Math.round(s.residualPct * 100)}% residual</div></div>
            <div className="sunk p-3"><div className="text-[11.5px] text-muted">Risk</div><div className="mt-1.5"><Badge tone={riskTone[profile?.level ?? s.risk]}>{(profile?.level ?? s.risk) === 'Unknown' ? 'Not assessed' : profile?.level ?? s.risk}</Badge></div><div className="mt-1 text-[11px] text-muted">{s.cpu ? `CPU avg ${s.cpu.avg.toFixed(1)}%, max ${s.cpu.max.toFixed(0)}%` : 'no CPU data'}</div></div>
            <div className="sunk p-3"><div className="text-[11.5px] text-muted">Rollback</div><div className="mt-1 text-[12.5px] font-medium leading-snug">{s.rollback}</div></div>
          </div>
          {high && <div className="mt-4 flex gap-2 rounded-xl border border-misconfig/40 bg-misconfig/8 p-3 text-[13px]"><AlertTriangle size={16} className="mt-0.5 shrink-0 text-misconfig" /><div><b>High risk at higher traffic.</b> <span className="text-muted">Safer alternative: schedule it off outside working hours instead of stopping it, or resize to the next size down first.</span></div></div>}
        </Panel>
        <Panel title="What if traffic grows?">
          {hist && res ? (
            <>
              <div className="flex items-center gap-4"><input type="range" min={1} max={4} step={0.1} value={mult} onChange={(e) => setMult(+e.target.value)} className="flex-1" aria-label="Traffic multiplier" /><span className="num w-12 text-right font-semibold">{mult.toFixed(1)}×</span></div>
              <DotCloud peaks={res.peaks} />
              <p className="text-[12.5px] text-muted">500 simulated weeks (seeded): each dot is a P99.5 CPU peak on the target. {Math.round(res.failRate * 100)}% cross the 80% limit at {mult.toFixed(1)}× — {res.pass ? 'passes' : 'fails'} with 20% headroom.</p>
              <div className="mt-2 flex gap-2">{profile!.results.map((r) => <Badge key={r.multiplier} tone={r.pass ? 'growth' : 'waste'}>{r.multiplier}× {r.pass ? 'pass' : 'fail'}</Badge>)}</div>
            </>
          ) : <p className="text-[13px] text-muted">Risk is not assessed: there is no CPU data for this workload. Load a utilization file in Data sources to turn this on.</p>}
        </Panel>
        {s.plan && (
          <Panel title="Plan and rollback" right={<button onClick={() => navigator.clipboard?.writeText(planAsText(s.plan!)).then(() => toast('Plan copied.'))} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink"><Copy size={13} /> Copy</button>}>
            <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-[13px] text-muted"><span>{2 + s.plan.change.length + 1} steps: find, back up, change, verify · rollback ready</span><ChevronDown size={15} className={open ? 'rotate-180' : ''} /></button>
            {open && (
              <ol className="mt-3 space-y-3 text-[13px]">
                {[s.plan.discover, s.plan.backup, ...s.plan.change, s.plan.verify, s.plan.rollback].map((p, i) => (
                  <li key={i}><div className="font-medium">{i + 1}. {p.title}</div><div className="text-muted">{p.why}</div>{p.command && <code className="sunk mt-1 block overflow-x-auto whitespace-pre p-2 font-mono text-[11px]">{p.command}</code>}</li>
                ))}
              </ol>
            )}
          </Panel>
        )}
        <Button size="lg" onClick={() => nav(`/case/${s.id}/approve`)}>Review & approve <ArrowRight size={16} /></Button>
      </div>
    </div>
  )
}

/** C5: make-before-break run with a step timeline and log. With the backend up it runs for
 *  real against the local cloud (boto3 → moto EC2); otherwise it is the labelled simulation. */
function Run({ s }: { s: Subject }) {
  const nav = useNavigate()
  const e = entryFor(s.id)
  const backend = useBackend()
  // Injected demo findings live only in the browser analysis. They are not in
  // the backend dataset, so sending them to /api/actions would produce
  // "Unknown finding". Keep those scenarios on the deterministic simulator;
  // imported findings can still execute against the local cloud.
  const remoteCapable = backend.status === 'up' && s.kind === 'case' && !s.injected && s.analyzed?.finding.scope !== 'service' && s.analyzed?.finding.kind !== 'steady'
  const [failAt, setFailAt] = useState(0)
  const [events, setEvents] = useState<{ step: number; label: string; status: string; at: string; detail?: string }[]>([])
  const [cur, setCur] = useState(-1)
  const [state, setState] = useState<'ready' | 'running' | 'done' | 'rolled-back'>('ready')
  const [remote, setRemote] = useState<{ id: string; steps: string[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  // Follow the executor's live events for this action.
  useEffect(() => {
    if (!remote) return
    const seen = new Set<number>()
    let finished = false
    const apply = (st: ReturnType<typeof useBackend.getState>) => {
      st.exec.forEach((ev, i) => {
        if (ev.actionId !== remote.id || seen.has(i)) return
        seen.add(i)
        const detail = Object.entries(ev.detail ?? {}).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')
        setCur(ev.status === 'ok' ? ev.step + 1 : ev.step)
        setEvents((x) => [...x, { step: ev.step, label: ev.label, status: ev.status, at: new Date(ev.at).toLocaleTimeString(), detail }])
      })
      const l = st.lastLedger
      if (!finished && l && l.id === remote.id && (l.status === 'applied' || l.status === 'rolled-back')) {
        finished = true
        const ok = l.status === 'applied'
        if (e) finishRun(e.id, ok, failAt || undefined)
        setState(ok ? 'done' : 'rolled-back')
      }
    }
    apply(useBackend.getState())
    return useBackend.subscribe(apply)
  }, [remote])
  if (!e || (e.status !== 'planned' && state === 'ready')) return <Navigate to={e && e.status !== 'rolled-back' ? `/case/${s.id}/result` : `/case/${s.id}/approve`} replace />

  const startRemote = async () => {
    setErr(null); setState('running'); setEvents([]); useStore.getState().setStatus(s.id, 'running')
    try {
      // The person already approved in this app (PIN or phone). The API gets its own signed,
      // single-use request so its ledger and audit chain record the same approval.
      // A phone approval already created the API action; otherwise request + sign one now.
      let c = { actionId: useBackend.getState().remoteActions[s.id] }
      if (!c.actionId) {
        const req = await api<{ policy: { result: string; reasons: string[] }; body?: string }>('/approvals/request', { json: { findingId: s.id, device: `laptop · approved by ${e.approvedBy}` } })
        if (req.policy.result === 'deny' || !req.body) throw new Error(req.policy.reasons[0])
        const token = sign(pairingKey(useStore.getState().pairingCode), req.body)
        c = await api<{ actionId: string }>('/approvals/consume', { json: { findingId: s.id, token } })
      }
      const { [s.id]: _used, ...rest } = useBackend.getState().remoteActions
      void _used
      useBackend.setState({ remoteActions: rest })
      const run = await api<{ steps: string[] }>(`/actions/${c.actionId}/run`, { json: { failAt: failAt || null } })
      useStore.getState().log('execute started', { actionId: e.id, remoteId: c.actionId, target: backend.health?.cloud.endpoint, simulateFailureAt: failAt || null, mode: 'local cloud' })
      setRemote({ id: c.actionId, steps: run.steps })
    } catch (x) {
      setErr((x as Error).message); setState('ready'); useStore.getState().setStatus(s.id, 'approved')
    }
  }
  const startSimulated = () => {
    const p = sagaPlan(failAt || undefined)
    setState('running'); setEvents([]); useStore.getState().setStatus(s.id, 'running')
    useStore.getState().log('execute started', { actionId: e.id, simulateFailureAt: failAt || null, mode: 'simulated' })
    let t = 0
    p.events.forEach((ev, i) => {
      t += ev.status === 'rolled-back' ? 450 : 600 + ((i * 97) % 300)
      timers.current.push(window.setTimeout(() => {
        setCur(ev.status === 'rolled-back' ? ev.step : ev.status === 'failed' ? ev.step : ev.step + 1)
        setEvents((x) => [...x, { ...ev, at: new Date().toLocaleTimeString() }])
        useStore.getState().log('execute step', { actionId: e.id, step: ev.step + 1, label: ev.label, status: ev.status })
        if (i === p.events.length - 1) {
          const ok = p.outcome === 'done'
          finishRun(e.id, ok, failAt || undefined)
          setState(ok ? 'done' : 'rolled-back')
        }
      }, t))
    })
  }
  const steps = remote?.steps ?? STEPS
  const failed = events.some((x) => x.status === 'failed')
  return (
    <div className="space-y-4">
      {remoteCapable || remote ? (
        <div className="flex flex-wrap items-center gap-2"><Badge tone="accent">Local cloud · {backend.health?.cloud.mode} · {backend.health?.cloud.endpoint}</Badge><span className="text-[12.5px] text-muted">Real boto3 calls against a mock AWS API on this laptop, not your AWS account. Snapshots, images and instance states change in the local cloud.</span></div>
      ) : (
        <div className="flex flex-wrap items-center gap-2"><Honest k="simulated" /><span className="text-[12.5px] text-muted">The approve-first, rollback and audit logic is real; the cloud calls are simulated. Start the backend to run against the local cloud.</span></div>
      )}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <RunScene step={state === 'ready' ? -1 : cur} failed={failed} rolledBack={state === 'rolled-back' || (failed && events.at(-1)?.status === 'rolled-back')} oldLabel={shortService(s.service) + ' · current'} newLabel={s.plan?.kind === 'vpc-endpoint' ? 'Gateway endpoint' : 'Snapshot / backup image'} height={440} />
        <Panel title="Steps">
          <ol className="space-y-1.5">
            {steps.map((l, i) => {
              const ev = [...events].reverse().find((x) => x.step === i)
              const tone = ev?.status === 'failed' ? 'text-waste' : ev?.status === 'rolled-back' ? 'text-misconfig' : ev ? 'text-growth' : 'text-muted'
              return <li key={l} className={`flex items-center gap-2 text-[13px] ${tone}`}><span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[10px]">{i + 1}</span><span className={ev ? 'text-ink' : ''}>{l}</span><span className="ml-auto text-[11px]">{ev?.status === 'ok' ? 'done' : ev?.status ?? ''}</span></li>
            })}
          </ol>
          {state === 'ready' && (
            <div className="mt-5 space-y-3">
              <label className="flex items-center justify-between gap-2 text-[13px]"><span className="text-muted">Simulate failure at step</span>
                <select value={failAt} onChange={(x) => setFailAt(+x.target.value)} className="rounded-lg border border-line bg-sunk px-2 py-1.5"><option value={0}>none</option>{steps.slice(1, 6).map((l, i) => <option key={l} value={i + 2}>{i + 2}. {l}</option>)}</select></label>
              <Button size="lg" className="w-full" onClick={remoteCapable ? startRemote : startSimulated}><Play size={16} /> {remoteCapable ? 'Run on local cloud' : 'Start live run'}</Button>
              {err && <p className="text-[13px] text-waste">{err}</p>}
            </div>
          )}
          {state === 'running' && remote && <p className="mt-4 text-[12.5px] text-muted">Executing… steps arrive live from the API.</p>}
          {state === 'rolled-back' && <div className="mt-4 rounded-xl border border-waste/40 bg-waste/8 p-3 text-[13px]"><b className="text-waste">Rolled back.</b> Every completed step was undone in reverse. No saving counted.</div>}
          {(state === 'done' || state === 'rolled-back') && <Button size="lg" className="mt-4 w-full" onClick={() => nav(`/case/${s.id}/result`)}>See the result <ArrowRight size={16} /></Button>}
        </Panel>
      </div>
      {events.length > 0 && <Panel title="Log"><div className="num max-h-56 overflow-y-auto font-mono text-[11.5px]">{events.map((x, i) => <div key={i} className={x.status === 'failed' ? 'text-waste' : x.status === 'rolled-back' ? 'text-misconfig' : 'text-muted'}>{x.at} · step {x.step + 1} · {x.label} · {x.status}{x.detail ? ` · ${x.detail}` : ''}</div>)}</div></Panel>}
    </div>
  )
}

/** C6: leak stopped, receipt preview, never-again rule. */
function Result({ s }: { s: Subject }) {
  const nav = useNavigate()
  const money = useMoney()
  const e = entryFor(s.id)
  if (!e) return <Navigate to={`/case/${s.id}/approve`} replace />
  if (e.status === 'planned') return <Navigate to={`/case/${s.id}/run`} replace />
  const rolled = e.status === 'rolled-back'
  return (
    <div className="grid gap-5 lg:grid-cols-[45%_1fr]">
      <WorldView height={phone ? 300 : 440} focus={s.service} fx={{ [s.service]: rolled ? { tone: 'waste' } : { beam: 0, tone: 'verified', lights: 0.2 } }} labelMode="top" />
      <div className="space-y-5">
        {rolled ? (
          <Panel title="Rolled back" edge="waste">
            <p className="text-[14px]">A step failed, so every completed step was undone in reverse order. The resource is as it was and no saving is counted. The case stays open.</p>
            <div className="mt-4 flex gap-2"><Button onClick={() => nav(`/case/${s.id}/approve`)}><RotateCcw size={15} /> Retry (needs a new approval)</Button><Button variant="ghost" onClick={() => nav('/proof/trust')}>See the audit trail</Button></div>
          </Panel>
        ) : (
          <>
            <LeakMeter perDay={s.perDay} stopped size="lg" label={e.status === 'verified' ? `Verified: ${money(e.measurement?.monthlySaving ?? 0, 0)}/month saved.` : undefined} />
            <Panel title="Savings receipt" right={<Badge tone={e.status === 'verified' ? 'growth' : 'misconfig'}>{e.status === 'verified' ? 'Verified' : 'Pending verification'}</Badge>}>
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div><div className="text-muted">Action</div><div className="font-medium">{e.action}</div></div>
                <div><div className="text-muted">Estimated saving</div><div className="num font-semibold text-growth">{money(e.estimatedMonthlySaving, 0)}/mo</div></div>
                <div><div className="text-muted">Approved by</div><div>{e.approvedBy}{e.secondApprover ? ` + ${e.secondApprover}` : ''}</div></div>
                <div><div className="text-muted">Effective</div><div className="num">{e.appliedOn}</div></div>
              </div>
              <div className="mt-3 truncate font-mono text-[11px] text-muted">receipt {receiptHash(e).slice(0, 32)}…</div>
              <p className="mt-3 text-[12.5px] text-muted">Verification compares the 7 days after the change with the level before it. Use “Fast-forward 7 days” on Savings (simulated clock), or load a newer billing export to measure it from real data.</p>
              <div className="mt-4 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => nav('/proof/savings')}><Receipt size={15} /> Open Savings</Button></div>
            </Panel>
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Button size="lg" onClick={() => nav(`/guardrails/backtest?from=${encodeURIComponent(s.id)}`)}><Shield size={16} /> Add never-again rule</Button>
            </motion.div>
          </>
        )}
      </div>
    </div>
  )
}
