'use client'

import { memo, useMemo } from 'react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HealthQuestion, HealthTrendPoint } from '@/types/health'
import { cn } from '@/lib/utils'
import {
  optionForTone,
  toneForAverage,
  TONE_CLASSES,
  TONE_HEX,
} from '@/components/health/scale'
import { formatAverage } from './format'
import { buildHealthTrendRows, type HealthTrendRow, type HealthTrendRowPoint } from './healthTrends'

interface Props {
  questions: HealthQuestion[]
  points: HealthTrendPoint[]
}

// Линия нейтральная: сам показатель несут точки. У вопросов точка окрашена по светофору
// (высота точки дублирует цвет, а последнее состояние названо словом рядом со значением),
// у оценки встречи — цвет графика настроения.
const LINE_COLOR = 'hsl(var(--muted-foreground))'
const ROTI_COLOR = '#6366F1'
const SURFACE = 'hsl(var(--card))'

interface DotProps {
  cx?: number
  cy?: number
  index?: number
  payload?: HealthTrendRowPoint
}

/** Точка мини-графика с кольцом цвета карточки — остаётся читаемой поверх линии. */
function renderDot(row: HealthTrendRow, radius: number, { cx, cy, index, payload }: DotProps) {
  const value = payload?.value
  if (cx == null || cy == null || value == null) return <g key={`gap-${index}`} />
  const fill = row.kind === 'health' ? TONE_HEX[toneForAverage(value)] : ROTI_COLOR
  return (
    <circle
      key={payload?.key ?? index}
      cx={cx}
      cy={cy}
      r={radius}
      fill={fill}
      stroke={SURFACE}
      strokeWidth={2}
    />
  )
}

interface TooltipPayloadItem {
  payload?: HealthTrendRowPoint
}

function RowTooltip({
  active,
  payload,
  row,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  row: HealthTrendRow
}) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="whitespace-nowrap rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <div className="font-semibold">{point.fullName}</div>
      {point.date && <div className="text-muted-foreground">{point.date}</div>}
      <div className="mt-1.5 text-muted-foreground">
        {row.title}:{' '}
        <strong className="font-mono text-foreground">
          {point.value !== null ? `${formatAverage(point.value)} из ${row.scaleMax}` : 'нет ответов'}
        </strong>
      </div>
    </div>
  )
}

function Delta({ row }: { row: HealthTrendRow }) {
  if (row.delta === null) return null
  const flat = Math.abs(row.delta) < 0.05
  const up = row.delta > 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
      title="Изменение к предыдущей доске с ответами"
    >
      <Icon
        className={cn(
          'h-3.5 w-3.5',
          !flat && (up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'),
        )}
        aria-hidden="true"
      />
      <span className="font-mono">
        {flat ? 'без изменений' : `${up ? '+' : '−'}${formatAverage(Math.abs(row.delta))}`}
      </span>
    </span>
  )
}

function TrendRow({ row }: { row: HealthTrendRow }) {
  const tone = row.kind === 'health' && row.latest !== null ? toneForAverage(row.latest) : null
  const midpoint = (row.scaleMin + row.scaleMax) / 2

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,10.5rem)_minmax(0,1fr)_auto]"
      data-testid={`health-trend-row-${row.key}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium leading-snug">{row.title}</p>
        {row.hint && (
          <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{row.hint}</p>
        )}
      </div>

      <div className="order-3 col-span-2 h-14 min-w-0 sm:order-0 sm:col-span-1" aria-hidden="true">
        {row.latest === null ? (
          <div className="flex h-full items-center text-xs text-muted-foreground">
            {row.kind === 'roti' ? 'Встречи пока не оценивали' : 'Ответов пока нет'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 240, height: 56 }}>
            <LineChart data={row.points} margin={{ top: 8, right: 10, bottom: 8, left: 10 }}>
              <XAxis dataKey="key" hide />
              <YAxis hide domain={[row.scaleMin, row.scaleMax]} />
              <ReferenceLine y={midpoint} stroke="hsl(var(--border))" />
              <Tooltip
                content={<RowTooltip row={row} />}
                cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1 }}
                allowEscapeViewBox={{ x: false, y: true }}
                wrapperStyle={{ zIndex: 30 }}
              />
              <Line
                type="linear"
                dataKey="value"
                name={row.title}
                stroke={LINE_COLOR}
                strokeOpacity={0.55}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls
                isAnimationActive={false}
                dot={(props: DotProps) => renderDot(row, 4.5, props)}
                activeDot={(props: DotProps) => renderDot(row, 6, props)}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="flex flex-col items-end gap-0.5 text-right">
        {row.latest === null ? (
          <span className="font-mono text-base font-semibold text-muted-foreground">—</span>
        ) : (
          <>
            <span className="whitespace-nowrap">
              <span className="font-mono text-base font-semibold" data-testid={`health-trend-value-${row.key}`}>
                {formatAverage(row.latest)}
              </span>
              <span className="text-xs text-muted-foreground"> из {row.scaleMax}</span>
            </span>
            <span className="flex flex-wrap items-center justify-end gap-x-2">
              {tone && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <span
                    className={cn('h-2 w-2 rounded-full', TONE_CLASSES[tone].dot)}
                    aria-hidden="true"
                  />
                  {optionForTone(tone).label}
                </span>
              )}
              <Delta row={row} />
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Динамика здоровья команды между досками: ряд на каждый вопрос и ряд оценки встречи.
 * У каждого ряда своя шкала (вопросы — от 1 до 3, оценка встречи — от 1 до 5),
 * поэтому это отдельные мини-графики с общей осью досок, а не линии на одном поле.
 */
export default memo(function HealthTrendsChart({ questions, points }: Props) {
  const { rows, axis } = useMemo(() => buildHealthTrendRows(questions, points), [questions, points])
  if (axis.length === 0) return null

  const first = axis[0]
  const last = axis[axis.length - 1]

  return (
    <div data-testid="health-trends">
      <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
        {rows.map((row) => (
          <TrendRow key={row.key} row={row} />
        ))}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {axis.length === 1
          ? `Одна доска с ответами: «${first.fullName}». Динамика появится после следующей.`
          : `Точки — доски слева направо, от «${first.fullName}» до «${last.fullName}». Последнее значение — справа.`}
      </p>

      {/* Те же числа таблицей — для экранных дикторов; мини-графики скрыты от них.
          sr-only стоит на обёртке: сама таблица не сжимается до 1px и растягивала бы страницу. */}
      <div className="sr-only">
        <table>
          <caption>Здоровье команды: средние ответы по доскам</caption>
          <thead>
            <tr>
              <th scope="col">Вопрос</th>
              {axis.map((entry) => (
                <th key={entry.key} scope="col">
                  {entry.fullName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  {row.title} (от {row.scaleMin} до {row.scaleMax})
                </th>
                {row.points.map((point) => (
                  <td key={point.key}>
                    {point.value !== null ? formatAverage(point.value) : 'нет ответов'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
