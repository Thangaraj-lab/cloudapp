import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseCsv } from '../src/engine/parse'
import { dailyTotals, total } from '../src/engine/series'
import { detect } from '../src/engine/detect'
import { explain } from '../src/engine/explain'
import { analyze } from '../src/engine/analyze'
import { injectedRows, RESIDUAL_PCT, SCENARIO_A_DAILY } from '../src/engine/inject'
import { injectedIdle } from '../src/engine/idle'
import { cpuHistory, riskProfile, simulate } from '../src/engine/risk'
import { issue, pairingKey, verify, TTL_MS } from '../src/engine/approval'
import { append, verifyChain, type AuditEntry } from '../src/engine/audit'
import { plan } from '../src/engine/execute'
import { evaluate, DEFAULT_POLICY } from '../src/engine/policy'

const csv = readFileSync('public/data/walkthrough_daily_by_service_region_tag.csv', 'utf8')
const ref = JSON.parse(readFileSync('public/data/walkthrough_findings.json', 'utf8'))
const { rows } = parseCsv(csv)

describe('T1 detect', () => {
  it('reproduces the 3 reference findings', () => {
    const f = detect(dailyTotals(rows))
    expect(f.map((x) => x.day)).toEqual(ref.flags.map((x: { day: string }) => x.day))
    f.forEach((x, i) => {
      expect(x.cost).toBeCloseTo(ref.flags[i].cost, 1)
      expect(Math.abs(x.baselineMedian - ref.flags[i].trailing7_median)).toBeLessThan(0.1)
      expect(Math.abs(x.z - ref.flags[i].robust_z)).toBeLessThan(0.1)
    })
  })
})

describe('T2 total', () => {
  it('total usage = 1430.99', () => expect(Math.abs(total(rows) - 1430.99)).toBeLessThan(0.01))
})

describe('T3 explain', () => {
  it('Sep 9: EC2 and dev on top', () => {
    const f = detect(dailyTotals(rows))[0]
    const ex = explain(rows, f)
    expect(ex.byService[0].name).toBe('Amazon Elastic Compute Cloud')
    expect(ex.byEnvironment[0].name).toBe('dev')
    expect(ex.totalDelta).toBeCloseTo(11.51, 1)
  })
})

describe('T4 parse', () => {
  it('quarantines bad rows and is idempotent', () => {
    const bad = 'day,service,region,environment,application,billed_cost_usd\n2024-09-01,EC2,us,dev,a,1\nnotadate,EC2,us,dev,a,1\n2024-09-02,EC2,us,dev,a,abc\n2024-09-03,,us,dev,a,1\n'
    const r = parseCsv(bad)
    expect(r.rows.length).toBe(1)
    expect(r.quarantine.map((q) => q.reason)).toEqual(['Unparseable date', 'Cost is not numeric', 'Service is empty'])
    expect(parseCsv(bad)).toEqual(r)
    expect(parseCsv('a,b\n1,2').missingColumns.length).toBeGreaterThan(0)
  })
})

describe('T5 verdict', () => {
  it('every finding gets a verdict, Sep 9 is Waste', () => {
    const a = analyze(rows)
    expect(a.findings.filter((f) => f.finding.scope === 'total').length).toBe(3)
    a.findings.forEach((f) => expect(['Waste', 'Misconfig', 'Growth']).toContain(f.verdict.kind))
    expect(a.findings[0].verdict.kind).toBe('Waste')
  })
  it('injected toggle adds A/B/C with expected verdicts and keeps real ones', () => {
    const a = analyze([...rows, ...injectedRows()], undefined, true)
    const real = a.findings.filter((f) => !f.finding.injected && f.finding.scope === 'total').map((f) => f.finding.day)
    expect(real).toEqual(ref.flags.map((x: { day: string }) => x.day))
    const by = Object.fromEntries(a.findings.filter((f) => f.finding.injected && f.finding.scope === 'total').map((f) => [f.finding.injected, f.verdict.kind]))
    expect(by).toEqual({ A: 'Waste', B: 'Misconfig', C: 'Growth' })
  })
})

describe('T6 idle', () => {
  it('finds scenario A with net = cost - 12%', () => {
    const [a] = injectedIdle()
    expect(a.id).toBe('i-0demo-staging-02')
    expect(a.netSaving).toBeCloseTo(SCENARIO_A_DAILY * 30 * (1 - RESIDUAL_PCT), 6)
  })
})

describe('T7 risk', () => {
  it('seeded and monotonic', () => {
    const h = cpuHistory(12, 35, 1)
    expect(riskProfile(h)).toEqual(riskProfile(h))
    const r1 = simulate(h, 1).failRate, r3 = simulate(h, 3).failRate
    expect(r3).toBeGreaterThanOrEqual(r1)
  })
})

describe('T8 approval', () => {
  const key = pairingKey('TARS')
  const exp = { findingId: 'f-1', stateHash: 'abc' }
  const tok = issue(key, { findingId: 'f-1', action: 'park', stateHash: 'abc', deviceId: 'd' })
  it('valid token passes', () => expect(verify(key, tok, { usedNonces: [], expected: exp }).ok).toBe(true))
  it('expired, reused, tampered rejected', () => {
    expect(verify(key, tok, { usedNonces: [], expected: exp, now: Date.now() + TTL_MS + 1 }).ok).toBe(false)
    const n = JSON.parse(atob(tok.split('.')[0])).nonce
    expect(verify(key, tok, { usedNonces: [n], expected: exp }).ok).toBe(false)
    expect(verify(key, 'x' + tok, { usedNonces: [], expected: exp }).ok).toBe(false)
    expect(verify(key, tok, { usedNonces: [], expected: { ...exp, stateHash: 'zzz' } }).ok).toBe(false)
  })
  it('prod denied by policy', () =>
    expect(evaluate(DEFAULT_POLICY, { environment: 'prod', dailyCost: 1, hasRollback: true }).result).toBe('deny'))
})

describe('T9 audit', () => {
  it('verifies and detects tamper index', () => {
    let c: AuditEntry[] = []
    for (let i = 0; i < 5; i++) c = append(c, 'test', 'e' + i, { i }, 1000 + i)
    expect(verifyChain(c).ok).toBe(true)
    const t = c.map((e) => (e.i === 2 ? { ...e, payload: { i: 99 } } : e))
    expect(verifyChain(t)).toEqual({ ok: false, brokenAt: 2 })
  })
})

describe('T10 execute', () => {
  it('failure triggers rollback', () => {
    const p = plan(4)
    expect(p.outcome).toBe('rolled-back')
    expect(p.events.filter((e) => e.status === 'rolled-back').length).toBe(3)
    expect(plan().outcome).toBe('done')
  })
})
