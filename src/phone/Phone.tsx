import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { LayoutGrid, FolderSearch, Trash2, ShieldCheck, Shield, RefreshCw, Upload, Database, ArrowRight, Fingerprint, CheckCircle2 } from 'lucide-react'
import { useAnalysis, useMoney, useStore } from '../store'
import { useView, needsAction } from '../flow/timeline'
import { useSubject, stateHash, policyFor, wasteId, type Subject } from '../flow/subject'
import { startAction, entryFor, finishRun, fastForward } from '../flow/actions'
import { setPending } from '../flow/importer'
import { decode, pairingKey, sign, shortCode, verify, issue } from '../engine/approval'
import { plan as sagaPlan, STEPS } from '../engine/execute'
import { brief, headline } from '../engine/narrate'
import { verifyChain } from '../engine/audit'
import { backtest } from '../engine/rules'
import { Badge, Button, CountUp, Honest, StatusChip, VerdictChip, Toasts, toast, CASE_STEPS } from '../components/ui'
import { LeakMeter, VerdictCard } from '../components/Signature'
import { WorldView, EstateList, useEstate } from '../world/World'
import { useTier } from '../world/quality'
import { Qr, useCountdown } from '../screens/cases/Approve'
import { BaselineChart } from '../viz/charts'
import { StatusStrip, useLaptopSync } from './PhoneStatus'
import { api, clientLog, useBackend } from '../flow/backend'
import { sha256Hex } from '../engine/hash'

const TABS = [
  { to: '/m', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/m/cases', label: 'Cases', icon: FolderSearch },
  { to: '/m/waste', label: 'Waste', icon: Trash2 },
  { to: '/m/proof', label: 'Proof', icon: ShieldCheck },
  { to: '/m/rules', label: 'Rules', icon: Shield },
]

type Ping = { state: 'idle' | 'testing' | 'ok' | 'static' | 'fail'; text: string }

/** Can this phone reach the laptop's dev server? Explains the likely cause when it can't. */
export function ConnectionTest() {
  const [r, setR] = useState<Ping>({ state: 'idle', text: '' })
  const run = async () => {
    setR({ state: 'testing', text: 'Testing…' })
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    try {
      const res = await fetch('/__ping?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal })
      const body = (await res.text()).trim()
      if (res.ok && body === 'ok') setR({ state: 'ok', text: `Reachable: the laptop at ${location.host} answered.` })
      else setR({ state: 'static', text: 'Page is served by a host without the dev server (for example a static deploy). That is fine: everything runs in this browser.' })
    } catch {
      if (!navigator.onLine) setR({ state: 'fail', text: 'Not reachable: this phone is offline. Approvals and signing still work while the page stays open.' })
      else setR({ state: 'fail', text: 'Not reachable. Likely: the laptop dev server stopped, the firewall blocks Node.js (allow it on Private networks), or the Wi-Fi isolates devices (guest/college Wi-Fi). Use a phone hotspot.' })
    } finally { clearTimeout(t) }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
      <button onClick={run} disabled={r.state === 'testing'} className="rounded-full border border-line px-2.5 py-1 font-medium text-accent">Test connection</button>
      {r.state !== 'idle' && <span className={r.state === 'ok' || r.state === 'static' ? 'text-growth' : r.state === 'fail' ? 'text-waste' : 'text-muted'}>{r.text}</span>}
    </div>
  )
}

/** Approval requests created on the laptop, delivered live through the API. */
/** The laptop publishes a hash of its pairing code; if this phone signs with a different code,
 *  every approval would be rejected, so say so up front instead of failing silently. */
function PairingCheck() {
  const health = useBackend((b) => b.health)
  const { pairingCode, paired } = useStore()
  const nav = useNavigate()
  const mine = sha256Hex(pairingCode).slice(0, 8)
  const match = !!health && health.pairingHash === mine
  const reported = useRef('')
  useEffect(() => {
    if (!health) return
    // Re-confirm on every health poll: after a laptop restart or reset the API has forgotten
    // the phone, and it must not look unpaired. (Cheap: one small POST every 5 s.)
    if (match && paired && !health.pairedPhone?.current) void api('/edge/paired', { json: { hash: mine, device: 'phone ' + (navigator.userAgent.match(/Android [\d.]+/)?.[0] ?? 'browser') } }).catch(() => {})
    const key = `${mine}|${health.pairingHash}|${paired ? 1 : 0}`
    if (reported.current === key) return
    reported.current = key
    clientLog('pairing check', { paired: !!paired, match, phoneHash: mine, laptopHash: health.pairingHash })
  }, [health, mine, paired])
  if (!health || match) return null
  return (
    <div className="mb-4 rounded-2xl border border-waste/50 bg-waste/10 p-4 text-[13.5px]">
      <div className="font-semibold text-waste">{paired ? 'Paired with a different code than the laptop' : 'Not paired with this laptop'}</div>
      <p className="mt-1 text-muted">Approvals from this phone would be rejected. On the laptop open Phone / Edge and scan the pairing QR, or type the 8-character code shown there.</p>
      <Button size="sm" className="mt-3" onClick={() => nav('/m/pair/')}>Enter the laptop code</Button>
    </div>
  )
}

function PendingFromLaptop() {
  const pending = useBackend((b) => b.pending)
  const nav = useNavigate()
  // Newest request first (several can be open; each expires after 10 minutes).
  const p = pending.length ? [...pending].sort((x, y) => y.expiresAt - x.expiresAt)[0] : null
  const hidden = !p || location.hash.includes('/m/approve/')
  // Diagnostics: report when the card appears, so the laptop knows what the phone shows.
  useEffect(() => { if (!hidden && p) clientLog('approval card shown', { findingId: p.findingId }) }, [hidden, p?.body])
  if (hidden || !p) return null
  const open = () => {
    clientLog('approval card tapped', { findingId: p.findingId })
    nav(`/m/approve/${encodeURIComponent(p.findingId)}?r=${encodeURIComponent(p.body)}`)
  }
  return (
    <button onClick={open} className="mb-4 w-full rounded-2xl border border-misconfig/50 bg-misconfig/10 p-4 text-left">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-misconfig">Approval waiting · from the laptop</div>
      <div className="mt-1 text-[14px] font-medium">{p.headline}</div>
      <div className="mt-1 text-[12.5px] text-muted">{p.action}{p.needsSecond ? ' · needs a second approver' : ''}</div>
      <div className="mt-2 flex items-center gap-1 text-[13px] text-accent">Review and hold to approve <ArrowRight size={14} /></div>
    </button>
  )
}

export function PhoneLayout() {
  const hydrated = useStore((s) => s.hydrated)
  const loc = useLocation()
  useEffect(() => { clientLog('screen', { path: loc.pathname }) }, [loc.pathname])
  if (!hydrated) return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>
  return (
    <div className="mx-auto min-h-screen max-w-[520px]">
      <header className="sticky top-0 z-20 border-b border-line bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] px-4 pb-2.5 pt-[max(10px,env(safe-area-inset-top))] backdrop-blur">
        <div className="mb-2 flex items-center gap-2">
          <span className="grad grid h-8 w-8 place-items-center rounded-xl font-display text-[13px] font-extrabold text-white">S</span>
          <div className="min-w-0 leading-tight"><div className="font-display text-[15px] font-bold">SpendSentinel</div><div className="text-[11px] text-muted">Approver · edge node (prototype)</div></div>
        </div>
        <StatusStrip />
      </header>
      <main className="px-4 pb-32 pt-4"><PairingCheck /><PendingFromLaptop /><Outlet /></main>
      <nav className="safe-b fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-[520px] gap-1 border-t border-line bg-solid/95 px-2 pt-1.5 backdrop-blur">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium ${isActive ? 'bg-accent/12 text-accent' : 'text-muted'}`}>
            <t.icon size={21} />{t.label}
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  )
}

function NoData() {
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const { sync, busy, canSync } = useLaptopSync()
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[24px] font-extrabold leading-tight">No data on this phone yet</h1>
        <p className="mt-1 text-[14px] text-muted">Approving needs no data here. To see cases on the phone, copy the laptop's data or load a file. Nothing is uploaded.</p>
      </div>
      {canSync && <Button size="lg" className="w-full" disabled={busy} onClick={() => sync()}><RefreshCw size={16} className={busy ? 'animate-spin' : ''} /> {busy ? 'Syncing…' : 'Sync from the laptop'}</Button>}
      <Button size="lg" variant={canSync ? 'ghost' : 'primary'} className="w-full" onClick={() => { setPending({ sample: true, returnTo: '/m' }); nav('/check') }}><Database size={16} /> Try real sample</Button>
      <input ref={input} type="file" accept=".csv,.gz,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPending({ file: f, returnTo: '/m' }); nav('/check') } }} />
      <Button size="lg" variant="ghost" className="w-full" onClick={() => input.current?.click()}><Upload size={16} /> Choose a file</Button>
      <MoreLinks />
    </div>
  )
}

function MoreLinks() {
  return (
    <div className="space-y-3 border-t border-line pt-4 text-[13px]">
      <ConnectionTest />
      <NavLink to="/m/approve/paste" className="link block">Paste an approval request from the laptop</NavLink>
      <NavLink to="/m/pair/" className="link block">Pair again with the laptop</NavLink>
    </div>
  )
}

export function PhoneOverview() {
  const rows = useStore((s) => s.rows)
  const status = useStore((s) => s.status)
  const source = useStore((s) => s.source)
  const importedAt = useStore((s) => s.importedAt)
  const v = useView()
  const money = useMoney()
  const nav = useNavigate()
  const tier = useTier()
  const estate = useEstate()
  const { sync, busy, newer, canSync } = useLaptopSync()
  const [showEstate, setShowEstate] = useState(false)
  if (!rows.length) return <NoData />
  const open = v.a.findings.filter((f) => needsAction(f, status[f.finding.id]))
  const verified = useStore.getState().ledger.filter((l) => l.status === 'verified').reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0)
  return (
    <div className="space-y-4">
      {newer && canSync && (
        <button onClick={() => sync()} className="flex w-full items-center gap-3 rounded-2xl border border-accent/40 bg-accent/8 p-3 text-left text-[13.5px]">
          <RefreshCw size={16} className={`text-accent ${busy ? 'animate-spin' : ''}`} /><span className="flex-1">The laptop has newer data.</span><span className="font-semibold text-accent">Sync</span>
        </button>
      )}
      <div>
        <div className="text-[12px] text-muted">{source}{importedAt ? ` · ${new Date(importedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}</div>
        <h1 className="mt-0.5 text-[22px] font-extrabold leading-tight">{open.length ? `${open.length} problem${open.length === 1 ? '' : 's'} need you` : 'All normal'}</h1>
      </div>
      <LeakMeter perDay={v.leakPerDay} size="sm" />
      <div className="grid grid-cols-2 gap-2.5">
        {[
          ['Spend', <CountUp key="s" value={v.spendToDate} format={(n) => money(n, 0)} />, ''],
          ['At risk', money(v.atRisk, 0), v.atRisk ? 'text-waste' : ''],
          ['Open cases', String(open.length), open.length ? 'text-misconfig' : ''],
          ['Verified / mo', money(verified, 0), 'text-growth'],
        ].map(([l, val, tone]) => (
          <div key={l as string} className="panel p-3.5"><div className="eyebrow">{l}</div><div className={`num mt-1.5 font-display text-[22px] font-extrabold leading-none ${tone}`}>{val}</div></div>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><h2 className="font-display text-[17px] font-bold">Needs attention</h2><NavLink to="/m/cases" className="link text-[13px]">All cases</NavLink></div>
        {open.length ? open.slice(0, 3).map((f) => (
          <button key={f.finding.id} onClick={() => nav(`/m/case/${f.finding.id}`)} className={`panel mb-2.5 flex w-full items-start gap-3 p-4 text-left edge-${f.verdict.kind.toLowerCase()}`}>
            <div className="min-w-0 flex-1"><VerdictChip kind={f.verdict.kind} confidence={f.verdict.confidence} /><div className="mt-2 text-[14.5px] leading-snug">{headline(f, money)}</div>
              <div className="num mt-1.5 text-[12px] text-muted">{money(f.finding.moneyAtRisk, 0)} at risk</div></div>
            <ArrowRight size={18} className="mt-1 shrink-0 text-muted" />
          </button>
        )) : <div className="panel p-4 text-[14px] text-muted">Nothing needs you right now.</div>}
      </div>
      <div className="panel overflow-hidden">
        <button onClick={() => setShowEstate(!showEstate)} className="flex w-full items-center justify-between p-4 text-left"><span className="font-display font-bold">Estate</span><span className="text-[13px] text-accent">{showEstate ? 'Hide' : 'Show'}</span></button>
        {showEstate && (tier === 'medium' || tier === 'high'
          ? <div className="px-3 pb-3"><WorldView height={260} labelMode="top" chip={false} onPick={(b) => nav(`/m/cases?service=${encodeURIComponent(b.service)}`)} /></div>
          : <EstateList estate={estate} />)}
      </div>
      <MoreLinks />
    </div>
  )
}

export function PhoneCases() {
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const status = useStore((s) => s.status)
  const [params] = useSearchParams()
  const svc = params.get('service')
  if (!a.series.length) return <NoData />
  const list = [...a.findings, ...a.signals].filter((f) => !svc || f.explanation.topPath.service === svc)
  return (
    <div className="space-y-2.5">
      <h1 className="text-[22px] font-extrabold">Cases</h1>
      {list.map((f) => (
        <button key={f.finding.id} onClick={() => nav(`/m/case/${f.finding.id}`)} className={`panel block w-full p-3 text-left edge-${f.verdict.kind.toLowerCase()}`}>
          <div className="flex flex-wrap gap-1.5"><VerdictChip kind={f.verdict.kind} confidence={f.verdict.confidence} />{status[f.finding.id] && <StatusChip s={status[f.finding.id]} />}{f.finding.injected && <Honest k="injected" />}</div>
          <div className="mt-1.5 text-[14px]">{headline(f, money)}</div>
          <div className="num mt-1 text-[12px] text-muted">{money(f.finding.moneyAtRisk, 0)} at risk</div>
        </button>
      ))}
    </div>
  )
}

/** 1-second hold to approve, with a ring and a vibration on success. */
export function HoldToApprove({ onDone, disabled, label = 'Hold to approve' }: { onDone: () => void; disabled?: boolean; label?: string }) {
  const [p, setP] = useState(0)
  const raf = useRef(0)
  const t0 = useRef(0)
  const holding = useRef(false)
  const done = useRef(false)
  // Only a real lift stops the hold. Android Chrome fires pointerleave/pointercancel during a
  // long press, which used to reset the ring before it completed.
  const stop = (why: string) => {
    if (!holding.current || done.current) return
    holding.current = false
    cancelAnimationFrame(raf.current)
    setP(0)
    clientLog('hold released early', { why, ms: Math.round(performance.now() - t0.current) })
  }
  const start = (e: React.PointerEvent | React.TouchEvent) => {
    if (disabled) { clientLog('hold on a disabled button', {}); return }
    if (holding.current) return
    if ('pointerId' in e) { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not supported */ } }
    holding.current = true
    done.current = false
    t0.current = performance.now()
    clientLog('hold start', {})
    const tick = () => {
      if (!holding.current) return
      const x = Math.min(1, (performance.now() - t0.current) / 1000)
      setP(x)
      if (x >= 1) { done.current = true; holding.current = false; navigator.vibrate?.(60); clientLog('hold complete', {}); onDone(); return }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const C = 2 * Math.PI * 46
  return (
    <button disabled={disabled} onPointerDown={start} onTouchStart={start} onPointerUp={() => stop('pointerup')} onTouchEnd={() => stop('touchend')}
      onContextMenu={(e) => e.preventDefault()}
      className="relative mx-auto grid h-[120px] w-[120px] select-none place-items-center rounded-full bg-accent/12 text-accent disabled:opacity-40"
      style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }} aria-label={label}>
      <svg width="120" height="120" className="absolute inset-0 -rotate-90"><circle cx="60" cy="60" r="46" fill="none" stroke="var(--border)" strokeWidth="6" /><circle cx="60" cy="60" r="46" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} /></svg>
      <span className="flex flex-col items-center gap-1 text-[12px] font-semibold"><Fingerprint size={30} />{p > 0 ? 'Keep holding' : label}</span>
    </button>
  )
}

/** Swipeable stages for one case on the phone. */
export function PhoneCase() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const s = useSubject(decodeURIComponent(id))
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const st = useStore()
  const scroller = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(Number(params.get('stage') ?? 0))
  const [running, setRunning] = useState<number | null>(null)
  useEffect(() => { scroller.current?.scrollTo({ left: stage * (scroller.current.clientWidth), behavior: 'smooth' }) }, [])
  if (!s) return <div className="panel p-4 text-[14px]">This case is not in the data on this phone. <button className="link" onClick={() => nav('/m/cases')}>Back</button></div>
  const f = s.analyzed
  const e = entryFor(s.id)
  const pol = policyFor(s, (n) => money(n))
  const stages = ['Understand', 'Fix', 'Approve', 'Run', 'Result']
  const approve = async () => {
    const key = pairingKey(st.pairingCode)
    // Backend up: approve on the laptop's API (its pending request, or a new one), so the
    // laptop ledger and audit chain record it and the laptop moves on live.
    const b = useBackend.getState()
    if (b.status === 'up' && s.kind === 'case') {
      try {
        const pending = b.pending.find((p) => p.findingId === s.id)
        const body = pending?.body ?? (await api<{ body?: string; policy: { reasons: string[] } }>('/approvals/request', { json: { findingId: s.id, device: 'phone' } })).body
        if (!body) throw new Error('Blocked by policy')
        const r = await api<{ actionId?: string; queued?: boolean }>('/approvals/consume', { json: { findingId: s.id, token: sign(key, body) } })
        st.log('approval issued', { subject: s.id, by: 'phone (hold)', remote: r.actionId ?? 'queued' })
        toast(r.queued ? 'Approved and saved on this phone. It is sent when the laptop is reachable.' : `Approved. Sent to the laptop (${r.actionId}).`)
        go(3)
      } catch (x) {
        toast(`Laptop refused it: ${(x as Error).message}`)
      }
      return
    }
    const exp = { findingId: s.id, stateHash: stateHash(s, st.fingerprint) }
    const token = issue(key, { findingId: s.id, action: s.action, stateHash: exp.stateHash, deviceId: 'phone@' + st.deviceId })
    const v = verify(key, token, { usedNonces: st.usedNonces, expected: exp })
    if (!v.ok) { toast(v.reason); return }
    st.log('approval issued', { subject: s.id, by: 'phone (hold)', nonce: v.payload.nonce })
    startAction(s, 'Phone approver', v.payload.nonce)
    toast('Approved on this phone.')
    go(3)
  }
  const run = (failAt?: number) => {
    const entry = entryFor(s.id)
    if (!entry) return
    const p = sagaPlan(failAt)
    st.log('execute started', { actionId: entry.id, mode: 'simulated', simulateFailureAt: failAt ?? null })
    p.events.forEach((ev, i) => setTimeout(() => { setRunning(ev.step); if (i === p.events.length - 1) { finishRun(entry.id, p.outcome === 'done', failAt); setRunning(null); go(4) } }, (i + 1) * 450))
  }
  const go = (i: number) => { setStage(i); scroller.current?.scrollTo({ left: i * scroller.current.clientWidth, behavior: 'smooth' }) }
  return (
    <div className="space-y-3">
      <button onClick={() => nav('/m/cases')} className="text-[13px] text-muted">← Cases</button>
      <div className="sticky top-[86px] z-10 -mx-4 flex justify-center gap-1.5 bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] py-2 backdrop-blur">
        {stages.map((l, i) => <button key={l} onClick={() => go(i)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium ${stage === i ? 'bg-accent/15 text-accent' : 'text-muted'}`}>{i + 1}. {l}</button>)}
      </div>
      <h1 className="text-[18px] font-bold leading-snug">{s.title}</h1>
      <div ref={scroller} onScroll={(ev) => { const el = ev.currentTarget; setStage(Math.round(el.scrollLeft / el.clientWidth)) }} className="no-scrollbar -mx-4 flex snap-x snap-mandatory overflow-x-auto">
        <section className="w-full shrink-0 snap-center space-y-3 px-4">
          {f ? <><BaselineChart points={a.baseline} fmt={money} height={180} anomalies={[f.finding.day]} focus={f.finding.day} /><LeakMeter perDay={f.verdict.kind === 'Growth' ? 0 : f.state.currentExtraPerDay} size="sm" /><VerdictCard f={f} /></> : <div className="panel p-4 text-[14px]">Idle for {s.idle?.daysIdle} days at {s.idle?.avgCpu.toFixed(1)}% average CPU.</div>}
          <Button size="lg" className="w-full" disabled={s.growth} onClick={() => go(1)}>{s.growth ? 'Growth: no fix needed' : 'Plan the fix'}</Button>
        </section>
        <section className="w-full shrink-0 snap-center space-y-3 px-4">
          <div className="panel p-4"><div className="text-[15px] font-semibold">{s.action}</div><div className="num mt-2 text-[14px] text-growth">{money(s.netMonthly, 0)}/month net</div><div className="mt-2 text-[13px] text-muted">Rollback: {s.rollback}</div><div className="mt-2"><Badge tone={s.risk === 'High' ? 'waste' : s.risk === 'Medium' ? 'misconfig' : s.risk === 'Low' ? 'growth' : 'neutral'}>Risk {s.risk === 'Unknown' ? 'not assessed' : s.risk}</Badge></div></div>
          <Button size="lg" className="w-full" disabled={s.growth || !s.ongoing} onClick={() => go(2)}>Review & approve</Button>
        </section>
        <section className="w-full shrink-0 snap-center space-y-3 px-4">
          <div className="panel p-4 text-[13.5px]"><Badge tone={pol.result === 'deny' ? 'waste' : 'misconfig'}>{pol.result === 'deny' ? 'Blocked by policy' : 'Needs approval'}</Badge><p className="mt-2 text-muted">{pol.reasons[0]}</p></div>
          {pol.result !== 'deny' && !e && <div className="panel py-6"><HoldToApprove onDone={approve} /><p className="mt-3 text-center text-[12px] text-muted">Signed on this phone, single-use, 10-minute expiry.</p></div>}
          {e && <div className="panel p-4 text-[14px] text-growth"><CheckCircle2 size={16} className="inline" /> Approved by {e.approvedBy}.</div>}
        </section>
        <section className="w-full shrink-0 snap-center space-y-3 px-4">
          <Honest k="simulated" />
          <div className="panel space-y-1.5 p-4">{STEPS.map((l, i) => <div key={l} className={`text-[13px] ${running !== null && i <= running ? 'text-growth' : 'text-muted'}`}>{i + 1}. {l}</div>)}</div>
          <Button size="lg" className="w-full" disabled={!e || e.status !== 'planned' || running !== null} onClick={() => run()}>Run (simulated)</Button>
          <Button variant="ghost" className="w-full" disabled={!e || e.status !== 'planned' || running !== null} onClick={() => run(4)}>Run with a failure at step 4</Button>
        </section>
        <section className="w-full shrink-0 snap-center space-y-3 px-4">
          {e?.status === 'rolled-back' ? <div className="panel p-4 text-[14px]"><b className="text-waste">Rolled back.</b> No saving counted.</div> : e && e.status !== 'planned' ? <LeakMeter perDay={s.perDay} stopped /> : <div className="panel p-4 text-[14px] text-muted">Run the fix first.</div>}
        </section>
      </div>
      <div className="flex justify-center gap-1.5">{CASE_STEPS.slice(2).map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === stage ? 'bg-accent' : 'bg-line'}`} />)}</div>
    </div>
  )
}

export function PhoneWaste() {
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const status = useStore((s) => s.status)
  if (!a.series.length) return <NoData />
  return (
    <div className="space-y-2.5">
      <h1 className="text-[22px] font-extrabold">Waste</h1>
      <p className="text-[13px] text-muted">{a.idle.length} idle · {money(a.idle.reduce((s, r) => s + r.netSaving, 0), 0)}/month net</p>
      {a.idle.map((r) => (
        <motion.div key={r.id} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} onDragEnd={(_, info) => { if (info.offset.x < -90) nav(`/m/case/${wasteId(r)}?stage=1`) }} className="panel p-3">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.id}</span>{status[wasteId(r)] ? <StatusChip s={status[wasteId(r)]} /> : <span className="num font-semibold text-growth">{money(r.netSaving, 0)}/mo</span>}</div>
          <div className="mt-1 text-[12px] text-muted">{r.avgCpu.toFixed(1)}% CPU · {r.daysIdle} days · swipe left to park</div>
        </motion.div>
      ))}
    </div>
  )
}

export function PhoneProof() {
  const a = useAnalysis()
  const money = useMoney()
  const { ledger, audit, log } = useStore()
  const [check, setCheck] = useState<string | null>(null)
  const b = useMemo(() => brief({ series: a.series, cases: a.findings, verifiedMonthly: ledger.filter((l) => l.status === 'verified').reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0), pendingMonthly: ledger.filter((l) => l.status === 'applied').reduce((s, l) => s + l.estimatedMonthlySaving, 0), idleMonthly: a.idle.reduce((s, r) => s + r.netSaving, 0), idleCount: a.idle.length }, money), [a, ledger, money])
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-extrabold">Proof</h1>
      <div className="panel p-4">
        <div className="flex items-center justify-between"><h2 className="font-display font-bold">Receipts</h2><Button size="sm" variant="ghost" disabled={!ledger.some((l) => l.status === 'applied')} onClick={() => { fastForward(); toast('Simulated 7 days.') }}>Fast-forward 7 days</Button></div>
        {ledger.length ? ledger.map((l) => <div key={l.id} className="mt-2 flex justify-between gap-2 text-[13px]"><span className="truncate">{l.action}</span><span className="num shrink-0">{l.status === 'verified' ? money(l.measurement?.monthlySaving ?? 0, 0) + '/mo' : l.status}</span></div>) : <p className="mt-2 text-[13px] text-muted">No fixes yet.</p>}
      </div>
      <div className="panel p-4">
        <div className="flex items-center justify-between"><h2 className="font-display font-bold">Audit chain</h2><Button size="sm" onClick={() => { const r = verifyChain(audit); setCheck(r.ok ? `Verified · ${r.n} entries` : `Broken at #${r.brokenAt}`); log('audit verified', { ok: r.ok }) }}>Verify</Button></div>
        <p className="mt-1 text-[13px] text-muted">{check ?? `${audit.length} entries`}</p>
      </div>
      <div className="panel p-4"><h2 className="font-display font-bold">{b.title}</h2>{b.paragraphs.map((p, i) => <p key={i} className="mt-2 text-[13.5px] leading-relaxed">{p}</p>)}<p className="mt-3 text-[13.5px] font-medium text-accent">{b.next}</p></div>
    </div>
  )
}

export function PhoneRules() {
  const a = useAnalysis()
  const money = useMoney()
  const { trust, rules, set, policy, log } = useStore()
  const names = ['Observe', 'Recommend', 'Approve-first', 'Auto dev/test']
  return (
    <div className="space-y-4">
      <h1 className="text-[22px] font-extrabold">Rules</h1>
      <div className="panel p-4"><div className="eyebrow">Trust ladder</div><div className="mt-2 grid grid-cols-2 gap-2">{names.map((n, i) => <button key={n} onClick={() => { set({ trust: i, policy: { ...policy, autoApply: i === 3 } }); log('policy changed', { trust: n }) }} className={`rounded-xl border px-3 py-2 text-[13px] ${trust === i ? 'border-accent bg-accent/10 text-accent' : 'border-line'}`}>{i + 1}. {n}</button>)}</div></div>
      <div className="panel p-4">
        <div className="eyebrow">Rules</div>
        {rules.length ? rules.map((r) => { const b = backtest(a.allRows, r); return (
          <label key={r.id} className="mt-3 flex items-start gap-3 text-[13.5px]"><input type="checkbox" checked={r.enabled} onChange={() => set({ rules: rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) })} className="mt-1 h-4 w-4 accent-[var(--accent)]" /><span>{r.name}<span className="block text-[12px] text-muted">{b.alertOnly ? `${b.fired.length} alerts in history` : `would have saved ${money(b.saved)}`}</span></span></label>
        ) }) : <p className="mt-2 text-[13px] text-muted">Add rules on the laptop under Guardrails.</p>}
      </div>
    </div>
  )
}

/** Pair this phone: store the laptop's pairing code. */
export function PhonePair() {
  const { code = '' } = useParams()
  const { set, log, pairingCode } = useStore()
  const nav = useNavigate()
  const [typed, setTyped] = useState(code)
  const [err, setErr] = useState<string | null>(null)
  const [liveHash, setLiveHash] = useState<string | undefined>()
  // Scanning a new QR in the same tab only changes the hash: follow the code in the link,
  // otherwise the code typed or scanned earlier would be submitted.
  useEffect(() => { if (code) { setTyped(code.toUpperCase()); setErr(null) } }, [code])
  const polledHash = useBackend((b) => (b.status === 'up' ? b.health?.pairingHash : undefined))
  // Do not wait for the background 5-second poll when a QR is being submitted.
  // A direct health read makes stale-QR feedback deterministic after opening the link.
  useEffect(() => {
    let alive = true
    void api<{ pairingHash?: string }>('/health').then((h) => { if (alive) setLiveHash(h.pairingHash) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const laptopHash = liveHash ?? polledHash
  const ok = /^[A-Z2-9]{8}$/.test(typed)
  const pair = async () => {
    // When the laptop is reachable, only its current code is accepted (it publishes a hash of
    // it). Offline, any code is accepted and checked again once the laptop is reachable.
    let currentHash = laptopHash
    if (!currentHash) currentHash = await api<{ pairingHash?: string }>('/health').then((h) => h.pairingHash).catch(() => undefined)
    if (currentHash && sha256Hex(typed).slice(0, 8) !== currentHash) {
      setErr('That is not the laptop’s current code. The QR or code you used is old: open Phone / Edge on the laptop and scan the QR shown there now.')
      clientLog('pairing refused: stale code', { phoneHash: sha256Hex(typed).slice(0, 8), laptopHash: currentHash })
      return
    }
    set({ pairingCode: typed, paired: { name: 'Laptop', at: Date.now() } })
    log('phone paired', { method: code ? 'qr' : 'code', verified: !!currentHash })
    clientLog('phone paired', { verified: !!currentHash })
    toast(currentHash ? 'Paired and verified with the laptop.' : 'Paired (will be checked when the laptop is reachable).')
    nav('/m')
  }
  return (
    <div className="space-y-4 pt-4">
      <h1 className="text-[24px] font-extrabold">Pair with the laptop</h1>
      <p className="text-[14px] text-muted">The code becomes this phone's signing key for approvals. It never leaves the two devices.</p>
      <input value={typed} onChange={(e) => { setTyped(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8)); setErr(null) }} placeholder="8-character code" className="num h-14 w-full rounded-2xl border border-line bg-sunk px-4 text-center font-mono text-[24px] tracking-[0.25em]" />
      {err && <p className="rounded-xl bg-waste/10 p-3 text-[13px] text-waste">{err}</p>}
      <Button size="lg" className="w-full" disabled={!ok} onClick={pair}>{pairingCode === typed ? 'Paired · continue' : 'Pair'}</Button>
    </div>
  )
}

/** Approve a request sent from the laptop: sign it here, show the token as QR + 8-character code. */
export function PhoneApprove() {
  const [params] = useSearchParams()
  const { id = '' } = useParams()
  const st = useStore()
  const nav = useNavigate()
  const body = (params.get('r') ?? '').replace(/ /g, '+')
  const p = body ? decode(body + '.x') : null
  const ttl = useCountdown(p?.expiresAt ?? 0)
  const [token, setToken] = useState<string | null>(null)
  const [sent, setSent] = useState<{ ok: boolean; text: string } | null>(null)
  // With the laptop reachable, a request is only approvable while the laptop still has it open
  // (not replaced, consumed, reset or expired). Otherwise point to the newest open request.
  const backend = useBackend()
  const open = backend.status !== 'up' || backend.pending.some((x) => x.body === body)
  const newest = [...backend.pending].sort((x, y) => y.expiresAt - x.expiresAt)[0]
  if (!p && id === 'paste') return <PasteRequest />
  if (!p) return <Navigate to={`/m/case/${encodeURIComponent(id)}?stage=2`} replace />
  if (!st.paired) { clientLog('approve page: phone not paired', {}); return <div className="space-y-3 pt-4"><h1 className="text-[22px] font-extrabold">Pair first</h1><p className="text-[14px] text-muted">This phone is not paired with the laptop yet.</p><Button size="lg" className="w-full" onClick={() => nav('/m/pair/')}>Enter the pairing code</Button></div> }
  return (
    <div className="space-y-4 pt-2">
      <div className="eyebrow">Approval request</div>
      <h1 className="text-[20px] font-bold leading-snug">{p.action}</h1>
      <div className="panel space-y-1 p-4 text-[13px]"><div className="flex justify-between"><span className="text-muted">Subject</span><span className="font-mono">{p.findingId}</span></div><div className="flex justify-between"><span className="text-muted">Bound to state</span><span className="font-mono">{p.stateHash}</span></div><div className="flex justify-between"><span className="text-muted">Expires in</span><span className={`num ${ttl.left ? '' : 'text-waste'}`}>{ttl.left ? ttl.label : 'expired'}</span></div></div>
      {!token && (!open || !ttl.left) ? (
        <div className="panel space-y-3 p-4 text-[14px]">
          <div className="font-semibold text-misconfig">{!ttl.left ? 'This request expired.' : 'This request is no longer open on the laptop.'}</div>
          <p className="text-muted">It was replaced, already used or cleared. Approving it would be refused.</p>
          {newest ? <Button size="lg" className="w-full" onClick={() => nav(`/m/approve/${encodeURIComponent(newest.findingId)}?r=${encodeURIComponent(newest.body)}`)}>Open the newest request</Button> : <p className="text-muted">No request is waiting right now.</p>}
        </div>
      ) : !token ? (
        <div className="panel py-6"><HoldToApprove disabled={!ttl.left} onDone={() => {
          const t = sign(pairingKey(st.pairingCode), body); setToken(t); st.log('approval issued', { subject: p.findingId, by: 'phone (hold)', nonce: p.nonce })
          // Straight to the laptop API when it is reachable; the code below stays as the fallback.
          api<{ actionId?: string; queued?: boolean }>('/approvals/consume', { json: { findingId: p.findingId, token: t } })
            .then((r) => {
              clientLog('approval sent', { actionId: r.actionId, queued: !!r.queued })
              setSent({ ok: true, text: r.queued ? 'Saved on this phone. The laptop is offline; it is sent automatically when the laptop is reachable.' : `Sent to the laptop. Action ${r.actionId} approved.` })
            })
            .catch((x) => { clientLog('approval send failed', { error: (x as Error).message }); setSent({ ok: false, text: `Not sent automatically (${(x as Error).message}). Type the code on the laptop.` }) })
        }} /><p className="mt-3 text-center text-[12px] text-muted">Prototype signing with a per-device key. Production uses hardware-backed keys.</p></div>
      ) : (
        <div className="panel space-y-3 p-4 text-center">
          {sent && <div className={`rounded-xl px-3 py-2 text-[13px] ${sent.ok ? 'bg-growth/12 text-growth' : 'bg-misconfig/12 text-misconfig'}`}>{sent.text}</div>}
          <div className="text-[13px] text-muted">{sent?.ok ? 'Code (not needed now)' : 'Type this code on the laptop'}</div>
          <div className="num font-mono text-[34px] font-bold tracking-[0.2em]">{shortCode(token)}</div>
          <div className="flex justify-center"><Qr text={token} size={180} /></div>
          <div className="num text-[12px] text-muted">Valid for {ttl.label} · single use</div>
        </div>
      )}
    </div>
  )
}

export type { Subject }

/** Guaranteed path when the phone can't open the laptop's link: paste the request text. */
function PasteRequest() {
  const nav = useNavigate()
  const [text, setText] = useState('')
  const p = text.trim() ? decode(text.trim().split('.')[0] + '.x') : null
  return (
    <div className="space-y-3 pt-4">
      <h1 className="text-[22px] font-extrabold">Paste an approval request</h1>
      <p className="text-[14px] text-muted">On the laptop, open “Phone can’t open links?” under Approve on phone, copy the request and paste it here.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} className="sunk h-28 w-full p-2 font-mono text-[11px]" placeholder="Request text" />
      {text && !p && <p className="text-[13px] text-waste">That is not a readable request.</p>}
      <Button size="lg" className="w-full" disabled={!p} onClick={() => nav(`/m/approve/${encodeURIComponent(p!.findingId)}?r=${text.trim().split('.')[0]}`)}>Continue</Button>
    </div>
  )
}
