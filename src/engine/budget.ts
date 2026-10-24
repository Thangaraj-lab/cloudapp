import type { Row } from './types'
import { daysInMonth } from './series'

export interface BudgetLine { service: string; monthToDate: number; projected: number; budget: number | null; daysElapsed: number; daysInMonth: number; month: string }

/** Month-to-date spend per service for the latest month in the data, projected to month end. */
export function budgetStatus(rows: Row[], budgets: Record<string, number>): BudgetLine[] {
  const last = rows.reduce((m, r) => (r.day > m ? r.day : m), '')
  if (!last) return []
  const month = last.slice(0, 7)
  const dim = daysInMonth(last)
  const elapsed = Number(last.slice(8))
  const mtd = new Map<string, number>()
  for (const r of rows) if (r.day.startsWith(month)) mtd.set(r.service, (mtd.get(r.service) ?? 0) + r.cost)
  for (const s of Object.keys(budgets)) if (!mtd.has(s)) mtd.set(s, 0)
  return [...mtd.entries()]
    .map(([service, v]) => ({ service, monthToDate: v, projected: (v / elapsed) * dim, budget: budgets[service] ?? null, daysElapsed: elapsed, daysInMonth: dim, month }))
    .sort((a, b) => b.projected - a.projected)
}
