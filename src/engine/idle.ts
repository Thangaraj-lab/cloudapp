import Papa from 'papaparse'
import type { IdleResource } from './types'
import { RESIDUAL_PCT, SCENARIOS, SCENARIO_A_DAILY } from './inject'
import { rng } from './hash'

// Demo price per core-month for the paired Azure VM rows (labelled in UI).
export const DEMO_PRICE_PER_CORE_MONTH = 30

export const isIdle = (avg: number, max: number, days: number) => avg < 5 && max < 20 && days >= 14

function spark(avg: number, max: number, seed: number): number[] {
  const r = rng(seed)
  return Array.from({ length: 14 }, () => Math.min(max, Math.max(0, avg + (r() - 0.5) * avg * 1.2)))
}

export function injectedIdle(): IdleResource[] {
  const avg = 2.1
  const max = 6
  const days = 21
  if (!isIdle(avg, max, days)) return []
  const monthlyCost = SCENARIO_A_DAILY * 30
  const residual = monthlyCost * RESIDUAL_PCT
  return [
    {
      id: SCENARIOS.A.resource,
      service: 'Amazon Elastic Compute Cloud',
      environment: 'dev',
      region: 'us-east-1',
      avgCpu: avg,
      maxCpu: max,
      daysIdle: days,
      monthlyCost,
      residual,
      netSaving: monthlyCost - residual,
      cpuSpark: spark(avg, max, 7),
      source: 'injected',
    },
  ]
}

export function pairedIdle(csv: string, limit = 25): IdleResource[] {
  const res = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true })
  return res.data
    .map((r) => ({
      id: r.vm_id,
      days: Number(r.lifetime_days),
      avg: Number(r.avg_cpu_pct),
      p95: Number(r.p95_of_max_cpu_pct),
      cores: Number(r.cores_bucket) || 1,
    }))
    .filter((v) => v.avg < 5 && v.p95 < 20 && v.days >= 14)
    .sort((a, b) => b.days - a.days)
    .slice(0, limit)
    .map((v, i) => {
      const monthlyCost = v.cores * DEMO_PRICE_PER_CORE_MONTH
      const residual = monthlyCost * RESIDUAL_PCT
      return {
        id: v.id,
        service: 'Azure VM',
        environment: 'untagged',
        region: 'paired-demo',
        avgCpu: v.avg,
        maxCpu: v.p95,
        daysIdle: Math.floor(v.days),
        monthlyCost,
        residual,
        netSaving: monthlyCost - residual,
        cpuSpark: spark(v.avg, v.p95, i + 11),
        source: 'paired' as const,
      }
    })
    .sort((a, b) => b.netSaving - a.netSaving)
}
