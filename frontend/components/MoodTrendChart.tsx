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

interface Props {
  data: MoodTrendPoint[]
}

function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  })
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
      <div className="mb-1.5 font-semibold">{meta?.fullName || meta?.date}</div>
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
  const valid = data.filter((d) => d.mood_avg !== null || d.cards_count > 0)
  if (valid.length === 0) return null

  const chartData = valid
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((d) => ({
      date: shortDate(d.created_at),
      fullName: d.board_name,
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
            dataKey="date"
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
