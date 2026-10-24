import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPlan, detectCloud, planAsText } from '../src/engine/plan'
import { measure, daysAfter, type LedgerEntry } from '../src/engine/ledger'
import { analyze, monthlyImpact } from '../src/engine/analyze'
import { budgetStatus } from '../src/engine/budget'
import { evaluate, DEFAULT_POLICY } from '../src/engine/policy'
import { parseCsv } from '../src/engine/parse'
import { addDays } from '../src/engine/series'
import type { Row } from '../src/engine/types'

describe('action plans', () => {
  it('detects the cloud from service and region', () => {
    expect(detectCloud('Amazon Elastic Compute Cloud', 'us-east-1')).toBe('aws')
    expect(detectCloud('AmazonEC2', 'ap-south-1')).toBe('aws')
    expect(detectCloud('Virtual Machines', 'eastus')).toBe('azure')
    expect(detectCloud('Compute Engine', 'asia-south1')).toBe('gcp')
  })
  it('AWS compute waste → stop-instances with backup and rollback', () => {
    const p = buildPlan('Waste', { service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'load-test-rig' })!
    expect(p.kind).toBe('park-compute')
    expect(p.discover.command).toContain('Name=tag:Environment,Values=dev')
    expect(p.discover.command).toContain('Name=tag:Application,Values=load-test-rig')
    expect(p.backup.command).toContain('create-image')
    expect(p.change.map((c) => c.command).join(' ')).toContain('aws ec2 stop-instances --region ap-south-1')
    expect(p.rollback.command).toContain('start-instances')
    expect(planAsText(p)).toContain('# Rollback')
  })
  it('NAT misconfig → gateway endpoint in the same region', () => {
    const p = buildPlan('Misconfig', { service: 'NAT Gateway', region: 'us-east-1', environment: 'untagged', application: 'untagged' })!
    expect(p.kind).toBe('vpc-endpoint')
    expect(p.change[0].command).toContain('com.amazonaws.us-east-1.s3')
  })
  it('RDS → snapshot then stop', () => {
    const p = buildPlan('Waste', { service: 'Amazon Relational Database Service', region: 'eu-west-1', environment: 'test', application: 'db' })!
    expect(p.kind).toBe('park-database')
    expect(p.backup.command).toContain('create-db-snapshot')
  })
  it('growth needs no plan; unknown services get manual steps', () => {
    expect(buildPlan('Growth', { service: 'x', region: 'y', environment: 'prod', application: 'a' })).toBeNull()
    expect(buildPlan('Waste', { service: 'Snowflake', region: 'untagged', environment: 'dev', application: 'a' })!.kind).toBe('review')
  })
  it('every finding in the real sample gets a plan or is growth', () => {
    const { rows } = parseCsv(readFileSync('public/data/walkthrough_daily_by_service_region_tag.csv', 'utf8'))
    for (const f of analyze(rows).findings) {
      if (f.verdict.kind === 'Growth' || !f.state.ongoing) expect(f.recommendation.plan).toBeNull()
      else expect(f.recommendation.plan?.cloud).toBe('aws')
      expect(f.recommendation.risk).toBe('Unknown') // no utilization uploaded
    }
  })
})

describe('measured verification', () => {
  const line = { service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'rig' }
  const rows: Row[] = []
  for (let i = 0; i < 20; i++) {
    const day = addDays('2025-09-01', i)
    rows.push({ day, ...line, cost: i < 10 ? 10 : 2 }) // stopped on day 10, 2/day residual
    rows.push({ day, service: 'AmazonS3', region: 'ap-south-1', environment: 'prod', application: 'web', cost: 5 })
  }
  const e: LedgerEntry = { id: 'A-001', findingId: 'f', findingDay: addDays('2025-09-01', 5), action: 'stop', line, createdAt: 0, approvedBy: 'Raj', approvalNonce: 'n', estimatedMonthlySaving: 240, status: 'applied', appliedOn: addDays('2025-09-01', 9) }

  it('waits until 7 days of data exist after the change', () => {
    const short = rows.filter((r) => r.day <= addDays('2025-09-01', 13))
    expect(daysAfter(short, e.appliedOn!)).toBe(4)
    expect(measure(short, e)).toBeNull()
  })
  it('measures before vs after on the affected line only', () => {
    const m = measure(rows, e)!
    expect(m.beforeDaily).toBe(10)
    expect(m.afterDaily).toBe(2)
    expect(m.monthlySaving).toBe(240)
  })
  it('measures before vs after on the affected line only', () => {
    expect(measure(rows, e)!.verdict).toBe('verified')
  })
  it('reports no saving when cost did not fall', () => {
    const flat = rows.map((r) => (r.service === 'AmazonEC2' ? { ...r, cost: 10 } : r))
    const m = measure(flat, e)!
    expect(m.monthlySaving).toBe(0)
    expect(m.verdict).toBe('no-saving')
  })
  it('does not credit a spike that ended by itself before the change', () => {
    // Normal 10/day; spike to 30 on days 5–6; back to 10 on its own; "fix" applied on day 9.
    const r2: Row[] = Array.from({ length: 20 }, (_, i) => ({ day: addDays('2025-09-01', i), ...line, cost: i === 5 || i === 6 ? 30 : 10 }))
    const m = measure(r2, e)!
    expect(m.beforeDaily).toBe(10)
    expect(m.verdict).toBe('no-saving')
  })
  it('calls a drop within normal noise inconclusive', () => {
    const r3: Row[] = Array.from({ length: 20 }, (_, i) => ({ day: addDays('2025-09-01', i), ...line, cost: i < 10 ? 10 + (i % 2 ? 1.5 : -1.5) : 9.6 + (i % 2 ? 1.5 : -1.5) }))
    expect(measure(r3, e)!.verdict).toBe('inconclusive')
  })
})

describe('analysis accuracy', () => {
  const day = (i: number) => addDays('2025-07-01', i)
  const base = (i: number): Row[] => [
    { day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'prod', application: 'web', cost: 500 + (i % 3) * 8 },
    { day: day(i), service: 'AmazonS3', region: 'ap-south-1', environment: 'prod', application: 'web', cost: 20 + (i % 2) },
  ]
  it('a spike that stopped by itself is not "at risk"', () => {
    const rows: Row[] = []
    for (let i = 0; i < 40; i++) {
      rows.push(...base(i))
      if (i === 20 || i === 21) rows.push({ day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'rig', cost: 300 })
    }
    const f = analyze(rows).findings.find((x) => x.finding.day === day(20))!
    expect(f.state.ongoing).toBe(false)
    expect(f.state.stoppedOn).toBe(day(22))
    expect(monthlyImpact(f)).toBe(0)
    expect(f.recommendation.plan).toBeNull()
  })
  it('an ongoing jump stays at risk with its current extra cost', () => {
    const rows: Row[] = []
    for (let i = 0; i < 40; i++) {
      rows.push(...base(i))
      if (i >= 20) rows.push({ day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'rig', cost: 300 })
    }
    const f = analyze(rows).findings.find((x) => x.finding.day === day(20))!
    expect(f.state.ongoing).toBe(true)
    expect(monthlyImpact(f)).toBeCloseTo(9000, -2)
  })
  it('finds a small service spike hidden inside a big, noisy bill', () => {
    const rows: Row[] = []
    for (let i = 0; i < 40; i++) {
      rows.push({ day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'prod', application: 'web', cost: 5000 + ((i * 37) % 11) * 40 })
      rows.push({ day: day(i), service: 'NAT Gateway', region: 'ap-south-1', environment: 'untagged', application: 'untagged', cost: i === 30 ? 90 : 6 })
    }
    const a = analyze(rows)
    const nat = a.signals.find((x) => x.finding.scope === 'service' && x.finding.service === 'NAT Gateway')
    expect(nat?.finding.day).toBe(day(30))
    expect(nat?.verdict.kind).toBe('Misconfig')
  })
  it('flags always-on dev spend, but not a dev box that sleeps at weekends', () => {
    const rows: Row[] = []
    for (let i = 0; i < 30; i++) {
      rows.push(...base(i))
      rows.push({ day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'ci', cost: 48 + (i % 2) })
      const dow = new Date(day(i) + 'T00:00:00Z').getUTCDay()
      rows.push({ day: day(i), service: 'AmazonRDS', region: 'ap-south-1', environment: 'test', application: 'qa-db', cost: dow === 0 || dow === 6 ? 2 : 30 })
    }
    const steady = analyze(rows).signals.filter((x) => x.finding.kind === 'steady')
    expect(steady.map((s) => s.explanation.topPath.application)).toEqual(['ci'])
    expect(steady[0].recommendation.plan?.kind).toBe('schedule')
    expect(steady[0].recommendation.netMonthlySaving).toBeGreaterThan(0)
  })
  it('measures the storage residual from the owner\'s own lines', () => {
    const rows: Row[] = []
    for (let i = 0; i < 40; i++) {
      rows.push(...base(i))
      rows.push({ day: day(i), service: 'Amazon Elastic Block Store', region: 'ap-south-1', environment: 'dev', application: 'rig', cost: 20 })
      rows.push({ day: day(i), service: 'AmazonEC2', region: 'ap-south-1', environment: 'dev', application: 'rig', cost: i >= 25 ? 180 : 80 })
    }
    const f = analyze(rows).findings.find((x) => x.explanation.topPath.application === 'rig' && x.finding.kind === 'spike')!
    expect(f.recommendation.residualSource).toBe('data')
  })
})

describe('budgets', () => {
  it('projects month-to-date to month end', () => {
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ day: addDays('2025-09-01', i), service: 'AmazonEC2', region: 'r', environment: 'prod', application: 'a', cost: 10 }))
    const [b] = budgetStatus(rows, { AmazonEC2: 250 })
    expect(b.monthToDate).toBe(100)
    expect(b.projected).toBe(300)
    expect(b.budget).toBe(250)
  })
})

describe('policy', () => {
  it('asks for a second approver above the limit and formats money', () => {
    const d = evaluate(DEFAULT_POLICY, { environment: 'dev', dailyCost: 80, hasRollback: true, fmt: (n) => '₹' + n })
    expect(d.needsSecond).toBe(true)
    expect(d.reasons[0]).toContain('₹80')
  })
})
