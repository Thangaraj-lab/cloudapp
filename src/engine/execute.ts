export const STEPS = [
  'Pre-check (policy + stale approval)',
  'Snapshot / backup tag',
  'Start replacement path (make-before-break)',
  'Health check passes',
  'Switch / stop original',
  'Verify metrics',
  'Done',
]

export type SagaEvent = { step: number; label: string; status: 'ok' | 'failed' | 'rolled-back' }

/** Pure saga plan: the UI replays these events with timing. failAt is 1-based. */
export function plan(failAt?: number): { events: SagaEvent[]; outcome: 'done' | 'rolled-back' } {
  const events: SagaEvent[] = []
  for (let i = 0; i < STEPS.length; i++) {
    if (failAt && i + 1 === failAt) {
      events.push({ step: i, label: STEPS[i], status: 'failed' })
      for (let j = i - 1; j >= 0; j--) events.push({ step: j, label: 'Undo: ' + STEPS[j], status: 'rolled-back' })
      return { events, outcome: 'rolled-back' }
    }
    events.push({ step: i, label: STEPS[i], status: 'ok' })
  }
  return { events, outcome: 'done' }
}
