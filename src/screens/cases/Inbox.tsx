import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAnalysis, useMoney, useStore, type FindingStatus } from '../../store'
import type { Analyzed } from '../../engine/analyze'
import { headline, dayName } from '../../engine/narrate'
import { Honest, PageHeader, Segmented, StateView, StatusChip, VerdictChip, Button, Badge } from '../../components/ui'

type Filter = 'all' | 'Waste' | 'Misconfig' | 'Growth'
type SFilter = 'any' | 'open' | 'done'
const DONE: FindingStatus[] = ['verified', 'resolved', 'expected', 'dismissed', 'applied']

export function CaseCard({ f, onOpen }: { f: Analyzed; onOpen: () => void }) {
  const money = useMoney()
  const st = useStore((s) => s.status[f.finding.id]) ?? (f.state.ongoing || f.verdict.kind === 'Growth' ? 'new' : 'resolved')
  return (
    <button onClick={onOpen} className={`panel panel-hover flex w-full flex-col gap-3 p-4 text-left sm:flex-row sm:items-center edge-${f.verdict.kind.toLowerCase()}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><VerdictChip kind={f.verdict.kind} confidence={f.verdict.confidence} /><StatusChip s={st} />{f.finding.injected && <Honest k="injected" />}{f.finding.kind === 'steady' && <Badge>always on</Badge>}</div>
        <div className="mt-2 text-[15px] font-medium leading-snug">{headline(f, money)}</div>
        <div className="num mt-1 text-[12.5px] text-muted">{dayName(f.finding.day)} · {f.finding.scope === 'service' ? 'service signal' : `z ${f.finding.z.toFixed(1)} · ${f.finding.severity} severity`}{!f.state.ongoing && f.state.stoppedOn ? ` · stopped by itself ${dayName(f.state.stoppedOn)}` : ''}</div>
      </div>
      <div className="flex shrink-0 items-center gap-4 sm:text-right">
        <div><div className="num font-display text-xl font-extrabold">{money(f.finding.moneyAtRisk, 0)}</div><div className="text-[11.5px] text-muted">at risk to month end</div></div>
        <ArrowRight size={18} className="text-muted" />
      </div>
    </button>
  )
}

export default function Inbox() {
  const a = useAnalysis()
  const nav = useNavigate()
  const status = useStore((s) => s.status)
  const [v, setV] = useState<Filter>('all')
  const [sf, setSf] = useState<SFilter>('any')
  const match = (f: Analyzed) => (v === 'all' || f.verdict.kind === v) && (sf === 'any' || (sf === 'done') === DONE.includes(status[f.finding.id] ?? 'new'))
  const cases = a.findings.filter(match).sort((x, y) => y.finding.moneyAtRisk - x.finding.moneyAtRisk)
  const signals = a.signals.filter(match).sort((x, y) => y.finding.moneyAtRisk - x.finding.moneyAtRisk)
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cases" title={a.findings.length ? `${a.findings.length} unusual day${a.findings.length === 1 ? '' : 's'}, ranked by money at risk` : 'No anomalies found'}
        sub="Each case goes Detect → Explain → Judge → Fix → Approve → Execute → Verify."
        right={<><Segmented size="sm" value={v} onChange={setV} options={[{ k: 'all', label: 'All' }, { k: 'Waste', label: 'Waste' }, { k: 'Misconfig', label: 'Misconfig' }, { k: 'Growth', label: 'Growth' }]} />
          <Segmented size="sm" value={sf} onChange={setSf} options={[{ k: 'any', label: 'Any status' }, { k: 'open', label: 'Open' }, { k: 'done', label: 'Done' }]} /></>} />
      {cases.length ? <div className="space-y-3">{cases.map((f) => <CaseCard key={f.finding.id} f={f} onOpen={() => nav(`/case/${f.finding.id}/understand`)} />)}</div>
        : <StateView title={a.findings.length ? 'No cases match these filters' : 'All normal'} action={<Button variant="ghost" onClick={() => nav('/waste')}>Check idle resources</Button>}>{a.findings.length ? 'Change the filters to see more.' : 'No day in this data cost unusually more than its normal range.'}</StateView>}
      {signals.length > 0 && (
        <div className="pt-4">
          <h2 className="font-display text-lg font-bold">Service signals</h2>
          <p className="mt-1 text-[13px] text-muted">Smaller jumps inside one service, and non-production spend that never switches off. They do not move the whole bill enough to be a case, but they cost money.</p>
          <div className="mt-3 space-y-3">{signals.map((f) => <CaseCard key={f.finding.id} f={f} onOpen={() => nav(`/case/${f.finding.id}/understand`)} />)}</div>
        </div>
      )}
    </div>
  )
}
