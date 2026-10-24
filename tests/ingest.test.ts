import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { autoMap, detectMapping, ingest, parseCost, parseDay, parseTags, previewHeaders } from '../src/engine/ingest'
import { analyzeUtilization, detectUMapping } from '../src/engine/utilization'
import { parseCsv } from '../src/engine/parse'
import { detect } from '../src/engine/detect'
import { dailyTotals, total } from '../src/engine/series'

describe('ingest helpers', () => {
  it('parses date formats', () => {
    expect(parseDay('2024-09-01T13:00:00Z')).toBe('2024-09-01')
    expect(parseDay('09/15/2024')).toBe('2024-09-15')
    expect(parseDay('15/09/2024')).toBe('2024-09-15')
    expect(parseDay('20240915')).toBe('2024-09-15')
    expect(parseDay('2024-02-30')).toBeNull()
    expect(parseDay('yesterday')).toBeNull()
  })
  it('parses cost formats', () => {
    expect(parseCost('$1,234.50')).toBe(1234.5)
    expect(parseCost('(12.30)')).toBe(-12.3)
    expect(parseCost('1.234,5')).toBe(1234.5)
    expect(parseCost('abc')).toBeNull()
    expect(parseCost('')).toBeNull()
  })
  it('parses tag formats', () => {
    expect(parseTags('{"env":"dev","application":"api"}')).toEqual({ env: 'dev', application: 'api' })
    expect(parseTags('"Environment": "prod","App": "web"')).toEqual({ environment: 'prod', app: 'web' })
    expect(parseTags('[{"key":"env","value":"test"}]')).toEqual({ env: 'test' })
  })
})

describe('auto-mapping', () => {
  it('FOCUS headers', () => {
    const m = detectMapping(['BilledCost', 'ChargePeriodStart', 'ServiceName', 'RegionName', 'Tags', 'ChargeCategory'])
    expect(m).toMatchObject({ day: 'ChargePeriodStart', service: 'ServiceName', cost: 'BilledCost', region: 'RegionName', tags: 'Tags', chargeCategory: 'ChargeCategory' })
  })
  it('AWS CUR headers', () => {
    const m = detectMapping(['lineItem/UsageStartDate', 'lineItem/ProductCode', 'lineItem/UnblendedCost', 'product/region', 'resourceTags/user:Environment', 'lineItem/LineItemType'])
    expect(m).toMatchObject({ day: 'lineItem/UsageStartDate', service: 'lineItem/ProductCode', cost: 'lineItem/UnblendedCost', region: 'product/region', environment: 'resourceTags/user:Environment', chargeCategory: 'lineItem/LineItemType' })
  })
  it('Azure headers', () => {
    const m = detectMapping(['Date', 'MeterCategory', 'ResourceLocation', 'CostInBillingCurrency', 'Tags'])
    expect(m).toMatchObject({ day: 'Date', service: 'MeterCategory', region: 'ResourceLocation', cost: 'CostInBillingCurrency', tags: 'Tags' })
  })
  it('Azure FOCUS export: x_PartnerCreditApplied is not the application', () => {
    const h = ['BilledCost', 'ChargePeriodStart', 'ServiceName', 'RegionName', 'Tags', 'ChargeCategory', 'x_PartnerCreditApplied']
    const m = autoMap(h, [{ BilledCost: '1.5', ChargePeriodStart: '2024-06-01', ServiceName: 'Storage', RegionName: 'East US', Tags: '{}', ChargeCategory: 'Usage', x_PartnerCreditApplied: 'false' }])
    expect(m.mapping.application).toBeUndefined()
  })
})

describe('auto-fill', () => {
  const rec = (h: string[], rows: string[][]) => rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])))
  it('known export: all by name, confident', () => {
    const h = ['lineItem/UsageStartDate', 'lineItem/ProductCode', 'product/region', 'lineItem/UnblendedCost', 'lineItem/LineItemType']
    const a = autoMap(h, rec(h, [['2025-08-01T00:00:00Z', 'AmazonEC2', 'ap-south-1', '1.2', 'Usage'], ['2025-08-01T01:00:00Z', 'AmazonRDS', 'ap-south-1', '0.4', 'Tax']]))
    expect(a.confident).toBe(true)
    expect(Object.values(a.source).every((s) => s === 'name')).toBe(true)
  })
  it('unfamiliar headers: inferred from values', () => {
    const h = ['When', 'What', 'Where', 'Money', 'Labels', 'Kind', 'Units']
    const rows = Array.from({ length: 30 }, (_, i) => [`2025-08-${String((i % 28) + 1).padStart(2, '0')}`, i % 2 ? 'Virtual Machines' : 'Storage', 'centralindia', (10 + i * 0.37).toFixed(2), '{"env":"dev","app":"api"}', i % 5 ? 'Usage' : 'Tax', String(i)])
    const a = autoMap(h, rec(h, rows))
    expect(a.mapping).toMatchObject({ day: 'When', service: 'What', cost: 'Money', region: 'Where', tags: 'Labels', chargeCategory: 'Kind' })
    expect(a.confident).toBe(true)
    expect(a.source.day).toBe('values')
    expect(a.mapping.cost).not.toBe('Units')
  })
  it('missing service → not confident, explains why', () => {
    const h = ['date', 'amount']
    const a = autoMap(h, rec(h, [['2025-08-01', '3.1'], ['2025-08-02', '2.9']]))
    expect(a.confident).toBe(false)
    expect(a.issues[0]).toContain('service')
  })
  it('mostly unreadable rows → not confident', () => {
    const h = ['date', 'service', 'cost']
    const a = autoMap(h, rec(h, [['2025-08-01', 'EC2', 'x'], ['bad', 'EC2', '1'], ['2025-08-03', 'EC2', 'n/a'], ['2025-08-04', 'EC2', '2']]))
    expect(a.confident).toBe(false)
  })
})

describe('streaming ingest', () => {
  const cur = [
    'lineItem/UsageStartDate,lineItem/ProductCode,product/region,lineItem/UnblendedCost,lineItem/LineItemType,resourceTags/user:Environment',
    '2024-09-01T00:00:00Z,AmazonEC2,us-east-1,1.50,Usage,dev',
    '2024-09-01T01:00:00Z,AmazonEC2,us-east-1,1.50,Usage,dev',
    '2024-09-01T00:00:00Z,AmazonEC2,us-east-1,5.00,Tax,dev',
    'bad-date,AmazonEC2,us-east-1,1.00,Usage,dev',
    '2024-09-02T00:00:00Z,AmazonS3,us-east-1,n/a,Usage,',
  ].join('\n')
  it('rolls hourly rows up to daily, skips tax, quarantines bad rows', async () => {
    const m = detectMapping(cur.split('\n')[0].split(','))
    const r = await ingest(cur, m, { usageOnly: true })
    expect(r.recordsRead).toBe(5)
    expect(r.excludedNonUsage).toBe(1)
    expect(r.quarantinedCount).toBe(2)
    expect(r.rows).toEqual([{ day: '2024-09-01', service: 'AmazonEC2', region: 'us-east-1', environment: 'dev', application: 'untagged', cost: 3 }])
    expect((await ingest(cur, m, { usageOnly: true })).fingerprint).toBe(r.fingerprint)
  })
  it('the bundled sample imports through the flexible path with the same results', async () => {
    const csv = readFileSync('public/data/walkthrough_daily_by_service_region_tag.csv', 'utf8')
    const { headers } = await previewHeaders(csv)
    const r = await ingest(csv, detectMapping(headers), { usageOnly: true })
    expect(Math.abs(total(r.rows) - 1430.99)).toBeLessThan(0.01)
    expect(detect(dailyTotals(r.rows)).map((f) => f.day)).toEqual(detect(dailyTotals(parseCsv(csv).rows)).map((f) => f.day))
  })
})

describe('utilization', () => {
  it('summary file (Azure VM sample) finds idle VMs', async () => {
    const csv = readFileSync('public/data/azure_vm_sample.csv', 'utf8')
    const m = detectUMapping((await previewHeaders(csv)).headers)
    expect(m).toMatchObject({ id: 'vm_id', avgCpu: 'avg_cpu_pct', maxCpu: 'p95_of_max_cpu_pct', days: 'lifetime_days' })
    const r = analyzeUtilization(csv, m, 60, 0.12)
    expect(r.scanned).toBe(4176)
    expect(r.resources.length).toBeGreaterThan(0)
    r.resources.forEach((x) => { expect(x.avgCpu).toBeLessThan(5); expect(x.maxCpu).toBeLessThan(20); expect(x.netSaving).toBeCloseTo(60 * 0.88, 6) })
  })
  it('time series file aggregates per resource', () => {
    const lines = ['timestamp,resource_id,cpu_pct,environment']
    for (let d = 1; d <= 15; d++) {
      const day = `2024-09-${String(d).padStart(2, '0')}`
      lines.push(`${day}T00:00:00Z,i-idle,2,dev`, `${day}T12:00:00Z,i-idle,4,dev`, `${day}T00:00:00Z,i-busy,60,prod`)
    }
    const csv = lines.join('\n')
    const r = analyzeUtilization(csv, detectUMapping(lines[0].split(',')), 100, 0.12)
    expect(r.mode).toBe('timeseries')
    expect(r.resources.map((x) => x.id)).toEqual(['i-idle'])
    expect(r.resources[0]).toMatchObject({ avgCpu: 3, maxCpu: 4, daysIdle: 15, environment: 'dev' })
  })
})
