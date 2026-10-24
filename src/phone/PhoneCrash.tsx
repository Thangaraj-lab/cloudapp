import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'
import { clientLog } from '../flow/backend'

/** A screen that failed to render on the phone: report it to the laptop and offer a way back. */
export function PhoneCrash() {
  const err = useRouteError() as Error | undefined
  useEffect(() => {
    clientLog('render error', { message: String(err?.message ?? err).slice(0, 300), stack: String(err?.stack ?? '').slice(0, 900), path: location.hash.slice(0, 80) })
  }, [err])
  return (
    <div className="mx-auto max-w-[520px] space-y-3 p-6">
      <h1 className="text-[22px] font-extrabold">This screen could not open</h1>
      <p className="text-[14px] text-muted">The problem was sent to the laptop. {String(err?.message ?? '')}</p>
      <button className="h-11 w-full rounded-[10px] bg-accent font-semibold text-[var(--accent-ink)]" onClick={() => { location.hash = '#/m'; location.reload() }}>Back to the phone home</button>
    </div>
  )
}
