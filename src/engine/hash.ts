// Pure-JS hashing (works on plain-http LAN origins where crypto.subtle is missing).
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { bytesToHex, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js'

export const sha256Hex = (s: string) => bytesToHex(sha256(utf8ToBytes(s)))
export const hmacHex = (key: string, msg: string) =>
  bytesToHex(hmac(sha256, utf8ToBytes(key), utf8ToBytes(msg)))
export const randomHex = (n: number) => bytesToHex(randomBytes(n))

export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']'
  const o = v as Record<string, unknown>
  return (
    '{' +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJSON(o[k]))
      .join(',') +
    '}'
  )
}

// Seeded RNG (mulberry32) so simulations are repeatable.
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
