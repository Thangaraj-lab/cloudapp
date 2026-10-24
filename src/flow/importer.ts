// The import pipeline behind A2/A3: sniff → map → validate/clean → score.
import { autoMap, ingest, previewHeaders, REQUIRED_FIELDS, FIELD_LABEL, type AutoMap, type IngestResult, type Mapping } from '../engine/ingest'
import { sniff } from '../engine/sniff'
import { pairedIdle } from '../engine/idle'
import { useStore, type Currency, type ImportReport } from '../store'
import { syncDataset } from './backend'
import { backtest } from '../engine/rules'

export const SAMPLE_FILE = 'walkthrough_daily_by_service_region_tag.csv'
const dataUrl = (f: string) => `${import.meta.env.BASE_URL}data/${f}`

/** What the user handed us on Connect / Welcome; Check picks it up. */
export let pending: { file?: File; sample?: boolean; merge?: boolean; returnTo?: string } | null = null
export const setPending = (p: typeof pending) => { pending = p }

export interface Source { name: string; size: number; input: File | string; format: string; note?: string }

export async function openSource(p: NonNullable<typeof pending>): Promise<Source | { error: string; format: string }> {
  if (p.sample) {
    const res = await fetch(dataUrl(SAMPLE_FILE))
    if (!res.ok) return { error: 'The bundled sample could not be loaded. Reload the page and try again.', format: 'CSV' }
    const text = await res.text()
    return { name: SAMPLE_FILE, size: text.length, input: text, format: 'CSV · FOCUS 1.0 sample (daily rollup)' }
  }
  const f = p.file!
  const s = await sniff(f)
  if (s.kind === 'unsupported') return { error: s.guide, format: s.format }
  const name = f.name.toLowerCase()
  const format = name.endsWith('.gz') ? 'CSV.gz' : name.endsWith('.json') ? 'JSON' : 'CSV'
  return { name: f.name, size: f.size, input: s.text ?? s.file!, format, note: s.note }
}

export async function mapColumns(src: Source): Promise<{ headers: string[]; sample: Record<string, string>[]; auto: AutoMap; missing: string[] }> {
  const { headers, sample } = await previewHeaders(src.input)
  const auto = autoMap(headers, sample)
  const missing = REQUIRED_FIELDS.filter((f) => !auto.mapping[f]).map((f) => FIELD_LABEL[f])
  return { headers, sample, auto, missing }
}

export function currencyOf(headers: string[], sample: Record<string, string>[]): Currency {
  const col = headers.find((h) => /^(billingcurrency|currency|currencycode|lineitemcurrencycode|billingcurrencycode)$/i.test(h.replace(/[^a-z]/gi, '')))
  const c = col ? String(sample[0]?.[col] ?? '').trim().toUpperCase() : ''
  return (['USD', 'INR', 'EUR', 'GBP'].includes(c) ? c : 'USD') as Currency
}

export function runIngest(src: Source, mapping: Mapping, onProgress: (records: number, pct: number) => void): Promise<IngestResult> {
  return ingest(src.input, mapping, { usageOnly: true }, onProgress)
}

/** Commits the cleaned rows to the store (IndexedDB) and loads the paired utilization sample. */
export async function commit(src: Source, r: IngestResult, auto: AutoMap, currency: Currency, sample: boolean) {
  const report: ImportReport = {
    fileName: src.name, format: src.format, note: src.note, recordsRead: r.recordsRead, rows: r.rows.length, quarantined: r.quarantinedCount,
    duplicates: r.duplicates, nonUsage: r.excludedNonUsage, nonUsageTotal: r.nonUsageTotal, mapping: r.mapping as Record<string, string>,
    inferred: Object.entries(auto.source).filter(([, v]) => v === 'values').map(([k]) => FIELD_LABEL[k as keyof typeof FIELD_LABEL]), currency, at: Date.now(),
  }
  const s = useStore.getState()
  s.load({ rows: r.rows, quarantine: r.quarantine, fingerprint: r.fingerprint, source: sample ? 'FOCUS 1.0 public sample' : src.name.startsWith('laptop:') ? 'Synced from the laptop' : 'Uploaded: ' + src.name, sourceKind: sample ? 'sample' : 'upload', report })
  // With the backend up, the same rows are delivered to the local S3 bucket and analysed by the API.
  void syncDataset(src.name, r.rows)
  // Enabled guardrails check every new import (alert rules fire on the newest day).
  const st = useStore.getState()
  const last = r.rows.reduce((m, x) => (x.day > m ? x.day : m), '')
  for (const rule of st.rules.filter((x) => x.enabled)) {
    const hit = backtest(r.rows, rule).fired.filter((x) => x.day === last)
    if (hit.length) {
      st.log('rule fired', { rule: rule.name, day: last, lines: hit.map((h) => h.line) })
      st.notify({ kind: 'rule', text: `Rule fired on ${last}: ${rule.name} (${hit[0].line} ${hit[0].detail})`, to: '/guardrails' })
    }
  }
  s.set({ currency, showInr: false })
  s.log('check passed', { file: src.name, recordsRead: r.recordsRead, quarantined: r.quarantinedCount, duplicates: r.duplicates, nonUsage: r.excludedNonUsage })
  if (sample && !s.utilization) {
    const res = await fetch(dataUrl('azure_vm_sample.csv')).catch(() => null)
    if (res?.ok) {
      const csv = await res.text()
      const resources = pairedIdle(csv)
      useStore.getState().set({ utilization: { fileName: 'azure_vm_sample.csv', resources, scanned: csv.trim().split('\n').length - 1, missingCost: 0, mode: 'paired' } })
    }
  }
}

/** Phone: copy the laptop's current dataset (through the edge node or the laptop API) and run it
 *  through the same checks. Nothing is uploaded back. */
export async function syncFromLaptop(): Promise<{ rows: number } | null> {
  const res = await fetch('/api/dataset.csv', { cache: 'no-store' })
  if (!res.ok) return null
  const text = await res.text()
  const src: Source = { name: 'laptop:dataset.csv', size: text.length, input: text, format: 'CSV · synced from the laptop' }
  const c = await mapColumns(src)
  if (c.missing.length) return null
  const r = await runIngest(src, c.auto.mapping, () => {})
  await commit(src, r, c.auto, currencyOf(c.headers, c.sample), false)
  return { rows: r.rows.length }
}
