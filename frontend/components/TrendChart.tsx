'use client'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts'
import type { TrendPoint } from '../types'
import s from './TrendChart.module.css'

interface Props {
  data: TrendPoint[]
}

function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
}

interface PayloadItem {
  color: string
  name: string
  value: number
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: PayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className={s.tooltip}>
      <div className={s.tooltipTitle}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} className={s.tooltipRow}>
          <span className={s.tooltipDot} style={{ background: entry.color }} />
          {entry.name}: <strong>{entry.value}</strong>
        </div>
      ))}
    </div>
  )
}

export default function TrendChart({ data }: Props) {
  if (data.length === 0) return null

  const chartData = data.map((d) => ({
    name: d.board_name.length > 18 ? d.board_name.slice(0, 16) + '...' : d.board_name,
    fullName: d.board_name,
    date: shortDate(d.created_at),
    'Открыто': d.open,
    'В работе': d.in_progress,
    'Выполнено': d.done,
  }))

  return (
    <div className={s.chartWrap}>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--md-outline-variant)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'var(--md-on-surface-variant)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--md-outline-variant)' }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'var(--md-on-surface-variant)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--md-surface-variant)', opacity: 0.5 }} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="Открыто" stackId="a" fill="#6750A4" radius={[0, 0, 0, 0]} />
          <Bar dataKey="В работе" stackId="a" fill="#E8760A" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Выполнено" stackId="a" fill="#006E1C" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
