import { useEffect, useRef, useState } from 'react'
import { Laptop, Smartphone, CloudOff, RefreshCw, ChevronDown, Check, Inbox } from 'lucide-react'
import { useStore } from '../store'
import { useBackend } from '../flow/backend'
import { syncFromLaptop } from '../flow/importer'
import { useOnline } from '../screens/system/System'
import { toast } from '../components/ui'

/** Served by the phone's own edge node (localhost), so the app keeps working without the laptop. */
export const onEdge = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /android|iphone|mobile/i.test(navigator.userAgent)

export function useOfflineReady() {
  const [ready, setReady] = useState(!!navigator.serviceWorker?.controller)
  useEffect(() => {
    if (!navigator.serviceWorker) return
    navigator.serviceWorker.ready.then(() => setReady(true)).catch(() => {})
    const h = () => setReady(!!navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange', h)
    return () => navigator.serviceWorker.removeEventListener('controllerchange', h)
  }, [])
  return ready && isSecureContext
}

/** Approvals saved on this phone while the laptop was unreachable (edge node outbox). */
export function useQueued() {
  const [n, setN] = useState(0)
  const tick = useBackend((b) => b.health)
  useEffect(() => {
    if (!onEdge()) return // only the phone's edge node has an outbox
    fetch('/api/edge/outbox', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setN(j?.outbox?.filter((o: { status: string }) => o.status === 'queued').length ?? 0)).catch(() => setN(0))
  }, [tick])
  return n
}

/** Keeps this phone's copy of the data in step with the laptop (first load and when the laptop has newer data). */
export function useLaptopSync() {
  const { status, health } = useBackend()
  const rows = useStore((s) => s.rows.length)
  const importedAt = useStore((s) => s.importedAt)
  const [busy, setBusy] = useState(false)
  const tried = useRef(false)
  const laptopAt = health?.dataset ? (health.dataset as { loadedAt?: number }).loadedAt ?? 0 : 0
  const newer = !!laptopAt && !!importedAt && laptopAt > importedAt + 1000
  const sync = async (quiet = false) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await syncFromLaptop()
      if (!quiet) toast(r ? `Synced ${r.rows} rows from the laptop.` : 'The laptop has no data to sync yet.')
    } catch (e) {
      if (!quiet) toast('Sync failed: ' + (e as Error).message)
    } finally { setBusy(false) }
  }
  useEffect(() => {
    if (status === 'up' && !rows && !tried.current) { tried.current = true; void sync(true) }
  }, [status, rows])
  return { sync, busy, newer, canSync: status === 'up' }
}

/** One line that answers: is the laptop there, where does this app run, can it work offline. */
export function StatusStrip() {
  const { status, health } = useBackend()
  const online = useOnline()
  const offlineReady = useOfflineReady()
  const queued = useQueued()
  const edge = onEdge()
  const [open, setOpen] = useState(false)
  const laptopUp = status === 'up' && !(health as { offline?: boolean } | null)?.offline
  const chip = (ok: boolean | null, icon: React.ReactNode, text: string) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-growth/12 text-growth' : ok === null ? 'bg-sunk text-muted' : 'bg-misconfig/12 text-misconfig'}`}>{icon}{text}</span>
  )
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-center gap-1.5 text-left" aria-expanded={open}>
        {chip(laptopUp, <Laptop size={11} />, laptopUp ? 'Laptop connected' : status === 'checking' ? 'Checking laptop…' : 'Laptop offline')}
        {edge && chip(true, <Smartphone size={11} />, 'Runs on this phone')}
        {chip(offlineReady ? true : null, offlineReady ? <Check size={11} /> : <CloudOff size={11} />, offlineReady ? 'Works offline' : 'Online only')}
        {queued > 0 && chip(false, <Inbox size={11} />, `${queued} approval${queued === 1 ? '' : 's'} queued`)}
        <ChevronDown size={14} className={`ml-auto text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1 rounded-xl bg-sunk p-3 text-[12px] text-muted">
          <div>Network: {online ? 'connected' : 'none (airplane mode)'} · Laptop: {laptopUp ? health?.cloud.endpoint : 'not reachable'}</div>
          <div>App served by: {edge ? 'the edge node on this phone (localhost:8080)' : location.host}</div>
          <div>{offlineReady ? 'Installed for offline use: it opens with no network.' : edge ? 'Preparing offline copy…' : 'Open the app from the edge node (http://localhost:8080/#/m) to use it offline.'}</div>
          {queued > 0 && <div>{queued} approval{queued === 1 ? ' is' : 's are'} saved on this phone and will be sent when the laptop is reachable.</div>}
          <div className="pt-1"><RefreshCw size={11} className="inline" /> Data stays on this device; only signed approvals travel.</div>
        </div>
      )}
    </div>
  )
}
