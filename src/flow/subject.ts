// One shape for "the thing being fixed": an anomaly case or an idle resource (Waste).
import { useMemo } from 'react'
import { findCase, type Analyzed } from '../engine/analyze'
import type { IdleResource } from '../engine/types'
import type { ActionPlan } from '../engine/plan'
import { buildPlan } from '../engine/plan'
import { cpuHistory, riskProfile, type RiskLevel } from '../engine/risk'
import { evaluate } from '../engine/policy'
import { headline } from '../engine/narrate'
import { shortService } from '../engine/explain'
import { sha256Hex } from '../engine/hash'
import { useAnalysis, useStore } from '../store'

export interface Subject {
  id: string
  kind: 'case' | 'waste'
  title: string
  service: string
  environment: string
  application: string
  region: string
  action: string
  perDay: number // current cost per day that the fix removes (before residual)
  netMonthly: number
  residualPct: number
  risk: RiskLevel | 'Unknown'
  rollback: string
  plan: ActionPlan | null
  cpu: { avg: number; max: number } | null
  injected: boolean
  growth: boolean
  ongoing: boolean
  analyzed?: Analyzed
  idle?: IdleResource
}

export const wasteId = (r: IdleResource) => 'w-' + r.id

export function fromCase(f: Analyzed, money: (n: number) => string): Subject {
  const tp = f.explanation.topPath
  return {
    id: f.finding.id, kind: 'case', title: headline(f, money), service: tp.service, environment: tp.environment, application: tp.application,
    region: f.recommendation.plan?.target.region ?? f.explanation.byRegion[0]?.name ?? 'untagged',
    action: f.recommendation.action, perDay: f.state.currentExtraPerDay, netMonthly: f.recommendation.netMonthlySaving, residualPct: f.recommendation.residualPct,
    risk: f.recommendation.risk, rollback: f.recommendation.rollback, plan: f.recommendation.plan, cpu: f.recommendation.cpu,
    injected: !!f.finding.injected, growth: f.verdict.kind === 'Growth', ongoing: f.state.ongoing, analyzed: f,
  }
}

export function fromIdle(r: IdleResource, money: (n: number, d?: number) => string): Subject {
  const plan = buildPlan('Waste', { service: r.service === 'Azure VM' ? 'Virtual Machines' : r.service, region: r.region, environment: r.environment, application: r.id })
  return {
    id: wasteId(r), kind: 'waste', title: `${r.id} has averaged ${r.avgCpu.toFixed(1)}% CPU for ${r.daysIdle} days and costs ${money(r.monthlyCost, 0)} a month.`,
    service: r.service, environment: r.environment, application: r.id, region: r.region,
    action: `Park ${r.id}: snapshot, then stop it (${shortService(r.service)})`, perDay: r.monthlyCost / 30, netMonthly: r.netSaving, residualPct: r.monthlyCost ? r.residual / r.monthlyCost : 0,
    risk: riskProfile(cpuHistory(r.avgCpu, r.maxCpu, 1)).level, rollback: plan?.rollback.title ?? 'Start it again from the snapshot', plan, cpu: { avg: r.avgCpu, max: r.maxCpu },
    injected: r.source === 'injected', growth: false, ongoing: true, idle: r,
  }
}

export function useSubject(id?: string) {
  const a = useAnalysis()
  const currency = useStore((s) => s.currency)
  return useMemo(() => {
    if (!id) return null
    const money = (n: number) => (currency === 'USD' ? '$' : '') + n.toFixed(2)
    if (id.startsWith('w-')) { const r = a.idle.find((x) => wasteId(x) === id); return r ? fromIdle(r, money) : null }
    const f = findCase(a, id)
    return f ? fromCase(f, money) : null
  }, [a, id, currency])
}

/** Approval is bound to this exact state: subject, cost and dataset fingerprint. */
export const stateHash = (s: Subject, fp: string | null) => sha256Hex(`${s.id}|${s.perDay.toFixed(4)}|${fp}`).slice(0, 16)

export function policyFor(s: Subject, fmt?: (n: number) => string) {
  return evaluate(useStore.getState().policy, { environment: s.environment, dailyCost: s.perDay, hasRollback: !!s.plan || s.kind === 'waste', fmt })
}
