import { Chart } from './Chart'
import { chartColors, seriesPalette } from '../theme'
import { shortService } from '../engine/explain'
import type { BaselinePoint } from '../engine/detect'
import type { DeltaNode, IdleResource } from '../engine/types'

type Fmt = (n: number, digits?: number) => string
type C = ReturnType<typeof chartColors>
const axis = (c: C) => ({ axisLine: { lineStyle: { color: c.border } }, axisTick: { show: false }, axisLabel: { color: c.muted, fontSize: 11 }, splitLine: { lineStyle: { color: c.border, opacity: 0.6 } } })
const tip = (c: C) => ({ backgroundColor: c.panel, borderColor: c.border, textStyle: { color: c.text, fontSize: 12 }, extraCssText: 'border-radius:12px;box-shadow:0 10px 30px -12px rgba(0,0,0,.4)' })
const md = (d: string) => d.slice(5)

/** Daily cost with the normal band (median ± MAD), anomaly markers and the Time Machine day. */
export function BaselineChart({ points, fmt, height = 260, asOf, anomalies = [], focus, label = 'Daily cost' }: { points: BaselinePoint[]; fmt: Fmt; height?: number; asOf?: string; anomalies?: string[]; focus?: string; label?: string }) {
  const c = chartColors()
  const lo = points.map((p) => (p.median === null ? null : Math.max(0, p.median - (p.mad ?? 0))))
  const band = points.map((p, i) => (p.median === null ? null : p.median + (p.mad ?? 0) - (lo[i] ?? 0)))
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 14, top: 18, bottom: 26 },
      tooltip: { trigger: 'axis', ...tip(c), formatter: (ps: { dataIndex: number }[]) => { const p = points[ps[0].dataIndex]; return `${p.day}<br/>${label}: <b>${fmt(p.cost)}</b>${p.median !== null ? `<br/>Normal: ${fmt(p.median)}${p.z !== null ? ` · z ${p.z.toFixed(1)}` : ''}` : '<br/>Learning normal'}` } },
      xAxis: { type: 'category', data: points.map((p) => p.day), ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: md } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        { type: 'line', data: lo, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, silent: true },
        { type: 'line', data: band, stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color: c.accent, opacity: 0.14 }, silent: true, name: 'Normal range' },
        { type: 'line', data: points.map((p) => p.median), symbol: 'none', lineStyle: { color: c.accent, width: 1, type: 'dashed', opacity: 0.7 }, silent: true },
        {
          type: 'line', data: points.map((p) => p.cost), symbol: 'circle', symbolSize: (_: number, p: { dataIndex: number }) => (anomalies.includes(points[p.dataIndex].day) ? 9 : 0),
          itemStyle: { color: (p: { dataIndex: number }) => (anomalies.includes(points[p.dataIndex].day) ? c.waste : c.text) }, lineStyle: { color: c.text, width: 1.8 },
          markLine: asOf ? { silent: true, symbol: 'none', lineStyle: { color: c.accent, type: 'solid', width: 1.5 }, label: { show: false }, data: [{ xAxis: asOf }] } : undefined,
          markArea: focus ? { silent: true, itemStyle: { color: c.waste, opacity: 0.08 }, data: [[{ xAxis: focus }, { xAxis: focus }]] } : { silent: true, itemStyle: { color: c.text, opacity: 0.04 }, data: [[{ xAxis: points[0]?.day }, { xAxis: points[Math.min(6, points.length - 1)]?.day }]] },
        },
      ],
    }} />
  )
}

export function StackedTrend({ days, series, fmt, height = 300, asOf, onPick, projection }: { days: string[]; series: { name: string; values: number[] }[]; fmt: Fmt; height?: number; asOf?: string; onPick?: (name: string) => void; projection?: { days: string[]; doNothing: number[]; applyFix: number[] } }) {
  const c = chartColors()
  const pal = seriesPalette()
  const all = projection ? [...days, ...projection.days] : days
  return (
    <Chart height={height} onEvents={onPick ? { click: (p: { seriesName: string; seriesIndex: number }) => { const s = series[p.seriesIndex]; if (s) onPick(s.name) } } : undefined} option={{
      grid: { left: 52, right: 14, top: 36, bottom: 26 },
      legend: { top: 0, type: 'scroll', textStyle: { color: c.muted, fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, pageTextStyle: { color: c.muted } },
      tooltip: { trigger: 'axis', ...tip(c), valueFormatter: (v: number) => (v == null ? '' : fmt(v)) },
      xAxis: { type: 'category', data: all, ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: md } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        ...series.map((s, i) => ({
          name: shortService(s.name), type: 'line', stack: 'all', data: s.values, showSymbol: false, smooth: 0.15, emphasis: { focus: 'series' },
          lineStyle: { width: 1, color: pal[i % pal.length] }, itemStyle: { color: pal[i % pal.length] }, areaStyle: { opacity: 0.5, color: pal[i % pal.length] },
          markLine: i === 0 && asOf ? { silent: true, symbol: 'none', lineStyle: { color: c.text, type: 'dashed', opacity: 0.5 }, label: { show: false }, data: [{ xAxis: asOf }] } : undefined,
        })),
        ...(projection ? [
          { name: 'Projection · do nothing', type: 'line', data: [...days.map(() => null), ...projection.doNothing], showSymbol: false, lineStyle: { type: 'dashed', color: c.waste, width: 1.6 }, itemStyle: { color: c.waste } },
          { name: 'Projection · apply fix', type: 'line', data: [...days.map(() => null), ...projection.applyFix], showSymbol: false, lineStyle: { type: 'dashed', color: c.growth, width: 1.6 }, itemStyle: { color: c.growth } },
        ] : []),
      ],
    }} />
  )
}

/** Daily total + dashed projection lines (do nothing vs apply fix). */
export function ForecastChart({ days, actual, projection, fmt, height = 240 }: { days: string[]; actual: number[]; projection: { days: string[]; doNothing: number[]; applyFix: number[] }; fmt: Fmt; height?: number }) {
  const c = chartColors()
  const all = [...days, ...projection.days]
  const join = (xs: number[]) => [...days.map((_, i) => (i === days.length - 1 ? actual[i] : null)), ...xs]
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 14, top: 30, bottom: 26 },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
      tooltip: { trigger: 'axis', ...tip(c), valueFormatter: (v: number) => (v == null ? '' : fmt(v)) },
      xAxis: { type: 'category', data: all, ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: md } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        { name: 'Actual', type: 'line', data: [...actual, ...projection.days.map(() => null)], showSymbol: false, lineStyle: { color: c.text, width: 1.8 }, itemStyle: { color: c.text } },
        { name: 'Projection · do nothing', type: 'line', data: join(projection.doNothing), showSymbol: false, lineStyle: { type: 'dashed', color: c.waste }, itemStyle: { color: c.waste } },
        { name: 'Projection · apply fix', type: 'line', data: join(projection.applyFix), showSymbol: false, lineStyle: { type: 'dashed', color: c.growth }, itemStyle: { color: c.growth }, areaStyle: { color: c.growth, opacity: 0.06 } },
      ],
    }} />
  )
}

export interface TreeNode { name: string; value?: number; children?: TreeNode[] }
export function SpendTreemap({ data, fmt, height = 300, onPick }: { data: TreeNode[]; fmt: Fmt; height?: number; onPick?: (service: string) => void }) {
  const c = chartColors()
  const pal = seriesPalette()
  return (
    <Chart height={height} onEvents={{ click: (p: { treePathInfo?: { name: string }[] }) => { const s = p.treePathInfo?.[1]?.name; if (s && onPick) onPick(s) } }} option={{
      tooltip: { ...tip(c), formatter: (p: { treePathInfo: { name: string }[]; value: number }) => `${p.treePathInfo.slice(1).map((x) => x.name).join(' › ')}<br/><b>${fmt(p.value, 2)}</b>` },
      series: [{
        type: 'treemap', data, roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '100%',
        label: { color: '#04211B', fontSize: 12, fontWeight: 600, formatter: (p: { name: string; value: number }) => `${shortService(p.name)}\n${fmt(p.value, 0)}` },
        upperLabel: { show: true, height: 20, color: '#04211B', fontSize: 11, fontWeight: 700 },
        itemStyle: { borderColor: c.panel, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }, { color: pal, itemStyle: { gapWidth: 2 } }, { colorSaturation: [0.35, 0.6], itemStyle: { gapWidth: 1 } }],
      }],
    }} />
  )
}

/** Pareto: services sorted by spend with the cumulative share line. */
export function Pareto({ items, fmt, height = 240 }: { items: { name: string; value: number }[]; fmt: Fmt; height?: number }) {
  const c = chartColors()
  const total = items.reduce((s, x) => s + x.value, 0) || 1
  let run = 0
  const cum = items.map((x) => ((run += x.value) / total) * 100)
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 40, top: 16, bottom: 52 },
      tooltip: { trigger: 'axis', ...tip(c) },
      xAxis: { type: 'category', data: items.map((x) => shortService(x.name)), ...axis(c), axisLabel: { ...axis(c).axisLabel, rotate: 35, fontSize: 10 } },
      yAxis: [{ type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } }, { type: 'value', max: 100, ...axis(c), splitLine: { show: false }, axisLabel: { ...axis(c).axisLabel, formatter: '{value}%' } }],
      series: [
        { type: 'bar', data: items.map((x) => x.value), itemStyle: { color: c.accent, borderRadius: [4, 4, 0, 0] }, tooltip: { valueFormatter: (v: number) => fmt(v) } },
        { type: 'line', yAxisIndex: 1, data: cum, symbolSize: 4, lineStyle: { color: c.text, width: 1.4 }, itemStyle: { color: c.text }, tooltip: { valueFormatter: (v: number) => v.toFixed(0) + '%' } },
      ],
    }} />
  )
}

export function CalendarHeat({ points, fmt, height = 170, anomalies = [] }: { points: { day: string; cost: number }[]; fmt: Fmt; height?: number; anomalies?: string[] }) {
  const c = chartColors()
  if (!points.length) return null
  const max = Math.max(...points.map((p) => p.cost))
  return (
    <Chart height={height} option={{
      tooltip: { ...tip(c), formatter: (p: { value: [string, number] }) => `${p.value[0]}<br/><b>${fmt(p.value[1])}</b>${anomalies.includes(p.value[0]) ? '<br/>Unusual day' : ''}` },
      visualMap: { show: false, min: 0, max, inRange: { color: [c.sunk || '#0c2e27', c.accent] } },
      calendar: { range: [points[0].day, points.at(-1)!.day], cellSize: ['auto', 18], top: 24, left: 30, right: 10, orient: 'horizontal', itemStyle: { borderColor: c.panel, borderWidth: 3, color: 'transparent' }, splitLine: { show: false }, dayLabel: { color: c.muted, fontSize: 10, firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] }, monthLabel: { color: c.muted, fontSize: 11 }, yearLabel: { show: false } },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: points.map((p) => [p.day, p.cost]), itemStyle: { borderRadius: 4, borderColor: (p: { value: [string] }) => (anomalies.includes(p.value[0]) ? c.waste : 'transparent') } }],
    }} />
  )
}

export function Ring({ value, label, color = 'var(--accent)', size = 96 }: { value: number; label: string; color?: string; size?: number }) {
  const r = size / 2 - 7, circ = 2 * Math.PI * r
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90"><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunk)" strokeWidth="7" /><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, Math.min(1, value)))} /></svg>
      <div className="absolute text-center"><div className="num font-display text-[20px] font-extrabold leading-none">{Math.round(value * 100)}%</div><div className="mt-0.5 text-[10px] text-muted">{label}</div></div>
    </div>
  )
}

/** Where the jump came from: Service → Environment → Application. */
export function DeltaSunburst({ tree, fmt, height = 300 }: { tree: DeltaNode[]; fmt: Fmt; height?: number }) {
  const c = chartColors()
  const pal = seriesPalette()
  const map = (n: DeltaNode, i: number): object => ({ name: shortService(n.name), value: Math.max(0, n.delta), itemStyle: i >= 0 ? { color: pal[i % pal.length] } : undefined, children: n.children?.filter((x) => x.delta > 0).map((x) => map(x, -1)) })
  return (
    <Chart height={height} option={{
      tooltip: { ...tip(c), formatter: (p: { treePathInfo: { name: string }[]; value: number }) => `${p.treePathInfo.slice(1).map((x) => x.name).join(' › ')}<br/>+${fmt(p.value)}/day` },
      series: [{
        type: 'sunburst', radius: ['18%', '92%'], nodeClick: false, sort: undefined, data: tree.filter((n) => n.delta > 0).map((n, i) => map(n, i)),
        label: { color: '#04211B', fontSize: 11, minAngle: 12, rotate: 'radial' }, itemStyle: { borderColor: c.panel, borderWidth: 2 },
        levels: [{}, { label: { fontWeight: 700 } }, { itemStyle: { opacity: 0.8 } }, { itemStyle: { opacity: 0.65 }, label: { fontSize: 10 } }],
      }],
    }} />
  )
}

/** Waterfall: normal → top contributors → the new total. */
export function Waterfall({ base, parts, total, fmt, height = 260 }: { base: number; parts: { name: string; delta: number }[]; total: number; fmt: Fmt; height?: number }) {
  const c = chartColors()
  const cats = ['Normal', ...parts.map((p) => shortService(p.name)), 'Unusual day']
  const helper: (number | string)[] = [0], up: (number | string)[] = [base], down: (number | string)[] = ['-']
  let run = base
  for (const p of parts) {
    if (p.delta >= 0) { helper.push(run); up.push(p.delta); down.push('-'); run += p.delta }
    else { run += p.delta; helper.push(run); up.push('-'); down.push(-p.delta) }
  }
  helper.push(0); up.push(total); down.push('-')
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 12, top: 14, bottom: 50 },
      tooltip: { trigger: 'axis', ...tip(c), formatter: (ps: { name: string; value: number | string; seriesName: string }[]) => ps.filter((p) => p.seriesName !== 'h' && p.value !== '-').map((p) => `${p.name}: <b>${p.seriesName === 'down' ? '−' : ''}${fmt(Number(p.value))}</b>`).join('<br/>') },
      xAxis: { type: 'category', data: cats, ...axis(c), axisLabel: { ...axis(c).axisLabel, interval: 0, rotate: 25, fontSize: 10 } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        { name: 'h', type: 'bar', stack: 'w', data: helper, itemStyle: { color: 'transparent' }, silent: true },
        { name: 'up', type: 'bar', stack: 'w', data: up, itemStyle: { color: (p: { dataIndex: number }) => (p.dataIndex === 0 ? c.neutral : p.dataIndex === cats.length - 1 ? c.text : c.waste), borderRadius: 4 } },
        { name: 'down', type: 'bar', stack: 'w', data: down, itemStyle: { color: c.growth, borderRadius: 4 } },
      ],
    }} />
  )
}

export function IdleScatter({ items, fmt, height = 280, onPick }: { items: IdleResource[]; fmt: Fmt; height?: number; onPick?: (id: string) => void }) {
  const c = chartColors()
  return (
    <Chart height={height} onEvents={onPick ? { click: (p: { data: { name: string } }) => onPick(p.data.name) } : undefined} option={{
      grid: { left: 56, right: 16, top: 16, bottom: 40 },
      tooltip: { ...tip(c), formatter: (p: { data: { name: string; value: [number, number] } }) => `${p.data.name}<br/>CPU ${p.data.value[0].toFixed(1)}% · ${fmt(p.data.value[1], 0)}/mo` },
      xAxis: { type: 'value', name: 'Average CPU %', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: c.muted }, min: 0, ...axis(c) },
      yAxis: { type: 'value', name: 'Monthly cost', nameTextStyle: { color: c.muted }, ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [{
        type: 'scatter', symbolSize: 11,
        data: items.map((r) => ({ name: r.id, value: [r.avgCpu, r.monthlyCost], itemStyle: { color: r.source === 'injected' ? c.misconfig : c.waste, opacity: 0.85 } })),
        markArea: { silent: true, itemStyle: { color: c.waste, opacity: 0.06 }, data: [[{ xAxis: 0 }, { xAxis: 5 }]] },
      }],
    }} />
  )
}

/** Before / after a change, with the change day marked. */
export function BeforeAfter({ days, values, changeDay, fmt, height = 220, simulatedFrom }: { days: string[]; values: number[]; changeDay: string; fmt: Fmt; height?: number; simulatedFrom?: string }) {
  const c = chartColors()
  const simIdx = simulatedFrom ? days.indexOf(simulatedFrom) : -1
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 12, top: 16, bottom: 26 },
      tooltip: { trigger: 'axis', ...tip(c), valueFormatter: (v: number) => (v == null ? '' : fmt(v)) },
      xAxis: { type: 'category', data: days, ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: md } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        { type: 'line', data: values.map((v, i) => (simIdx >= 0 && i > simIdx ? null : v)), showSymbol: false, lineStyle: { color: c.text, width: 1.8 }, itemStyle: { color: c.text }, areaStyle: { color: c.text, opacity: 0.05 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: c.accent, width: 1.5 }, label: { formatter: 'change', color: c.accent, fontSize: 10 }, data: [{ xAxis: changeDay }] } },
        ...(simIdx >= 0 ? [{ type: 'line', data: values.map((v, i) => (i >= simIdx ? v : null)), showSymbol: false, lineStyle: { color: c.growth, width: 1.8, type: 'dashed' }, itemStyle: { color: c.growth } }] : []),
      ],
    }} />
  )
}

/** Histogram of simulated peak CPU (What-if dot cloud alternative for small screens). */
export function DotCloud({ peaks, ceiling = 80, height = 160 }: { peaks: number[]; ceiling?: number; height?: number }) {
  const c = chartColors()
  const pts = peaks.slice(0, 300).map((p, i) => [p, ((i * 37) % 100) / 100])
  return (
    <Chart height={height} option={{
      grid: { left: 36, right: 12, top: 10, bottom: 26 },
      xAxis: { type: 'value', min: 0, max: Math.max(100, ...peaks.map((p) => Math.ceil(p / 10) * 10)), ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: '{value}%' } },
      yAxis: { type: 'value', show: false, min: -0.1, max: 1.1 },
      series: [{
        type: 'scatter', symbolSize: 5, data: pts, itemStyle: { color: (p: { value: [number] }) => (p.value[0] > ceiling ? c.waste : c.accent), opacity: 0.75 }, silent: true,
        markLine: { silent: true, symbol: 'none', lineStyle: { color: c.waste, type: 'dashed' }, label: { formatter: `${ceiling}% limit`, color: c.muted, fontSize: 10 }, data: [{ xAxis: ceiling }] },
      }],
    }} />
  )
}

/** Cumulative verified savings. */
export function Cumulative({ points, fmt, height = 220 }: { points: { label: string; value: number; simulated?: boolean }[]; fmt: Fmt; height?: number }) {
  const c = chartColors()
  let run = 0
  const cum = points.map((p) => (run += p.value))
  return (
    <Chart height={height} option={{
      grid: { left: 56, right: 12, top: 16, bottom: 30 },
      tooltip: { trigger: 'axis', ...tip(c), valueFormatter: (v: number) => fmt(v, 0) + '/mo' },
      xAxis: { type: 'category', data: points.map((p) => p.label), ...axis(c) },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [{ type: 'line', step: 'end', data: cum, symbolSize: 7, lineStyle: { color: c.growth, width: 2 }, itemStyle: { color: c.growth }, areaStyle: { color: c.growth, opacity: 0.1 } }],
    }} />
  )
}

/** Ghost twin curves: actual vs with the rule on. */
export function TwinCurves({ days, actual, withRule, fmt, height = 240, asOf }: { days: string[]; actual: number[]; withRule: number[]; fmt: Fmt; height?: number; asOf?: string }) {
  const c = chartColors()
  return (
    <Chart height={height} option={{
      grid: { left: 52, right: 12, top: 30, bottom: 26 },
      legend: { top: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
      tooltip: { trigger: 'axis', ...tip(c), valueFormatter: (v: number) => fmt(v) },
      xAxis: { type: 'category', data: days, ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: md } },
      yAxis: { type: 'value', ...axis(c), axisLabel: { ...axis(c).axisLabel, formatter: (v: number) => fmt(v, 0) } },
      series: [
        { name: 'What happened', type: 'line', data: actual, showSymbol: false, lineStyle: { color: c.text, width: 1.8 }, itemStyle: { color: c.text },
          markLine: asOf ? { silent: true, symbol: 'none', lineStyle: { color: c.accent }, label: { show: false }, data: [{ xAxis: asOf }] } : undefined },
        { name: 'With the rule on (ghost twin)', type: 'line', data: withRule, showSymbol: false, lineStyle: { color: c.accent, width: 1.8, type: 'dashed' }, itemStyle: { color: c.accent }, areaStyle: { color: c.accent, opacity: 0.08 } },
      ],
    }} />
  )
}

export function Bars({ items, fmt, height = 200, color }: { items: { name: string; value: number }[]; fmt: Fmt; height?: number; color?: string }) {
  const c = chartColors()
  return (
    <Chart height={height} option={{
      grid: { left: 110, right: 50, top: 6, bottom: 6 },
      xAxis: { type: 'value', show: false },
      yAxis: { type: 'category', inverse: true, data: items.map((x) => shortService(x.name)), ...axis(c), axisLine: { show: false } },
      tooltip: { ...tip(c), valueFormatter: (v: number) => fmt(v) },
      series: [{ type: 'bar', data: items.map((x) => x.value), barWidth: 12, itemStyle: { color: color ?? c.accent, borderRadius: 6 }, label: { show: true, position: 'right', color: c.muted, fontSize: 11, formatter: (p: { value: number }) => fmt(p.value) } }],
    }} />
  )
}
