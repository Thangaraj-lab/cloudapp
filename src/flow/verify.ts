import { useEffect } from 'react'
import { useStore } from '../store'
import { measure } from '../engine/ledger'

/** Re-measures every applied action whenever billing data changes. */
export function useAutoVerify() {
  const rows = useStore((s) => s.rows)
  const ledger = useStore((s) => s.ledger)
  useEffect(() => {
    const s = useStore.getState()
    for (const e of ledger) {
      if (e.status !== 'applied') continue
      const m = measure(rows, e)
      if (!m) continue
      const status = m.verdict === 'verified' ? 'verified' : m.verdict === 'inconclusive' ? 'inconclusive' : 'not-effective'
      s.updateAction(e.id, { measurement: m, status })
      s.setStatus(e.findingId, status)
      s.log('saving measured', { actionId: e.id, result: m.verdict, beforeDaily: +m.beforeDaily.toFixed(4), afterDaily: +m.afterDaily.toFixed(4), noise: +m.noise.toFixed(4), monthlySaving: +m.monthlySaving.toFixed(2) })
    }
  }, [rows, ledger])
}
