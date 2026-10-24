import type { Row } from '../engine/types'
import { baseline, type BaselinePoint } from '../engine/detect'
import { dateRange } from '../engine/series'
import type { DetectParams } from '../engine/detect'

export interface ServiceStats {
  service: string
  total: number
  share: number
  series: BaselinePoint[]
  byEnv: { name: string; value: number }[]
  byApp: { name: string; value: number }[]
  byRegion: { name: string; value: number }[]
  tagged: number // share of spend with an environment tag
}

const group = (rows: Row[], k: (r: Row) => string) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + r.cost)
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

export function serviceStats(all: Row[], service: string, upTo: string, params: DetectParams): ServiceStats {
  const days = dateRange(all).filter((d) => d <= upTo)
  const rows = all.filter((r) => r.service === service && r.day <= upTo)
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.day, (m.get(r.day) ?? 0) + r.cost)
  const total = rows.reduce((s, r) => s + r.cost, 0)
  const grand = all.filter((r) => r.day <= upTo).reduce((s, r) => s + r.cost, 0) || 1
  return {
    service, total, share: total / grand,
    series: baseline(days.map((d) => ({ day: d, cost: m.get(d) ?? 0 })), params),
    byEnv: group(rows, (r) => r.environment), byApp: group(rows, (r) => r.application), byRegion: group(rows, (r) => r.region),
    tagged: total ? rows.filter((r) => r.environment !== 'untagged').reduce((s, r) => s + r.cost, 0) / total : 0,
  }
}

export function byService(rows: Row[], upTo?: string) {
  return group(upTo ? rows.filter((r) => r.day <= upTo) : rows, (r) => r.service)
}
