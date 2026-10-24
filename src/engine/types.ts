export interface Row {
  day: string
  service: string
  region: string
  environment: string
  application: string
  cost: number
  injected?: string // scenario id when the row comes from inject.ts
}

export interface QuarantinedRow {
  line: number
  reason: string
  raw: string
}

export interface ParseResult {
  rows: Row[]
  quarantine: QuarantinedRow[]
  missingColumns: string[]
  fingerprint: string
  /** Exact repeated lines, dropped. */
  duplicates?: number
}

export interface DayPoint {
  day: string
  cost: number
}

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  id: string
  day: string
  cost: number
  baselineMedian: number
  mad: number
  z: number
  deltaPerDay: number
  severity: Severity
  moneyAtRisk: number
  /** 'total' = the whole bill jumped; 'service' = one service jumped inside a steady bill. */
  scope?: 'total' | 'service'
  service?: string
  /** 'spike' = a sudden jump; 'steady' = non-production spend that never switches off. */
  kind?: 'spike' | 'steady'
  remainingDays: number
  injected?: string
}

export interface DeltaNode {
  name: string
  delta: number
  share: number
  children?: DeltaNode[]
}

export interface Explanation {
  totalDelta: number
  tree: DeltaNode[]
  byService: DeltaNode[]
  byEnvironment: DeltaNode[]
  byApplication: DeltaNode[]
  byRegion: DeltaNode[]
  topPath: { service: string; environment: string; application: string }
  sentence: string
  /** Currency-neutral pieces so the UI can format amounts in the billing currency. */
  parts: { subject: string; add: number; total: number; share: number; steady?: boolean }
  hasNegativeLines: boolean
}

export type VerdictKind = 'Waste' | 'Misconfig' | 'Growth'
export type Confidence = 'High' | 'Medium' | 'Low'

export interface Verdict {
  kind: VerdictKind
  scores: Record<VerdictKind, number>
  confidence: Confidence
  margin: number
  features: {
    devShare: number
    prodShare: number
    networkShare: number
    untaggedShare: number
    sustained: number
    idleSignal: number
  }
  reasons: string[]
  wouldChange: string
}

export interface IdleResource {
  id: string
  service: string
  environment: string
  region: string
  avgCpu: number
  maxCpu: number
  daysIdle: number
  monthlyCost: number
  residual: number
  netSaving: number
  cpuSpark: number[]
  source: 'injected' | 'paired' | 'uploaded'
}
