import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react'
import { animate, AnimatePresence, motion } from 'framer-motion'
import { X, AlertTriangle, Inbox, WifiOff, FlaskConical, Database, Clock3, Smartphone, Info } from 'lucide-react'
import { create } from 'zustand'
import type { VerdictKind } from '../engine/types'
import type { FindingStatus } from '../store'

const EASE = [0.22, 1, 0.36, 1] as const

export function Panel({ title, right, children, className = '', pad = true, edge, delay = 0 }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; edge?: 'waste' | 'misconfig' | 'growth'; delay?: number }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay, ease: EASE }}
      className={`panel ${edge ? `edge-${edge}` : ''} ${pad ? 'p-5' : ''} ${className}`}>
      {(title || right) && (
        <div className={`flex flex-wrap items-center justify-between gap-3 ${pad ? 'mb-4' : 'px-5 pt-5 pb-3'}`}>
          {title && <h3 className="font-display text-[16px] font-bold">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </motion.section>
  )
}

export function PageHeader({ eyebrow, title, sub, right }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="mt-1 text-[24px] font-extrabold leading-[1.18] sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  )
}

const tones = {
  accent: 'text-accent bg-accent/12',
  waste: 'text-waste bg-waste/12',
  misconfig: 'text-misconfig bg-misconfig/12',
  growth: 'text-growth bg-growth/12',
  neutral: 'text-muted bg-sunk border border-line',
}
export type Tone = keyof typeof tones

export function Badge({ tone = 'neutral', children, className = '', title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ${tones[tone]} ${className}`}>{children}</span>
}

/** Honest labels that must stay visible (CLAUDE.md 2.2). */
const HONEST = {
  real: { icon: Database, text: 'Real sample data', tone: 'accent' as Tone },
  injected: { icon: FlaskConical, text: 'Injected demo scenario', tone: 'misconfig' as Tone },
  simulated: { icon: Info, text: 'Demo mode — cloud actions simulated', tone: 'misconfig' as Tone },
  clock: { icon: Clock3, text: 'Simulated clock', tone: 'misconfig' as Tone },
  projection: { icon: Clock3, text: 'Projection', tone: 'neutral' as Tone },
  edge: { icon: Smartphone, text: 'Browser edge node (prototype)', tone: 'neutral' as Tone },
  paired: { icon: Database, text: 'Paired demo data (public Azure VM trace stats)', tone: 'neutral' as Tone },
  rate: { icon: Info, text: '₹ at demo rate', tone: 'neutral' as Tone },
}
export function Honest({ k, className = '' }: { k: keyof typeof HONEST; className?: string }) {
  const h = HONEST[k]
  return <Badge tone={h.tone} className={className}><h.icon size={12} />{h.text}</Badge>
}

export const verdictTone: Record<VerdictKind, Tone> = { Waste: 'waste', Misconfig: 'misconfig', Growth: 'growth' }
export const verdictLabel: Record<VerdictKind, string> = { Waste: 'Waste', Misconfig: 'Misconfig', Growth: 'Growth' }

export function VerdictChip({ kind, confidence }: { kind: VerdictKind; confidence?: string }) {
  return (
    <Badge tone={verdictTone[kind]}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />{verdictLabel[kind]}{confidence && <span className="opacity-75">· {confidence}</span>}
    </Badge>
  )
}

const statusMeta: Record<FindingStatus, [string, Tone]> = {
  new: ['New', 'neutral'], approved: ['Approved', 'accent'], planned: ['Plan ready', 'accent'], running: ['Running', 'accent'],
  applied: ['Pending verification', 'misconfig'], verified: ['Verified', 'growth'], inconclusive: ['Within noise', 'misconfig'],
  'not-effective': ['No saving measured', 'waste'], expected: ['Expected growth', 'growth'], dismissed: ['Dismissed', 'neutral'],
  resolved: ['Resolved', 'neutral'], 'rolled-back': ['Rolled back', 'waste'], rejected: ['Rejected', 'waste'],
}
export const statusText = (s: FindingStatus) => statusMeta[s][0]
export const StatusChip = ({ s }: { s: FindingStatus }) => <Badge tone={statusMeta[s][1]}>{statusMeta[s][0]}</Badge>

export function Button({ variant = 'primary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'quiet' | 'danger'; size?: 'sm' | 'md' | 'lg' }) {
  const v =
    variant === 'primary' ? 'btn-primary font-semibold'
      : variant === 'quiet' ? 'text-muted hover:text-ink hover:bg-sunk'
        : variant === 'danger' ? 'border border-waste/40 text-waste hover:bg-waste/10'
          : 'border border-line bg-sunk hover:border-[var(--border-strong)]'
  const s = size === 'sm' ? 'h-8 px-3 text-[13px]' : size === 'lg' ? 'h-12 px-6 text-[15px]' : 'h-10 px-4 text-sm'
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-[10px] transition-[filter,background,border-color] duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 ${s} ${v} ${className}`} />
}

/** Counts up once to the value; later changes jump straight there. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [v, setV] = useState(value)
  const first = useRef(true)
  useEffect(() => {
    if (!first.current) { setV(value); return }
    first.current = false
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return }
    const c = animate(0, value, { duration: 0.8, ease: EASE, onUpdate: setV })
    return () => c.stop()
  }, [value])
  return <span className="num">{format(v)}</span>
}

export function KPI({ label, value, sentence, tone, children }: { label: string; value: ReactNode; sentence?: ReactNode; tone?: 'waste' | 'growth' | 'accent' | 'misconfig'; children?: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow">{label}</div>
      <div className={`num mt-2 font-display text-[26px] font-extrabold leading-none ${tone ? `text-${tone}` : ''}`}>{value}</div>
      {sentence && <div className="mt-2 text-[12.5px] leading-snug text-muted">{sentence}</div>}
      {children}
    </div>
  )
}

/** Seven fixed stages of a case. */
export const CASE_STEPS = ['Detect', 'Explain', 'Judge', 'Fix', 'Approve', 'Execute', 'Verify'] as const
export function Stepper({ current, done = current - 1 }: { current: number; done?: number }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto no-scrollbar" aria-label={`Step ${current + 1} of 7: ${CASE_STEPS[current]}`}>
      {CASE_STEPS.map((s, i) => {
        const state = i === current ? 'cur' : i < current || i <= done ? 'done' : 'todo'
        return (
          <li key={s} className="flex items-center gap-1">
            <span className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-medium ${state === 'cur' ? 'bg-accent/15 text-accent' : state === 'done' ? 'text-ink' : 'text-muted'}`}>
              <span className={`h-2 w-2 rounded-full ${state === 'cur' ? 'bg-accent' : state === 'done' ? 'bg-accent/60' : 'border border-line bg-transparent'}`} />
              <span className={state === 'cur' ? '' : 'hidden md:inline'}>{s}</span>
            </span>
            {i < CASE_STEPS.length - 1 && <span className={`h-px w-3 ${i < current ? 'bg-accent/50' : 'bg-line'}`} />}
          </li>
        )
      })}
    </ol>
  )
}

export function Spark({ data, color = 'var(--accent)', w = 90, h = 24, mark }: { data: number[]; color?: string; w?: number; h?: number; mark?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1e-9)
  const x = (i: number) => (i / (data.length - 1)) * w
  const y = (v: number) => h - (v / max) * (h - 3) - 1.5
  return (
    <svg width={w} height={h} aria-hidden className="overflow-visible">
      <polyline points={data.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {mark !== undefined && mark >= 0 && <circle cx={x(mark)} cy={y(data[mark])} r="2.5" fill="var(--waste)" />}
    </svg>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />
}

/** G5: one designed empty / error / offline view reused everywhere. */
export function StateView({ kind = 'empty', title, children, action }: { kind?: 'empty' | 'error' | 'offline'; title: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = kind === 'error' ? AlertTriangle : kind === 'offline' ? WifiOff : Inbox
  return (
    <div className="panel px-6 py-12 text-center">
      <div className={`mx-auto grid h-11 w-11 place-items-center rounded-2xl ${kind === 'error' ? 'bg-waste/12 text-waste' : 'bg-accent/12 text-accent'}`}><Icon size={20} /></div>
      <h3 className="mt-4 font-display text-lg font-bold">{title}</h3>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Right drawer (420px) on desktop, bottom sheet on phones. Esc closes. */
export function Drawer({ open, onClose, title, children, footer, width = 420 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [open, onClose])
  const phone = typeof window !== 'undefined' && window.innerWidth < 640
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.aside role="dialog" aria-label={typeof title === 'string' ? title : 'Details'}
            className={`fixed z-50 flex flex-col border-line bg-solid shadow-[var(--shadow-lg)] ${phone ? 'inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl border-t' : 'right-0 top-0 h-full border-l'}`}
            style={phone ? undefined : { width, maxWidth: '100vw' }}
            initial={phone ? { y: 40, opacity: 0 } : { x: 32, opacity: 0 }} animate={phone ? { y: 0, opacity: 1 } : { x: 0, opacity: 1 }} exit={phone ? { y: 40, opacity: 0 } : { x: 32, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}>
            {phone && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" />}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0 font-display text-lg font-bold">{title}</div>
              <button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-sunk hover:text-ink"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && <div className="safe-b border-t border-line px-5 pt-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/** Toasts with an optional Undo. */
interface Toast { id: number; text: string; undo?: () => void }
const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }))
let tid = 0
export function toast(text: string, undo?: () => void) {
  const id = ++tid
  useToasts.setState((s) => ({ list: [...s.list, { id, text, undo }] }))
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), 6000)
}
export function Toasts() {
  const list = useToasts((s) => s.list)
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-line bg-solid px-4 py-3 text-sm shadow-[var(--shadow-lg)]">
            <span className="flex-1">{t.text}</span>
            {t.undo && <button className="font-semibold text-accent" onClick={() => { t.undo!(); useToasts.setState((s) => ({ list: s.list.filter((x) => x.id !== t.id) })) }}>Undo</button>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Check({ state, children, detail, right }: { state: 'pass' | 'warn' | 'fail' | 'pending' | 'running'; children: ReactNode; detail?: ReactNode; right?: ReactNode }) {
  const c = state === 'pass' ? 'bg-growth text-[var(--accent-ink)]' : state === 'warn' ? 'bg-misconfig text-[var(--accent-ink)]' : state === 'fail' ? 'bg-waste text-white' : state === 'running' ? 'border-2 border-accent' : 'border border-line'
  const sym = state === 'pass' ? '✓' : state === 'warn' ? '!' : state === 'fail' ? '✕' : ''
  return (
    <div className="flex gap-3 py-2.5">
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${c}`}>{sym}</span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${state === 'pending' ? 'text-muted' : 'font-medium'}`}>{children}</div>
        {detail && <div className="mt-0.5 text-[12.5px] text-muted">{detail}</div>}
      </div>
      {right}
    </div>
  )
}

/** Segmented control. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { k: T; label: ReactNode }[]; onChange: (k: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-[12px] border border-line bg-sunk p-0.5" role="tablist">
      {options.map((o) => (
        <button key={o.k} role="tab" aria-selected={value === o.k} onClick={() => onChange(o.k)}
          className={`rounded-[10px] font-medium transition-colors duration-150 ${size === 'sm' ? 'px-2.5 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'} ${value === o.k ? 'bg-solid text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
