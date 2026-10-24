// Guardrails: a rule is a condition plus an action. Backtest replays it over history.
import type { Row } from './types'
import { addDays, dateRange, median } from './series'

export type RuleKind = 'idle-nonprod' | 'spike-alert' | 'nat-spike'
export interface Rule {
  id: string
  kind: RuleKind
  name: string
  /** idle-nonprod: days running in a row before it is parked. Alerts: multiple of the 7-day median. */
  threshold: number
  enabled: boolean
  createdAt: number
  fromCase?: string
}

export const RULE_TEMPLATES: Omit<Rule, 'id' | 'enabled' | 'createdAt'>[] = [
  { kind: 'idle-nonprod', name: 'Park dev/test compute that runs more than 7 days in a row', threshold: 7 },
  { kind: 'nat-spike', name: 'Alert when NAT / data-transfer cost is above 5× its normal day', threshold: 5 },
  { kind: 'spike-alert', name: 'Alert when any service costs more than 3× its normal day', threshold: 3 },
]

const NONPROD = /^(dev|development|test|testing|qa|staging|stage|sandbox|uat)$/i
const COMPUTE = /ec2|elastic compute|compute engine|virtual machine|\bvm|rds|relational database/i
const NETWORK = /nat|data ?transfer|vpc|networking|bandwidth/i

export interface Backtest {
  days: string[]
  actual: number[]
  withRule: number[]
  saved: number
  fired: { day: string; line: string; detail: string }[]
  /** Alert rules save nothing by themselves; they show when they would have warned. */
  alertOnly: boolean
}

/** Replays the rule day by day, using only data available up to that day. */
export function backtest(rows: Row[], rule: Pick<Rule, 'kind' | 'threshold'>): Backtest {
  const days = dateRange(rows)
  const idx = new Map(days.map((d, i) => [d, i]))
  const actual = days.map(() => 0)
  for (const r of rows) actual[idx.get(r.day)!] += r.cost
  const withRule = [...actual]
  const fired: Backtest['fired'] = []
  const lines = new Map<string, { label: string; m: Map<string, number> }>()
  for (const r of rows) {
    const k = [r.service, r.environment, r.application].join('|')
    if (!lines.has(k)) lines.set(k, { label: `${r.service} · ${r.environment} · ${r.application}`, m: new Map() })
    const l = lines.get(k)!
    l.m.set(r.day, (l.m.get(r.day) ?? 0) + r.cost)
  }
  if (rule.kind === 'idle-nonprod') {
    for (const [k, l] of lines) {
      const [svc, env] = k.split('|')
      if (!NONPROD.test(env) || !COMPUTE.test(svc)) continue
      let run = 0
      let parked = false
      for (const d of days) {
        const v = l.m.get(d) ?? 0
        // Parking takes effect the day after the rule fires.
        if (parked) { withRule[idx.get(d)!] -= v; continue }
        run = v > 0 ? run + 1 : 0
        if (run > rule.threshold) { parked = true; fired.push({ day: d, line: l.label, detail: `ran ${run} days in a row; parked from the next day` }) }
      }
    }
  } else {
    for (const [k, l] of lines) {
      const [svc] = k.split('|')
      if (rule.kind === 'nat-spike' && !NETWORK.test(svc)) continue
      for (const d of days) {
        const prev: number[] = []
        for (let i = 1; i <= 7; i++) prev.push(l.m.get(addDays(d, -i)) ?? 0)
        const base = median(prev)
        const v = l.m.get(d) ?? 0
        if (prev.filter((x) => x > 0).length >= 5 && base > 0 && v > rule.threshold * base && v - base >= 1)
          fired.push({ day: d, line: l.label, detail: `${(v / base).toFixed(1)}× its normal day` })
      }
    }
  }
  const saved = actual.reduce((s, v, i) => s + v - withRule[i], 0)
  return { days, actual, withRule, saved: Math.max(0, saved), fired, alertOnly: rule.kind !== 'idle-nonprod' }
}
