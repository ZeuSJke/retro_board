'use client'

import { memo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TrendPoint } from '../types'

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
  payload?: { fullName?: string; date?: string }
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: PayloadItem[]
}) {
  if (!active || !payload?.length) return null
  const meta = payload[0]?.payload
  return (
    <div className="rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-semibold">
        {meta?.fullName || meta?.date}
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <strong className="font-mono">{entry.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

export default memo(function TrendChart({ data }: Props) {
  if (data.length === 0) return null

  const chartData = data
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((d) => ({
      name: d.board_name.length > 16 ? `${d.board_name.slice(0, 14)}…` : d.board_name,
      fullName: d.board_name,
      date: shortDate(d.created_at),
      Открыто: d.open,
      'В работе': d.in_progress,
      Выполнено: d.done,
    }))

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.5)' }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Открыто" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} />
          <Bar dataKey="В работе" stackId="a" fill="#3B82F6" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Выполнено" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
})
