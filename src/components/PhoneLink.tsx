import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, ShieldAlert, Wifi } from 'lucide-react'
import { isInsecureLan, isLocalHost, phoneBaseUrl, phoneLink } from '../flow/lan'
import { toast } from './ui'

export function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size, errorCorrectionLevel: 'L' }).then(setSrc).catch(() => setSrc('')) }, [text, size])
  return src ? <img src={src} alt="QR code" width={size} height={size} className="rounded-xl bg-white p-1.5" /> : <div className="skeleton" style={{ width: size, height: size }} />
}

const MANUAL_KEY = 'ss-laptop-ip'
const CHOICE_KEY = 'ss-lan-choice'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

/** The base URL a phone can open (never localhost), with the LAN choices behind it. */
export function usePhoneBase() {
  const local = isLocalHost(location.hostname)
  const [urls, setUrls] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(local ? 'loading' : 'ok')
  const [choice, setChoiceState] = useState<string | null>(read(CHOICE_KEY))
  const [manual, setManualState] = useState(read(MANUAL_KEY) ?? '')
  useEffect(() => {
    if (!local) return
    fetch('/__lan', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { urls?: string[] }) => { setUrls(j.urls ?? []); setState(j.urls?.length ? 'ok' : 'failed') })
      .catch(() => setState('failed'))
  }, [local])
  const base = phoneBaseUrl({ hostname: location.hostname, origin: location.origin, port: location.port, pathname: location.pathname }, urls, choice, state === 'failed' ? manual : null)
  return {
    local, urls, state, base, manual, choice,
    setChoice: (v: string) => { setChoiceState(v); write(CHOICE_KEY, v) },
    setManual: (v: string) => { setManualState(v); write(MANUAL_KEY, v) },
  }
}

/** QR + copyable link for opening a route on the phone, with the LAN checklist. */
export function PhoneLink({ route = '/m', size = 180, title = 'Open on your phone' }: { route?: string; size?: number; title?: string }) {
  const p = usePhoneBase()
  const url = phoneLink(p.base, route)
  return (
    <div className="space-y-3" data-phone-link={url ?? ''}>
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex flex-wrap items-start gap-4">
        {url ? <Qr text={url} size={size} /> : <div className="grid place-items-center rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-muted" style={{ width: size, height: size }}>{p.state === 'loading' ? 'Finding the laptop’s network address…' : 'Enter the laptop IP to make the QR code'}</div>}
        <div className="min-w-0 flex-1 space-y-2 text-[13px]">
          {url && (
            <button onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied.'))} className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-sunk px-3 py-2 text-left font-mono text-[12.5px] hover:border-[var(--border-strong)]">
              <span className="min-w-0 flex-1 break-all">{url}</span><Copy size={13} className="shrink-0 text-muted" />
            </button>
          )}
          {p.local && p.urls.length > 1 && (
            <label className="block"><span className="text-[12px] text-muted">This laptop has several networks. Pick the one the phone is on:</span>
              <select value={p.choice && p.urls.includes(p.choice) ? p.choice : p.urls[0]} onChange={(e) => p.setChoice(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-line bg-sunk px-2 font-mono text-[12.5px]">
                {p.urls.map((u) => <option key={u} value={u}>{u}</option>)}
              </select></label>
          )}
          {p.local && p.state === 'failed' && (
            <label className="block"><span className="text-[12px] text-muted">Couldn’t detect the network address. Laptop IP (run <code>ipconfig</code>, look for IPv4 under Wi-Fi):</span>
              <input value={p.manual} onChange={(e) => p.setManual(e.target.value)} placeholder="192.168.1.20" className="mt-1 h-9 w-full rounded-lg border border-line bg-sunk px-2 font-mono text-[12.5px]" /></label>
          )}
          {isInsecureLan(url) && (
            <span className="inline-flex items-start gap-1.5 rounded-xl bg-misconfig/12 px-2.5 py-1.5 text-[11.5px] text-misconfig"><ShieldAlert size={13} className="mt-0.5 shrink-0" />Insecure origin: crypto.subtle and service workers are unavailable. Deploy over https for full offline PWA. Approvals still work (pure-JS hashing).</span>
          )}
        </div>
      </div>
      <ul className="space-y-1 text-[12px] text-muted">
        <li className="flex items-center gap-1.5"><Wifi size={12} /> Phone and laptop on the same Wi-Fi/hotspot</li>
        <li>• Allow Node.js through the firewall (Private network)</li>
        <li>• Avoid college/guest Wi-Fi (client isolation blocks phone ↔ laptop)</li>
      </ul>
    </div>
  )
}
