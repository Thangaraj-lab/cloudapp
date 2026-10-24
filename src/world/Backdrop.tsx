// Faint decorative estate behind the Welcome screen. It carries no numbers:
// there is no data yet, so it shows only the shape of what the product draws.
import { useRef } from 'react'
import { Stage } from './Stage'
import { EstateScene } from './Estate'
import { buildEstate } from './model'
import { useTier } from './quality'
import type { Row } from '../engine/types'

const SHAPES: [string, number][] = [
  ['Compute', 9], ['Database', 4], ['Object storage', 2], ['Gateway', 1.5], ['Functions', 1], ['Monitoring', 0.6], ['Queue', 0.3], ['Cache', 0.8], ['Container cluster', 3],
]
const rows: Row[] = SHAPES.map(([service, cost]) => ({ day: '2000-01-01', service, region: 'region', environment: 'prod', application: 'app', cost }))
const estate = buildEstate(rows, '2000-01-01', [], {})

export default function Backdrop() {
  const tier = useTier()
  const host = useRef<HTMLDivElement>(null)
  if (!tier || tier === 'none') return null
  return (
    <div className="absolute inset-0">
      <Stage tier={tier === 'high' ? 'medium' : tier} shot={{ pos: [14, 11, 18], target: [0, 0, 3] }} controls={false}>
        <EstateScene estate={estate} labelHost={host} labelMode="none" account="" />
      </Stage>
      <div ref={host} className="hidden" />
    </div>
  )
}
