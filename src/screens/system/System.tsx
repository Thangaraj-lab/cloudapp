import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, RefreshCw, Plus, Trash2, Cpu, Wifi, WifiOff, Smartphone, FlaskConical } from 'lucide-react'
import { useAnalysis, useMoney, useStore, type Currency, type Person, pinHash } from '../../store'
import { previewHeaders } from '../../engine/ingest'
import { analyzeUtilization, detectUMapping } from '../../engine/utilization'
import { RESIDUAL_PCT } from '../../engine/inject'
import { newPairingCode } from '../../engine/approval'
import { randomHex } from '../../engine/hash'
import { DEFAULT_DETECT } from '../../engine/detect'
import { Badge, Button, Honest, PageHeader, Panel, Segmented, toast } from '../../components/ui'
import { PhoneLink } from '../../components/PhoneLink'
import { BackendPanel } from '../../components/BackendPanel'
import { api, useBackend } from '../../flow/backend'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-0"><span><span className="text-[14px]">{label}</span>{hint && <span className="block text-[12px] text-muted">{hint}</span>}</span>{children}</label>
}
const num = 'num h-9 w-24 rounded-lg border border-line bg-sunk px-2 text-right'

/** G1 Settings: detection thresholds with live re-scan, currency, approvers, policy, reset. */
export function Settings() {
  const s = useStore()
  const a = useAnalysis()
  const money = useMoney()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [role, setRole] = useState<Person['role']>('approver')
  const p = s.params
  const setP = (k: keyof typeof p, v: number) => { if (Number.isFinite(v) && v > 0) { s.set({ params: { ...p, [k]: v } }); s.log('detection changed', { [k]: v }) } }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Detection" right={<Badge tone="accent">{a.findings.length} cases · {a.signals.length} signals</Badge>}>
          <Field label="Unusual if robust z above" hint="Default 3.5"><input type="number" step={0.1} value={p.zThreshold} onChange={(e) => setP('zThreshold', +e.target.value)} className={num} /></Field>
          <Field label="Minimum change per day" hint="Default 5 (billing currency)"><input type="number" step={1} value={p.minChange} onChange={(e) => setP('minChange', +e.target.value)} className={num} /></Field>
          <Field label="Baseline window (days)" hint="Trailing median and MAD. Default 7"><input type="number" step={1} min={3} max={28} value={p.window} onChange={(e) => setP('window', Math.round(+e.target.value))} className={num} /></Field>
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted"><span>Every change re-scans immediately.</span><Button size="sm" variant="ghost" onClick={() => s.set({ params: DEFAULT_DETECT })}>Defaults</Button></div>
        </Panel>
        <Panel title="Money">
          <Field label="Billing currency"><select value={s.currency} onChange={(e) => s.set({ currency: e.target.value as Currency })} className="h-9 rounded-lg border border-line bg-sunk px-2">{['USD', 'INR', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Show amounts in ₹" hint={`USD_INR = ${s.inrRate} (demo rate)`}><input type="checkbox" checked={s.showInr} onChange={(e) => s.set({ showInr: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /></Field>
          <Field label="₹ per $ (demo rate)"><input type="number" value={s.inrRate} onChange={(e) => s.set({ inrRate: Math.max(1, +e.target.value) })} className={num} /></Field>
          <Field label="Theme"><Segmented size="sm" value={s.theme} onChange={(t) => s.set({ theme: t })} options={[{ k: 'dark', label: 'Dark' }, { k: 'light', label: 'Light' }]} /></Field>
        </Panel>
        <Panel title="Policy">
          <Field label="Never change production" hint="Prod-tagged changes are denied with a reason"><input type="checkbox" checked={s.policy.blockProd} onChange={(e) => { s.set({ policy: { ...s.policy, blockProd: e.target.checked } }); s.log('policy changed', { blockProd: e.target.checked }) }} className="h-4 w-4 accent-[var(--accent)]" /></Field>
          <Field label="Require a rollback plan"><input type="checkbox" checked={s.policy.requireRollbackPlan} onChange={(e) => { s.set({ policy: { ...s.policy, requireRollbackPlan: e.target.checked } }); s.log('policy changed', { requireRollbackPlan: e.target.checked }) }} className="h-4 w-4 accent-[var(--accent)]" /></Field>
          <Field label="Second approver above (per day)" hint={money(s.policy.maxActionCostPerDay)}><input type="number" value={s.policy.maxActionCostPerDay} onChange={(e) => { s.set({ policy: { ...s.policy, maxActionCostPerDay: Math.max(0, +e.target.value) } }) }} className={num} /></Field>
          <div className="mt-2 text-[12.5px] text-muted">Trust level: <button className="link" onClick={() => nav('/guardrails')}>{['Observe', 'Recommend', 'Approve-first', 'Auto for dev/test'][s.trust]}</button></div>
        </Panel>
        <Panel title="Approvers">
          <div className="space-y-2">
            {s.people.map((x) => (
              <div key={x.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-[13.5px]">
                <span>{x.name} <span className="text-muted">· {x.role}</span>{s.currentPerson === x.id && <Badge tone="accent" className="ml-2">this device</Badge>}</span>
                <span className="flex gap-1">{s.currentPerson !== x.id && <Button size="sm" variant="quiet" onClick={() => s.set({ currentPerson: x.id })}>Use</Button>}<Button size="sm" variant="quiet" aria-label="Remove" onClick={() => { const prev = s.people; s.set({ people: s.people.filter((y) => y.id !== x.id) }); toast(`${x.name} removed.`, () => useStore.getState().set({ people: prev })) }}><Trash2 size={14} /></Button></span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-sunk px-2 text-sm" />
            <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="PIN" type="password" className="h-9 w-20 rounded-lg border border-line bg-sunk px-2 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as Person['role'])} className="h-9 rounded-lg border border-line bg-sunk px-2 text-sm"><option value="approver">approver</option><option value="admin">admin</option><option value="viewer">viewer</option></select>
            <Button size="sm" disabled={name.trim().length < 2 || pin.length < 4} onClick={() => { const id = 'p-' + randomHex(4); s.set({ people: [...s.people, { id, name: name.trim(), role, pinHash: pinHash(id, pin) }], currentPerson: s.currentPerson ?? id }); s.log('profile created', { id, name, role }); setName(''); setPin('') }}><Plus size={14} /> Add</Button>
          </div>
        </Panel>
      </div>
      <Panel title="Reset demo">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] text-muted">Clears data, cases, ledger, rules and the audit chain on this device. You can undo for a few seconds.</p>
          <Button variant="danger" onClick={() => {
            const snap = { ...useStore.getState() }
            s.reset(); nav('/welcome')
            if (useBackend.getState().status === 'up') void api('/reset', { json: {} }).catch(() => {})
            toast('Everything was reset.', () => { useStore.setState(snap); location.hash = '#/overview' })
          }}><RefreshCw size={15} /> Reset demo</Button>
        </div>
      </Panel>
    </div>
  )
}

/** G2 Data sources. */
export function Sources() {
  const s = useStore()
  const money = useMoney()
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const r = s.report
  const util = async (f: File) => {
    setErr(null)
    const t = await f.text()
    const p = await previewHeaders(t)
    const m = detectUMapping(p.headers)
    if (!(m.avgCpu && m.maxCpu) && !(m.cpu && m.timestamp)) { setErr('Could not find CPU columns (average and max/P95 CPU, or timestamp + CPU).'); return }
    const res = analyzeUtilization(t, m, null, RESIDUAL_PCT)
    s.set({ utilization: { fileName: f.name, resources: res.resources, scanned: res.scanned, missingCost: res.missingCost, mode: res.mode } })
    s.log('utilization loaded', { file: f.name, scanned: res.scanned, idle: res.idleCount })
    toast(`${res.scanned} resources read · ${res.idleCount} idle.`)
  }
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Data sources" title="Where the numbers come from" right={<><Button variant="ghost" onClick={() => nav('/connect?merge=1')}><Plus size={15} /> Add newer export</Button><Button onClick={() => nav('/connect')}><Upload size={15} /> Replace data</Button></>} />
      <BackendPanel />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Billing data" right={s.sourceKind === 'sample' ? <Honest k="real" /> : <Badge tone="accent">Uploaded</Badge>}>
          <div className="space-y-2 text-[13.5px]">
            <div className="flex justify-between gap-3"><span className="text-muted">File</span><span className="truncate text-right">{r?.fileName ?? s.source}</span></div>
            {s.sourceKind === 'sample' && <div className="flex justify-between gap-3"><span className="text-muted">Origin</span><span className="text-right">FOCUS 1.0 public sample · AWS 11353890204 · Sept 2024 · usage rows · USD</span></div>}
            <div className="flex justify-between"><span className="text-muted">Format</span><span>{r?.format ?? 'CSV'}</span></div>
            <div className="flex justify-between"><span className="text-muted">Fingerprint (SHA-256, first 8)</span><span className="num font-mono">{s.fingerprint}</span></div>
            <div className="flex justify-between"><span className="text-muted">Rows read → kept</span><span className="num">{(r?.recordsRead ?? s.rows.length).toLocaleString()} → {s.rows.length.toLocaleString()}</span></div>
            {r && <div className="flex justify-between"><span className="text-muted">Set aside · duplicates · non-usage</span><span className="num">{r.quarantined} · {r.duplicates} · {r.nonUsage} ({money(r.nonUsageTotal)})</span></div>}
            <div className="flex justify-between"><span className="text-muted">Imported</span><span>{s.importedAt ? new Date(s.importedAt).toLocaleString() : '—'}</span></div>
          </div>
          <Button variant="ghost" size="sm" className="mt-4" onClick={() => nav('/check')}>Open the health check</Button>
        </Panel>
        <Panel title="Injected demo scenarios" right={s.injected && <Honest k="injected" />}>
          <label className="flex cursor-pointer items-start gap-3 text-[13.5px]">
            <input type="checkbox" checked={s.injected} onChange={(e) => { s.set({ injected: e.target.checked }); s.log('injected scenarios ' + (e.target.checked ? 'on' : 'off'), {}) }} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
            <span><span className="flex items-center gap-1.5 font-medium"><FlaskConical size={14} className="text-misconfig" /> Add three demo scenarios (October, after the real month)</span>
              <span className="mt-1 block text-muted">A · forgotten test server i-0demo-staging-02 (Waste) · B · one-day NAT data-processing jump (Misconfig) · C · production growing 40% (Growth). Additive only: the real September findings never change. Everything they add has a dashed outline and a badge.</span></span>
          </label>
        </Panel>
        <Panel title="CPU utilization" right={s.utilization?.mode === 'paired' && <Honest k="paired" />}>
          {s.utilization ? (
            <div className="flex items-center gap-3 text-[13.5px]"><Cpu size={18} className="text-accent" /><div className="flex-1"><div className="font-medium">{s.utilization.fileName}</div><div className="text-muted">{s.utilization.scanned.toLocaleString()} resources · {s.utilization.resources.length} idle</div></div><Button size="sm" variant="quiet" onClick={() => { const prev = s.utilization; s.set({ utilization: null }); toast('Utilization removed.', () => useStore.getState().set({ utilization: prev })) }}>Remove</Button></div>
          ) : <p className="text-[13.5px] text-muted">No utilization file. Idle detection and risk checks need CPU data.</p>}
          <input ref={input} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) util(f); e.target.value = '' }} />
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => input.current?.click()}><Upload size={14} /> {s.utilization ? 'Replace' : 'Add'} utilization CSV</Button>
          {err && <p className="mt-2 text-[13px] text-waste">{err}</p>}
        </Panel>
        <Panel title="Connect cloud"><p className="text-[13.5px] text-muted">Read-only billing connections (AWS Data Exports, Azure Cost Management, GCP BigQuery export) are coming. Today, upload an export file.</p><Badge className="mt-3">Coming soon</Badge></Panel>
      </div>
    </div>
  )
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => { const u = () => setOn(true), d = () => setOn(false); addEventListener('online', u); addEventListener('offline', d); return () => { removeEventListener('online', u); removeEventListener('offline', d) } }, [])
  return on
}

/** G3 Phone / Edge. */
export function Edge() {
  const s = useStore()
  const online = useOnline()
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={<span className="flex items-center gap-2">Phone / Edge <Honest k="edge" /></span>} title={s.paired ? 'Phone paired' : 'Pair a phone as your approver'} sub="The phone holds the same signing key (derived from the pairing code). Only the signed approval moves between devices." />
      <BackendPanel focus="edge" />
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
        <Panel title="Pair">
          <PhoneLink route={`/m/pair/${s.pairingCode}`} size={200} title="Scan with the phone camera to pair" />
          <div className="mt-4 text-center text-[12px] text-muted">Pairing code (type it on the phone if the link won't open)</div>
          <div className="num mt-1 text-center font-mono text-[24px] font-bold tracking-[0.2em]">{s.pairingCode}</div>
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              const prev = s.pairingCode, code = newPairingCode()
              s.set({ pairingCode: code, paired: null }); s.log('pairing code changed', {})
              if (useBackend.getState().status === 'up') void api('/pairing', { json: { code, rotate: true } })
              toast('New pairing code. Pair the phone again.', () => { useStore.getState().set({ pairingCode: prev }); if (useBackend.getState().status === 'up') void api('/pairing', { json: { code: prev, rotate: true } }) })
            }}><RefreshCw size={14} /> New code</Button>
            {!s.paired && <Button size="sm" onClick={() => { s.set({ paired: { name: 'Phone', at: Date.now() } }); s.log('phone paired', {}) }}><Smartphone size={14} /> Phone shows “Paired”</Button>}
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Status">
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Badge tone={online ? 'growth' : 'misconfig'}>{online ? <Wifi size={12} /> : <WifiOff size={12} />}{online ? 'Online' : 'Offline'}</Badge>
              <Badge>Data stays on this device</Badge>
              <Badge tone={s.paired ? 'growth' : 'neutral'}>{s.paired ? `Paired ${new Date(s.paired.at).toLocaleString()}` : 'Not paired'}</Badge>
            </div>
            <p className="mt-3 text-[12.5px] text-muted">The phone link above never uses localhost: on this laptop it is built from the network address the dev server reports. On the phone, Overview has a “Test connection” button.</p>
          </Panel>
          <Panel title="What works offline">
            <ul className="space-y-1.5 text-[13.5px]">
              <li>✓ After the page has loaded: cases, verdicts, approvals and signing (pure JavaScript hashes, no network).</li>
              <li>✓ Hold-to-approve and the 8-character code.</li>
              <li>• Keep the page open: reloading offline is not promised.</li>
              <li>• The AES-GCM vault needs https or localhost; approvals do not.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  )
}
