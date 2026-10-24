import type { Row } from '../engine/types'
import type { ImportReport } from '../store'
import { dateRange, median } from '../engine/series'

export type FixId = 'drop-partial-day' | 'tag-untagged-shared'
export interface HealthItem { label: string; state: 'pass' | 'warn' | 'fail'; detail: string; fix?: { id: FixId; label: string } }
export interface Health { score: number; items: HealthItem[]; parts: { completeness: number; validity: number; duplicates: number; coverage: number; tags: number } }

const pct = (x: number) => `${Math.round(x * 100)}%`

/** Data Health 0–100 from five parts (20 points each), with a one-click fix where one exists. */
export function dataHealth(rows: Row[], r: ImportReport | null, hasUtil = false): Health {
  const items: HealthItem[] = []
  const read = r?.recordsRead ?? rows.length
  const spend = rows.reduce((s, x) => s + x.cost, 0) || 1

  // Validity: rows that parsed.
  const bad = r?.quarantined ?? 0
  const badPct = read ? bad / read : 0
  const validity = Math.max(0, 20 - badPct * 200)
  items.push({ label: 'Valid rows', state: badPct > 0.05 ? 'fail' : bad ? 'warn' : 'pass', detail: bad ? `${bad.toLocaleString()} of ${read.toLocaleString()} rows set aside with a reason (see the list below).` : `All ${read.toLocaleString()} rows parsed: dates, costs and services are readable.` })

  // Duplicates: removed automatically.
  const dups = r?.duplicates ?? 0
  const duplicates = Math.max(0, 20 - (read ? (dups / read) * 100 : 0))
  items.push({ label: 'Duplicates', state: dups ? 'warn' : 'pass', detail: dups ? `${dups.toLocaleString()} exact repeated lines were removed so nothing is counted twice.` : 'No repeated lines.' })

  // Completeness: non-usage rows separated, last day complete.
  const days = dateRange(rows)
  const totals = new Map<string, number>()
  for (const x of rows) totals.set(x.day, (totals.get(x.day) ?? 0) + x.cost)
  const last = days.at(-1)
  const prev = days.slice(-8, -1).map((d) => totals.get(d) ?? 0)
  const partial = !!last && prev.length >= 5 && (totals.get(last) ?? 0) < 0.5 * median(prev)
  let completeness = 20
  if (r?.nonUsage) items.push({ label: 'Non-usage rows', state: 'pass', detail: `${r.nonUsage.toLocaleString()} credit / tax / fee rows kept apart (total ${r.nonUsageTotal.toFixed(2)} ${r.currency}). Analysis uses usage only.` })
  if (partial) { completeness -= 8; items.push({ label: 'Last day looks partial', state: 'warn', detail: `${last} is under half a normal day; billing for it is probably still arriving.`, fix: { id: 'drop-partial-day', label: `Leave out ${last}` } }) }

  // Date coverage: enough history, no gaps.
  const have = new Set(rows.map((x) => x.day))
  const gaps = days.filter((d) => !have.has(d)).length
  let coverage = 20
  if (days.length < 14) { coverage -= 12; items.push({ label: 'History', state: 'fail', detail: `Only ${days.length} days. Need ≥14 days for a reliable baseline.` }) }
  else items.push({ label: 'History', state: 'pass', detail: `${days.length} days, ${days[0]} to ${last}. The first 7 are used to learn normal.` })
  if (gaps) { coverage -= Math.min(8, gaps * 2); items.push({ label: 'Date gaps', state: 'warn', detail: `${gaps} day${gaps === 1 ? '' : 's'} have no rows and count as zero spend.` }) }

  // Tags.
  const untagged = rows.filter((x) => x.environment === 'untagged').reduce((s, x) => s + x.cost, 0) / spend
  const tags = Math.round(20 * (1 - untagged))
  items.push({
    label: 'Environment tags', state: untagged > 0.4 ? 'fail' : untagged > 0.1 ? 'warn' : 'pass',
    detail: `${pct(1 - untagged)} of spend has an environment tag${untagged > 0.1 ? '; untagged spend is harder to judge and has no owner' : ''}.`,
    fix: untagged > 0.1 ? { id: 'tag-untagged-shared', label: 'Group untagged spend as "shared"' } : undefined,
  })
  if (!hasUtil) items.push({ label: 'CPU utilization', state: 'warn', detail: 'No utilization file: idle detection uses the paired public sample only.' })

  const parts = { completeness, validity, duplicates, coverage, tags }
  const score = Math.round(Object.values(parts).reduce((a, b) => a + b, 0))
  return { score: Math.max(0, Math.min(100, score)), items, parts }
}

/** Applies a fix and returns the new rows (the caller keeps the old rows for Undo). */
export function applyFix(rows: Row[], id: FixId): Row[] {
  if (id === 'drop-partial-day') {
    const last = rows.reduce((m, r) => (r.day > m ? r.day : m), '')
    return rows.filter((r) => r.day !== last)
  }
  return rows.map((r) => (r.environment === 'untagged' ? { ...r, environment: 'shared' } : r))
}
