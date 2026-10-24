import type { Row } from './types'
import { addDays, median } from './series'

export type ActionStatus = 'planned' | 'applied' | 'verified' | 'inconclusive' | 'not-effective' | 'rolled-back' | 'cancelled'

export interface LedgerEntry {
  id: string
  findingId: string
  findingDay: string
  action: string
  line: { service: string; region: string; environment: string; application: string }
  createdAt: number
  approvedBy: string
  secondApprover?: string
  approvalNonce: string
  checks?: { label: string; state: 'pass' | 'warn' | 'fail'; detail: string }[]
  stepsDone?: number[]
  appliedOn?: string // billing day the change took effect, chosen by the user
  estimatedMonthlySaving: number
  measurement?: Measurement
  status: ActionStatus
}

export interface Measurement {
  beforeDaily: number
  afterDaily: number
  noise: number
  daysBefore: number
  daysAfter: number
  monthlySaving: number
  verdict: 'verified' | 'inconclusive' | 'no-saving'
}

export const VERIFY_DAYS = 7
const BEFORE_DAYS = 3

const lineRows = (rows: Row[], l: LedgerEntry['line']) =>
  rows.filter((r) => r.service === l.service && r.environment === l.environment && r.application === l.application && (l.region === 'untagged' || r.region === l.region))

/** Last billing day present in the data. */
export const lastDay = (rows: Row[]) => rows.reduce((m, r) => (r.day > m ? r.day : m), '')

/** Days of billing data available after the change date (exclusive). */
export function daysAfter(rows: Row[], appliedOn: string): number {
  const end = lastDay(rows)
  if (!end || end <= appliedOn) return 0
  return Math.round((Date.parse(end) - Date.parse(appliedOn)) / 86400000)
}

const mad = (xs: number[]) => { const m = median(xs); return median(xs.map((x) => Math.abs(x - m))) }

/**
 * Measured, not assumed, and robust to spikes that end on their own:
 *  - before = median cost of the affected line over the last 3 days before the
 *    change (its level when the change was made, never earlier than the finding)
 *  - after  = median over the 7 days after the change
 *  - the drop must exceed 3× the line's normal day-to-day noise to count as verified.
 */
export function measure(rows: Row[], e: LedgerEntry): Measurement | null {
  if (!e.appliedOn || daysAfter(rows, e.appliedOn) < VERIFY_DAYS) return null
  const byDay = new Map<string, number>()
  for (const r of lineRows(rows, e.line)) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.cost)
  const range = (from: string, to: string) => { const out: number[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(byDay.get(d) ?? 0); return out }
  const findingDay = e.findingDay ?? addDays(e.appliedOn, -VERIFY_DAYS)
  let from = addDays(e.appliedOn, -BEFORE_DAYS)
  if (from < findingDay) from = findingDay
  const to = addDays(e.appliedOn, -1)
  const before = from <= to ? range(from, to) : range(to, to)
  const after = range(addDays(e.appliedOn, 1), addDays(e.appliedOn, VERIFY_DAYS))
  const baseline = range(addDays(findingDay, -VERIFY_DAYS), addDays(findingDay, -1))
  const beforeDaily = median(before)
  const afterDaily = median(after)
  const noise = Math.max(mad(baseline), mad(after), 0.02 * beforeDaily, 0.01)
  const diff = beforeDaily - afterDaily
  const verdict = diff <= 0 ? 'no-saving' : diff > 3 * noise ? 'verified' : 'inconclusive'
  return { beforeDaily, afterDaily, noise, daysBefore: before.length, daysAfter: after.length, monthlySaving: Math.max(0, diff) * 30, verdict }
}

/** Simulated days still needed after the real data to reach VERIFY_DAYS. */
export const simulatedDaysNeeded = (rows: Row[], e: LedgerEntry) => (e.appliedOn ? Math.max(0, VERIFY_DAYS - daysAfter(rows, e.appliedOn)) : VERIFY_DAYS)

/**
 * Simulated clock ("Fast-forward 7 days"): billing rows for the days after the
 * real data ends, built from the line's own level before the change minus the
 * estimated saving. Rows carry `injected: 'simulated'` and are never stored as real data.
 */
export function simulateAfter(rows: Row[], e: LedgerEntry, days = VERIFY_DAYS): Row[] {
  if (!e.appliedOn) return []
  const byDay = new Map<string, number>()
  for (const r of lineRows(rows, e.line)) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.cost)
  const from = e.findingDay && e.findingDay > addDays(e.appliedOn, -BEFORE_DAYS) ? e.findingDay : addDays(e.appliedOn, -BEFORE_DAYS)
  const before: number[] = []
  for (let d = from; d < e.appliedOn; d = addDays(d, 1)) before.push(byDay.get(d) ?? 0)
  if (!before.length) before.push(byDay.get(e.appliedOn) ?? 0)
  const after = Math.max(0, median(before) - e.estimatedMonthlySaving / 30)
  const end = lastDay(rows)
  const start = end > e.appliedOn ? end : e.appliedOn
  const out: Row[] = []
  for (let i = 1; i <= days; i++) out.push({ day: addDays(start, i), ...e.line, cost: after * (1 + 0.01 * Math.sin(i * 1.7)), injected: 'simulated' })
  return out
}
