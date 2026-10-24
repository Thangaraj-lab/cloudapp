import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Database, Upload, Cloud, ArrowRight, Lock, Smartphone } from 'lucide-react'
import { setPending } from '../../flow/importer'
import { useStore } from '../../store'
import { PhoneLink } from '../../components/PhoneLink'
import { api, useBackend } from '../../flow/backend'
import { useState } from 'react'

const Backdrop = lazy(() => import('../../world/Backdrop'))

export default function Welcome() {
  const nav = useNavigate()
  const hasData = useStore((s) => s.rows.length > 0)
  const cloudUp = useBackend((b) => b.status === 'up' && !!b.health?.cloud.ok)
  const [cloudErr, setCloudErr] = useState<string | null>(null)
  // Local cloud: read the newest export delivered to the S3 bucket and run it through the same checks.
  const fromBucket = async () => {
    setCloudErr(null)
    try {
      const r = await api<{ key: string; csv: string }>('/cloud/ingest', { json: {} })
      setPending({ file: new File([r.csv], 's3:' + r.key.split('/').pop(), { type: 'text/csv' }) })
      nav('/check')
    } catch (x) { setCloudErr((x as Error).message) }
  }
  const cards = [
    { icon: Database, title: 'Try real sample', text: 'FOCUS 1.0 public billing export from a real AWS account, September 2024. 466 daily rows.', cta: 'Start with the sample', primary: true, go: () => { setPending({ sample: true }); nav('/check') } },
    { icon: Upload, title: 'Upload my file', text: 'CSV, CSV.gz or JSON from AWS, Azure, GCP or FOCUS. Processed on this device.', cta: 'Choose a file', go: () => nav('/connect') },
    cloudUp
      ? { icon: Cloud, title: 'Connect cloud', text: 'Read the newest billing export delivered to the local cloud bucket (S3 API on this laptop).', cta: 'Load from bucket', disabled: false, go: fromBucket }
      : { icon: Cloud, title: 'Connect cloud', text: 'Start the backend to read exports from the local cloud bucket. Real AWS / Azure / GCP connections come next.', cta: 'Backend not running', disabled: true, go: () => {} },
  ]
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-full opacity-45 md:w-[62%]"><Suspense fallback={null}><Backdrop /></Suspense></div>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_10%,var(--bg)_75%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1100px] flex-col px-5 py-8">
        <div className="flex items-center gap-3">
          <span className="grad grid h-10 w-10 place-items-center rounded-xl font-display text-lg font-extrabold text-white">S</span>
          <span className="font-display text-lg font-bold">SpendSentinel</span>
          {hasData && <button onClick={() => nav('/overview')} className="link ml-auto text-sm">Back to my overview</button>}
        </div>
        <div className="my-auto py-10">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="eyebrow">Cloud cost anomaly and waste finder</div>
            <h1 className="mt-3 max-w-3xl text-[36px] font-extrabold leading-[1.08] sm:text-[52px]">
              Find the spike. <span className="grad-text">Know why.</span> Fix it safely.
            </h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">
              SpendSentinel reads a billing export, finds the days that cost more than normal, says which service, environment and app caused it, judges it as waste, misconfiguration or growth, and proves the saving after a fix.
            </p>
          </motion.div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {cards.map((c, i) => (
              <motion.button key={c.title} disabled={c.disabled} onClick={c.go}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 + i * 0.06 }}
                className={`panel panel-hover flex flex-col p-5 text-left disabled:cursor-not-allowed disabled:opacity-55 ${c.primary ? 'border-accent/50' : ''}`}>
                <span className={`grid h-10 w-10 place-items-center rounded-xl ${c.primary ? 'grad text-white' : 'bg-sunk text-accent'}`}><c.icon size={19} /></span>
                <span className="mt-4 font-display text-lg font-bold">{c.title}</span>
                <span className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-muted">{c.text}</span>
                <span className={`mt-5 inline-flex items-center gap-1.5 text-sm font-semibold ${c.primary ? 'text-accent' : c.disabled ? 'text-muted' : 'text-ink'}`}>{c.cta}{!c.disabled && <ArrowRight size={15} />}</span>
              </motion.button>
            ))}
          </div>
          {cloudErr && <p className="mt-4 text-[13px] text-waste">{cloudErr}</p>}
          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted"><Lock size={14} /> Files are processed in this browser. No rows are uploaded anywhere.</p>
          <details className="panel mt-6 max-w-2xl p-4">
            <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-semibold"><Smartphone size={16} className="text-accent" /> Use it on your phone (approver)</summary>
            <div className="mt-4"><PhoneLink route="/m" size={170} title="Scan with the phone camera" /></div>
          </details>
        </div>
      </div>
    </div>
  )
}
