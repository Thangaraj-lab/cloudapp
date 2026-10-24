import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCsv } from '../src/engine/parse'
import { analyze } from '../src/engine/analyze'
import { injectedRows } from '../src/engine/inject'
import { ingest, autoMap, previewHeaders } from '../src/engine/ingest'
import { plan } from '../src/engine/execute'
import { measure, simulateAfter, type LedgerEntry } from '../src/engine/ledger'
import { backtest } from '../src/engine/rules'
import { forecast } from '../src/engine/forecast'
import { headline, brief } from '../src/engine/narrate'
import { newPairingCode, shortCode, issue, pairingKey } from '../src/engine/approval'
import { jsonToCsv } from '../src/engine/sniff'
import type { Row } from '../src/engine/types'

const csv = readFileSync('public/data/walkthrough_daily_by_service_region_tag.csv', 'utf8')
const { rows } = parseCsv(csv)
const money = (n: number) => '$' + n.toFixed(2)

describe('T14 injection toggle', () => {
  it('OFF gives exactly the 3 real findings, ON gives 6', () => {
    expect(analyze(rows).findings.map((f) => f.finding.day)).toEqual(['2024-09-09', '2024-09-12', '2024-09-18'])
    const on = analyze([...rows, ...injectedRows()], undefined, true).findings
    expect(on.length).toBe(6)
    expect(on.filter((f) => f.finding.injected).map((f) => f.finding.injected)).toEqual(['A', 'B', 'C'])
  })
})

describe('T4 parse extras', () => {
  it('drops exact duplicate lines', () => {
    const t = 'day,service,region,environment,application,billed_cost_usd\n2024-09-01,EC2,us,dev,a,1\n2024-09-01,EC2,us,dev,a,1\n2024-09-02,EC2,us,dev,a,2\n'
    const r = parseCsv(t)
    expect(r.rows.length).toBe(2)
    expect(r.duplicates).toBe(1)
  })
  it('ingest separates non-usage rows with their total, and removes duplicates', async () => {
    const t = 'ChargePeriodStart,BilledCost,ServiceName,ChargeCategory\n2024-09-01,5,EC2,Usage\n2024-09-01,5,EC2,Usage\n2024-09-01,-2,EC2,Credit\n2024-09-02,1.5,EC2,Tax\n'
    const { headers, sample } = await previewHeaders(t)
    const m = autoMap(headers, sample)
    const r = await ingest(t, m.mapping, { usageOnly: true })
    expect(r.rows.length).toBe(1)
    expect(r.duplicates).toBe(1)
    expect(r.excludedNonUsage).toBe(2)
    expect(r.nonUsageTotal).toBeCloseTo(-0.5, 6)
  })
  it('JSON exports convert to CSV', () => {
    expect(jsonToCsv('[{"a":1,"b":"x,y"},{"a":2}]')).toBe('a,b\n1,"x,y"\n2,')
  })
})

describe('T11 execute + ledger', () => {
  it('a failed run counts no saving', () => {
    const p = plan(3)
    expect(p.outcome).toBe('rolled-back')
    expect(p.events.at(-1)!.status).toBe('rolled-back')
  })
})

describe('T12 ledger (simulated clock)', () => {
  it('verified saving equals the engine-computed difference', () => {
    const f = analyze(rows).findings[2]
    const tp = f.explanation.topPath
    const e: LedgerEntry = {
      id: 'x', findingId: f.finding.id, findingDay: f.finding.day, action: 'park', createdAt: 0, approvedBy: 't', approvalNonce: 'n',
      line: { ...tp, region: 'untagged' }, appliedOn: '2024-09-30', estimatedMonthlySaving: f.recommendation.lineDeltaPerDay * 30 * 0.88, status: 'applied',
    }
    const sim = simulateAfter(rows, e)
    expect(sim.length).toBe(7)
    expect(sim.every((r) => r.injected === 'simulated')).toBe(true)
    const m = measure([...rows, ...sim], e)!
    expect(m).not.toBeNull()
    expect(m.monthlySaving).toBeCloseTo((m.beforeDaily - m.afterDaily) * 30, 6)
    expect(m.verdict).toBe('verified')
  })
})

describe('T13 rules backtest', () => {
  const toy: Row[] = []
  for (let i = 1; i <= 12; i++) toy.push({ day: `2024-01-${String(i).padStart(2, '0')}`, service: 'Amazon Elastic Compute Cloud', region: 'us', environment: 'dev', application: 'x', cost: 2 })
  it('idle rule saves the days after it fires (manual calc)', () => {
    const b = backtest(toy, { kind: 'idle-nonprod', threshold: 7 })
    // fires on day 8 (8 days in a row), parked days 9..12 = 4 days × $2
    expect(b.fired[0].day).toBe('2024-01-08')
    expect(b.saved).toBeCloseTo(8, 6)
  })
  it('returns ≥ 0 on the real data and alert rules save nothing', () => {
    expect(backtest(rows, { kind: 'idle-nonprod', threshold: 7 }).saved).toBeGreaterThanOrEqual(0)
    const a = backtest(rows, { kind: 'spike-alert', threshold: 3 })
    expect(a.saved).toBe(0)
    expect(a.alertOnly).toBe(true)
  })
})

describe('forecast, narrate, pairing', () => {
  const a = analyze(rows)
  it('forecast apply-fix is never above do-nothing', () => {
    const f = forecast(a.series, 5)
    expect(f.days.length).toBeGreaterThanOrEqual(7)
    f.applyFix.forEach((v, i) => expect(v).toBeLessThanOrEqual(f.doNothing[i]))
    expect(f.monthEndApplyFix).toBeLessThanOrEqual(f.monthEndDoNothing)
  })
  it('headline names EC2 in dev for Sep 9', () => {
    expect(headline(a.findings[0], money)).toMatch(/^EC2 in dev added \$\d+\.\d\d a day since Sep 9\./)
    expect(brief({ series: a.series, cases: a.findings, verifiedMonthly: 0, pendingMonthly: 0, idleMonthly: 0, idleCount: 0 }, money).paragraphs.length).toBe(4)
  })
  it('8-character codes', () => {
    expect(newPairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(shortCode(issue(pairingKey('AB'), { findingId: 'f', action: 'a', stateHash: 's', deviceId: 'd' }))).toMatch(/^[0-9A-F]{8}$/)
  })
})
