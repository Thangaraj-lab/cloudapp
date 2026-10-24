import { rng } from './hash'

export const CEILING = 80
export const MULTIPLIERS = [1, 1.5, 3]
export type RiskLevel = 'Low' | 'Medium' | 'High'

/** 14 days x 24 hourly CPU samples for the workload being moved. */
export function cpuHistory(avg: number, max: number, seed = 1): number[] {
  const r = rng(seed)
  return Array.from({ length: 14 * 24 }, (_, h) => {
    const daily = 0.6 + 0.4 * Math.sin(((h % 24) / 24) * Math.PI * 2)
    return Math.min(max, Math.max(0, avg * daily * (0.5 + r())))
  })
}

function p995(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(0.995 * s.length))]
}

/**
 * Parking moves the workload onto a target half the size, so its CPU share
 * doubles. Each run resamples the history (bootstrap with jitter), scales by
 * the traffic multiplier and records the P99.5 peak.
 */
export function simulate(history: number[], multiplier: number, runs = 500, seed = 99, targetScale = 2) {
  const r = rng(seed + Math.round(multiplier * 100))
  const peaks: number[] = []
  for (let k = 0; k < runs; k++) {
    const sample = Array.from({ length: history.length }, () => {
      const v = history[Math.floor(r() * history.length)]
      return v * (0.8 + r() * 0.6)
    })
    peaks.push(p995(sample) * multiplier * targetScale)
  }
  const fails = peaks.filter((p) => p > CEILING).length
  return { multiplier, peaks, failRate: fails / runs, pass: fails / runs <= 0.05 }
}

export function riskProfile(history: number[], runs = 500, seed = 99) {
  const results = MULTIPLIERS.map((m) => simulate(history, m, runs, seed))
  const level: RiskLevel = results[2].pass ? 'Low' : results[1].pass ? 'Medium' : 'High'
  return { results, level }
}
