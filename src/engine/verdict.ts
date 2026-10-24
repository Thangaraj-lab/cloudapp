import type { Confidence, DayPoint, Explanation, Finding, IdleResource, Verdict, VerdictKind } from './types'

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const NETWORK = /NAT|Data Transfer|DataTransfer|CloudWatch|VPC|Load Balanc|Request/i
const pct = (x: number) => Math.round(x * 100) + '%'

/** Positive share of the jump carried by nodes matching a predicate. */
function shareOf(nodes: { name: string; delta: number }[], total: number, pred: (n: string) => boolean) {
  if (total <= 0) return 0
  return clamp(nodes.filter((n) => pred(n.name)).reduce((s, n) => s + n.delta, 0) / total)
}

export function sustainedScore(series: DayPoint[], f: Finding, days = 3): number {
  const i = series.findIndex((p) => p.day === f.day)
  const after = series.slice(i + 1, i + 1 + days)
  if (!after.length || f.deltaPerDay <= 0) return 0.5
  const minLift = Math.min(...after.map((p) => p.cost - f.baselineMedian))
  return clamp(minLift / f.deltaPerDay)
}

export function judge(f: Finding, ex: Explanation, series: DayPoint[], idle: IdleResource[]): Verdict {
  const t = ex.totalDelta
  const devShare = shareOf(ex.byEnvironment, t, (n) => /^(dev|test|staging|untagged)$/i.test(n))
  const prodShare = shareOf(ex.byEnvironment, t, (n) => /^prod/i.test(n))
  const untaggedShare = shareOf(ex.byEnvironment, t, (n) => n === 'untagged')
  const networkShare = shareOf(ex.byService, t, (n) => NETWORK.test(n))
  const sustained = sustainedScore(series, f)
  const idleSignal = idle.some(
    (r) =>
      r.source !== 'paired' &&
      r.environment === ex.topPath.environment &&
      (r.service === ex.topPath.service || r.service === 'unknown'),
  )
    ? 1
    : 0

  const scores: Record<VerdictKind, number> = {
    Waste: 0.5 * devShare + 0.3 * (1 - sustained) + 0.2 * idleSignal,
    Misconfig: 0.6 * networkShare + 0.25 * (1 - sustained) + 0.15 * untaggedShare,
    Growth: 0.6 * prodShare + 0.4 * sustained,
  }
  const ranked = (Object.keys(scores) as VerdictKind[]).sort((a, b) => scores[b] - scores[a])
  const kind = ranked[0]
  const margin = scores[ranked[0]] - scores[ranked[1]]
  const confidence: Confidence = margin > 0.35 ? 'High' : margin > 0.15 ? 'Medium' : 'Low'

  const reasons: string[] = []
  if (kind === 'Waste') {
    reasons.push(`${pct(devShare)} of the jump is in dev/test/untagged resources`)
    reasons.push(sustained < 0.5 ? 'The new cost level did not persist like real demand would' : `Cost stayed up (${pct(sustained)} of the jump persisted) with no production share`)
    if (idleSignal) reasons.push('A matching idle resource is running (CPU under 5%)')
  } else if (kind === 'Misconfig') {
    reasons.push(`${pct(networkShare)} of the jump is network / data-processing lines`)
    if (untaggedShare > 0.2) reasons.push(`${pct(untaggedShare)} is untagged (no owner)`)
    reasons.push(sustained < 0.5 ? 'One-day burst, not a steady new level' : 'Elevated level persisted')
  } else {
    reasons.push(`${pct(prodShare)} of the jump is in production-tagged resources`)
    reasons.push(`The new level persisted (${pct(sustained)} of the jump held for 3 days)`)
  }
  const wouldChange =
    kind === 'Waste'
      ? 'If this cost moved to production tags and held steady for 3+ days, it would read as Growth.'
      : kind === 'Misconfig'
        ? 'If the jump were in compute rather than network lines, or tagged to an owner, it would read as Waste or Growth.'
        : 'If the jump were in dev/test or faded within a day or two, it would read as Waste.'

  return {
    kind,
    scores,
    confidence,
    margin,
    features: { devShare, prodShare, networkShare, untaggedShare, sustained, idleSignal },
    reasons,
    wouldChange,
  }
}
