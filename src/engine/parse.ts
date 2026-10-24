import Papa from 'papaparse'
import type { ParseResult, QuarantinedRow, Row } from './types'
import { sha256Hex } from './hash'

export const REQUIRED = ['day', 'service', 'region', 'environment', 'application', 'billed_cost_usd']

export function parseCsv(text: string): ParseResult {
  const fingerprint = sha256Hex(text.replace(/\r\n/g, '\n').trim()).slice(0, 8)
  const res = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  })
  const fields = res.meta.fields ?? []
  const missingColumns = REQUIRED.filter((c) => !fields.includes(c))
  if (missingColumns.length) return { rows: [], quarantine: [], missingColumns, fingerprint }

  const rows: Row[] = []
  const quarantine: QuarantinedRow[] = []
  const seen = new Set<string>()
  let duplicates = 0
  res.data.forEach((r, i) => {
    const line = i + 2
    const raw = Object.values(r).join(',')
    const day = (r.day ?? '').trim()
    const cost = Number((r.billed_cost_usd ?? '').trim())
    const service = (r.service ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || isNaN(Date.parse(day))) {
      quarantine.push({ line, reason: 'Unparseable date', raw })
    } else if ((r.billed_cost_usd ?? '').trim() === '' || !isFinite(cost)) {
      quarantine.push({ line, reason: 'Cost is not numeric', raw })
    } else if (!service) {
      quarantine.push({ line, reason: 'Service is empty', raw })
    } else if (seen.has(raw)) {
      duplicates++
    } else {
      seen.add(raw)
      rows.push({
        day,
        service,
        region: (r.region ?? '').trim() || 'untagged',
        environment: (r.environment ?? '').trim() || 'untagged',
        application: (r.application ?? '').trim() || 'untagged',
        cost,
      })
    }
  })
  return { rows, quarantine, missingColumns, fingerprint, duplicates }
}
