import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, Droplets, ThumbsUp, ThumbsDown } from 'lucide-react'
import type { Analyzed } from '../engine/analyze'
import type { VerdictKind } from '../engine/types'
import { useMoney, useStore } from '../store'
import { Badge, VerdictChip, verdictLabel, toast } from './ui'

/** Calm "$X/day leaking" that ticks while it is open and turns into "Stopped" after a fix. */
export function LeakMeter({ perDay, stopped = false, size = 'md', label }: { perDay: number; stopped?: boolean; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const money = useMoney()
  const [since, setSince] = useState(0)
  const t0 = useRef(Date.now())
  useEffect(() => {
    if (stopped || perDay <= 0) return
    const t = setInterval(() => setSince(((Date.now() - t0.current) / 86400000) * perDay), 1000)
    return () => clearInterval(t)
  }, [stopped, perDay])
  const big = size === 'lg' ? 'text-[34px]' : size === 'sm' ? 'text-[20px]' : 'text-[26px]'
  if (stopped)
    return (
      <motion.div initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="rounded-2xl border border-growth/35 bg-growth/8 p-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-growth"><CheckCircle2 size={14} /> Leak meter</div>
        <div className={`mt-1 font-display font-extrabold text-growth ${big}`}>Stopped</div>
        <div className="mt-1 text-[12.5px] text-muted">{label ?? `Was ${money(perDay)}/day. Waiting for billing data to verify the saving.`}</div>
      </motion.div>
    )
  return (
    <div className={`rounded-2xl border p-4 ${perDay > 0 ? 'border-waste/35 bg-waste/7' : 'border-line bg-sunk'}`}>
      <div className={`flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider ${perDay > 0 ? 'text-waste' : 'text-muted'}`}><Droplets size={14} /> Leak meter</div>
      <div className={`num mt-1 font-display font-extrabold ${big} ${perDay > 0 ? 'text-waste' : ''}`}>{money(perDay)}<span className="text-[0.5em] font-semibold text-muted">/day</span></div>
      <div className="num mt-1 text-[12.5px] text-muted">{perDay > 0 ? (label ?? `leaking if nothing changes · ${money(perDay * 30, 0)}/month · ${money(since, 4)} since you opened this`) : 'Nothing leaking right now'}</div>
    </div>
  )
}

const KINDS: VerdictKind[] = ['Waste', 'Misconfig', 'Growth']
const C: Record<VerdictKind, string> = { Waste: 'var(--waste)', Misconfig: 'var(--misconfig)', Growth: 'var(--growth)' }

/** Verdict with confidence, the three scores, reasons and what would change it. */
export function VerdictCard({ f, compact = false }: { f: Analyzed; compact?: boolean }) {
  const labels = useStore((s) => s.labels)
  const label = useStore((s) => s.label)
  const v = f.verdict
  const mine = labels[f.finding.id]
  const count = Object.keys(labels).length
  return (
    <div className={`rounded-2xl border p-4 edge-${v.kind.toLowerCase()} border-line bg-sunk`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><VerdictChip kind={v.kind} /><Badge tone="neutral">{v.confidence} confidence · margin {(v.margin * 100).toFixed(0)} pts</Badge></div>
        <span className="text-[11px] text-muted">rule-based scoring model</span>
      </div>
      <div className="mt-4 space-y-2">
        {KINDS.map((k) => (
          <div key={k} className="flex items-center gap-3 text-[12.5px]">
            <span className={`w-16 ${k === v.kind ? 'font-semibold' : 'text-muted'}`}>{verdictLabel[k]}</span>
            <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)]">
              <motion.span className="absolute inset-y-0 left-0 rounded-full" style={{ background: C[k], opacity: k === v.kind ? 1 : 0.45 }} initial={{ width: 0 }} animate={{ width: `${Math.max(2, v.scores[k] * 100)}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} />
            </span>
            <span className="num w-9 text-right text-muted">{v.scores[k].toFixed(2)}</span>
          </div>
        ))}
      </div>
      {!compact && (
        <>
          <div className="mt-4 text-[12px] font-semibold uppercase tracking-wider text-muted">Why</div>
          <ul className="mt-1.5 space-y-1.5 text-[13.5px]">{v.reasons.slice(0, 3).map((r) => <li key={r} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />{r}</li>)}</ul>
          <div className="mt-4 rounded-xl border border-line px-3 py-2.5 text-[13px]"><span className="font-semibold">What would change this? </span><span className="text-muted">{v.wouldChange}</span></div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {mine ? (
              <span className="text-[13px] text-muted">You marked this as <b className="text-ink">{verdictLabel[mine.label]}</b>{mine.label === v.kind ? ' (confirmed)' : ' (corrected)'}.</span>
            ) : (
              <>
                <button onClick={() => { label(f.finding.id, v.kind, v.kind); toast('Verdict confirmed. Saved as a label.') }} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] hover:border-[var(--border-strong)]"><ThumbsUp size={14} /> Confirm</button>
                {KINDS.filter((k) => k !== v.kind).map((k) => (
                  <button key={k} onClick={() => { label(f.finding.id, v.kind, k); toast(`Marked as ${verdictLabel[k]}. Saved as a label.`) }} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-3 text-[13px] text-muted hover:bg-sunk hover:text-ink"><ThumbsDown size={13} /> Wrong: it's {verdictLabel[k]}</button>
                ))}
              </>
            )}
            <span className="ml-auto text-[11.5px] text-muted">Labels collected: {count}</span>
          </div>
        </>
      )}
    </div>
  )
}
