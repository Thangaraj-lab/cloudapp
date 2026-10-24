// Real idle finder input: a utilization CSV, either one row per resource
// (avg/max CPU summary) or a time series (timestamp, resource, cpu) that we
// aggregate per resource. Billing exports carry no CPU, so this is separate.
import Papa from 'papaparse'
import type { IdleResource } from './types'
import { isIdle } from './idle'
import { parseCost, parseDay } from './ingest'
import { rng } from './hash'

export const UFIELDS = ['id', 'avgCpu', 'maxCpu', 'cpu', 'timestamp', 'days', 'monthlyCost', 'service', 'environment', 'region'] as const
export type UField = (typeof UFIELDS)[number]
export type UMapping = Partial<Record<UField, string>>

export const UFIELD_LABEL: Record<UField, string> = {
  id: 'Resource ID', avgCpu: 'Avg CPU %', maxCpu: 'Max / P95 CPU %', cpu: 'CPU % (time series)', timestamp: 'Timestamp (time series)',
  days: 'Days observed', monthlyCost: 'Monthly cost', service: 'Service', environment: 'Environment', region: 'Region',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const ALIASES: Record<UField, string[]> = {
  id: ['resourceid', 'vmid', 'instanceid', 'lineitemresourceid', 'resource', 'resourcename', 'name', 'id', 'hostname'],
  avgCpu: ['avgcpupct', 'avgcpu', 'cpuavg', 'averagecpu', 'meancpu', 'cpuutilizationaverage', 'avgcpuutilization', 'cpuaverage'],
  maxCpu: ['p95ofmaxcpupct', 'maxcpupct', 'maxcpu', 'cpumax', 'peakcpu', 'p95cpu', 'cpuutilizationmaximum', 'maxcpuutilization', 'cpumaximum'],
  cpu: ['cpu', 'cpupct', 'cpuutilization', 'cpupercent', 'percentagecpu', 'value'],
  timestamp: ['timestamp', 'time', 'datetime', 'date', 'day'],
  days: ['lifetimedays', 'daysobserved', 'days', 'uptimedays', 'observationdays'],
  monthlyCost: ['monthlycostusd', 'monthlycost', 'costpermonth', 'monthlyprice', 'cost'],
  service: ['service', 'servicename'],
  environment: ['environment', 'env'],
  region: ['region', 'location'],
}

export function detectUMapping(headers: string[]): UMapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  const m: UMapping = {}
  const used = new Set<string>()
  for (const f of UFIELDS) for (const a of ALIASES[f]) { const h = byNorm.get(a); if (h && !used.has(h)) { m[f] = h; used.add(h); break } }
  // A summary file (avg/max present) does not need time-series fields.
  if (m.avgCpu && m.maxCpu) { delete m.cpu; delete m.timestamp }
  return m
}

export interface UtilResult { resources: IdleResource[]; scanned: number; idleCount: number; missingCost: number; mode: 'summary' | 'timeseries' }

function spark(avg: number, max: number, seed: number) {
  const r = rng(seed)
  return Array.from({ length: 14 }, () => Math.min(max, Math.max(0, avg + (r() - 0.5) * avg * 1.2)))
}

export function analyzeUtilization(text: string, m: UMapping, defaultMonthlyCost: number | null, residualPct: number): UtilResult {
  const res = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true })
  const num = (v: string | undefined) => { const n = parseCost(v ?? ''); return n === null ? NaN : n }
  type Acc = { id: string; sum: number; n: number; max: number; days: Set<string>; daysCol?: number; cost?: number; service?: string; env?: string; region?: string }
  const acc = new Map<string, Acc>()
  const timeseries = !(m.avgCpu && m.maxCpu) && !!(m.cpu && m.timestamp)
  res.data.forEach((r, i) => {
    const id = (m.id ? r[m.id] : '') || `row-${i + 1}`
    let a = acc.get(id)
    if (!a) { a = { id, sum: 0, n: 0, max: 0, days: new Set() }; acc.set(id, a) }
    if (timeseries) {
      const c = num(r[m.cpu!]); if (isNaN(c)) return
      a.sum += c; a.n++; a.max = Math.max(a.max, c)
      const d = parseDay(r[m.timestamp!] ?? ''); if (d) a.days.add(d)
    } else {
      const avg = num(m.avgCpu ? r[m.avgCpu] : undefined), max = num(m.maxCpu ? r[m.maxCpu] : undefined)
      if (isNaN(avg) || isNaN(max)) return
      a.sum = avg; a.n = 1; a.max = max
      if (m.days) a.daysCol = num(r[m.days])
    }
    if (m.monthlyCost) { const c = num(r[m.monthlyCost]); if (!isNaN(c)) a.cost = c }
    if (m.service) a.service = r[m.service]
    if (m.environment) a.env = r[m.environment]
    if (m.region) a.region = r[m.region]
  })
  let missingCost = 0
  const all = [...acc.values()].filter((a) => a.n > 0)
  const resources: IdleResource[] = []
  all.forEach((a, i) => {
    const avg = a.sum / a.n
    const days = timeseries ? a.days.size : isNaN(a.daysCol ?? NaN) ? 14 : Math.floor(a.daysCol!)
    if (!isIdle(avg, a.max, days)) return
    const monthlyCost = a.cost ?? defaultMonthlyCost
    if (monthlyCost == null) missingCost++
    const mc = monthlyCost ?? 0
    const residual = mc * residualPct
    resources.push({
      id: a.id, service: a.service || 'unknown', environment: (a.env || 'untagged').toLowerCase(), region: a.region || 'untagged',
      avgCpu: +avg.toFixed(2), maxCpu: +a.max.toFixed(2), daysIdle: days, monthlyCost: mc, residual, netSaving: mc - residual,
      cpuSpark: spark(avg, a.max, i + 3), source: 'uploaded',
    })
  })
  resources.sort((x, y) => y.netSaving - x.netSaving)
  return { resources, scanned: all.length, idleCount: resources.length, missingCost, mode: timeseries ? 'timeseries' : 'summary' }
}
