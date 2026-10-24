// Data → scene mapper. Nothing in the Estate World is hand-placed: every platform,
// building, beam and colour comes from the billing rows and the engine's findings.
import type { Analyzed } from '../engine/analyze'
import type { Row } from '../engine/types'
import { addDays } from '../engine/series'

export type Category = 'compute' | 'database' | 'storage' | 'network' | 'serverless' | 'other'
export type Health = 'neutral' | 'waste' | 'misconfig' | 'growth' | 'verified'

export interface Building {
  id: string // service|region
  service: string
  region: string
  category: Category
  cost: number // spend on the viewed day
  total: number // spend over the whole window
  share: number // share of the viewed day's total
  height: number
  ghost: number // highest height in the 7 days before (ghost trail)
  env: string // dominant environment by spend
  envMix: { env: string; share: number }[]
  health: Health
  injected: boolean
  pos: [number, number, number]
  anomaly: boolean // flagged on the viewed day
}
export interface Platform { region: string; pos: [number, number, number]; size: [number, number]; buildings: Building[] }
export interface Estate { platforms: Platform[]; buildings: Building[]; dayTotal: number; date: string; maxDay: number }

export function categoryOf(service: string): Category {
  const s = service.toLowerCase()
  if (/rds|relational|dynamo|database|sql|aurora|elasticache|redshift|cosmos|bigtable|spanner|documentdb|neptune/.test(s)) return 'database'
  if (/s3|simple storage|ebs|block store|glacier|backup|storage|efs|file system|blob|disk/.test(s)) return 'storage'
  if (/nat|vpc|virtual private|load balanc|cloudfront|route ?53|api gateway|direct connect|transfer|network|cdn|gateway/.test(s)) return 'network'
  if (/lambda|functions|fargate|cloud run|step functions|sqs|queue|sns|eventbridge|serverless/.test(s)) return 'serverless'
  if (/ec2|elastic compute|compute engine|virtual machine|\bvm|eks|aks|gke|kubernetes|container|batch/.test(s)) return 'compute'
  return 'other'
}

/** Height on a log scale so a $0.01 service and a $50 service are both visible. Labelled in the UI. */
export const heightFor = (cost: number, max: number) => (max <= 0 ? 0.2 : 0.22 + 3.1 * (Math.log1p(cost / (max * 0.002)) / Math.log1p(500)))

const SPACING = 1.7

export function buildEstate(rows: Row[], date: string, cases: Analyzed[], status: Record<string, string>, excluded: string[] = []): Estate {
  // No billing data on this device (e.g. a phone used only to approve): an empty estate.
  if (!date || !rows.length) return { platforms: [], buildings: [], dayTotal: 0, date, maxDay: 1 }
  const ex = new Set(excluded)
  const win = addDays(date, -6)
  const day = new Map<string, number>(), total = new Map<string, number>(), ghost = new Map<string, number[]>()
  const env = new Map<string, Map<string, number>>()
  const injected = new Set<string>()
  const regionOf = new Map<string, string>()
  for (const r of rows) {
    if (ex.has(r.service) || r.day > date) continue
    const k = r.service + '|' + r.region
    regionOf.set(k, r.region)
    total.set(k, (total.get(k) ?? 0) + r.cost)
    if (r.injected && r.injected !== 'base') injected.add(k)
    if (r.day === date) day.set(k, (day.get(k) ?? 0) + r.cost)
    if (r.day >= win && r.day < date) {
      const g = ghost.get(k) ?? []
      g.push(r.cost)
      ghost.set(k, g)
    }
    if (r.day >= win) {
      const m = env.get(k) ?? new Map()
      m.set(r.environment, (m.get(r.environment) ?? 0) + r.cost)
      env.set(k, m)
    }
  }
  const keys = [...total.keys()].sort((a, b) => total.get(b)! - total.get(a)!)
  const dayTotal = [...day.values()].reduce((a, b) => a + b, 0)
  const maxDay = Math.max(...keys.map((k) => Math.max(day.get(k) ?? 0, ...(ghost.get(k) ?? [0]))), 1e-9)

  // Health from the engine's cases that touch this service and are visible on this date.
  const health = new Map<string, Health>()
  const anomaly = new Set<string>()
  for (const c of cases) {
    if (c.finding.day > date) continue
    const svc = c.explanation.topPath.service
    const st = status[c.finding.id]
    const h: Health = st === 'verified' || st === 'applied' ? 'verified' : c.verdict.kind === 'Waste' ? 'waste' : c.verdict.kind === 'Misconfig' ? 'misconfig' : 'growth'
    const live = c.state.ongoing || (c.state.stoppedOn ?? '') > date
    if (!live && h !== 'verified') continue
    for (const k of keys) if (k.startsWith(svc + '|')) { if (!health.has(k) || h === 'waste') health.set(k, h); if (c.finding.day === date) anomaly.add(k) }
  }

  const byRegion = new Map<string, string[]>()
  for (const k of keys) { const r = regionOf.get(k)!; byRegion.set(r, [...(byRegion.get(r) ?? []), k]) }
  const regions = [...byRegion.keys()].sort((a, b) => byRegion.get(b)!.length - byRegion.get(a)!.length)
  const platforms: Platform[] = []
  const all: Building[] = []
  // Biggest region centred in front of the hub; the others alternate left and right of it.
  const sizes = regions.map((region) => {
    const n = byRegion.get(region)!.length
    const cols = Math.ceil(Math.sqrt(n * 1.4))
    const rowsN = Math.ceil(n / cols)
    return { cols, rowsN, size: [cols * SPACING + 0.9, rowsN * SPACING + 0.9] as [number, number] }
  })
  let left = -sizes[0]?.size[0] / 2, right = sizes[0]?.size[0] / 2
  regions.forEach((region, ri) => {
    const ks = byRegion.get(region)!
    const { cols, rowsN, size } = sizes[ri]
    let x = 0
    if (ri > 0) {
      if (ri % 2) { x = right + 0.8 + size[0] / 2; right = x + size[0] / 2 } else { x = left - 0.8 - size[0] / 2; left = x - size[0] / 2 }
    }
    const pos: [number, number, number] = [x, 0, 3.2 + sizes[0].size[1] / 2]
    const buildings = ks.map((k, i) => {
      const [service] = k.split('|')
      const cx = (i % cols) - (cols - 1) / 2
      const cz = Math.floor(i / cols) - (rowsN - 1) / 2
      const m = env.get(k) ?? new Map<string, number>()
      const envTotal = [...m.values()].reduce((a, b) => a + b, 0) || 1
      const envMix = [...m.entries()].map(([e, v]) => ({ env: e, share: v / envTotal })).sort((a, b) => b.share - a.share)
      const cost = day.get(k) ?? 0
      const b: Building = {
        id: k, service, region, category: categoryOf(service), cost, total: total.get(k)!, share: dayTotal ? cost / dayTotal : 0,
        height: heightFor(cost, maxDay), ghost: heightFor(Math.max(0, ...(ghost.get(k) ?? [0])), maxDay),
        env: envMix[0]?.env ?? 'untagged', envMix, health: health.get(k) ?? 'neutral', injected: injected.has(k),
        pos: [pos[0] + cx * SPACING, 0, pos[2] + cz * SPACING], anomaly: anomaly.has(k),
      }
      return b
    })
    platforms.push({ region, pos, size, buildings })
    all.push(...buildings)
  })
  return { platforms, buildings: all, dayTotal, date, maxDay }
}
