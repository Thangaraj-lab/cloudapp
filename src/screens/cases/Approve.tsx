import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Smartphone, UserPlus, Check, X } from 'lucide-react'
import { pinHash, useMe, useMoney, useStore, type Person } from '../../store'
import { decode, fromShortCode, issue, pairingKey, request, verify, TTL_MS } from '../../engine/approval'
import { randomHex } from '../../engine/hash'
import { policyFor, stateHash, type Subject } from '../../flow/subject'
import { startAction } from '../../flow/actions'
import { ChainScene } from '../../world/Sims'
import { Badge, Button, Panel, StateView, toast } from '../../components/ui'
import { PhoneLink, Qr } from '../../components/PhoneLink'
import { api, useBackend } from '../../flow/backend'
export { Qr }

export const decisionTone = { allow: 'growth', 'needs-approval': 'misconfig', deny: 'waste' } as const
export const decisionLabel = { allow: 'Allowed by policy', 'needs-approval': 'Needs approval', deny: 'Blocked by policy' } as const

export function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const left = Math.max(0, until - now)
  return { left, label: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` }
}

export function CreateProfile({ onCreated }: { onCreated?: (p: Person) => void }) {
  const { people, set, log } = useStore()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const ok = name.trim().length >= 2 && /^\d{4,6}$/.test(pin)
  return (
    <div className="sunk space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} className="text-accent" /> Create your approver profile</div>
      <p className="text-[12px] text-muted">Stored on this device. The PIN confirms it is you when you approve.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name and role, e.g. Raj (CTO)" className="h-10 w-full rounded-[10px] border border-line bg-solid px-3 text-sm" />
      <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" placeholder="4–6 digit PIN" className="h-10 w-full rounded-[10px] border border-line bg-solid px-3 text-sm tracking-[0.3em]" />
      <Button size="sm" disabled={!ok} onClick={() => {
        const id = 'p-' + randomHex(4)
        const p: Person = { id, name: name.trim(), role: 'admin', pinHash: pinHash(id, pin) }
        set({ people: [...people, p], currentPerson: id, org: name.trim() })
        log('profile created', { id, name: p.name })
        onCreated?.(p)
      }}><Check size={14} /> Save profile</Button>
    </div>
  )
}

function PairInline() {
  const { pairingCode, set, log } = useStore()
  const up = useBackend((b) => b.status === 'up')
  return (
    <div className="sunk space-y-3 p-4">
      <PhoneLink route={`/m/pair/${pairingCode}`} size={150} title="Pair a phone first: scan with the phone camera" />
      <div className="text-[13px]"><span className="text-muted">Or open the app on the phone, go to Pair, and type the code:</span>
        <div data-pairing-code={pairingCode} className="num mt-1 font-mono text-[22px] font-bold tracking-[0.2em]">{pairingCode}</div></div>
      {up
        ? <p className="flex items-center gap-2 text-[13px] text-muted"><span className="h-2 w-2 rounded-full bg-misconfig" /> Waiting for the phone to pair… this continues by itself once it holds the current code.</p>
        : <Button size="sm" variant="ghost" onClick={() => { set({ paired: { name: 'Phone', at: Date.now() } }); log('phone paired', { method: 'code' }) }}>The phone shows “Paired”</Button>}
    </div>
  )
}

/** C4 Approval. */
export function ApprovalStep({ s }: { s: Subject }) {
  const st = useStore()
  const me = useMe()
  const money = useMoney()
  const nav = useNavigate()
  const pol = policyFor(s, (n) => money(n))
  const [checks, setChecks] = useState([false, false])
  const [pin, setPin] = useState('')
  const [second, setSecond] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const seconds = st.people.filter((p) => p.id !== me?.id && p.role !== 'viewer')
  const secondPerson = seconds.find((p) => p.id === second)
  const [mode, setMode] = useState<'here' | 'phone'>('here')
  const [code, setCode] = useState('')
  const [sealed, setSealed] = useState(false)
  // Paired = the API saw a phone prove it holds the current code (or, offline, the manual flag).
  const phoneOk = useBackend((b) => b.status === 'up' ? !!b.health?.pairedPhone?.current : null)
  const isPaired = phoneOk ?? !!st.paired
  const key = pairingKey(st.pairingCode)
  const expected = { findingId: s.id, stateHash: stateHash(s, st.fingerprint) }
  const req = useMemo(() => (mode === 'phone' && isPaired ? request({ findingId: s.id, action: s.action, stateHash: expected.stateHash, deviceId: 'phone' }) : null), [mode, isPaired, s.id])
  // Backend up: the request lives on the API, so the paired phone sees it instantly and can
  // send its signed approval straight back; the laptop continues on the live event.
  const backend = useBackend()
  const remote = backend.status === 'up' && s.kind === 'case' && s.analyzed?.finding.scope !== 'service' && s.analyzed?.finding.kind !== 'steady'
  const [serverReq, setServerReq] = useState<string | null>(null)
  const ready0 = pol.result !== 'deny' && checks.every(Boolean)
  useEffect(() => {
    if (!remote || mode !== 'phone' || !isPaired || !ready0 || serverReq) return
    api<{ body?: string; policy: { reasons: string[] } }>('/approvals/request', { json: { findingId: s.id } })
      .then((r) => (r.body ? setServerReq(r.body) : setErr(r.policy.reasons[0]))).catch((x) => setErr((x as Error).message))
  }, [remote, mode, isPaired, ready0])
  useEffect(() => {
    if (!remote) return
    return useBackend.subscribe((b) => {
      const l = b.lastLedger
      if (l && l.findingId === s.id && l.status === 'approved' && !b.remoteActions[s.id]) {
        useBackend.setState({ remoteActions: { ...b.remoteActions, [s.id]: l.id } })
        done('Phone approver', l.nonce ?? l.id)
      }
    })
  }, [remote])
  const reqBody = remote ? serverReq : req
  const payload = reqBody ? decode(reqBody + '.x') : null
  const ttl = useCountdown(payload?.expiresAt ?? Date.now() + TTL_MS)
  useEffect(() => {
    if (req) { st.set({ waiting: { findingId: s.id, since: Date.now() } }); st.log('approval requested', { subject: s.id, via: 'phone' }); st.notify({ kind: 'approval', text: `Approval waiting on the phone: ${s.action}`, to: `/case/${s.id}/approve` }) }
    return () => { useStore.getState().set({ waiting: null }) }
  }, [req])
  const ready = pol.result !== 'deny' && checks.every(Boolean)
  const done = (approvedBy: string, nonce: string, second?: string) => {
    startAction(s, approvedBy, nonce, second)
    setSealed(true)
    toast('Approved and signed. A new block was sealed onto the audit chain.')
    setTimeout(() => nav(`/case/${s.id}/run`), 1400)
  }
  const approveHere = () => {
    if (!me || pinHash(me.id, pin) !== me.pinHash) { setErr('Wrong PIN.'); st.log('approval rejected', { subject: s.id, reason: 'wrong PIN' }); return }
    if (pol.needsSecond && (!secondPerson || pinHash(secondPerson.id, pin2) !== secondPerson.pinHash)) { setErr('Second approver PIN is wrong.'); st.log('approval rejected', { subject: s.id, reason: 'second approver' }); return }
    const token = issue(key, { findingId: s.id, action: s.action, stateHash: expected.stateHash, deviceId: me.name + '@' + st.deviceId })
    st.log('approval issued', { subject: s.id, by: me.name, nonce: decode(token)?.nonce })
    const v = verify(key, token, { usedNonces: st.usedNonces, expected })
    if (!v.ok) { setErr(v.reason); return }
    done(me.name, v.payload.nonce, secondPerson?.name)
  }
  const usePhoneCode = () => {
    if (remote) {
      api('/approvals/consume', { json: { findingId: s.id, code } }).catch((x) => setErr((x as Error).message))
      return
    }
    if (!req) return
    const token = fromShortCode(key, req, code)
    if (!token) { setErr('That code does not match this request. Check the 8 characters on the phone.'); st.log('approval rejected', { subject: s.id, reason: 'code mismatch' }); return }
    const v = verify(key, token, { usedNonces: st.usedNonces, expected })
    if (!v.ok) { setErr(v.reason); st.log('approval rejected', { subject: s.id, reason: v.reason }); return }
    st.log('approval issued', { subject: s.id, by: 'phone', nonce: v.payload.nonce })
    done('Phone approver', v.payload.nonce)
  }
  if (sealed) return <Panel title="Approved"><ChainScene count={st.audit.length} /><p className="mt-3 text-[13px] text-muted">Signed, single-use approval consumed. Opening the live run…</p></Panel>
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Panel title="Policy" right={<Badge tone={decisionTone[pol.result]}>{decisionLabel[pol.result]}</Badge>}>
          <ul className="space-y-1.5 text-[13.5px]">{pol.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {pol.result === 'deny' && <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => nav('/guardrails')}>Review policy</Button><Button variant="quiet" onClick={() => { st.setStatus(s.id, 'rejected'); st.log('approval denied by policy', { subject: s.id }); nav('/cases') }}>Close case</Button></div>}
        </Panel>
        <Panel title="You are approving">
          <p className="text-[15px] font-semibold">{s.action}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <div className="sunk p-3"><div className="text-muted">Net saving</div><div className="num font-semibold text-growth">{money(s.netMonthly, 0)}/mo</div></div>
            <div className="sunk p-3"><div className="text-muted">Bound to</div><div className="num font-mono text-[12px]">state {expected.stateHash}</div></div>
          </div>
          {pol.result !== 'deny' && (
            <div className="mt-4 space-y-2.5">
              {[`I reviewed the rollback plan (${s.rollback.toLowerCase()})`, `The owner of ${s.environment} / ${s.application} has been told`].map((l, i) => (
                <label key={i} className="flex cursor-pointer gap-3 text-[13.5px]"><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((c, j) => (j === i ? e.target.checked : c)))} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />{l}</label>
              ))}
            </div>
          )}
        </Panel>
      </div>
      {pol.result !== 'deny' && (
        <Panel title="Sign the approval" right={<div className="flex gap-1"><Button size="sm" variant={mode === 'here' ? 'primary' : 'ghost'} onClick={() => { setMode('here'); setErr(null) }}><KeyRound size={14} /> Approve here</Button><Button size="sm" variant={mode === 'phone' ? 'primary' : 'ghost'} onClick={() => { setMode('phone'); setErr(null) }}><Smartphone size={14} /> Approve on phone</Button></div>}>
          {mode === 'here' ? (
            !st.people.length || !me ? <CreateProfile /> : (
              <div className="space-y-3">
                <label className="block text-[13px]"><span className="text-muted">{me.name} — PIN</span>
                  <input value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null) }} inputMode="numeric" type="password" placeholder="PIN" className="mt-1.5 h-11 w-full rounded-[10px] border border-line bg-sunk px-3 tracking-[0.3em]" /></label>
                {pol.needsSecond && (seconds.length ? (
                  <div className="sunk space-y-2 p-3">
                    <div className="text-[13px] font-medium">Second approver (above the daily cost limit)</div>
                    <select value={second} onChange={(e) => setSecond(e.target.value)} className="h-10 w-full rounded-[10px] border border-line bg-solid px-2 text-sm"><option value="">Choose a person</option>{seconds.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    {secondPerson && <input value={pin2} onChange={(e) => { setPin2(e.target.value.replace(/D/g, '').slice(0, 6)); setErr(null) }} inputMode="numeric" type="password" placeholder={`${secondPerson.name} — PIN`} className="h-10 w-full rounded-[10px] border border-line bg-solid px-3 tracking-[0.3em]" />}
                  </div>
                ) : <p className="rounded-xl bg-misconfig/10 p-3 text-[13px] text-misconfig">This change needs a second approver. Add one in Settings → Approvers first.</p>)}
                {err && <p className="text-[13px] text-waste">{err}</p>}
                <Button size="lg" className="w-full" disabled={!ready || pin.length < 4 || (pol.needsSecond && (!secondPerson || pin2.length < 4))} onClick={approveHere}><KeyRound size={16} /> Approve and sign</Button>
                {!ready && <p className="text-[12px] text-muted">Tick both checks first.</p>}
              </div>
            )
          ) : !isPaired ? <PairInline /> : !ready ? <p className="text-[13px] text-muted">Tick both checks, then the request goes to the phone.</p> : (
            <div className="space-y-4">
              <div className="text-[13px]">
                <div className="flex items-center gap-2 font-semibold"><span className="h-2 w-2 rounded-full bg-misconfig" /> Waiting for phone… <span className="num font-normal text-muted">valid for {ttl.label}</span></div>
                <p className="mt-1 text-muted">Scan on the paired phone, hold to approve, then type the 8-character code it shows.</p>
              </div>
              {!reqBody ? <p className="text-[13px] text-muted">Creating the request…</p> : <div data-request-url={`#/m/approve/${encodeURIComponent(s.id)}?r=${reqBody}`}><PhoneLink route={`/m/approve/${encodeURIComponent(s.id)}?r=${reqBody}`} size={170} title="Approval request link" /></div>}
              <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">Phone can’t open links? Paste this request on the phone (Approve tab)</summary>
                <button onClick={() => navigator.clipboard?.writeText(reqBody!).then(() => toast('Request copied.'))} className="sunk mt-2 block w-full break-all p-2 text-left font-mono text-[10.5px]">{reqBody}</button></details>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8)); setErr(null) }} placeholder="8-character code" className="num h-11 min-w-0 flex-1 rounded-[10px] border border-line bg-sunk px-3 font-mono text-[16px] tracking-[0.25em]" />
                <Button size="lg" disabled={code.length !== 8 || !ttl.left} onClick={usePhoneCode}>Use code</Button>
              </div>
              {err && <p className="text-[13px] text-waste">{err}</p>}
              {!ttl.left && <p className="text-[13px] text-waste">The request expired (10 minutes). Switch tabs to create a new one.</p>}
              <div className="flex gap-2"><Button variant="ghost" size="sm" onClick={() => setMode('here')}>Approve here instead</Button><Button variant="quiet" size="sm" onClick={() => { setMode('here'); st.log('approval cancelled', { subject: s.id }) }}><X size={14} /> Cancel</Button></div>
            </div>
          )}
          <p className="mt-5 border-t border-line pt-3 text-[11.5px] text-muted">Prototype signing with a per-device key (HMAC-SHA256, single-use nonce, 10-minute TTL, bound to this exact data). Production uses hardware-backed keys. Nothing changes in your cloud until the live run.</p>
        </Panel>
      )}
      {pol.result === 'deny' && <StateView kind="error" title="This change cannot be approved">{pol.reasons[0]}</StateView>}
    </div>
  )
}
