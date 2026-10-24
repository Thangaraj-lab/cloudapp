// Month-end projection: actual to date + median of the last 14 days for the same weekday.
import type { DayPoint } from './types'
import { addDays, daysInMonth, median } from './series'

export interface Forecast {
  /** Projected days after the last real day (to month end, at least `minDays`). */
  days: string[]
  doNothing: number[]
  applyFix: number[]
  actualToDate: number
  monthEndDoNothing: number
  monthEndApplyFix: number
}

const weekday = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()

export function dailyForecast(series: DayPoint[], day: string): number {
  const last14 = series.slice(-14)
  const same = last14.filter((p) => weekday(p.day) === weekday(day)).map((p) => p.cost)
  return same.length ? median(same) : median(last14.map((p) => p.cost))
}

/** `savingPerDay` is removed from `fixFrom` onwards in the "apply fix" line. */
export function forecast(series: DayPoint[], savingPerDay = 0, fixFrom?: string, minDays = 7): Forecast {
  if (!series.length) return { days: [], doNothing: [], applyFix: [], actualToDate: 0, monthEndDoNothing: 0, monthEndApplyFix: 0 }
  const last = series.at(-1)!.day
  const monthStart = last.slice(0, 8) + '01'
  const actualToDate = series.filter((p) => p.day >= monthStart).reduce((s, p) => s + p.cost, 0)
  const remaining = daysInMonth(last) - Number(last.slice(8))
  const n = Math.max(minDays, remaining)
  const days: string[] = [], doNothing: number[] = [], applyFix: number[] = []
  const from = fixFrom ?? addDays(last, 1)
  for (let i = 1; i <= n; i++) {
    const d = addDays(last, i)
    const v = dailyForecast(series, d)
    days.push(d)
    doNothing.push(v)
    applyFix.push(d >= from ? Math.max(0, v - savingPerDay) : v)
  }
  const inMonth = (xs: number[]) => xs.slice(0, remaining).reduce((a, b) => a + b, 0)
  return { days, doNothing, applyFix, actualToDate, monthEndDoNothing: actualToDate + inMonth(doNothing), monthEndApplyFix: actualToDate + inMonth(applyFix) }
}
