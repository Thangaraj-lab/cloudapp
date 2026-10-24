import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import Dexie, { type Table } from 'dexie'
import type { IdleResource, QuarantinedRow, Row, VerdictKind } from '../engine/types'
import { analyze, type Analysis } from '../engine/analyze'
import { DEFAULT_DETECT, type DetectParams } from '../engine/detect'
import { append, type AuditEntry } from '../engine/audit'
import { DEFAULT_POLICY, type Policy } from '../engine/policy'
import type { LedgerEntry } from '../engine/ledger'
import type { Rule } from '../engine/rules'
import { injectedRows } from '../engine/inject'
import { newPairingCode } from '../engine/approval'
import { randomHex, sha256Hex } from '../engine/hash'

class DB extends Dexie {
  kv!: Table<{ k: string; v: string }, string>
  labels!: Table<{ id?: number; findingId: string; predicted: VerdictKind; label: VerdictKind; ts: number }, number>
  constructor() {
    super('spendsentinel')
    this.version(1).stores({ kv: 'k', labels: '++id, findingId' })
  }
}
export const db = new DB()

const dexieStorage: StateStorage = {
  getItem: async (k) => (await db.kv.get(k).catch(() => undefined))?.v ?? null,
  setItem: async (k, v) => { await db.kv.put({ k, v }).catch(() => {}) },
  removeItem: async (k) => { await db.kv.delete(k).catch(() => {}) },
}

export type FindingStatus = 'new' | 'approved' | 'planned' | 'running' | 'applied' | 'verified' | 'inconclusive' | 'not-effective' | 'rolled-back' | 'expected' | 'dismissed' | 'resolved' | 'rejected'
export type Currency = 'USD' | 'INR' | 'EUR' | 'GBP'
export type Role = 'admin' | 'approver' | 'viewer'
export interface Person { id: string; name: string; role: Role; pinHash: string }
export type Range = '30d' | '90d' | 'all'

export interface ImportReport {
  fileName: string
  format: string
  note?: string
  recordsRead: number
  rows: number
  quarantined: number
  duplicates: number
  nonUsage: number
  nonUsageTotal: number
  mapping: Record<string, string>
  inferred: string[]
  currency: string
  at: number
}

export interface Notice { id: string; kind: 'approval' | 'verified' | 'rule' | 'data'; text: string; to: string; at: number; read: boolean }

export interface TimeMachine {
  /** Billing day being viewed; null = latest real day. */
  date: string | null
  playing: boolean
  speed: 1 | 4 | 16
  mode: 'replay' | 'projection'
  /** Sentence shown when replay pauses on an anomaly day. */
  paused: string | null
}

export interface State {
  hydrated: boolean
  rows: Row[]
  quarantine: QuarantinedRow[]
  fingerprint: string | null
  source: string | null
  sourceKind: 'sample' | 'upload' | null
  importedAt: number | null
  report: ImportReport | null
  utilization: { fileName: string; resources: IdleResource[]; scanned: number; missingCost: number; mode: string } | null
  autoImport: boolean
  injected: boolean
  excluded: string[]
  renames: Record<string, string>
  params: DetectParams
  currency: Currency
  showInr: boolean
  inrRate: number
  theme: 'dark' | 'light'
  labels: Record<string, { predicted: VerdictKind; label: VerdictKind }>
  status: Record<string, FindingStatus>
  audit: AuditEntry[]
  ledger: LedgerEntry[]
  /** Simulated-clock rows ("Fast-forward 7 days"); never mixed into detection. */
  simRows: Row[]
  usedNonces: string[]
  policy: Policy
  pairingCode: string
  paired: { name: string; at: number } | null
  waiting: { findingId: string; since: number } | null
  deviceId: string
  trust: number
  org: string
  people: Person[]
  currentPerson: string | null
  budgets: Record<string, number>
  /** Owner per untagged line (service|env|app). */
  owners: Record<string, string>
  rules: Rule[]
  ignoredWaste: string[]
  notices: Notice[]
  worldMode: '3d' | 'list'
  revealed: boolean
  lens: 'skyline' | 'trends' | 'breakdown'
  tm: TimeMachine
  load: (p: { rows: Row[]; quarantine: QuarantinedRow[]; fingerprint: string; source: string; sourceKind: 'sample' | 'upload'; report?: ImportReport | null }) => void
  set: (p: Partial<State>) => void
  log: (event: string, payload?: unknown, actor?: string) => void
  setStatus: (id: string, s: FindingStatus) => void
  updateAction: (id: string, p: Partial<LedgerEntry>) => void
  label: (findingId: string, predicted: VerdictKind, label: VerdictKind) => void
  notify: (n: Omit<Notice, 'id' | 'at' | 'read'>) => void
  setTm: (p: Partial<TimeMachine>) => void
  reset: () => void
}

const initial = {
  rows: [], quarantine: [], fingerprint: null, source: null, sourceKind: null, importedAt: null, report: null, utilization: null,
  autoImport: true, injected: false, excluded: [] as string[], renames: {} as Record<string, string>,
  params: DEFAULT_DETECT, currency: 'USD' as Currency, showInr: false, inrRate: 88, theme: 'dark' as const,
  labels: {}, status: {}, audit: [], ledger: [], simRows: [] as Row[], usedNonces: [],
  policy: DEFAULT_POLICY, paired: null, waiting: null, trust: 2, org: '',
  people: [] as Person[], currentPerson: null, budgets: {}, owners: {} as Record<string, string>, rules: [] as Rule[], ignoredWaste: [] as string[], notices: [] as Notice[],
  worldMode: '3d' as const, revealed: false, lens: 'skyline' as State['lens'],
}
const TM0: TimeMachine = { date: null, playing: false, speed: 4, mode: 'replay', paused: null }

export const pinHash = (personId: string, pin: string) => sha256Hex(`spendsentinel-pin:${personId}:${pin}`)

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...initial,
      hydrated: false,
      tm: TM0,
      pairingCode: newPairingCode(),
      deviceId: 'dev-' + randomHex(4),
      load: (p) => {
        // Finding ids are billing dates, so status and labels carry over when a
        // newer export of the same account is loaded. "Reset" clears them.
        set({ report: null, ...p, importedAt: Date.now(), tm: TM0, revealed: false, excluded: [], simRows: [] })
        get().log('dataset loaded', { rows: p.rows.length, quarantined: p.report?.quarantined ?? p.quarantine.length, fingerprint: p.fingerprint, source: p.source })
      },
      set: (p) => set(p),
      log: (event, payload = {}, actor) => {
        const me = get().people.find((x) => x.id === get().currentPerson)
        set({ audit: append(get().audit, actor ?? ((me?.name ?? get().org.trim()) || 'user') + '@' + get().deviceId, event, payload) })
      },
      setStatus: (id, s) => set({ status: { ...get().status, [id]: s } }),
      updateAction: (id, p) => set({ ledger: get().ledger.map((l) => (l.id === id ? { ...l, ...p } : l)) }),
      label: (findingId, predicted, label) => {
        set({ labels: { ...get().labels, [findingId]: { predicted, label } } })
        db.labels.add({ findingId, predicted, label, ts: Date.now() }).catch(() => {})
        get().log('verdict labelled', { findingId, predicted, label })
      },
      notify: (n) => set({ notices: [{ ...n, id: randomHex(4), at: Date.now(), read: false }, ...get().notices].slice(0, 40) }),
      setTm: (p) => set({ tm: { ...get().tm, ...p } }),
      reset: () => {
        set({ ...initial, tm: TM0, pairingCode: newPairingCode() })
        db.labels.clear().catch(() => {})
      },
    }),
    {
      name: 'spendsentinel-v3',
      storage: createJSONStorage(() => dexieStorage),
      partialize: (s) => {
        const { load, set, log, setStatus, updateAction, label, notify, setTm, reset, hydrated, tm, waiting, ...rest } = s
        void load; void set; void log; void setStatus; void updateAction; void label; void notify; void setTm; void reset; void hydrated; void tm; void waiting
        return rest
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
)

// The rows the engine sees: real rows (minus services the user excluded) plus,
// when the toggle is on, the badged injected scenarios.
const INJECTED = injectedRows()
let cache: { key: unknown[]; value: Analysis & { allRows: Row[] } } | null = null
export function getAnalysis(s: Pick<State, 'rows' | 'params' | 'utilization' | 'injected' | 'excluded'>) {
  const key = [s.rows, s.params, s.utilization, s.injected, s.excluded]
  if (!cache || key.some((k, i) => k !== cache!.key[i])) {
    const ex = new Set(s.excluded)
    const real = ex.size ? s.rows.filter((r) => !ex.has(r.service)) : s.rows
    const allRows = s.injected && s.rows.length ? [...real, ...INJECTED] : real
    cache = { key, value: { allRows, ...analyze(allRows, s.params, s.injected, s.utilization?.resources ?? []) } }
  }
  return cache.value
}
export function useAnalysis() {
  const rows = useStore((s) => s.rows)
  const params = useStore((s) => s.params)
  const utilization = useStore((s) => s.utilization)
  const injected = useStore((s) => s.injected)
  const excluded = useStore((s) => s.excluded)
  return getAnalysis({ rows, params, utilization, injected, excluded })
}

export const useMe = () => {
  const people = useStore((s) => s.people)
  const id = useStore((s) => s.currentPerson)
  return people.find((p) => p.id === id) ?? null
}

const SYMBOL: Record<Currency, string> = { USD: '$', INR: '₹', EUR: '€', GBP: '£' }
export function formatMoney(v: number, digits: number, s: Pick<State, 'currency' | 'showInr' | 'inrRate'>) {
  if (s.showInr && s.currency !== 'INR') return (v < 0 ? '−' : '') + '₹' + Math.abs(Math.round(v * s.inrRate)).toLocaleString('en-IN')
  const locale = s.currency === 'INR' ? 'en-IN' : 'en-US'
  const d = s.currency === 'INR' ? 0 : digits
  return (v < 0 ? '−' : '') + SYMBOL[s.currency] + Math.abs(v).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d })
}
export function useMoney() {
  const currency = useStore((s) => s.currency)
  const showInr = useStore((s) => s.showInr)
  const inrRate = useStore((s) => s.inrRate)
  return (v: number, digits = 2) => formatMoney(v, digits, { currency, showInr, inrRate })
}
/** Display name for a service, honouring renames from the reveal panel. */
export const useName = () => {
  const renames = useStore((s) => s.renames)
  return (svc: string) => renames[svc] ?? svc
}
