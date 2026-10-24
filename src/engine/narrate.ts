// Deterministic sentences built from engine output. No language model involved.
import type { Analyzed } from './analyze'
import type { DayPoint } from './types'
import { shortService } from './explain'

type Money = (n: number, digits?: number) => string
export const dayName = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

const GUESS: Record<string, string> = {
  Waste: 'Looks like something left running.',
  Misconfig: 'Looks like a setting or routing problem.',
  Growth: 'Looks like real demand growing.',
}

/** "EC2 in dev added $11.51 a day since Sep 9. Looks like a forgotten test environment." */
export function headline(a: Analyzed, money: Money): string {
  const tp = a.explanation.topPath
  const where = tp.environment !== 'untagged' ? ` in ${tp.environment}` : ' (untagged)'
  if (a.finding.kind === 'steady') return `${shortService(tp.service)}${where} runs every day, weekends included, at about ${money(a.explanation.parts.add)} a day.`
  const guess = a.verdict.kind === 'Waste' && /^(dev|test|staging|qa)$/i.test(tp.environment) ? 'Looks like a forgotten test environment.' : GUESS[a.verdict.kind]
  return `${shortService(tp.service)}${where} added ${money(Math.max(0, a.explanation.parts.add))} a day since ${dayName(a.finding.day)}. ${guess}`
}

/** "$412 · 18% above normal". */
export function vsNormal(actual: number, normal: number, money: Money): string {
  if (normal <= 0) return `${money(actual)} · no normal yet`
  const pct = Math.round(((actual - normal) / normal) * 100)
  return `${money(actual)} · ${Math.abs(pct)}% ${pct >= 0 ? 'above' : 'below'} normal`
}

export interface BriefInput {
  series: DayPoint[]
  cases: Analyzed[]
  verifiedMonthly: number
  pendingMonthly: number
  idleMonthly: number
  idleCount: number
}

/** Founder Brief: four short paragraphs and one next action, a 60-second read. */
export function brief(b: BriefInput, money: Money): { title: string; paragraphs: string[]; next: string } {
  const total = b.series.reduce((s, p) => s + p.cost, 0)
  const first = b.series[0]?.day
  const last = b.series.at(-1)?.day
  const open = b.cases.filter((c) => c.state.ongoing && c.verdict.kind !== 'Growth')
  const leak = open.reduce((s, c) => s + c.state.currentExtraPerDay, 0)
  const top = [...b.cases].sort((x, y) => y.finding.moneyAtRisk - x.finding.moneyAtRisk).slice(0, 3)
  const paragraphs = [
    first && last
      ? `Cloud spend was ${money(total)} from ${dayName(first)} to ${dayName(last)}. ${b.cases.length} day${b.cases.length === 1 ? '' : 's'} stood out from the normal pattern.`
      : 'No billing data loaded yet.',
    top.length
      ? 'Biggest items: ' + top.map((c, i) => `(${i + 1}) ${headline(c, money)} Verdict: ${c.verdict.kind}, ${c.verdict.confidence.toLowerCase()} confidence.`).join(' ')
      : 'No anomalies were found in this period.',
    [
      open.length ? `${open.length} problem${open.length === 1 ? ' is' : 's are'} still running, about ${money(leak)} a day.` : 'Nothing is leaking right now.',
      b.idleCount ? `${b.idleCount} idle resource${b.idleCount === 1 ? '' : 's'} could free ${money(b.idleMonthly, 0)} a month, net of storage that keeps billing.` : '',
    ].filter(Boolean).join(' '),
    `Verified savings: ${money(b.verifiedMonthly, 0)} a month, measured from billing after each change. Waiting for verification: ${money(b.pendingMonthly, 0)} a month.`,
  ]
  const next = open[0]
    ? `Next: plan the fix for "${headline(open[0], money)}"`
    : b.idleCount ? 'Next: review the idle resources in Waste.' : 'Next: add a never-again rule so the same thing is caught early.'
  return { title: last ? `Founder Brief · ${dayName(last)}` : 'Founder Brief', paragraphs, next }
}
