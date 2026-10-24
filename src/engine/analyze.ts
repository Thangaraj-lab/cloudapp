import type { DayPoint, Explanation, Finding, IdleResource, Row, Verdict } from './types'
import { addDays, dailyTotals, groupDaily, median } from './series'
import { baseline, detect, DEFAULT_DETECT, type BaselinePoint, type DetectParams } from './detect'
import { explain, describe, shortService } from './explain'
import { judge } from './verdict'
import { injectedIdle } from './idle'
import { scenarioForDay, RESIDUAL_PCT } from './inject'
import { cpuHistory, riskProfile, type RiskLevel } from './risk'
import { buildPlan, buildSchedulePlan, SCHEDULE_SAVING, type ActionPlan } from './plan'

export interface Analyzed {
  finding: Finding
  explanation: Explanation
  verdict: Verdict
  /** Is the extra cost still there on the latest billing day? */
  state: { ongoing: boolean; currentExtraPerDay: number; baselinePerDay: number; latestPerDay: number; stoppedOn: string | null; lastDay: string }
  recommendation: {
    action: string
    plan: ActionPlan | null
    /** Extra cost per day on the affected line, at the time of the jump. */
    lineDeltaPerDay: number
    netMonthlySaving: number
    residualPct: number
    residualSource: 'data' | 'assumed'
    risk: RiskLevel | 'Unknown'
    rollback: string
    cpu: { avg: number; max: number } | null
    cpuSource: string | null
  }
}

export interface Analysis {
  series: DayPoint[]
  baseline: BaselinePoint[]
  /** Cases: anomalies in the whole bill (the reference method). */
  findings: Analyzed[]
  /** Extra signals: one service jumping inside a steady bill, and always-on non-production spend. */
  signals: Analyzed[]
  idle: IdleResource[]
}

/** Find a case or signal by id. */
export const findCase = (a: Pick<Analysis, 'findings' | 'signals'>, id?: string) =>
  a.findings.find((f) => f.finding.id === id) ?? a.signals.find((f) => f.finding.id === id)

/** What this finding costs per month if nothing changes (0 once it stopped or for growth). */
export const monthlyImpact = (a: Analyzed) => (a.verdict.kind === 'Growth' ? 0 : a.state.currentExtraPerDay * 30)

const NONPROD = /^(dev|development|test|testing|qa|staging|stage|sandbox|uat|demo)$/i
const RUNNABLE = /ec2|elastic compute|compute engine|virtual machine|\bvm|rds|relational database|cloud sql|sql database|kubernetes|eks|aks|gke|container|instance|opensearch|elasticache|redshift/i
const STORAGE = /ebs|block store|snapshot|storage|disk|volume/i
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

function lineDaily(rows: Row[], tp: { service: string; environment: string; application: string }) {
  const m = new Map<string, number>()
  for (const r of rows) if (r.service === tp.service && r.environment === tp.environment && r.application === tp.application) m.set(r.day, (m.get(r.day) ?? 0) + r.cost)
  return m
}
const meanOver = (m: Map<string, number>, from: string, to: string) => {
  let s = 0, n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) { s += m.get(d) ?? 0; n++ }
  return n ? s / n : 0
}

/** Storage that keeps billing after compute stops, measured from the same owner's lines. */
function residualFor(rows: Row[], tp: Analyzed['explanation']['topPath'], day: string): { pct: number; source: 'data' | 'assumed' } {
  if (tp.environment === 'untagged' && tp.application === 'untagged') return { pct: RESIDUAL_PCT, source: 'assumed' }
  const from = addDays(day, -30)
  let storage = 0, compute = 0
  for (const r of rows) {
    if (r.day < from || r.day > day || r.environment !== tp.environment || r.application !== tp.application) continue
    if (r.service === tp.service) compute += r.cost
    else if (STORAGE.test(r.service)) storage += r.cost
  }
  if (storage > 0 && compute > 0) return { pct: Math.min(0.6, storage / (storage + compute)), source: 'data' }
  return { pct: RESIDUAL_PCT, source: 'assumed' }
}

function actionText(verdict: Verdict['kind'], plan: ActionPlan | null, ex: Explanation, ongoing: boolean, stoppedOn: string | null) {
  if (verdict === 'Growth') return 'No change needed: this is demand-driven growth. Confirm it and set a budget for the new level.'
  if (!ongoing) return `This stopped by itself${stoppedOn ? ` around ${stoppedOn}` : ''}. Nothing to change; mark it resolved.`
  if (!plan) return 'Review this cost line with its owner.'
  const { service, environment, application } = ex.topPath
  if (plan.kind === 'schedule') return `Run ${environment} "${application}" only during working hours (Mon–Fri, 08:00–20:00)`
  if (plan.kind === 'vpc-endpoint') return 'Add S3 / DynamoDB gateway endpoints so this traffic stops paying NAT data processing'
  if (plan.kind === 'park-database') return `Snapshot and stop the ${environment} database "${application}"`
  if (plan.kind === 'park-compute') return `Back up and stop the ${environment} compute for "${application}"`
  return `Review and reduce ${service} in ${environment}${application !== 'untagged' ? ` for "${application}"` : ''}`
}

function enrich(rows: Row[], series: DayPoint[], finding: Finding, explanation: Explanation, verdict: Verdict, idle: IdleResource[]): Analyzed {
  const tp = explanation.topPath
  const lastDay = series.at(-1)?.day ?? finding.day
  const topApp = explanation.tree[0]?.children?.[0]?.children?.[0]
  const lineDeltaPerDay = Math.max(0, topApp?.delta ?? explanation.totalDelta)
  // Still happening? Compare the line's latest level with its level before the jump.
  const line = lineDaily(rows, tp)
  const baselinePerDay = meanOver(line, addDays(finding.day, -7), addDays(finding.day, -1))
  const latestPerDay = meanOver(line, addDays(lastDay, -2), lastDay)
  const recent = finding.day >= addDays(lastDay, -2)
  const extraNow = Math.max(0, latestPerDay - baselinePerDay)
  const ongoing = recent || extraNow >= 0.5 * Math.max(lineDeltaPerDay, 0.01)
  let stoppedOn: string | null = null
  if (!ongoing) for (let d = addDays(finding.day, 1); d <= lastDay; d = addDays(d, 1)) if ((line.get(d) ?? 0) - baselinePerDay < 0.5 * lineDeltaPerDay) { stoppedOn = d; break }
  const currentExtraPerDay = !ongoing ? 0 : recent ? lineDeltaPerDay : Math.min(extraNow, lineDeltaPerDay * 1.5)

  const region = explanation.byRegion[0]?.name ?? 'untagged'
  const plan = ongoing ? buildPlan(verdict.kind, { service: tp.service, region, environment: tp.environment, application: tp.application }) : null
  // Risk needs real CPU data for this workload; without it we say so.
  const match = idle.find((r) => r.source !== 'paired' && r.environment === tp.environment && (r.service === tp.service || r.service === 'unknown'))
  const cpu = match ? { avg: match.avgCpu, max: match.maxCpu } : null
  const risk: RiskLevel | 'Unknown' = cpu ? riskProfile(cpuHistory(cpu.avg, cpu.max, 1)).level : 'Unknown'
  const res = residualFor(rows, tp, finding.day)
  return {
    finding, explanation, verdict,
    state: { ongoing, currentExtraPerDay, baselinePerDay, latestPerDay, stoppedOn, lastDay },
    recommendation: {
      action: actionText(verdict.kind, plan, explanation, ongoing, stoppedOn),
      plan,
      lineDeltaPerDay,
      netMonthlySaving: verdict.kind === 'Growth' || !ongoing ? 0 : currentExtraPerDay * 30 * (1 - res.pct),
      residualPct: res.pct,
      residualSource: res.source,
      risk,
      rollback: plan?.rollback.title ?? 'Nothing to roll back.',
      cpu,
      cpuSource: match ? `${match.source === 'uploaded' ? 'utilization file' : 'injected scenario'} · ${match.id}` : null,
    },
  }
}

/** Non-production compute/database spend that runs every day of the week at a flat level. */
function steadyWaste(rows: Row[], series: DayPoint[], params: DetectParams, taken: Set<string>): Analyzed[] {
  if (series.length < 14) return []
  const lastDay = series.at(-1)!.day
  const from = addDays(lastDay, -13)
  const lines = new Map<string, { svc: string; env: string; app: string; region: string; m: Map<string, number> }>()
  for (const r of rows) {
    if (r.day < from || !NONPROD.test(r.environment) || !RUNNABLE.test(r.service)) continue
    const k = [r.service, r.environment, r.application].join('|')
    if (!lines.has(k)) lines.set(k, { svc: r.service, env: r.environment, app: r.application, region: r.region, m: new Map() })
    const l = lines.get(k)!
    l.m.set(r.day, (l.m.get(r.day) ?? 0) + r.cost)
  }
  const out: Analyzed[] = []
  for (const [k, l] of lines) {
    if (taken.has(k)) continue
    const days: string[] = []
    for (let d = from; d <= lastDay; d = addDays(d, 1)) days.push(d)
    const vals = days.map((d) => l.m.get(d) ?? 0)
    if (vals.filter((v) => v > 0).length < 13) continue
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    if (avg < Math.max(1, params.minChange * 0.2)) continue
    const wk = days.map((d) => new Date(d + 'T00:00:00Z').getUTCDay())
    const weekend = vals.filter((_, i) => wk[i] === 0 || wk[i] === 6)
    const weekday = vals.filter((_, i) => wk[i] !== 0 && wk[i] !== 6)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    if (mean(weekend) < 0.8 * mean(weekday)) continue
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - avg) ** 2, 0) / vals.length)
    const cv = sd / avg
    if (cv > 0.3) continue
    const node = (name: string, children?: Explanation['tree']) => ({ name, delta: avg, share: 1, children })
    const tp = { service: l.svc, environment: l.env, application: l.app }
    const parts = { subject: `${shortService(l.svc)} in ${l.env}${l.app !== 'untagged' ? `, app ${l.app}` : ''}`, add: avg, total: avg, share: 1, steady: true }
    const explanation: Explanation = {
      totalDelta: avg, tree: [node(l.svc, [node(l.env, [node(l.app)])])],
      byService: [node(l.svc)], byEnvironment: [node(l.env)], byApplication: [node(l.app)], byRegion: [node(l.region)],
      topPath: tp, parts, sentence: describe(parts, (n) => '$' + n.toFixed(2)), hasNegativeLines: false,
    }
    const verdict: Verdict = {
      kind: 'Waste', scores: { Waste: 0.8, Misconfig: 0.05, Growth: 0.15 }, confidence: cv < 0.15 ? 'High' : 'Medium', margin: 0.65,
      features: { devShare: 1, prodShare: 0, networkShare: 0, untaggedShare: 0, sustained: 1, idleSignal: 0 },
      reasons: [
        `Non-production (${l.env}) spend runs every day, including weekends (weekend level ${Math.round((mean(weekend) / Math.max(mean(weekday), 1e-9)) * 100)}% of weekdays)`,
        `The daily cost is flat (varies about ±${Math.round(cv * 100)}%), so nothing switches it off at night`,
        'Development and test environments are usually needed only during working hours',
      ],
      wouldChange: 'If this environment serves real users or round-the-clock jobs, tag it as production and it will not be flagged.',
    }
    const plan = buildSchedulePlan({ ...tp, region: l.region })
    const res = residualFor(rows, tp, lastDay)
    const finding: Finding = {
      id: 's-' + slug(k), day: from, cost: avg, baselineMedian: avg, mad: sd, z: 0, deltaPerDay: avg, severity: 'medium',
      moneyAtRisk: avg * 30, remainingDays: 30, scope: 'service', service: l.svc, kind: 'steady',
    }
    const extra = avg * SCHEDULE_SAVING
    out.push({
      finding, explanation, verdict,
      state: { ongoing: true, currentExtraPerDay: extra, baselinePerDay: 0, latestPerDay: avg, stoppedOn: null, lastDay },
      recommendation: {
        action: actionText('Waste', plan, explanation, true, null), plan, lineDeltaPerDay: avg,
        netMonthlySaving: extra * 30 * (1 - res.pct), residualPct: res.pct, residualSource: res.source,
        risk: 'Unknown', rollback: plan.rollback.title, cpu: null, cpuSource: null,
      },
    })
  }
  return out
}

export function analyze(rows: Row[], params: DetectParams = DEFAULT_DETECT, injected = false, uploadedIdle: IdleResource[] = []): Analysis {
  const series = dailyTotals(rows)
  const injectedDays = new Map<string, string>()
  if (injected) for (const p of series) { const s = scenarioForDay(p.day); if (s) injectedDays.set(p.day, s) }
  const idle = [...uploadedIdle, ...(injected ? injectedIdle() : [])]

  // 1) Jumps in the whole bill.
  const total = detect(series, params, injectedDays).map((f) => {
    const finding: Finding = { ...f, scope: 'total', kind: 'spike' }
    const explanation = explain(rows, finding, params.window)
    return enrich(rows, series, finding, explanation, judge(finding, explanation, series, idle), idle)
  })
  // 2) Jumps inside one service that the total hides (small service, big bill).
  const totalDays = new Set(total.flatMap((t) => [addDays(t.finding.day, -1), t.finding.day, addDays(t.finding.day, 1)]))
  const perService: Analyzed[] = []
  for (const [svc, m] of groupDaily(rows, (r) => r.service)) {
    const ser = series.map((p) => ({ day: p.day, cost: m.get(p.day) ?? 0 }))
    if (median(ser.map((p) => p.cost)) <= 0 && ser.filter((p) => p.cost > 0).length < params.window) continue
    for (const f of detect(ser, params)) {
      if (totalDays.has(f.day)) continue
      const finding: Finding = { ...f, id: `f-${f.day}-${slug(svc)}`, scope: 'service', service: svc, kind: 'spike' }
      const svcRows = rows.filter((r) => r.service === svc)
      const explanation = explain(svcRows, finding, params.window)
      perService.push(enrich(rows, series, finding, explanation, judge(finding, explanation, ser, idle), idle))
    }
  }
  const spikes = [...total, ...perService]
  // 3) Always-on non-production spend, unless an ongoing jump already covers that line.
  const taken = new Set(spikes.filter((s) => s.state.ongoing).map((s) => [s.explanation.topPath.service, s.explanation.topPath.environment, s.explanation.topPath.application].join('|')))
  const signals = [...perService, ...steadyWaste(rows, series, params, taken)]
  return { series, baseline: baseline(series, params), findings: total, signals, idle }
}
