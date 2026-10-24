import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Upload, ArrowLeft, Lock, FileWarning } from 'lucide-react'
import { sniff } from '../../engine/sniff'
import { setPending } from '../../flow/importer'
import { Segmented } from '../../components/ui'

const GUIDES = {
  aws: ['Billing and Cost Management → Data Exports → Create export.', 'Choose "Standard data export" with FOCUS 1.0 or CUR 2.0, daily granularity, CSV (gzip is fine).', 'Download the file from the S3 bucket and drop it here.'],
  azure: ['Cost Management → Exports → Add.', 'Type "Cost and usage details (FOCUS)" or "Actual cost", daily, CSV.', 'Download the CSV from the storage account and drop it here.'],
  gcp: ['Billing → Billing export → BigQuery export (daily cost detail).', 'In BigQuery, query the export table for the period you want.', 'Save results → CSV (local file) and drop it here.'],
}

export default function Connect() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [tab, setTab] = useState<keyof typeof GUIDES>('aws')
  const [problem, setProblem] = useState<{ format: string; guide: string } | null>(null)
  const take = async (f: File) => {
    setProblem(null)
    const s = await sniff(f)
    if (s.kind === 'unsupported') { setProblem({ format: s.format, guide: s.guide }); return }
    setPending({ file: f, merge: params.get('merge') === '1' })
    nav('/check')
  }
  return (
    <div className="mx-auto min-h-screen max-w-[880px] px-5 py-8">
      <button onClick={() => nav(-1)} className="flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={15} /> Back</button>
      <h1 className="mt-6 text-[30px] font-extrabold">Upload a billing export</h1>
      <p className="mt-2 text-muted">One file with daily (or hourly, or line-item) cost rows. Columns are recognised automatically.</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) take(f) }}
        onClick={() => input.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
        className={`mt-6 grid min-h-[260px] cursor-pointer place-items-center rounded-3xl border-2 border-dashed p-8 text-center transition-colors duration-200 ${over ? 'border-accent bg-accent/10' : 'border-line bg-sunk hover:border-accent/60'}`}>
        <input ref={input} type="file" accept=".csv,.gz,.json,text/csv,application/json,application/gzip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) take(f); e.target.value = '' }} />
        <div>
          <span className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${over ? 'grad text-white' : 'bg-accent/12 text-accent'}`}><Upload size={24} /></span>
          <div className="mt-4 font-display text-xl font-bold">{over ? 'Drop to check it' : 'Drop your file here, or click to choose'}</div>
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">{['CSV', 'CSV.gz', 'JSON', 'FOCUS 1.0', 'AWS CUR', 'Azure', 'GCP'].map((c) => <span key={c} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-muted">{c}</span>)}</div>
        </div>
      </div>
      {problem && (
        <div className="mt-4 flex gap-3 rounded-2xl border border-misconfig/40 bg-misconfig/8 p-4 text-sm">
          <FileWarning size={18} className="mt-0.5 shrink-0 text-misconfig" />
          <div><div className="font-semibold">{problem.format} files can't be read here yet</div><div className="mt-1 text-muted">{problem.guide}</div></div>
        </div>
      )}
      <p className="mt-4 flex items-center gap-2 text-[13px] text-muted"><Lock size={14} /> Processed on this device. Nothing is uploaded.</p>
      <div className="panel mt-8 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-display font-bold">How to export</h3>
          <Segmented value={tab} onChange={setTab} options={[{ k: 'aws', label: 'AWS' }, { k: 'azure', label: 'Azure' }, { k: 'gcp', label: 'GCP' }]} /></div>
        <ol className="mt-4 space-y-2 text-[14px]">{GUIDES[tab].map((g, i) => <li key={i} className="flex gap-3"><span className="num grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sunk text-[12px] font-semibold">{i + 1}</span><span className="text-muted">{g}</span></li>)}</ol>
      </div>
    </div>
  )
}
