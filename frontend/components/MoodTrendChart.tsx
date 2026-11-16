'use client'

import { memo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MoodTrendPoint } from '../types'
import { buildBoardAxis, sortBoardPoints } from './dashboard/chartLabels'

interface Props {
  data: MoodTrendPoint[]
}

interface PayloadItem {
  value?: number
  payload?: {
    fullName?: string
    date?: string
    moodAvg?: number | null
    moodCount?: number
    cardsCount?: number
  }
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
      <div className="mb-1.5">
        <div className="font-semibold">{meta?.fullName}</div>
        {meta?.date && <div>{meta.date}</div>}
      </div>
      <div className="space-y-1 text-muted-foreground">
        <div>
          Настроение:{' '}
          <strong className="font-mono text-foreground">
            {meta?.moodAvg != null ? `${meta.moodAvg.toFixed(1)} / 5` : 'нет оценок'}
          </strong>
          {meta?.moodCount ? ` (${meta.moodCount} чел.)` : ''}
        </div>
        <div>
          Карточек на доске:{' '}
          <strong className="font-mono text-foreground">{meta?.cardsCount ?? 0}</strong>
        </div>
      </div>
    </div>
  )
}

export default memo(function MoodTrendChart({ data }: Props) {
  // Настроение больше не собирается на доске: на графике только доски с историей оценок
  const valid = data.filter((d) => d.mood_avg !== null)
  if (valid.length === 0) return null

  // Точка — доска: на оси её название, дата — в подсказке (см. chartLabels.ts)
  const sorted = sortBoardPoints(valid)
  const axis = buildBoardAxis(sorted)
  const labels = new Map(axis.map((entry) => [entry.key, entry.label]))
  const chartData = sorted.map((d, index) => ({
    key: axis[index].key,
    fullName: axis[index].fullName,
    date: axis[index].date,
    moodAvg: d.mood_avg,
    moodCount: d.mood_count,
    cardsCount: d.cards_count,
  }))

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
          <defs>
            <linearGradient id="moodGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366F1" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="key"
            tickFormatter={(key: string) => labels.get(key) ?? ''}
            minTickGap={12}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis
            domain={[1, 5]}
            ticks={[1, 2, 3, 4, 5]}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="moodAvg"
            name="Настроение"
            stroke="#6366F1"
            strokeWidth={2.5}
            fill="url(#moodGradient)"
            connectNulls
            dot={{ r: 4, fill: '#6366F1', strokeWidth: 2, stroke: 'hsl(var(--background))' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
})
