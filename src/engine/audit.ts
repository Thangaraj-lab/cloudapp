import { canonicalJSON, sha256Hex } from './hash'

export interface AuditEntry {
  i: number
  ts: number
  actor: string
  event: string
  payload: unknown
  prevHash: string
  hash: string
}

export const GENESIS = '0'.repeat(64)

export function hashEntry(e: Omit<AuditEntry, 'hash'>): string {
  return sha256Hex(e.prevHash + canonicalJSON(e))
}

export function append(chain: AuditEntry[], actor: string, event: string, payload: unknown, ts = Date.now()): AuditEntry[] {
  const prevHash = chain.length ? chain[chain.length - 1].hash : GENESIS
  const base = { i: chain.length, ts, actor, event, payload, prevHash }
  return [...chain, { ...base, hash: hashEntry(base) }]
}

export function verifyChain(chain: AuditEntry[]): { ok: true; n: number } | { ok: false; brokenAt: number } {
  let prev = GENESIS
  for (const e of chain) {
    const { hash, ...rest } = e
    if (e.prevHash !== prev || hashEntry(rest) !== hash) return { ok: false, brokenAt: e.i }
    prev = hash
  }
  return { ok: true, n: chain.length }
}
