import { hmacHex, randomHex, sha256Hex } from './hash'
import { randomBytes } from '@noble/hashes/utils.js'

// No 0/O/1/I so the code reads cleanly aloud and on a small screen.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** New 8-character pairing code. */
export const newPairingCode = () => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join('')
/** 8-character approval code: the first 8 of the token signature, typed on the laptop. */
export const shortCode = (token: string) => (token.split('.')[1] ?? '').slice(0, 8).toUpperCase()

export const TTL_MS = 10 * 60 * 1000

export interface TokenPayload {
  findingId: string
  action: string
  stateHash: string
  nonce: string
  issuedAt: number
  expiresAt: number
  deviceId: string
}

/** Signing key shared by paired devices: derived from the pairing code. */
export const pairingKey = (code: string) => sha256Hex('spendsentinel-pairing:' + code.trim().toUpperCase())

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/=+$/, '')
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)))

/** Unsigned approval request (laptop → phone). */
export function request(p: Omit<TokenPayload, 'nonce' | 'issuedAt' | 'expiresAt'>, now = Date.now()): string {
  const payload: TokenPayload = { ...p, nonce: randomHex(16), issuedAt: now, expiresAt: now + TTL_MS }
  return b64(JSON.stringify(payload))
}
/** Sign a request with the paired key (phone). */
export const sign = (key: string, body: string) => body + '.' + hmacHex(key, body)

export function issue(key: string, p: Omit<TokenPayload, 'nonce' | 'issuedAt' | 'expiresAt'>, now = Date.now()): string {
  return sign(key, request(p, now))
}

/** The laptop rebuilds the signed token from the request it sent and the phone's 8-character code. */
export function fromShortCode(key: string, body: string, code: string): string | null {
  const t = sign(key, body)
  return shortCode(t) === code.trim().toUpperCase().replace(/[^0-9A-F]/g, '') ? t : null
}

export function decode(token: string): TokenPayload | null {
  try {
    // A '+' in base64 can arrive as a space when carried in a URL query: restore it.
    return JSON.parse(unb64(token.trim().split('.')[0].replace(/ /g, '+')))
  } catch {
    return null
  }
}

export type VerifyResult = { ok: true; payload: TokenPayload } | { ok: false; reason: string }

export function verify(
  key: string,
  token: string,
  ctx: { usedNonces: string[]; expected: { findingId: string; stateHash: string }; now?: number },
): VerifyResult {
  const [body, sig] = token.trim().split('.')
  if (!body || !sig) return { ok: false, reason: 'Malformed token.' }
  if (hmacHex(key, body) !== sig) return { ok: false, reason: 'Signature mismatch: token was tampered with or signed by an unpaired device.' }
  const p = decode(token)
  if (!p) return { ok: false, reason: 'Unreadable payload.' }
  if ((ctx.now ?? Date.now()) > p.expiresAt) return { ok: false, reason: 'Token expired (10 minute TTL).' }
  if (ctx.usedNonces.includes(p.nonce)) return { ok: false, reason: 'Token already used (single-use nonce replay blocked).' }
  if (p.findingId !== ctx.expected.findingId) return { ok: false, reason: 'Token was issued for a different finding.' }
  if (p.stateHash !== ctx.expected.stateHash) return { ok: false, reason: 'Stale approval: the cost state changed since this was signed.' }
  return { ok: true, payload: p }
}
