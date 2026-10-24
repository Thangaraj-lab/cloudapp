import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LayoutGrid, FolderSearch, Trash2, ShieldCheck, Shield, Bell, Settings, Sun, Moon, Search, Database, Smartphone, HeartPulse, FlaskConical, Server } from 'lucide-react'
import { useAnalysis, useMoney, useStore, useName } from '../store'
import { dataHealth } from '../flow/health'
import { headline } from '../engine/narrate'
import { shortService } from '../engine/explain'
import { TimeMachine } from './TimeMachine'
import { useBackend } from '../flow/backend'
import { Honest, Toasts } from './ui'

const NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutGrid, match: ['/overview', '/service', '/trends', '/ownership'] },
  { to: '/cases', label: 'Cases', icon: FolderSearch, match: ['/cases', '/case'] },
  { to: '/waste', label: 'Waste', icon: Trash2, match: ['/waste'] },
  { to: '/proof/savings', label: 'Proof', icon: ShieldCheck, match: ['/proof'] },
  { to: '/guardrails', label: 'Guardrails', icon: Shield, match: ['/guardrails'] },
]
// The Time Machine bar shows only where replaying the past makes sense.
const TM_ROUTES = [/^\/overview$/, /^\/service\//, /^\/case\/[^/]+\/understand$/, /^\/guardrails\/backtest$/, /^\/proof\/savings$/, /^\/trends$/]

export function ThemeSync() {
  const theme = useStore((s) => s.theme)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  return null
}

function useIsActive() {
  const { pathname } = useLocation()
  return (m: string[]) => m.some((x) => pathname === x || pathname.startsWith(x + '/'))
}

function Rail() {
  const active = useIsActive()
  const a = useAnalysis()
  const status = useStore((s) => s.status)
  const open = a.findings.filter((f) => f.verdict.kind !== 'Growth' && f.state.ongoing && !['applied', 'verified', 'resolved', 'dismissed', 'expected'].includes(status[f.finding.id] ?? '')).length
  return (
    <>
      <aside className="group fixed inset-y-0 left-0 z-30 hidden w-[72px] flex-col border-r border-line bg-solid/95 py-3 backdrop-blur transition-[width] duration-200 ease-out hover:w-[208px] sm:flex">
        <NavLink to="/overview" className="mx-3 mb-5 flex h-11 items-center gap-3 overflow-hidden rounded-xl px-2">
          <span className="grad grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[15px] font-extrabold text-white">S</span>
          <span className="whitespace-nowrap font-display text-[15px] font-bold opacity-0 transition-opacity group-hover:opacity-100">SpendSentinel</span>
        </NavLink>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => {
            const on = active(n.match)
            return (
              <NavLink key={n.to} to={n.to} className={`relative flex h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-[14px] font-medium transition-colors ${on ? 'bg-accent/14 text-accent' : 'text-muted hover:bg-sunk hover:text-ink'}`}>
                <n.icon size={19} className="shrink-0" />
                <span className="whitespace-nowrap opacity-0 transition-opacity group-hover:opacity-100">{n.label}</span>
                {n.label === 'Cases' && open > 0 && <span className="absolute left-7 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-waste px-1 text-[10px] font-bold text-white">{open}</span>}
              </NavLink>
            )
          })}
        </nav>
      </aside>
      <nav className="safe-b fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-solid/95 px-1 pt-1.5 backdrop-blur sm:hidden">
        {NAV.map((n) => {
          const on = active(n.match)
          return (
            <NavLink key={n.to} to={n.to} className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[10.5px] font-medium ${on ? 'text-accent' : 'text-muted'}`}>
              <n.icon size={19} />{n.label}
            </NavLink>
          )
        })}
      </nav>
    </>
  )
}

function SearchBox() {
  const a = useAnalysis()
  const money = useMoney()
  const name = useName()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const items = useMemo(() => {
    const svcs = [...new Set(a.allRows.map((r) => r.service))]
    return [
      ...a.findings.map((f) => ({ label: headline(f, money), hint: 'Case', to: `/case/${f.finding.id}/understand` })),
      ...svcs.map((s) => ({ label: name(s), hint: 'Service', to: `/service/${encodeURIComponent(s)}` })),
      ...['Overview', 'Trends', 'Ownership', 'Cases', 'Waste', 'Savings', 'Founder Brief', 'Trust Center', 'Guardrails', 'Backtest', 'Settings', 'Data sources', 'Phone'].map((l) => ({
        label: l, hint: 'Page', to: { Overview: '/overview', Trends: '/trends', Ownership: '/ownership', Cases: '/cases', Waste: '/waste', Savings: '/proof/savings', 'Founder Brief': '/proof/brief', 'Trust Center': '/proof/trust', Guardrails: '/guardrails', Backtest: '/guardrails/backtest', Settings: '/settings', 'Data sources': '/sources', Phone: '/edge' }[l]!,
      })),
    ]
  }, [a, money, name])
  const hits = q.trim() ? items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === '/' && !(e.target as HTMLElement).matches('input,textarea')) { e.preventDefault(); box.current?.querySelector('input')?.focus() } }
    addEventListener('keydown', k)
    return () => removeEventListener('keydown', k)
  }, [])
  return (
    <div ref={box} className="relative hidden md:block">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search cases, services…  /" aria-label="Search" className="h-9 w-56 rounded-[10px] border border-line bg-sunk pl-9 pr-3 text-[13px] placeholder:text-muted focus:w-72 focus:outline-none focus:ring-1 focus:ring-accent lg:w-64" />
      {open && hits.length > 0 && (
        <div className="absolute left-0 top-11 z-50 w-[380px] overflow-hidden rounded-2xl border border-line bg-solid shadow-[var(--shadow-lg)]">
          {hits.map((h) => (
            <button key={h.hint + h.to} onMouseDown={() => { nav(h.to); setQ(''); setOpen(false) }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[13px] hover:bg-sunk">
              <span className="w-14 shrink-0 text-[11px] text-muted">{h.hint}</span><span className="line-clamp-1">{h.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const notices = useStore((s) => s.notices)
  const set = useStore((s) => s.set)
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const unread = notices.filter((n) => !n.read).length
  return (
    <div className="relative">
      <button aria-label="Notifications" onClick={() => { setOpen(!open); if (!open) set({ notices: notices.map((n) => ({ ...n, read: true })) }) }} className="relative grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-sunk hover:text-ink">
        <Bell size={17} />{unread > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-waste" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-2xl border border-line bg-solid shadow-[var(--shadow-lg)]">
            <div className="border-b border-line px-4 py-3 text-sm font-semibold">Notifications</div>
            {notices.length ? notices.slice(0, 8).map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); nav(n.to) }} className="block w-full border-b border-line px-4 py-3 text-left text-[13px] last:border-0 hover:bg-sunk">
                <div>{n.text}</div><div className="mt-0.5 text-[11px] text-muted">{new Date(n.at).toLocaleString()}</div>
              </button>
            )) : <div className="px-4 py-6 text-center text-[13px] text-muted">Approvals waiting, verified savings and rules that fire show up here.</div>}
          </div>
        </>
      )}
    </div>
  )
}

/** Backend + local cloud + local AI + edge node, one chip. */
function BackendChip() {
  const { status, health } = useBackend()
  const nav = useNavigate()
  const up = status === 'up'
  const tip = up ? `Backend up · cloud: ${health?.cloud.mode} ${health?.cloud.ok ? 'ok' : 'down'} · AI: ${health?.llm.available ? health.llm.model : 'off'} · edge: ${health?.edge.online ? 'online' : 'offline'}` : status === 'down' ? 'Backend not running: everything runs in this browser' : 'Checking backend…'
  return (
    <button onClick={() => nav('/sources')} title={tip} className="hidden h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12px] text-muted hover:bg-sunk hover:text-ink md:flex">
      <Server size={15} /><span className={`h-1.5 w-1.5 rounded-full ${up ? (health?.cloud.ok ? 'bg-growth' : 'bg-misconfig') : 'bg-neutral'}`} />
      <span className="hidden xl:inline">{up ? 'Local cloud' : 'Browser only'}</span>
      {up && health?.edge.online && <span className="rounded bg-growth/15 px-1 text-[10px] text-growth">edge</span>}
    </button>
  )
}

function TopBar() {
  const s = useStore()
  const a = useAnalysis()
  const nav = useNavigate()
  const health = dataHealth(s.rows, s.report, !!s.utilization)
  const tone = health.score >= 80 ? 'text-growth' : health.score >= 60 ? 'text-misconfig' : 'text-waste'
  const first = a.series[0]?.day, last = a.series.at(-1)?.day
  return (
    <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] px-3 backdrop-blur-md sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={() => nav('/sources')} className="flex min-w-0 items-center gap-2 rounded-[10px] px-2 py-1.5 text-left hover:bg-sunk" title="Data sources">
          <Database size={15} className="shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-semibold">{s.sourceKind === 'sample' ? 'FOCUS 1.0 sample · AWS 11353890204' : s.source?.replace(/^Uploaded: /, '')}</span>
            <span className="num block text-[11px] text-muted">{first} → {last}</span>
          </span>
        </button>
        <span className="hidden xl:inline-flex">{s.sourceKind === 'sample' && <Honest k="real" />}</span>
        {s.injected && <span className="hidden lg:inline-flex"><Honest k="injected" /></span>}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <SearchBox />
        <button onClick={() => nav('/check')} title="Data health" className={`hidden h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-semibold hover:bg-sunk sm:flex ${tone}`}><HeartPulse size={15} />{health.score}</button>
        <button onClick={() => nav('/edge')} title="Phone / edge" className="hidden h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] text-muted hover:bg-sunk hover:text-ink sm:flex">
          <Smartphone size={15} /><span className={`h-1.5 w-1.5 rounded-full ${s.paired ? 'bg-growth' : 'bg-neutral'}`} /><span className="hidden lg:inline">{s.paired ? 'Paired' : 'Phone'}</span>
        </button>
        <BackendChip />
        <Notifications />
        <button onClick={() => s.set({ showInr: !s.showInr })} title={s.showInr ? 'Show USD' : `Show ₹ (demo rate ${s.inrRate})`} className="grid h-9 w-9 place-items-center rounded-[10px] text-[14px] font-semibold text-muted hover:bg-sunk hover:text-ink">{s.showInr ? '₹' : '$'}</button>
        <button aria-label="Toggle theme" onClick={() => s.set({ theme: s.theme === 'dark' ? 'light' : 'dark' })} className="grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-sunk hover:text-ink">{s.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button aria-label="Settings" onClick={() => nav('/settings')} className="grid h-9 w-9 place-items-center rounded-[10px] text-muted hover:bg-sunk hover:text-ink"><Settings size={17} /></button>
      </div>
    </header>
  )
}

export default function Shell() {
  const hydrated = useStore((s) => s.hydrated)
  const rows = useStore((s) => s.rows)
  const injected = useStore((s) => s.injected)
  const { pathname } = useLocation()
  if (!hydrated) return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>
  if (!rows.length) return <Navigate to="/welcome" replace />
  const tm = TM_ROUTES.some((r) => r.test(pathname))
  return (
    <div className="min-h-screen sm:pl-[72px]">
      <Rail />
      <TopBar />
      <main className={`mx-auto max-w-[1440px] px-4 pt-5 sm:px-6 ${tm ? 'pb-40' : 'pb-24 sm:pb-12'}`}>
        {injected && <div className="mb-3 flex items-center gap-2 text-[12px] text-muted lg:hidden"><FlaskConical size={13} className="text-misconfig" /> Injected demo scenarios are on (dashed outline).</div>}
        <Outlet />
      </main>
      {tm && <div className="no-print fixed inset-x-0 bottom-[62px] z-20 px-3 sm:bottom-3 sm:left-[72px] sm:px-6"><div className="mx-auto max-w-[1440px]"><TimeMachine /></div></div>}
      <Toasts />
    </div>
  )
}

export const svcLabel = (s: string) => shortService(s)
