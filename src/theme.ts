import type { VerdictKind } from './engine/types'

export const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim()

export const verdictVar: Record<VerdictKind, string> = { Waste: 'waste', Misconfig: 'misconfig', Growth: 'growth' }

export function chartColors() {
  return {
    text: cssVar('text'), muted: cssVar('muted'), border: cssVar('border'), panel: cssVar('panel-solid'), sunk: cssVar('sunk'),
    accent: cssVar('accent'), deep: cssVar('deep'), waste: cssVar('waste'), misconfig: cssVar('misconfig'), growth: cssVar('growth'), neutral: cssVar('neutral'),
  }
}

/** Series palette for many services: emerald → teal → mint → sage, ending in neutral. */
export function seriesPalette() {
  const c = chartColors()
  const dark = document.documentElement.dataset.theme !== 'light'
  return dark
    ? [c.accent, '#3FB8AF', '#8FD9C4', '#4E8F7E', '#C9E9DF', '#2E6B5D', c.neutral]
    : [c.accent, '#0E8C86', '#3BAA8C', '#0C4137', '#7FBFAD', '#5A7F76', c.neutral]
}
