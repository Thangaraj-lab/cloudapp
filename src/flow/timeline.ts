import { useMemo } from 'react'
import type { Analysis, Analyzed } from '../engine/analyze'
import type { Row } from '../engine/types'
import { forecast } from '../engine/forecast'
import { addDays } from '../engine/series'
import { useAnalysis, useStore, type FindingStatus } from '../store'

/** Statuses where the problem is still unresolved (a fix with no measured saving or a rollback leaves it open). */
const OPEN: (FindingStatus | undefined)[] = [undefined, 'new', 'approved', 'planned', 'running', 'inconclusive', 'not-effective', 'rolled-back', 'rejected']
export const needsAction = (f: Analyzed, s?: FindingStatus) => f.verdict.kind !== 'Growth' && f.state.ongoing && OPEN.includes(s)
/** A fix ran and the leak is stopped (pending or verified). */
export const isStopped = (s?: FindingStatus) => s === 'applied' || s === 'verified' || s === 'resolved' || s === 'expected' || s === 'dismissed'

/** Everything the Time Machine needs: the day being viewed and what is true on that day. */
export function useView() {
  const a = useAnalysis()
  const tm = useStore((s) => s.tm)
  const status = useStore((s) => s.status)
  const ledger = useStore((s) => s.ledger)
  return useMemo(() => view(a, tm.date, status, ledger), [a, tm.date, status, ledger])
}

export function view(a: Analysis & { allRows: Row[] }, date: string | null, status: Record<string, FindingStatus>, ledger: { status: string; measurement?: { monthlySaving: number }; estimatedMonthlySaving: number }[]) {
  const days = a.series.map((p) => p.day)
  const last = days.at(-1) ?? ''
  const d = date && date <= last ? date : last
  const idx = Math.max(0, days.indexOf(d))
  const point = a.baseline[idx]
  const spendToDate = a.series.slice(0, idx + 1).reduce((s, p) => s + p.cost, 0)
  const monthStart = d.slice(0, 8) + '01'
  const monthToDate = a.series.slice(0, idx + 1).filter((p) => p.day >= monthStart).reduce((s, p) => s + p.cost, 0)
  const visible = a.findings.filter((f) => f.finding.day <= d)
  const isLatest = d === last
  // On a past day a finding counts as live if it had not stopped yet.
  const live = visible.filter((f) => (isLatest ? needsAction(f, status[f.finding.id]) : f.verdict.kind !== 'Growth' && (!f.state.stoppedOn || f.state.stoppedOn > d)))
  const leakPerDay = live.reduce((s, f) => s + (isLatest ? f.state.currentExtraPerDay : f.finding.deltaPerDay), 0)
  const atRisk = live.reduce((s, f) => s + f.finding.moneyAtRisk, 0)
  const verified = ledger.filter((l) => l.status === 'verified').reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0)
  const pending = ledger.filter((l) => l.status === 'applied').reduce((s, l) => s + l.estimatedMonthlySaving, 0)
  const anomalyDays = new Set(a.findings.map((f) => f.finding.day))
  return {
    a, days, date: d, idx, isLatest, point,
    cost: point?.cost ?? 0, normal: point?.median ?? null,
    spendToDate, monthToDate, visible, live, leakPerDay, atRisk, verified, pending, anomalyDays,
    learning: Math.min(7, days.length),
  }
}

/** Rows up to the viewed day (for the 3D world and breakdowns). */
export function rowsUpTo(rows: Row[], d: string, windowDays = 0) {
  const from = windowDays ? addDays(d, -windowDays + 1) : ''
  return rows.filter((r) => r.day <= d && r.day >= from)
}

export function useProjection(savingPerDay = 0) {
  const a = useAnalysis()
  return useMemo(() => forecast(a.series, savingPerDay), [a.series, savingPerDay])
}
