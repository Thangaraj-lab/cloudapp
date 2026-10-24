import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Copy, FastForward, FileText, Lock, ShieldCheck, ShieldAlert, Unlock, Play } from 'lucide-react'
import { useAnalysis, useMoney, useStore } from '../../store'
import { fastForward, lineSeries, receiptHash } from '../../flow/actions'
import { needsAction } from '../../flow/timeline'
import { brief } from '../../engine/narrate'
import { verifyChain, type AuditEntry } from '../../engine/audit'
import { issue, pairingKey, verify, TTL_MS, decode } from '../../engine/approval'
import { Badge, Button, CountUp, Honest, KPI, PageHeader, Panel, Segmented, StateView, toast } from '../../components/ui'
import { BeforeAfter, Cumulative } from '../../viz/charts'
import { DomeScene } from '../../world/Sims'

function ProofTabs() {
  const nav = useNavigate()
  const { tab = 'savings' } = useParams()
  return <Segmented value={tab === 'receipt' ? 'savings' : tab} onChange={(k) => nav(`/proof/${k}`)} options={[{ k: 'savings', label: 'Savings' }, { k: 'brief', label: 'Founder Brief' }, { k: 'trust', label: 'Trust Center' }]} />
}

export function Savings() {
  const { ledger, simRows } = useStore()
  const money = useMoney()
  const nav = useNavigate()
  const verified = ledger.filter((l) => l.status === 'verified')
  const pending = ledger.filter((l) => l.status === 'applied')
  const rolled = ledger.filter((l) => l.status === 'rolled-back')
  const vSum = verified.reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0)
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Proof" title={vSum > 0 ? `${money(vSum, 0)}/month in verified savings` : 'Savings are proven, not promised'} sub="A saving counts only after billing data shows the cost went down and stayed down beyond normal noise." right={<ProofTabs />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Verified" value={<CountUp value={vSum} format={(n) => money(n, 0)} />} tone="growth" sentence="per month, measured" />
        <KPI label="Pending" value={money(pending.reduce((s, l) => s + l.estimatedMonthlySaving, 0), 0)} tone="misconfig" sentence={`${pending.length} change${pending.length === 1 ? '' : 's'} waiting for 7 days of data`} />
        <KPI label="Rolled back" value={String(rolled.length)} sentence="no saving counted" />
        <KPI label="Receipts" value={String(verified.length)} sentence="each with a hash and timeline" />
      </div>
      {!ledger.length ? (
        <StateView title="Run your first fix" action={<Button onClick={() => nav('/cases')}>Open cases</Button>}>Approve and run a fix from a case or from Waste. Its saving appears here once it is measured.</StateView>
      ) : (
        <>
          <Panel title="Fast-forward" right={simRows.length > 0 && <Honest k="clock" />}>
            <div className="flex flex-wrap items-center gap-4">
              <p className="min-w-0 flex-1 text-[13.5px] text-muted">The sample ends on its last billing day, so there are no real days after a change yet. The simulated clock adds 7 days after each change (the line's level before the change minus the estimated saving, with small noise) and runs the same measurement used for real data.</p>
              <Button size="lg" disabled={!pending.length} onClick={() => { const n = fastForward(); toast(n ? `Simulated 7 days for ${n} change${n === 1 ? '' : 's'}.` : 'Nothing to verify.') }}><FastForward size={16} /> Fast-forward 7 days</Button>
            </div>
          </Panel>
          {verified.length > 0 && <Panel title="Cumulative verified saving"><Cumulative points={[{ label: 'start', value: 0 }, ...verified.map((l) => ({ label: l.id, value: l.measurement?.monthlySaving ?? 0 }))]} fmt={money} /></Panel>}
          <Panel title="Receipts and changes" pad={false}>
            {ledger.slice().reverse().map((l) => (
              <button key={l.id} onClick={() => nav(`/proof/receipt/${l.id}`)} className="flex w-full flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 text-left last:border-0 hover:bg-sunk">
                <span className="num w-14 text-[12px] text-muted">{l.id}</span>
                <span className="min-w-0 flex-1 text-[13.5px]">{l.action}</span>
                <Badge tone={l.status === 'verified' ? 'growth' : l.status === 'rolled-back' || l.status === 'not-effective' ? 'waste' : 'misconfig'}>{l.status === 'applied' ? 'pending verification' : l.status}</Badge>
                <span className="num w-24 text-right font-semibold">{l.measurement ? money(l.measurement.monthlySaving, 0) : money(l.estimatedMonthlySaving, 0)}<span className="text-[11px] text-muted">/mo</span></span>
              </button>
            ))}
          </Panel>
        </>
      )}
    </div>
  )
}

export function ReceiptView() {
  const { id = '' } = useParams()
  const e = useStore((s) => s.ledger.find((l) => l.id === id))
  const audit = useStore((s) => s.audit)
  const money = useMoney()
  const nav = useNavigate()
  if (!e) return <StateView kind="error" title="Receipt not found" action={<Button onClick={() => nav('/proof/savings')}>Back to Savings</Button>} />
  const series = lineSeries(e)
  const hash = receiptHash(e)
  const m = e.measurement
  const events = audit.filter((x) => JSON.stringify(x.payload).includes(e.id) || JSON.stringify(x.payload).includes(e.findingId))
  const summary = `SpendSentinel receipt ${e.id}: ${e.action}. ${m ? `Before ${money(m.beforeDaily)}/day, after ${money(m.afterDaily)}/day, saving ${money(m.monthlySaving, 0)}/month (${m.verdict}).` : 'Pending verification.'} Approved by ${e.approvedBy}. Hash ${hash.slice(0, 16)}.`
  return (
    <div className="space-y-5">
      <button onClick={() => nav('/proof/savings')} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Savings</button>
      <PageHeader eyebrow={`Savings receipt · ${e.id}`} title={m ? `${money(m.monthlySaving, 0)}/month ${m.verdict === 'verified' ? 'saved, verified' : m.verdict === 'inconclusive' ? '— within normal noise' : '— no saving measured'}` : 'Pending verification'} sub={e.action}
        right={<Button variant="ghost" onClick={() => navigator.clipboard?.writeText(summary).then(() => toast('Summary copied.'))}><Copy size={15} /> Copy summary</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Panel title="Before and after" right={series.simulatedFrom && <Honest k="clock" />}>
          {series.days.length > 1 ? <BeforeAfter days={series.days} values={series.values} changeDay={e.appliedOn ?? series.days[0]} simulatedFrom={series.simulatedFrom} fmt={money} /> : <p className="text-[13px] text-muted">This resource has no billing line of its own; the saving is its monthly cost minus what keeps billing.</p>}
          {m && <div className="mt-3 grid grid-cols-3 gap-3 text-[13px]"><div className="sunk p-3"><div className="text-muted">Before</div><div className="num font-semibold">{money(m.beforeDaily)}/day</div></div><div className="sunk p-3"><div className="text-muted">After</div><div className="num font-semibold">{money(m.afterDaily)}/day</div></div><div className="sunk p-3"><div className="text-muted">Noise (3×)</div><div className="num font-semibold">{money(m.noise * 3)}/day</div></div></div>}
        </Panel>
        <Panel title="Proof">
          <div className="text-[12px] text-muted">Receipt hash (SHA-256)</div>
          <div className="mt-1 break-all font-mono text-[11.5px]">{hash}</div>
          <div className="mt-4 text-[12px] text-muted">Timeline</div>
          <ol className="mt-2 space-y-2 border-l border-line pl-4 text-[12.5px]">
            {events.slice(-8).map((x) => <li key={x.hash}><div className="font-medium">{x.event}</div><div className="num text-[11px] text-muted">{new Date(x.ts).toLocaleString()} · {x.hash.slice(0, 10)}</div></li>)}
          </ol>
        </Panel>
      </div>
    </div>
  )
}

export function Brief() {
  const a = useAnalysis()
  const money = useMoney()
  const { ledger, status } = useStore()
  const b = brief({
    series: a.series, cases: a.findings,
    verifiedMonthly: ledger.filter((l) => l.status === 'verified').reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0),
    pendingMonthly: ledger.filter((l) => l.status === 'applied').reduce((s, l) => s + l.estimatedMonthlySaving, 0),
    idleMonthly: a.idle.reduce((s, r) => s + r.netSaving, 0), idleCount: a.idle.length,
  }, money)
  const open = a.findings.filter((f) => needsAction(f, status[f.finding.id]))
  const text = [b.title, '', ...b.paragraphs, '', b.next].join('\n')
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Proof" title="Founder Brief" sub="A 60-second read, written from the engine's numbers with fixed sentence templates (no language model)." right={<><ProofTabs /><Button variant="ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Brief copied.'))}><Copy size={15} /> Copy</Button><Button variant="ghost" onClick={() => print()}><FileText size={15} /> Print</Button></>} />
      <article className="panel mx-auto max-w-3xl p-8">
        <div className="eyebrow">{b.title}</div>
        {b.paragraphs.map((p, i) => <p key={i} className={`mt-4 leading-relaxed ${i === 0 ? 'text-[19px] font-semibold' : 'text-[15px]'}`}>{p}</p>)}
        <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/8 p-4 text-[15px] font-medium">{b.next}</div>
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4 text-center text-[13px]">
          <div><div className="num font-display text-xl font-extrabold">{money(a.series.reduce((s, p) => s + p.cost, 0), 0)}</div><div className="text-muted">spent</div></div>
          <div><div className="num font-display text-xl font-extrabold text-waste">{open.length}</div><div className="text-muted">open problems</div></div>
          <div><div className="num font-display text-xl font-extrabold text-growth">{money(ledger.filter((l) => l.status === 'verified').reduce((s, l) => s + (l.measurement?.monthlySaving ?? 0), 0), 0)}</div><div className="text-muted">verified / month</div></div>
        </div>
      </article>
    </div>
  )
}

// Network allowlist: this page may only fetch from its own origin.
const ALLOW = () => [location.host]
export function allowed(url: string) {
  try { return ALLOW().includes(new URL(url, location.href).host) } catch { return false }
}

async function vaultKey(pass: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export function Trust() {
  const { audit, rows, ledger, pairingCode, usedNonces, log } = useStore()
  const [check, setCheck] = useState<null | { ok: true; n: number } | { ok: false; brokenAt: number }>(null)
  const [tamper, setTamper] = useState<number | null>(null)
  const [attacks, setAttacks] = useState<Record<string, string>>({})
  const [vault, setVault] = useState<{ cipher?: string; plain?: string; err?: string }>({})
  const [pass, setPass] = useState('')
  const [note, setNote] = useState('')
  const head = audit.at(-1)?.hash ?? '0'.repeat(64)
  const recent = useMemo(() => audit.slice(-10), [audit])
  const runTamper = () => {
    if (audit.length < 3) { toast('Do a few things first so there is a chain to test.'); return }
    const k = Math.floor(audit.length / 2)
    const copy: AuditEntry[] = audit.map((e, i) => (i === k ? { ...e, payload: { ...(e.payload as object), tampered: true } } : e))
    const r = verifyChain(copy)
    setTamper(r.ok ? null : r.brokenAt)
    setCheck(r)
    log('tamper test run', { mutatedIndex: k, detectedAt: r.ok ? null : r.brokenAt })
  }
  const runAttacks = () => {
    const key = pairingKey(pairingCode)
    const exp = { findingId: 'attack-test', stateHash: 'x' }
    const t = issue(key, { findingId: 'attack-test', action: 'test', stateHash: 'x', deviceId: 'test' })
    const n = decode(t)!.nonce
    const replay = verify(key, t, { usedNonces: [...usedNonces, n], expected: exp })
    const expired = verify(key, t, { usedNonces, expected: exp, now: Date.now() + TTL_MS + 1000 })
    const edited = verifyChain(audit.map((e, i) => (i === 0 ? { ...e, event: e.event + '!' } : e)))
    const upload = allowed('https://collector.example.com/upload')
    setAttacks({
      'Replay a used approval': replay.ok ? 'NOT blocked' : `Rejected — ${replay.reason}`,
      'Use an expired approval': expired.ok ? 'NOT blocked' : `Rejected — ${expired.reason}`,
      'Edit a ledger / audit entry': edited.ok ? (audit.length ? 'NOT detected' : 'No entries yet') : `Chain breaks at #${edited.brokenAt}`,
      'Upload rows to an unknown host': upload ? 'NOT blocked' : 'Blocked by the allowlist (only this origin)',
    })
    log('attack tests run', {})
  }
  const encrypt = async () => {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(pass, salt), new TextEncoder().encode(note))
      const pack = btoa(String.fromCharCode(...salt, ...iv, ...new Uint8Array(ct)))
      localStorage.setItem('ss-vault', pack)
      setVault({ cipher: pack }); setNote('')
    } catch (e) { setVault({ err: (e as Error).message }) }
  }
  const decrypt = async () => {
    try {
      const b = Uint8Array.from(atob(localStorage.getItem('ss-vault') ?? ''), (c) => c.charCodeAt(0))
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(16, 28) }, await vaultKey(pass, b.slice(0, 16)), b.slice(28))
      setVault({ plain: new TextDecoder().decode(pt) })
    } catch { setVault({ err: 'Wrong passphrase or nothing stored.' }) }
  }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Proof" title="Trust Center" sub="What leaves this device, how approvals are signed, and how every action is recorded." right={<ProofTabs />} />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <DomeScene rows={rows.length} blocks={audit.length} broken={tamper} sent={ledger.length} height={400} />
        <Panel title="Audit chain" right={<Badge tone={check ? (check.ok ? 'growth' : 'waste') : 'neutral'}>{check ? (check.ok ? `Verified · ${check.n} entries` : `Broken at #${check.brokenAt}`) : `${audit.length} entries`}</Badge>}>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { const r = verifyChain(audit); setCheck(r); setTamper(null); log('audit verified', { ok: r.ok }) }}><ShieldCheck size={14} /> Verify</Button>
            <Button size="sm" variant="ghost" onClick={runTamper}><ShieldAlert size={14} /> Tamper test</Button>
          </div>
          <p className="mt-2 text-[12px] text-muted">Each entry's hash = SHA-256(previous hash + entry). The tamper test edits one entry in a copy held in memory; your real chain is untouched.</p>
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
            {recent.map((e) => <div key={e.hash} className={`flex gap-2 rounded px-1.5 py-1 ${tamper === e.i ? 'bg-waste/15 text-waste' : ''}`}><span className="text-muted">#{e.i}</span><span className="min-w-0 flex-1 truncate">{e.event}</span><span className="text-muted">{e.hash.slice(0, 8)}</span></div>)}
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[12px]"><div className="text-muted">Head hash (anchored off-device in production)</div><button className="mt-1 flex w-full items-center gap-2 break-all text-left font-mono text-[11px]" onClick={() => navigator.clipboard?.writeText(head).then(() => toast('Head hash copied.'))}>{head}<Copy size={12} className="shrink-0" /></button></div>
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Attack tests" right={<Button size="sm" onClick={runAttacks}><Play size={14} /> Run</Button>}>
          {Object.keys(attacks).length ? (
            <div className="space-y-2">{Object.entries(attacks).map(([k, v]) => <div key={k} className="flex flex-wrap justify-between gap-2 text-[13px]"><span>{k}</span><span className={v.startsWith('NOT') ? 'text-waste' : 'text-growth'}>{v}</span></div>)}</div>
          ) : <p className="text-[13px] text-muted">Replays a used approval, uses an expired one, edits an audit entry in a copy, and tries to send rows to an outside host.</p>}
        </Panel>
        <Panel title="Encrypted vault" right={<Badge tone={isSecureContext ? 'growth' : 'neutral'}>{isSecureContext ? 'AES-GCM available' : 'needs https or localhost'}</Badge>}>
          {isSecureContext ? (
            <div className="space-y-2">
              <input value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Passphrase" className="h-10 w-full rounded-[10px] border border-line bg-sunk px-3 text-sm" />
              <div className="flex gap-2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Secret note (e.g. a cloud role ARN)" className="h-10 min-w-0 flex-1 rounded-[10px] border border-line bg-sunk px-3 text-sm" /><Button size="md" disabled={!pass || !note} onClick={encrypt}><Lock size={14} /> Encrypt</Button><Button size="md" variant="ghost" disabled={!pass} onClick={decrypt}><Unlock size={14} /></Button></div>
              {vault.cipher && <div className="break-all font-mono text-[10.5px] text-muted">{vault.cipher.slice(0, 120)}…</div>}
              {vault.plain && <div className="text-[13px] text-growth">Decrypted: {vault.plain}</div>}
              {vault.err && <div className="text-[13px] text-waste">{vault.err}</div>}
            </div>
          ) : <p className="text-[13px] text-muted">Browsers only allow AES-GCM on secure pages. On a plain LAN address the vault is off; approvals still work because they use @noble/hashes.</p>}
        </Panel>
      </div>
      <Panel title="What this prototype does and does not do">
        <div className="grid gap-5 md:grid-cols-2 text-[13.5px]">
          <ul className="space-y-1.5"><li className="font-semibold text-growth">Does</li><li>Reads and analyses billing files in this browser; raw rows are never uploaded.</li><li>Signs approvals with HMAC-SHA256, single-use, 10-minute expiry, bound to the data state.</li><li>Records every step in a SHA-256 hash chain you can verify.</li><li>Measures savings from billing data before and after a change.</li></ul>
          <ul className="space-y-1.5"><li className="font-semibold text-waste">Does not</li><li>Hold cloud credentials or call cloud APIs: live runs are simulated and labelled.</li><li>Know who made a change (that needs CloudTrail or activity logs).</li><li>Use hardware-backed keys: the per-device key is a prototype.</li><li>Anchor the audit head off-device yet.</li></ul>
        </div>
      </Panel>
    </div>
  )
}

export default function Proof() {
  const { tab = 'savings' } = useParams()
  if (tab === 'brief') return <Brief />
  if (tab === 'trust') return <Trust />
  return <Savings />
}

