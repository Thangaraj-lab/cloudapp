import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, ChevronDown, FileText, Upload } from 'lucide-react'
import { pending, setPending, openSource, mapColumns, runIngest, commit, currencyOf, type Source } from '../../flow/importer'
import { dataHealth, applyFix, type FixId } from '../../flow/health'
import { FIELD_LABEL, FIELDS, REQUIRED_FIELDS, type AutoMap, type Mapping } from '../../engine/ingest'
import type { IngestResult } from '../../engine/ingest'
import { sha256Hex } from '../../engine/hash'
import { useStore, useMoney } from '../../store'
import { Button, Check as CheckRow, toast, Honest } from '../../components/ui'

type St = 'pending' | 'running' | 'pass' | 'warn' | 'fail'
interface Step { label: string; state: St; detail: string }
const STEPS0: Step[] = ['Format', 'Columns', 'Dates', 'Cost', 'Tags'].map((label) => ({ label, state: 'pending', detail: 'Waiting' }))

export function HealthRing({ score, size = 132 }: { score: number; size?: number }) {
  const r = size / 2 - 9, c = 2 * Math.PI * r
  const color = score >= 80 ? 'var(--growth)' : score >= 60 ? 'var(--misconfig)' : 'var(--waste)'
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunk)" strokeWidth="9" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
      </svg>
      <div className="absolute text-center"><div className="num font-display text-[34px] font-extrabold leading-none">{score}</div><div className="mt-1 text-[11px] text-muted">of 100</div></div>
    </div>
  )
}

export default function Check() {
  const nav = useNavigate()
  const s = useStore()
  const money = useMoney()
  const [steps, setSteps] = useState<Step[]>(STEPS0)
  const [src, setSrc] = useState<Source | null>(null)
  const [cols, setCols] = useState<{ headers: string[]; sample: Record<string, string>[]; auto: AutoMap } | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [needMap, setNeedMap] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(!pending)
  const [showQ, setShowQ] = useState(false)
  const started = useRef(false)
  const job = useRef(pending)

  const put = (i: number, p: Partial<Step>) => setSteps((x) => x.map((st, j) => (j === i ? { ...st, ...p } : st)))

  const finish = async (source: Source, c: NonNullable<typeof cols>, m: Mapping) => {
    put(2, { state: 'running', detail: 'Reading every row…' })
    let r: IngestResult
    try {
      r = await runIngest(source, m, (records, pct) => { setProgress(pct); put(2, { detail: `${records.toLocaleString()} rows read` }) })
    } catch (e) { put(2, { state: 'fail', detail: 'Could not read the file: ' + (e as Error).message }); return }
    const reasons = r.quarantine.reduce<Record<string, number>>((o, q) => ({ ...o, [q.reason]: (o[q.reason] ?? 0) + 1 }), {})
    const days = [...new Set(r.rows.map((x) => x.day))].sort()
    if (!r.rows.length) { put(2, { state: 'fail', detail: `No usable rows: ${r.quarantinedCount} set aside. Check the date and cost columns.` }); setNeedMap(true); return }
    put(2, { state: reasons['Unparseable date'] ? 'warn' : days.length < 14 ? 'warn' : 'pass', detail: `${days.length} days, ${days[0]} → ${days.at(-1)}${reasons['Unparseable date'] ? ` · ${reasons['Unparseable date']} rows with unreadable dates set aside` : ''}${days.length < 14 ? ' · need ≥14 days for a reliable baseline' : ''}` })
    const total = r.rows.reduce((a, x) => a + x.cost, 0)
    put(3, { state: reasons['Cost is not numeric'] ? 'warn' : 'pass', detail: `${money(total)} usage cost${r.duplicates ? ` · ${r.duplicates} duplicates removed` : ''}${r.excludedNonUsage ? ` · ${r.excludedNonUsage} credit/tax rows kept apart` : ''}${reasons['Cost is not numeric'] ? ` · ${reasons['Cost is not numeric']} non-numeric costs set aside` : ''}` })
    const tagged = r.rows.filter((x) => x.environment !== 'untagged').reduce((a, x) => a + x.cost, 0) / (total || 1)
    put(4, { state: tagged < 0.6 ? 'warn' : 'pass', detail: `${Math.round(tagged * 100)}% of spend has an environment tag · ${new Set(r.rows.map((x) => x.application)).size} applications` })
    const cur = currencyOf(c.headers, c.sample)
    const merge = job.current?.merge && useStore.getState().rows.length
    if (merge) {
      const prev = useStore.getState()
      const newDays = new Set(r.rows.map((x) => x.day))
      r = { ...r, rows: [...prev.rows.filter((x) => !newDays.has(x.day)), ...r.rows].sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : 0)), fingerprint: sha256Hex(prev.fingerprint + '+' + r.fingerprint).slice(0, 8) }
    }
    await commit(source, r, c.auto, cur, !!job.current?.sample)
    setPending(null)
    setDone(true)
  }

  useEffect(() => {
    if (started.current || !job.current) return
    started.current = true
    ;(async () => {
      put(0, { state: 'running', detail: 'Looking at the file…' })
      const source = await openSource(job.current!)
      if ('error' in source) { put(0, { state: 'fail', detail: `${source.format}: ${source.error}` }); return }
      setSrc(source)
      put(0, { state: 'pass', detail: `${source.format}${source.note ? ` · ${source.note}` : ''} · ${(source.size / 1024).toFixed(0)} KB` })
      put(1, { state: 'running', detail: 'Matching columns…' })
      const c = await mapColumns(source)
      setCols(c); setMapping(c.auto.mapping)
      const mapped = FIELDS.filter((f) => c.auto.mapping[f]).length
      if (c.missing.length) { put(1, { state: 'fail', detail: `Choose a column for: ${c.missing.join(', ')}` }); setNeedMap(true); return }
      put(1, { state: c.auto.confident ? 'pass' : 'warn', detail: `${mapped} of ${FIELDS.length} fields matched${Object.values(c.auto.source).includes('values') ? ' (some from the values; check below)' : ''} · ${c.headers.length} columns in the file` })
      if (!c.auto.confident) setNeedMap(true)
      else await finish(source, c, c.auto.mapping)
    })()
  }, [])

  if (!job.current && !s.rows.length) return <Navigate to="/welcome" replace />
  const health = dataHealth(s.rows, s.report, s.utilization?.mode !== 'paired' && !!s.utilization)
  const fix = (id: FixId, label: string) => {
    const before = useStore.getState().rows
    s.set({ rows: applyFix(before, id) })
    s.log('data fix applied', { fix: id })
    toast(`${label} — done.`, () => { useStore.getState().set({ rows: before }); useStore.getState().log('data fix undone', { fix: id }) })
  }
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f])

  return (
    <div className="mx-auto min-h-screen max-w-[1100px] px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="eyebrow">Check & health</div><h1 className="mt-1 text-[28px] font-extrabold">{done ? 'Your data is checked' : 'Checking your data'}</h1></div>
        {s.sourceKind === 'sample' && done && <Honest k="real" />}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <div className="panel p-5">
          <div className="flex items-center gap-3 border-b border-line pb-3">
            <FileText size={18} className="text-accent" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{src?.name ?? s.report?.fileName ?? s.source}</div><div className="text-[12px] text-muted">{done && !src ? `Imported ${new Date(s.importedAt ?? 0).toLocaleString()} · fingerprint ${s.fingerprint}` : 'Five checks run on every row'}</div></div>
          </div>
          {src || job.current ? (
            <div className="mt-1">
              {steps.map((st) => <CheckRow key={st.label} state={st.state === 'running' ? 'running' : st.state} detail={st.detail}>{st.label}</CheckRow>)}
              {steps[2].state === 'running' && <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunk"><motion.div className="h-full bg-accent" animate={{ width: progress + '%' }} /></div>}
            </div>
          ) : (
            <div className="mt-1">
              <CheckRow state="pass" detail={s.report?.format ?? 'CSV'}>Format</CheckRow>
              <CheckRow state="pass" detail={`${Object.keys(s.report?.mapping ?? {}).length} fields mapped${s.report?.inferred.length ? ` · from values: ${s.report.inferred.join(', ')}` : ''}`}>Columns</CheckRow>
              <CheckRow state="pass" detail={`${new Set(s.rows.map((r) => r.day)).size} days`}>Dates</CheckRow>
              <CheckRow state="pass" detail={`${money(s.rows.reduce((a, r) => a + r.cost, 0))} usage cost`}>Cost</CheckRow>
              <CheckRow state={health.parts.tags < 12 ? 'warn' : 'pass'} detail={`${Math.round((health.parts.tags / 20) * 100)}% of spend tagged`}>Tags</CheckRow>
            </div>
          )}
          {needMap && cols && (
            <div className="mt-4 space-y-2 rounded-2xl border border-misconfig/40 bg-misconfig/6 p-4">
              <div className="text-sm font-semibold">Check the column mapping</div>
              {cols.auto.issues.map((i) => <div key={i} className="text-[12.5px] text-muted">{i}</div>)}
              {FIELDS.map((f) => (
                <label key={f} className="flex items-center gap-3 text-[13px]">
                  <span className="w-32 shrink-0 text-muted">{FIELD_LABEL[f]}{REQUIRED_FIELDS.includes(f) && <span className="text-waste"> *</span>}</span>
                  <select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })} className={`min-w-0 flex-1 rounded-[10px] border bg-solid px-2 py-1.5 ${REQUIRED_FIELDS.includes(f) && !mapping[f] ? 'border-waste/60' : 'border-line'}`}>
                    <option value="">— not used —</option>{cols.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
              <Button disabled={missing.length > 0} onClick={() => { setNeedMap(false); put(1, { state: 'pass', detail: 'Mapping confirmed by you' }); finish(src!, cols, mapping) }}>Continue the check</Button>
            </div>
          )}
          {steps[0].state === 'fail' && <Button variant="ghost" className="mt-4" onClick={() => nav('/connect')}><Upload size={15} /> Choose another file</Button>}
        </div>

        <motion.div className="panel p-5" initial={{ opacity: 0 }} animate={{ opacity: done ? 1 : 0.45 }} transition={{ duration: 0.3 }}>
          {done ? (
            <>
              <div className="flex items-center gap-5">
                <HealthRing score={health.score} />
                <div><div className="font-display text-xl font-bold">Data health {health.score >= 80 ? 'is good' : health.score >= 60 ? 'is fair' : 'needs attention'}</div>
                  <div className="mt-1 text-[13px] text-muted">Completeness, validity, duplicates, date coverage and tag coverage, 20 points each.</div></div>
              </div>
              <div className="mt-4 divide-y divide-line">
                {health.items.map((it) => (
                  <CheckRow key={it.label} state={it.state} detail={it.detail}
                    right={it.fix && <Button size="sm" variant="ghost" onClick={() => fix(it.fix!.id, it.fix!.label)}>{it.fix.label}</Button>}>{it.label}</CheckRow>
                ))}
              </div>
              {s.quarantine.length > 0 && (
                <div className="mt-3">
                  <button onClick={() => setShowQ(!showQ)} className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"><ChevronDown size={14} className={showQ ? 'rotate-180' : ''} /> Set-aside rows ({s.report?.quarantined ?? s.quarantine.length})</button>
                  {showQ && <div className="sunk mt-2 max-h-48 overflow-auto p-2 font-mono text-[11px]">{s.quarantine.slice(0, 100).map((q) => <div key={q.line}><span className="text-waste">Row {q.line}:</span> {q.reason}. <span className="text-muted">{q.raw.slice(0, 80)}</span></div>)}</div>}
                </div>
              )}
              <Button size="lg" className="mt-5 w-full" onClick={() => nav(job.current?.returnTo ?? (s.revealed ? '/overview' : '/reveal'))}>Looks good <ArrowRight size={16} /></Button>
            </>
          ) : (
            <div className="grid h-full min-h-[280px] place-items-center text-center text-sm text-muted">The health score appears when the checks finish.</div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
