// Flexible billing ingest: auto-maps FOCUS, AWS CUR (v1/v2), Azure cost exports,
// GCP billing exports and simple daily CSVs onto our daily Row shape, streaming
// the file so large exports never sit in memory as raw records.
import Papa from 'papaparse'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { QuarantinedRow, Row } from './types'

export const FIELDS = ['day', 'service', 'cost', 'region', 'environment', 'application', 'tags', 'chargeCategory'] as const
export type Field = (typeof FIELDS)[number]
export type Mapping = Partial<Record<Field, string>>
export const REQUIRED_FIELDS: Field[] = ['day', 'service', 'cost']

export const FIELD_LABEL: Record<Field, string> = {
  day: 'Date', service: 'Service', cost: 'Cost', region: 'Region', environment: 'Environment tag',
  application: 'Application tag', tags: 'Tags / labels (JSON)', chargeCategory: 'Charge type',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Ordered by preference: the first alias present wins.
const ALIASES: Record<Field, string[]> = {
  day: ['day', 'date', 'usagedate', 'chargeperiodstart', 'lineitemusagestartdate', 'usagestarttime', 'usagestartdate', 'usagestart', 'starttime', 'billingdate', 'timestamp', 'period', 'intervalstart'],
  service: ['service', 'servicename', 'lineitemproductcode', 'productproductname', 'productservicecode', 'productname', 'metercategory', 'consumedservice', 'servicedescription', 'servicecategory', 'product'],
  cost: ['billedcostusd', 'billedcost', 'costusd', 'cost', 'lineitemunblendedcost', 'unblendedcost', 'lineitemnetunblendedcost', 'costinbillingcurrency', 'costinusd', 'pretaxcost', 'effectivecost', 'lineitemblendedcost', 'amount', 'totalcost', 'charges', 'spend'],
  region: ['region', 'regionname', 'regionid', 'productregion', 'productregioncode', 'resourcelocation', 'locationregion', 'location', 'availabilityzone', 'lineitemavailabilityzone'],
  environment: ['environment', 'env', 'tagenvironment', 'tagsenvironment', 'resourcetagsuserenvironment', 'resourcetagsuserenv', 'resourcetagsenvironment', 'labelsenvironment', 'stage'],
  application: ['application', 'app', 'tagapplication', 'tagsapplication', 'resourcetagsuserapplication', 'resourcetagsuserapp', 'resourcetagsuserproject', 'project', 'projectname', 'projectid', 'workload'],
  tags: ['tags', 'resourcetags', 'labels', 'tag'],
  chargeCategory: ['chargecategory', 'lineitemlineitemtype', 'chargetype', 'costtype'],
}

export function detectMapping(headers: string[]): Mapping {
  const byNorm = new Map(headers.map((h) => [norm(h), h]))
  const m: Mapping = {}
  const used = new Set<string>()
  for (const f of FIELDS) {
    for (const a of ALIASES[f]) {
      const h = byNorm.get(a)
      if (h && !used.has(h)) { m[f] = h; used.add(h); break }
    }
  }
  return m
}

/** ISO (with or without time), YYYY/MM/DD, MM/DD/YYYY or DD/MM/YYYY (when the first part > 12), YYYYMMDD. */
export function parseDay(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '')
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s)
  if (m) return fmt(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s)
  if (m) {
    const a = +m[1], b = +m[2]
    return a > 12 ? fmt(+m[3], b, a) : fmt(+m[3], a, b)
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return fmt(+m[1], +m[2], +m[3])
  return null
}
function fmt(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return null
  return dt.toISOString().slice(0, 10)
}

/** "$1,234.50", "(12.30)", "1 234,5" style values. */
export function parseCost(raw: string): number | null {
  let s = raw.trim().replace(/^"|"$/g, '')
  if (!s) return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  s = s.replace(/[$₹€£\s]|USD|INR|EUR/gi, '')
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  if (!isFinite(n) || s === '') return null
  return neg ? -n : n
}

const ENV_KEYS = ['environment', 'env', 'stage', 'tier', 'userenvironment', 'userenv']
const APP_KEYS = ['application', 'app', 'appname', 'project', 'workload', 'service', 'userapplication', 'userapp', 'userproject']

/** FOCUS `{"k":"v"}`, Azure `"k": "v","k2": "v2"`, GCP `[{"key":"k","value":"v"}]`. */
export function parseTags(raw: string): Record<string, string> {
  const s = raw.trim()
  if (!s) return {}
  const tryJson = (t: string) => { try { return JSON.parse(t) } catch { return undefined } }
  let v = tryJson(s) ?? (s.includes(':') && !s.startsWith('{') ? tryJson('{' + s + '}') : undefined)
  if (typeof v === 'string') v = tryJson(v)
  const out: Record<string, string> = {}
  if (Array.isArray(v)) for (const kv of v) { if (kv && 'key' in kv) out[norm(String(kv.key))] = String(kv.value ?? '') }
  else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) out[norm(k)] = String(val ?? '')
  else for (const part of s.split(/[;,]/)) { const [k, ...rest] = part.split(/[=:]/); if (k && rest.length) out[norm(k)] = rest.join(':').trim() }
  return out
}
const pick = (tags: Record<string, string>, keys: string[]) => {
  for (const k of keys) if (tags[k]) return tags[k]
  return ''
}

export interface IngestOptions { usageOnly: boolean }
export interface IngestResult {
  rows: Row[]
  quarantine: QuarantinedRow[]
  quarantinedCount: number
  excludedNonUsage: number
  /** Billed total of the rows left out because they are credits, tax, fees or purchases. */
  nonUsageTotal: number
  /** Exact repeated lines, dropped. */
  duplicates: number
  recordsRead: number
  fingerprint: string
  mapping: Mapping
}

const QUARANTINE_KEEP = 200

export type Normalized =
  | { ok: true; day: string; service: string; region: string; environment: string; application: string; cost: number }
  | { ok: false; reason: string }
  | { ok: 'skip' }

export function normalize(r: Record<string, string>, m: Mapping, o: IngestOptions): Normalized {
  const get = (f: Field) => (m[f] ? (r[m[f]!] ?? '').toString() : '')
  if (o.usageOnly && m.chargeCategory) {
    const c = get('chargeCategory').trim()
    if (c && !/usage/i.test(c)) return { ok: 'skip' }
  }
  const day = parseDay(get('day'))
  if (!day) return { ok: false, reason: 'Unparseable date' }
  const cost = parseCost(get('cost'))
  if (cost === null) return { ok: false, reason: 'Cost is not numeric' }
  const service = get('service').trim()
  if (!service) return { ok: false, reason: 'Service is empty' }
  const tags = m.tags ? parseTags(get('tags')) : {}
  return {
    ok: true,
    day,
    service,
    cost,
    region: get('region').trim() || 'untagged',
    environment: (get('environment').trim() || pick(tags, ENV_KEYS) || 'untagged').toLowerCase(),
    application: get('application').trim() || pick(tags, APP_KEYS) || 'untagged',
  }
}

// ---------------------------------------------------------------- auto-fill

export type MapSource = 'name' | 'values'
export interface SampleCheck { checked: number; ok: number; skipped: number; bad: number; reasons: Record<string, number> }
export interface AutoMap {
  mapping: Mapping
  source: Partial<Record<Field, MapSource>>
  check: SampleCheck
  /** Safe to import without asking: required fields found and the sample reads cleanly. */
  confident: boolean
  issues: string[]
}

const share = (vals: string[], pred: (v: string) => boolean) => {
  const v = vals.filter((x) => x != null && String(x).trim() !== '')
  return v.length ? v.filter(pred).length / v.length : 0
}
const AWS_R = /^(us|eu|ap|sa|ca|me|af|il)-[a-z]+-\d$/i
const GCP_R = /^[a-z]+-[a-z]+\d$/i
const AZ_R = /^(east|west|central|north|south)[a-z]*\d?$|^[a-z]+(india|europe|asia|us|uk)[a-z]*\d?$/i

export function checkSample(sample: Record<string, string>[], m: Mapping, o: IngestOptions = { usageOnly: true }): SampleCheck {
  const c: SampleCheck = { checked: sample.length, ok: 0, skipped: 0, bad: 0, reasons: {} }
  for (const r of sample) {
    const n = normalize(r, m, o)
    if (n.ok === true) c.ok++
    else if (n.ok === 'skip') c.skipped++
    else { c.bad++; c.reasons[n.reason] = (c.reasons[n.reason] ?? 0) + 1 }
  }
  return c
}

/**
 * Fill every field: exact header names first, then infer the rest from the
 * values in the sample (dates, numbers, region codes, tag JSON, charge types).
 */
export function autoMap(headers: string[], sample: Record<string, string>[]): AutoMap {
  const mapping = detectMapping(headers)
  const source: AutoMap['source'] = {}
  for (const f of FIELDS) if (mapping[f]) source[f] = 'name'
  const used = () => new Set(Object.values(mapping))
  const col = (h: string) => sample.map((r) => r[h] ?? '')
  const free = () => headers.filter((h) => !used().has(h))
  const best = (f: Field, score: (h: string, vals: string[]) => number, min: number) => {
    if (mapping[f]) return
    let top: [string, number] | null = null
    for (const h of free()) { const s = score(h, col(h)); if (s >= min && (!top || s > top[1])) top = [h, s] }
    if (top) { mapping[f] = top[0]; source[f] = 'values' }
  }
  const nm = (h: string) => norm(h)

  best('day', (h, v) => share(v, (x) => parseDay(x) !== null) + (/date|time|day|start|period/.test(nm(h)) ? 0.5 : 0), 0.8)
  best('cost', (h, v) => {
    const n = nm(h)
    if (/quantity|qty|count|hours|usageamount|rate|id$|percent|pct|cpu/.test(n)) return 0
    const numeric = share(v, (x) => parseCost(x) !== null)
    if (numeric < 0.9) return 0
    return numeric + (/cost|amount|charge|price|spend|billed|total|usd|inr|eur/.test(n) ? 1 : 0) + (share(v, (x) => /\.\d/.test(x)) > 0.3 ? 0.3 : 0)
  }, 1.2)
  best('service', (h, v) => {
    const text = share(v, (x) => isNaN(Number(x)) && parseDay(x) === null)
    return text < 0.9 ? 0 : (/service|product|meter|category|resourcetype|sku/.test(nm(h)) ? 2 : 0) + text * 0.2
  }, 2)
  best('region', (h, v) => (/region|location|zone/.test(nm(h)) ? 1 : 0) + share(v, (x) => AWS_R.test(x) || GCP_R.test(x) || AZ_R.test(x)), 0.7)
  best('tags', (h, v) => (/tag|label/.test(nm(h)) ? 0.5 : 0) + share(v, (x) => /^\s*[[{]/.test(x) || /"[^"]+"\s*:/.test(x)), 0.6)
  // Last resort for service: a plain text column whose values repeat (a category).
  best('service', (_h, v) => {
    const vals = v.filter((x) => x.trim())
    if (!vals.length) return 0
    const plain = share(vals, (x) => isNaN(Number(x)) && parseDay(x) === null && !/^\s*[[{]/.test(x) && !(AWS_R.test(x) || GCP_R.test(x) || AZ_R.test(x)) && !/^(usage|tax|credit|purchase|refund|fee)$/i.test(x.trim()))
    const distinct = new Set(vals).size / vals.length
    return plain >= 0.95 && distinct <= 0.5 ? 1 - distinct : 0
  }, 0.5)
  best('environment', (h) => (/env|stage/.test(nm(h)) ? 1 : 0), 1)
  // "app" only as a whole name part: x_PartnerCreditApplied is not an application column.
  best('application', (h) => (/application|project|workload|^app$|^appname$|^appid$|(tag|tags|label|labels)app/.test(nm(h)) && !/appl(ied|y)/.test(nm(h)) ? 1 : 0), 1)
  best('chargeCategory', (h, v) => (/charge|lineitemtype|costtype/.test(nm(h)) ? 0.5 : 0) + share(v, (x) => /^(usage|tax|credit|purchase|refund|fee|discountedusage|savingsplancoveredusage|rifee)$/i.test(x.trim())), 0.8)

  const check = checkSample(sample, mapping)
  const issues: string[] = []
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f])
  if (missing.length) issues.push(`Couldn't find a column for ${missing.map((f) => FIELD_LABEL[f].toLowerCase()).join(', ')}.`)
  const readable = check.ok + check.bad
  if (!missing.length && readable && check.bad / readable > 0.1) {
    const top = Object.entries(check.reasons).sort((a, b) => b[1] - a[1])[0]
    issues.push(`${check.bad} of the first ${check.checked} rows can't be read (${top[0].toLowerCase()}).`)
  }
  if (!missing.length && !check.ok) issues.push('None of the first rows produced usable cost data.')
  const inferredRequired = REQUIRED_FIELDS.filter((f) => source[f] === 'values')
  return { mapping, source, check, confident: issues.length === 0 && (inferredRequired.length === 0 || check.ok / Math.max(1, readable) >= 0.98), issues }
}

export function previewHeaders(input: File | string, rows = 200): Promise<{ headers: string[]; sample: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(input as never, {
      header: true, preview: rows, skipEmptyLines: true,
      complete: (res) => resolve({ headers: res.meta.fields ?? [], sample: res.data }),
      error: (e: Error) => reject(e),
    })
  })
}

/** Streams the input, aggregating to one row per day/service/region/env/app. */
export function ingest(input: File | string, mapping: Mapping, opts: IngestOptions, onProgress?: (records: number, pct: number) => void): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    const agg = new Map<string, Row>()
    const quarantine: QuarantinedRow[] = []
    const hasher = sha256.create()
    let records = 0, quarantined = 0, excluded = 0, nonUsageTotal = 0, duplicates = 0
    const seen = new Set<string>()
    const size = typeof input === 'string' ? input.length : input.size
    Papa.parse<Record<string, string>>(input as never, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1 << 20,
      chunk: (res) => {
        for (const r of res.data) {
          records++
          const line = Object.values(r).join('')
          if (seen.has(line)) { duplicates++; continue }
          seen.add(line)
          const n = normalize(r, mapping, opts)
          if (n.ok === 'skip') { excluded++; nonUsageTotal += (mapping.cost && parseCost(r[mapping.cost] ?? '')) || 0; continue }
          if (n.ok === false) {
            quarantined++
            if (quarantine.length < QUARANTINE_KEEP) quarantine.push({ line: records + 1, reason: n.reason, raw: Object.values(r).join(',').slice(0, 200) })
            continue
          }
          const key = [n.day, n.service, n.region, n.environment, n.application].join('\u0001')
          const cur = agg.get(key)
          if (cur) cur.cost += n.cost
          else agg.set(key, { day: n.day, service: n.service, region: n.region, environment: n.environment, application: n.application, cost: n.cost })
          hasher.update(utf8ToBytes(key + '|' + n.cost))
        }
        onProgress?.(records, Math.min(99, Math.round(((res.meta.cursor ?? 0) / Math.max(1, size)) * 100)))
      },
      complete: () => {
        const rows = [...agg.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.service.localeCompare(b.service)))
        onProgress?.(records, 100)
        resolve({ rows, quarantine, quarantinedCount: quarantined, excludedNonUsage: excluded, nonUsageTotal, duplicates, recordsRead: records, fingerprint: bytesToHex(hasher.digest()).slice(0, 8), mapping })
      },
      error: (e: Error) => reject(e),
    })
  })
}
