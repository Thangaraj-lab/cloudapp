// Approve → run → verify, recorded in the ledger and the audit chain.
import type { LedgerEntry, Measurement } from '../engine/ledger'
import { measure, simulateAfter } from '../engine/ledger'
import { canonicalJSON, sha256Hex } from '../engine/hash'
import { addDays } from '../engine/series'
import { getAnalysis, useStore } from '../store'
import type { Subject } from './subject'

export function startAction(s: Subject, approvedBy: string, nonce: string, secondApprover?: string): string {
  const st = useStore.getState()
  const id = 'A-' + String(st.ledger.length + 1).padStart(3, '0')
  const entry: LedgerEntry = {
    id, findingId: s.id, findingDay: s.analyzed?.finding.day ?? '', action: s.action,
    line: { service: s.service, region: s.analyzed ? 'untagged' : s.region, environment: s.environment, application: s.application },
    createdAt: Date.now(), approvedBy, secondApprover, approvalNonce: nonce, estimatedMonthlySaving: s.netMonthly, status: 'planned',
  }
  st.set({ ledger: [...st.ledger, entry], usedNonces: [...st.usedNonces, nonce], waiting: null })
  st.setStatus(s.id, 'approved')
  st.log('approval consumed', { subject: s.id, actionId: id, approvedBy, secondApprover, nonce })
  return id
}

export const entryFor = (id: string) => [...useStore.getState().ledger].reverse().find((l) => l.findingId === id)

/** Live run finished (simulated cloud action). Success stops the leak; failure rolls back and counts nothing. */
export function finishRun(entryId: string, ok: boolean, failedAt?: number) {
  const st = useStore.getState()
  const e = st.ledger.find((l) => l.id === entryId)
  if (!e) return
  const a = getAnalysis(st)
  const last = a.series.at(-1)?.day ?? ''
  if (ok) {
    st.updateAction(entryId, { status: 'applied', appliedOn: last, stepsDone: [0, 1, 2, 3, 4, 5, 6] })
    st.setStatus(e.findingId, 'applied')
    st.log('execute finished', { actionId: entryId, appliedOn: last, mode: 'simulated' })
  } else {
    st.updateAction(entryId, { status: 'rolled-back', stepsDone: [] })
    st.setStatus(e.findingId, 'rolled-back')
    st.log('rollback', { actionId: entryId, failedAtStep: failedAt, saving: 0 })
  }
}

/** Waste items have no billing line of their own: before = monthly cost, after = residual. */
function wasteMeasure(e: LedgerEntry): Measurement {
  const r = getAnalysis(useStore.getState()).idle.find((x) => 'w-' + x.id === e.findingId)
  const before = (r?.monthlyCost ?? e.estimatedMonthlySaving) / 30
  const after = (r?.residual ?? 0) / 30
  return { beforeDaily: before, afterDaily: after, noise: 0, daysBefore: 14, daysAfter: 7, monthlySaving: (before - after) * 30, verdict: 'verified' }
}

/** "Fast-forward 7 days" on the simulated clock: generate the days after the change and measure them. */
export function fastForward() {
  const st = useStore.getState()
  const a = getAnalysis(st)
  let simRows = [...st.simRows]
  let n = 0
  for (const e of st.ledger) {
    if (e.status !== 'applied') continue
    let m: Measurement | null
    if (e.findingId.startsWith('w-')) m = wasteMeasure(e)
    else {
      const sim = simulateAfter(a.allRows, e)
      simRows = [...simRows.filter((r) => !(r.service === e.line.service && r.environment === e.line.environment && r.application === e.line.application)), ...sim]
      m = measure([...a.allRows, ...sim], e)
    }
    if (!m) continue
    const status = m.verdict === 'verified' ? 'verified' : m.verdict === 'inconclusive' ? 'inconclusive' : 'not-effective'
    st.updateAction(e.id, { measurement: m, status })
    st.setStatus(e.findingId, status)
    st.log('ledger verified', { actionId: e.id, result: m.verdict, monthlySaving: +m.monthlySaving.toFixed(2), clock: 'simulated' })
    if (status === 'verified') st.notify({ kind: 'verified', text: `Saving verified: ${e.action} · $${m.monthlySaving.toFixed(0)}/month (simulated clock).`, to: `/proof/receipt/${e.id}` })
    n++
  }
  useStore.getState().set({ simRows })
  return n
}

export function receiptHash(e: LedgerEntry) {
  return sha256Hex(canonicalJSON({ id: e.id, subject: e.findingId, action: e.action, line: e.line, approvedBy: e.approvedBy, nonce: e.approvalNonce, appliedOn: e.appliedOn, measurement: e.measurement }))
}

/** Daily cost of the entry's line around the change (real rows, then simulated rows). */
export function lineSeries(e: LedgerEntry) {
  const st = useStore.getState()
  const a = getAnalysis(st)
  const rows = [...a.allRows, ...st.simRows]
  const from = addDays(e.appliedOn ?? a.series.at(-1)!.day, -10)
  const m = new Map<string, number>()
  for (const r of rows) if (r.service === e.line.service && r.environment === e.line.environment && r.application === e.line.application && r.day >= from) m.set(r.day, (m.get(r.day) ?? 0) + r.cost)
  const days = [...m.keys()].sort()
  const lastReal = a.series.at(-1)?.day ?? ''
  return { days, values: days.map((d) => m.get(d) ?? 0), simulatedFrom: days.find((d) => d > lastReal) ? lastReal : undefined }
}
