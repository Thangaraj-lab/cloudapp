import { useEffect, useState } from 'react'
import { Cloud, Cpu, Server, Smartphone, RefreshCw, Play } from 'lucide-react'
import { api, useBackend } from '../flow/backend'
import { Badge, Button, Panel, toast } from './ui'

interface Instance { id: string; state: string; type: string; environment?: string; application?: string; name?: string }
interface Export { key: string; bytes: number; modified: string }

/** Live view of the local stack: API, local cloud (S3 + EC2), local AI, edge node. */
export function BackendPanel({ focus = 'all' }: { focus?: 'all' | 'edge' }) {
  const { status, health, ledgerTick } = useBackend()
  const [inst, setInst] = useState<Instance[]>([])
  const [exp, setExp] = useState<Export[]>([])
  const [verify, setVerify] = useState<string | null>(null)
  const load = () => {
    api<{ instances: Instance[] }>('/cloud/instances').then((r) => setInst(r.instances)).catch(() => {})
    api<{ exports: Export[] }>('/cloud/exports').then((r) => setExp(r.exports)).catch(() => {})
  }
  useEffect(() => { if (status === 'up') load() }, [status, ledgerTick])
  if (status !== 'up' || !health)
    return (
      <Panel title="Local stack">
        <p className="text-[13.5px] text-muted">{status === 'checking' ? 'Checking for the backend…' : 'The backend is not running, so everything runs in this browser (that still works).'} To start it:</p>
        <code className="sunk mt-2 block p-2 text-[12px]">C:\Users\pandi\.ssvenv\Scripts\python -m uvicorn app:app --app-dir server --host 0.0.0.0 --port 8787</code>
      </Panel>
    )
  const edge = health.edge
  return (
    <Panel title="Local stack" right={<Badge tone="growth"><Server size={12} /> Backend up · {health.engine} engine</Badge>}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="sunk p-3 text-[13px]">
          <div className="flex items-center gap-2 font-semibold"><Cloud size={15} className="text-accent" /> Local cloud</div>
          <div className="mt-1 text-muted">{health.cloud.mode} · {health.cloud.endpoint}</div>
          <div className="mt-1"><Badge tone={health.cloud.ok ? 'growth' : 'waste'}>{health.cloud.ok ? 'reachable' : 'down'}</Badge></div>
          <div className="mt-2 text-[12px] text-muted">Bucket <b className="text-ink">{health.cloud.bucket}</b>: {exp.length} export{exp.length === 1 ? '' : 's'}</div>
        </div>
        <div className="sunk p-3 text-[13px]">
          <div className="flex items-center gap-2 font-semibold"><Cpu size={15} className="text-accent" /> Local AI</div>
          <div className="mt-1 text-muted">Ollama · {health.llm.model}</div>
          <div className="mt-1"><Badge tone={health.llm.available ? 'growth' : 'misconfig'}>{health.llm.available ? 'ready (wording only)' : health.llm.ok ? 'model not pulled' : 'Ollama not running'}</Badge></div>
          <div className="mt-2 text-[12px] text-muted">Verdicts: {health.model.active ? `learned tree (${health.model.trainedOn} labels)` : `rule-based (learned tree after ${health.model.minLabels} labels)`}</div>
        </div>
        <div className="sunk p-3 text-[13px]">
          <div className="flex items-center gap-2 font-semibold"><Smartphone size={15} className="text-accent" /> Edge node</div>
          <div className="mt-1 text-muted">{edge.deviceId ? `${edge.deviceId}${edge.ip ? ` · ${edge.ip}` : ''}` : 'No phone has checked in yet'}</div>
          <div className="mt-1"><Badge tone={edge.online ? 'growth' : 'neutral'}>{edge.online ? 'online (heartbeat)' : edge.deviceId ? 'offline: laptop standby' : 'not connected'}</Badge></div>
          {edge.at && <div className="mt-2 text-[12px] text-muted">Last heartbeat {new Date(edge.at * 1000).toLocaleTimeString()}{edge.battery != null ? ` · battery ${edge.battery}%` : ''}</div>}
        </div>
        <div className="sunk p-3 text-[13px]">
          <div className="flex items-center gap-2 font-semibold"><Server size={15} className="text-accent" /> Dataset on API</div>
          <div className="mt-1 text-muted">{health.dataset ? `${health.dataset.name} · ${health.dataset.rows} rows` : 'none'}</div>
          <div className="mt-1 text-[12px] text-muted">{health.dataset?.key}</div>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => api<{ ok: boolean; brokenAt?: number; n?: number }>('/audit/verify').then((r) => setVerify(r.ok ? `Audit chain verified · ${r.n} entries` : `Broken at #${r.brokenAt}`))}>Verify API audit chain</Button>
          {verify && <div className="mt-1 text-[12px] text-growth">{verify}</div>}
        </div>
      </div>
      {focus === 'all' && (
        <div className="mt-4">
          <div className="flex items-center justify-between"><div className="eyebrow">Instances in the local cloud</div><Button size="sm" variant="quiet" onClick={load}><RefreshCw size={13} /> Refresh</Button></div>
          <div className="mt-2 max-h-60 overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="py-1">Instance</th><th>Env</th><th>App</th><th>State</th><th /></tr></thead>
              <tbody>
                {inst.map((i) => (
                  <tr key={i.id} className="border-t border-line">
                    <td className="py-1.5 font-mono">{i.id}</td><td>{i.environment}</td><td>{i.application}</td>
                    <td><Badge tone={i.state === 'running' ? 'growth' : i.state === 'stopped' ? 'misconfig' : 'neutral'}>{i.state}</Badge></td>
                    <td className="text-right">{i.state === 'stopped' && <Button size="sm" variant="quiet" onClick={() => api('/cloud/unpark', { json: { environment: i.environment, application: i.application } }).then(() => { toast('Started again in the local cloud.'); load() })}><Play size={12} /> Start</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  )
}
