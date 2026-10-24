import type { DayPoint, Row } from './types'

export function addDays(day: string, n: number): string {
  if (!day) return day // no data yet: nothing to shift
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function dateRange(rows: Row[]): string[] {
  if (!rows.length) return []
  const days = rows.map((r) => r.day).sort()
  const out: string[] = []
  for (let d = days[0]; d <= days[days.length - 1]; d = addDays(d, 1)) out.push(d)
  return out
}

/** Daily totals with gaps filled as 0 so the baseline window is calendar-based. */
export function dailyTotals(rows: Row[]): DayPoint[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.cost)
  return dateRange(rows).map((day) => ({ day, cost: m.get(day) ?? 0 }))
}

export const total = (rows: Row[]) => rows.reduce((s, r) => s + r.cost, 0)

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function daysInMonth(day: string): number {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function groupDaily(rows: Row[], key: (r: Row) => string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const k = key(r)
    if (!out.has(k)) out.set(k, new Map())
    const g = out.get(k)!
    g.set(r.day, (g.get(r.day) ?? 0) + r.cost)
  }
  return out
}
