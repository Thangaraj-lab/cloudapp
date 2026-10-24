// Works out what kind of file was dropped before parsing it.
export type Sniffed =
  | { kind: 'csv'; text?: string; file?: File; note?: string }
  | { kind: 'unsupported'; format: string; guide: string }

const GUIDES: Record<string, string> = {
  parquet: 'Parquet is not read in the browser yet. In AWS Data Exports choose CSV (gzip is fine); in Azure Cost Management choose "Download → CSV"; in BigQuery run the billing export query and "Save results → CSV".',
  xlsx: 'Excel files are not read directly. Open the workbook and use File → Save As → CSV (UTF-8), then drop the CSV here.',
  pdf: 'An invoice PDF has no daily lines. Export the cost and usage report (CSV) from your cloud console instead.',
  unknown: 'This does not look like a billing export. Use a CSV, CSV.gz or JSON file with one row per cost line.',
}

/** JSON array (or {rows|data|items|value: [...]}) → CSV text. */
export function jsonToCsv(text: string): string {
  const v = JSON.parse(text)
  const arr: Record<string, unknown>[] = Array.isArray(v) ? v : v.rows ?? v.data ?? v.items ?? v.value ?? []
  if (!Array.isArray(arr) || !arr.length) throw new Error('empty')
  const keys = [...new Set(arr.flatMap((o) => Object.keys(o ?? {})))]
  const cell = (x: unknown) => {
    const s = x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [keys.join(','), ...arr.map((o) => keys.map((k) => cell(o[k])).join(','))].join('\n')
}

export async function sniff(file: File): Promise<Sniffed> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const name = file.name.toLowerCase()
  if (b[0] === 0x50 && b[1] === 0x41 && b[2] === 0x52 && b[3] === 0x31) return { kind: 'unsupported', format: 'Parquet', guide: GUIDES.parquet }
  if (b[0] === 0x50 && b[1] === 0x4b)
    return name.endsWith('.zip') ? { kind: 'unsupported', format: 'ZIP', guide: 'Unzip the archive and drop the CSV inside it.' } : { kind: 'unsupported', format: 'Excel', guide: GUIDES.xlsx }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { kind: 'unsupported', format: 'PDF', guide: GUIDES.pdf }
  if (b[0] === 0x1f && b[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') return { kind: 'unsupported', format: 'gzip', guide: 'This browser cannot unzip .gz files. Unzip it first, then drop the CSV.' }
    const text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    const t = text.trimStart()
    if (t.startsWith('[') || t.startsWith('{')) return { kind: 'csv', text: jsonToCsv(t), note: 'Unzipped and converted from JSON' }
    return { kind: 'csv', text, note: 'Unzipped .gz' }
  }
  const first = new TextDecoder().decode(b).trimStart()
  if (first.startsWith('[') || first.startsWith('{')) {
    try {
      return { kind: 'csv', text: jsonToCsv(await file.text()), note: 'Converted from JSON' }
    } catch {
      return { kind: 'unsupported', format: 'JSON', guide: 'The JSON has no list of cost rows. Export as CSV instead.' }
    }
  }
  if (b.some((x) => x === 0)) return { kind: 'unsupported', format: 'binary', guide: GUIDES.unknown }
  return { kind: 'csv', file }
}
