export interface Policy {
  autoApply: boolean
  maxActionCostPerDay: number
  blockProd: boolean
  requireRollbackPlan: boolean
}

export const DEFAULT_POLICY: Policy = {
  autoApply: false,
  maxActionCostPerDay: 50,
  blockProd: true,
  requireRollbackPlan: true,
}

export type PolicyDecision = { result: 'allow' | 'needs-approval' | 'deny'; reasons: string[]; needsSecond: boolean }

export function evaluate(
  p: Policy,
  ctx: { environment: string; dailyCost: number; hasRollback: boolean; fmt?: (n: number) => string },
): PolicyDecision {
  const fmt = ctx.fmt ?? ((n: number) => n.toFixed(2))
  if (p.blockProd && /^prod/i.test(ctx.environment))
    return { result: 'deny', needsSecond: false, reasons: ['Your policy never changes production-tagged resources. Hand this one to the owning team.'] }
  if (p.requireRollbackPlan && !ctx.hasRollback)
    return { result: 'deny', needsSecond: false, reasons: ['Your policy requires a rollback plan, and none is available for this change.'] }
  const reasons: string[] = []
  const needsSecond = ctx.dailyCost > p.maxActionCostPerDay
  if (needsSecond) reasons.push(`This change affects about ${fmt(ctx.dailyCost)}/day, above your ${fmt(p.maxActionCostPerDay)}/day limit, so a second approver must sign too.`)
  const autoOk = p.autoApply && /^(dev|test)$/i.test(ctx.environment)
  if (autoOk && !needsSecond) return { result: 'allow', needsSecond, reasons: ['Your policy lets dev/test changes go ahead without sign-off.'] }
  reasons.push('Approve-first: a named person signs every change.')
  return { result: 'needs-approval', needsSecond, reasons }
}
