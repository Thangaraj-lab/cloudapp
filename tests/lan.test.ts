import { describe, expect, it } from 'vitest'
import { isInsecureLan, isLocalHost, normalizeManual, phoneBaseUrl, phoneLink } from '../src/flow/lan'
import { issue, pairingKey, verify } from '../src/engine/approval'

const local = { hostname: 'localhost', origin: 'http://localhost:5173', port: '5173', pathname: '/' }
const lan = ['http://192.168.1.20:5173', 'http://10.0.0.5:5173']

describe('phone URL building', () => {
  it('localhost uses the LAN URL from /__lan, never localhost', () => {
    expect(phoneLink(phoneBaseUrl(local, lan), '/m')).toBe('http://192.168.1.20:5173/#/m')
    expect(phoneBaseUrl({ ...local, hostname: '127.0.0.1', origin: 'http://127.0.0.1:5173' }, lan)).toBe('http://192.168.1.20:5173/')
  })
  it('a chosen LAN address wins when several are found', () => {
    expect(phoneBaseUrl(local, lan, 'http://10.0.0.5:5173')).toBe('http://10.0.0.5:5173/')
    expect(phoneBaseUrl(local, lan, 'http://stale:1')).toBe('http://192.168.1.20:5173/')
  })
  it('a real host uses its own origin', () => {
    const real = { hostname: '192.168.1.20', origin: 'http://192.168.1.20:5173', port: '5173', pathname: '/' }
    expect(phoneLink(phoneBaseUrl(real, []), '/m/pair/ABCD2345')).toBe('http://192.168.1.20:5173/#/m/pair/ABCD2345')
    expect(phoneBaseUrl({ hostname: 'app.example.com', origin: 'https://app.example.com', port: '', pathname: '/ss/' }, [])).toBe('https://app.example.com/ss/')
  })
  it('falls back to the manual laptop IP when /__lan fails', () => {
    expect(phoneBaseUrl(local, [], null, '192.168.0.7')).toBe('http://192.168.0.7:5173/')
    expect(phoneBaseUrl(local, [], null, 'http://192.168.0.7:4173/')).toBe('http://192.168.0.7:4173/')
    expect(phoneBaseUrl(local, [], null, 'localhost')).toBeNull()
    expect(phoneBaseUrl(local, [], null, '')).toBeNull()
    expect(normalizeManual('::bad::', '5173')).toBeNull()
  })
  it('flags insecure LAN origins and recognises local hosts', () => {
    expect(isInsecureLan('http://192.168.1.20:5173/#/m')).toBe(true)
    expect(isInsecureLan('https://app.example.com/#/m')).toBe(false)
    expect(isLocalHost('::1')).toBe(true)
  })
  it('signing works without crypto.subtle (pure-JS hashes)', () => {
    const k = pairingKey('ABCD2345')
    const t = issue(k, { findingId: 'f', action: 'a', stateHash: 's', deviceId: 'phone' })
    expect(verify(k, t, { usedNonces: [], expected: { findingId: 'f', stateHash: 's' } }).ok).toBe(true)
  })
})
