import type { DeltaNode, Explanation, Finding, Row } from './types'
export type { Explanation }
import { addDays } from './series'

function deltas(rows: Row[], f: Finding, window: number, key: (r: Row) => string): Map<string, number> {
  const start = addDays(f.day, -window)
  const m = new Map<string, number>()
  for (const r of rows) {
    if (r.day === f.day) m.set(key(r), (m.get(key(r)) ?? 0) + r.cost)
    else if (r.day >= start && r.day < f.day) m.set(key(r), (m.get(key(r)) ?? 0) - r.cost / window)
  }
  return m
}

function nodes(m: Map<string, number>, totalDelta: number): DeltaNode[] {
  return [...m.entries()]
    .map(([name, delta]) => ({ name, delta, share: totalDelta ? delta / totalDelta : 0 }))
    .filter((n) => Math.abs(n.delta) > 1e-6)
    .sort((a, b) => b.delta - a.delta)
}

const short = (s: string) =>
  s.replace('Amazon Elastic Compute Cloud', 'EC2').replace('Amazon ', '').replace('AWS ', '')

export function explain(rows: Row[], f: Finding, window = 7): Explanation {
  const sep = '\u0001'
  const svc = deltas(rows, f, window, (r) => r.service)
  const totalDelta = [...svc.values()].reduce((a, b) => a + b, 0)
  const byService = nodes(svc, totalDelta)
  const byEnvironment = nodes(deltas(rows, f, window, (r) => r.environment), totalDelta)
  const byApplication = nodes(deltas(rows, f, window, (r) => r.application), totalDelta)
  const byRegion = nodes(deltas(rows, f, window, (r) => r.region), totalDelta)

  const full = deltas(rows, f, window, (r) => [r.service, r.environment, r.application].join(sep))
  const tree: DeltaNode[] = byService.map((s) => {
    const envs = new Map<string, Map<string, number>>()
    for (const [k, d] of full) {
      const [sv, env, app] = k.split(sep)
      if (sv !== s.name) continue
      if (!envs.has(env)) envs.set(env, new Map())
      envs.get(env)!.set(app, d)
    }
    return {
      ...s,
      children: [...envs.entries()]
        .map(([env, apps]) => {
          const d = [...apps.values()].reduce((a, b) => a + b, 0)
          return { name: env, delta: d, share: totalDelta ? d / totalDelta : 0, children: nodes(apps, totalDelta) }
        })
        .filter((n) => Math.abs(n.delta) > 1e-6)
        .sort((a, b) => b.delta - a.delta),
    }
  })

  const topS = tree[0]
  const topE = topS?.children?.[0]
  const topA = topE?.children?.[0]
  const topPath = {
    service: topS?.name ?? 'unknown',
    environment: topE?.name ?? 'untagged',
    application: topA?.name ?? 'untagged',
  }
  const where = [
    topPath.environment !== 'untagged' ? `in ${topPath.environment}` : 'with no environment tag',
    topPath.application !== 'untagged' ? `app ${topPath.application}` : '',
  ].filter(Boolean).join(', ')
  const subject = `${short(topPath.service)} ${where}`
  const add = topA?.delta ?? totalDelta
  const share = topA?.share ?? 1
  const parts = { subject, add, total: totalDelta, share }
  const sentence = describe(parts, (n) => '$' + n.toFixed(2))
  const hasNegativeLines = byService.some((n) => n.delta < 0)
  return { totalDelta, tree, byService, byEnvironment, byApplication, byRegion, topPath, sentence, parts, hasNegativeLines }
}

/** Plain-English cause. Shares above 100% (other lines dipped) are shown as amounts only. */
export function describe(p: Explanation['parts'], money: (n: number) => string): string {
  if (p.steady) return `${p.subject} runs every day, weekends included, at about ${money(p.add)}/day.`
  const pct = p.share <= 1.02 && p.share >= 0.05 ? `, ${Math.round(p.share * 100)}% of the jump` : ''
  return `${p.subject} added ${money(p.add)}/day${pct}.`
}

export { short as shortService }
