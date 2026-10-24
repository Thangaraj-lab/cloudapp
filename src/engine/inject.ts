// Injected demo scenarios. Every row carries `injected` and is badged in the UI.
// Rows are dated in October 2024, after the real September month, so the real
// findings never change (the trailing baseline only looks backwards).
import type { Row } from './types'
import { addDays } from './series'
import { rng } from './hash'

export const SCENARIOS = {
  A: { id: 'A', title: 'Forgotten test server', resource: 'i-0demo-staging-02', start: '2024-10-08' },
  B: { id: 'B', title: 'NAT data-processing misconfig', start: '2024-10-15' },
  C: { id: 'C', title: 'Healthy growth (prod ramp)', start: '2024-10-21' },
} as const

export const INJECT_START = '2024-10-01'
export const INJECT_DAYS = 28
export const SCENARIO_A_DAILY = 6.2
export const RESIDUAL_PCT = 0.12

export function injectedRows(seed = 42): Row[] {
  const r = rng(seed)
  const noise = (x: number) => x * (1 + (r() - 0.5) * 0.06)
  const rows: Row[] = []
  const base = (day: string, service: string, env: string, app: string, cost: number, tag = 'base') =>
    rows.push({ day, service, region: 'us-east-1', environment: env, application: app, cost: noise(cost), injected: tag })

  for (let i = 0; i < INJECT_DAYS; i++) {
    const day = addDays(INJECT_START, i)
    // Steady background so the baseline is learnable.
    const prodScale = day >= SCENARIOS.C.start ? 1.4 : 1
    base(day, 'Amazon Elastic Compute Cloud', 'prod', 'HyperMindEngine', 20 * prodScale, day >= SCENARIOS.C.start ? 'C' : 'base')
    base(day, 'Amazon Relational Database Service', 'prod', 'PureAssetCloud', 8)
    base(day, 'Amazon Simple Storage Service', 'prod', 'PureAssetCloud', 2)
    base(day, 'NAT Gateway', 'untagged', 'untagged', day === SCENARIOS.B.start ? 9 : 1.5, day === SCENARIOS.B.start ? 'B' : 'base')
    // Scenario A: staging server left running from Oct 8, steady cost.
    if (day >= SCENARIOS.A.start)
      base(day, 'Amazon Elastic Compute Cloud', 'dev', 'staging-02', SCENARIO_A_DAILY, 'A')
  }
  return rows
}

/** Which scenario a detected finding day belongs to. */
export function scenarioForDay(day: string): string | undefined {
  if (day === SCENARIOS.A.start) return 'A'
  if (day === SCENARIOS.B.start) return 'B'
  if (day === SCENARIOS.C.start) return 'C'
  return day >= INJECT_START ? 'base' : undefined
}
