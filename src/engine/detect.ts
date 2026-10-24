import type { DayPoint, Finding, Severity } from './types'
import { daysInMonth, median } from './series'

export interface DetectParams {
  window: number
  zThreshold: number
  minChange: number
}

export const DEFAULT_DETECT: DetectParams = { window: 7, zThreshold: 3.5, minChange: 5 }
export const MAD_FLOOR = 0.01

export interface BaselinePoint extends DayPoint {
  median: number | null
  mad: number | null
  z: number | null
}

export function baseline(series: DayPoint[], p: DetectParams = DEFAULT_DETECT): BaselinePoint[] {
  return series.map((pt, i) => {
    if (i < p.window) return { ...pt, median: null, mad: null, z: null }
    const win = series.slice(i - p.window, i).map((x) => x.cost)
    const med = median(win)
    const mad = Math.max(median(win.map((x) => Math.abs(x - med))), MAD_FLOOR)
    return { ...pt, median: med, mad, z: (0.6745 * (pt.cost - med)) / mad }
  })
}

const severity = (z: number): Severity => (Math.abs(z) >= 6 ? 'high' : Math.abs(z) >= 4.5 ? 'medium' : 'low')

/**
 * Flags upward anomalies. Consecutive flagged days form one episode and are
 * reported once, on the first day (a step change keeps flagging until the
 * trailing window catches up).
 */
export function detect(series: DayPoint[], p: DetectParams = DEFAULT_DETECT, injectedDays?: Map<string, string>): Finding[] {
  const b = baseline(series, p)
  const out: Finding[] = []
  let prevFlagged = false
  for (const pt of b) {
    const flagged =
      pt.z !== null && pt.z > p.zThreshold && pt.cost - (pt.median ?? 0) >= p.minChange
    if (flagged && !prevFlagged) {
      const delta = pt.cost - pt.median!
      const dim = daysInMonth(pt.day)
      const remaining = dim - Number(pt.day.slice(8)) + 1
      out.push({
        id: 'f-' + pt.day,
        day: pt.day,
        cost: pt.cost,
        baselineMedian: pt.median!,
        mad: pt.mad!,
        z: pt.z!,
        deltaPerDay: delta,
        severity: severity(pt.z!),
        remainingDays: remaining,
        moneyAtRisk: delta * remaining,
        injected: injectedDays?.get(pt.day),
      })
    }
    prevFlagged = flagged
  }
  return out
}
