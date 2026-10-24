import { useEffect, useRef } from 'react'
import { Pause, Play, SkipBack, SkipForward, ChevronsRight } from 'lucide-react'
import { useStore, useMoney } from '../store'
import { useView } from '../flow/timeline'
import { headline, dayName } from '../engine/narrate'
import { Honest, Segmented } from './ui'

/** Global Time Machine bar. Everything on screen reads `tm.date` from the store. */
export function TimeMachine({ compact = false }: { compact?: boolean }) {
  const v = useView()
  const tm = useStore((s) => s.tm)
  const setTm = useStore((s) => s.setTm)
  const money = useMoney()
  const { days, idx, anomalyDays, learning } = v
  const timer = useRef(0)

  const go = (i: number) => {
    const j = Math.max(0, Math.min(days.length - 1, i))
    setTm({ date: j === days.length - 1 ? null : days[j], paused: null })
  }
  const nextAnomaly = () => {
    const j = days.findIndex((d, i) => i > idx && anomalyDays.has(d))
    if (j >= 0) { const f = v.a.findings.find((x) => x.finding.day === days[j])!; setTm({ date: days[j], playing: false, paused: headline(f, money) }) }
  }

  // Playback: advance one day per tick; pause on anomaly days with a sentence.
  useEffect(() => {
    if (!tm.playing) return
    timer.current = window.setTimeout(() => {
      const s = useStore.getState()
      const cur = s.tm.date ? days.indexOf(s.tm.date) : days.length - 1
      const n = cur >= days.length - 1 ? 0 : cur + 1
      const d = days[n]
      if (anomalyDays.has(d)) {
        const f = v.a.findings.find((x) => x.finding.day === d)!
        s.setTm({ date: n === days.length - 1 ? null : d, playing: false, paused: headline(f, money) })
        s.log('replay paused on anomaly', { day: d })
      } else s.setTm({ date: n === days.length - 1 ? null : d, playing: n !== days.length - 1, paused: null })
    }, 900 / tm.speed)
    return () => clearTimeout(timer.current)
  }, [tm.playing, tm.date, tm.speed, days.length])

  // Space play/pause, ←/→ step a day (ignored while typing).
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (/input|textarea|select/i.test(t.tagName) || t.isContentEditable) return
      if (e.key === ' ') { e.preventDefault(); setTm({ playing: !useStore.getState().tm.playing, paused: null }) }
      else if (e.key === 'ArrowRight') go(idx + 1)
      else if (e.key === 'ArrowLeft') go(idx - 1)
    }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [idx, days.length])

  if (days.length < 2) return null
  const pct = (i: number) => (i / (days.length - 1)) * 100
  return (
    <div className="glass flex flex-col gap-2 px-3 py-2.5 sm:px-4" role="group" aria-label="Time Machine">
      {tm.paused && <div className="rounded-lg bg-waste/10 px-3 py-1.5 text-[13px] text-waste">Paused on an unusual day — {tm.paused}</div>}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-0.5">
          <button aria-label="Previous day" onClick={() => go(idx - 1)} className="rounded-lg p-1.5 text-muted hover:bg-sunk hover:text-ink"><SkipBack size={15} /></button>
          <button aria-label={tm.playing ? 'Pause' : 'Play'} onClick={() => setTm({ playing: !tm.playing, paused: null, mode: 'replay' })} className="grid h-8 w-8 place-items-center rounded-full bg-accent text-[var(--accent-ink)]">{tm.playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}</button>
          <button aria-label="Next day" onClick={() => go(idx + 1)} className="rounded-lg p-1.5 text-muted hover:bg-sunk hover:text-ink"><SkipForward size={15} /></button>
        </div>
        <div className="relative min-w-0 flex-1 py-2">
          <div className="relative h-1.5 rounded-full bg-sunk">
            <div className="absolute inset-y-0 left-0 rounded-l-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" style={{ width: pct(learning - 1) + '%' }} title="Learning normal (first 7 days)" />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent/60" style={{ width: pct(idx) + '%' }} />
            {days.map((d, i) => anomalyDays.has(d) && <span key={d} className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded bg-waste" style={{ left: `calc(${pct(i)}% - 1px)` }} title={`Unusual day ${dayName(d)}`} />)}
          </div>
          <input type="range" min={0} max={days.length - 1} value={idx} onChange={(e) => go(+e.target.value)} aria-label="Billing day"
            className="absolute inset-0 w-full cursor-pointer opacity-0" />
          <div className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-solid" style={{ left: pct(idx) + '%' }} />
        </div>
        <div className="num w-[74px] shrink-0 text-right text-[13px] font-semibold">{dayName(v.date)}</div>
        {!compact && (
          <div className="hidden items-center gap-2 lg:flex">
            <Segmented size="sm" value={String(tm.speed) as '1' | '4' | '16'} options={[{ k: '1', label: '1×' }, { k: '4', label: '4×' }, { k: '16', label: '16×' }]} onChange={(k) => setTm({ speed: Number(k) as 1 | 4 | 16 })} />
            <button onClick={nextAnomaly} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-sunk hover:text-ink"><ChevronsRight size={14} /> Next anomaly</button>
            <Segmented size="sm" value={tm.mode} options={[{ k: 'replay', label: 'Replay' }, { k: 'projection', label: 'Projection' }]} onChange={(k) => setTm({ mode: k, playing: false, date: null, paused: null })} />
          </div>
        )}
      </div>
      {tm.mode === 'projection' && <div className="flex items-center gap-2 text-[12px] text-muted"><Honest k="projection" /> Future days are estimated from the median of the last 14 days for the same weekday, shown dashed.</div>}
    </div>
  )
}
