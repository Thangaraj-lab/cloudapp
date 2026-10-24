// Connection to the local backend (FastAPI: engine, SQLite, local cloud, local LLM, edge node).
// The app keeps working without it (browser engine); when it is up, actions run against the
// local cloud and every device sees the same approvals and events in real time.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useStore } from '../store'
import { sha256Hex } from '../engine/hash'

export interface Health {
  ok: boolean
  engine: string
  cloud: { ok: boolean; endpoint: string; mode: string; bucket: string; error?: string }
  llm: { ok: boolean; model: string; available?: boolean; error?: string }
  dataset: { source: string; key: string; name: string; rows: number } | null
  edge: { online: boolean; deviceId?: string; ip?: string; at?: number; battery?: number }
  /** First 8 hex of SHA-256 of the API pairing code (the code itself is never exposed). */
  pairingHash: string
  /** Phone that proved it holds the current code (current=false after a code change). */
  pairedPhone: { device: string; at: number; current: boolean } | null
  model: { active: boolean; trainedOn: number; minLabels: number }
}
export interface ExecEvent { actionId: string; step: number; label: string; status: 'ok' | 'failed' | 'rolled-back'; detail: Record<string, unknown>; at: number }
export interface Pending { body: string; findingId: string; action: string; headline: string; expiresAt: number; needsSecond: boolean }

interface BackendState {
  status: 'checking' | 'up' | 'down'
  health: Health | null
  exec: ExecEvent[]
  ledgerTick: number
  lastLedger: { id: string; status: string; findingId?: string; nonce?: string; by?: string } | null
  pending: Pending[]
  /** API action approved for a case (phone approvals): Run executes it instead of asking again. */
  remoteActions: Record<string, string>
}
export const useBackend = create<BackendState>(() => ({ status: 'checking', health: null, exec: [], ledgerTick: 0, lastLedger: null, pending: [], remoteActions: {} }))

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const laptopPairingRequest = path === '/pairing' && typeof window !== 'undefined' && !location.hash.startsWith('#/m')
  const res = await fetch('/api' + path, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(laptopPairingRequest ? { 'X-SpendSentinel-Laptop': '1' } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error((data && (data.detail || data.message)) || `HTTP ${res.status}`)
  return data as T
}

export const backendUp = () => useBackend.getState().status === 'up'

async function refresh() {
  try {
    const h = await api<Health>('/health')
    useBackend.setState({ status: 'up', health: h })
    // The API owns the pairing code. Laptop pages check it on every poll (not only on first
    // connect), so a tab left open never shows a stale pairing QR. Phones never read it.
    if (!location.hash.startsWith('#/m')) {
      const code = useStore.getState().pairingCode
      if (h.pairingHash !== sha256Hex(code).slice(0, 8)) {
        const r = await api<{ code: string }>('/pairing').catch(() => null)
        if (r?.code) useStore.getState().set({ pairingCode: r.code, paired: null })
      }
    }
    const p = await api<{ pending: Pending[] }>('/approvals/pending').catch(() => ({ pending: [] }))
    useBackend.setState({ pending: p.pending })
  } catch {
    useBackend.setState({ status: 'down' })
  }
}

/** Mount once: polls health every 5 s and listens to the live event stream. */
export function useBackendConnection() {
  useEffect(() => {
    let es: EventSource | null = null
    let alive = true
    const connect = () => {
      if (!alive || es || typeof EventSource === 'undefined') return
      es = new EventSource('/api/events')
      es.addEventListener('execute', (m) => useBackend.setState((s) => ({ exec: [...s.exec, JSON.parse((m as MessageEvent).data)].slice(-200) })))
      es.addEventListener('ledger', (m) => useBackend.setState((s) => ({ ledgerTick: s.ledgerTick + 1, lastLedger: JSON.parse((m as MessageEvent).data) })))
      es.addEventListener('approval-request', () => refresh())
      es.addEventListener('edge', (m) => {
        const e = JSON.parse((m as MessageEvent).data)
        const h = useBackend.getState().health
        if (h) useBackend.setState({ health: { ...h, edge: e } })
      })
      es.addEventListener('dataset', () => refresh())
      es.onerror = () => { es?.close(); es = null }
    }
    refresh().then(connect)
    const t = setInterval(() => { refresh().then(() => { if (useBackend.getState().status === 'up') connect() }) }, 5000)
    return () => { alive = false; clearInterval(t); es?.close() }
  }, [])
}

/** Push the browser's validated rows to the backend (they land in the local S3 bucket). */
export function syncDataset(name: string, rows: { day: string; service: string; region: string; environment: string; application: string; cost: number }[]) {
  // Data that came from the bucket is already there.
  if (!backendUp() || name.startsWith('s3:') || name.startsWith('laptop:')) return Promise.resolve(null)
  return api('/datasets/rows', { json: { name, rows } }).catch(() => null)
}

/** Diagnostics from devices the laptop cannot see (the phone): sent to the API log, never blocking. */
export function clientLog(msg: string, data: Record<string, unknown> = {}) {
  try {
    void fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ msg, data, page: location.hash, ua: navigator.userAgent.slice(0, 120), at: Date.now() }) }).catch(() => {})
  } catch { /* ignore */ }
}

if (typeof window !== 'undefined' && location.hash.startsWith('#/m')) {
  addEventListener('error', (e) => clientLog('page error', { message: e.message, source: e.filename, line: e.lineno }))
  addEventListener('unhandledrejection', (e) => clientLog('unhandled rejection', { reason: String(e.reason).slice(0, 300) }))
}
