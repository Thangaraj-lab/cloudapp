import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { LineChart, ScatterChart, TreemapChart, BarChart, SunburstChart, HeatmapChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, LegendComponent, CalendarComponent, VisualMapComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { useStore } from '../store'

// Only the chart pieces the app uses; this module loads with the screens that draw charts.
echarts.use([LineChart, ScatterChart, TreemapChart, BarChart, SunburstChart, HeatmapChart, PieChart, GridComponent, TooltipComponent, MarkLineComponent, MarkAreaComponent, MarkPointComponent, LegendComponent, CalendarComponent, VisualMapComponent, SVGRenderer])

export function Chart({ option, height = 280, onEvents }: { option: object; height?: number; onEvents?: Record<string, (p: never) => void> }) {
  const theme = useStore((s) => s.theme)
  return <ReactEChartsCore echarts={echarts} key={theme} option={option} style={{ height }} notMerge onEvents={onEvents} opts={{ renderer: 'svg' }} />
}
