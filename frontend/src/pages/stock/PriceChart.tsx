import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Area, AreaChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Delta } from '../../components/ui'
import { date } from '../../lib/format'
import { downsample } from '../../lib/range'

export type ChartRange = '7d' | '1m' | '3m' | '6m' | 'YTD' | '1y' | '5y' | '10y' | 'all'

function startOf(range: ChartRange): string | null {
  const d = new Date()
  switch (range) {
    case '7d': d.setDate(d.getDate() - 7); break
    case '1m': d.setMonth(d.getMonth() - 1); break
    case '3m': d.setMonth(d.getMonth() - 3); break
    case '6m': d.setMonth(d.getMonth() - 6); break
    case 'YTD': return `${d.getFullYear()}-01-01`
    case '1y': d.setFullYear(d.getFullYear() - 1); break
    case '5y': d.setFullYear(d.getFullYear() - 5); break
    case '10y': d.setFullYear(d.getFullYear() - 10); break
    case 'all': return null
  }
  return d.toISOString().slice(0, 10)
}

export function RangeTabs<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={clsx('cursor-pointer rounded px-2 py-1 text-[12.6px] transition', value === o ? 'text-accent' : 'text-body hover:text-white')}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

const shortDate = (d: string) => date(d, { day: 'numeric', month: 'short', year: '2-digit' })

export type Marker = { date: string; color: string; key: string | number }

export default function PriceChart({
  rows,
  fmt,
  ranges = ['7d', '1m', '3m', '6m', 'YTD', '1y', '5y', 'all'],
  initial = '1y',
  deltaMode = 'value',
  markers = [],
  costPerShare = null,
  height = 300,
}: {
  rows: { date: string; close: number }[]
  fmt: (v: number) => string
  ranges?: ChartRange[]
  initial?: ChartRange
  deltaMode?: 'value' | 'points'
  markers?: Marker[]
  costPerShare?: number | null
  height?: number
}) {
  const [range, setRange] = useState<ChartRange>(initial)
  const data = useMemo(() => {
    const start = startOf(range)
    let r = rows
    if (start) {
      const idx = rows.findIndex((x) => x.date >= start)
      r = idx === -1 ? rows.slice(-1) : rows.slice(Math.max(0, idx - 1))
    }
    return downsample(r, 600)
  }, [rows, range])

  if (!rows.length) return <div className="py-16 text-center text-muted">No data</div>
  const first = data[0]
  const last = data[data.length - 1]
  const change = last.close - first.close
  const changePct = first.close ? (change / Math.abs(first.close)) * 100 : null
  let max = data[0]
  let min = data[0]
  for (const r of data) {
    if (r.close > max.close) max = r
    if (r.close < min.close) min = r
  }
  const multiYear = data.length > 1 && last.date.slice(0, 4) !== first.date.slice(0, 4) && range !== '1y' && range !== '6m'
  const dots = markers
    .filter((m) => m.date >= first.date)
    .map((m) => {
      const p = data.find((r) => r.date >= m.date) ?? last
      return { ...m, x: p.date, y: p.close }
    })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <RangeTabs options={ranges} value={range} onChange={setRange} />
        <div className="flex items-center gap-1.5 text-[12.6px] text-body">
          {shortDate(first.date)} - {shortDate(last.date)}
          <span className="ml-1 inline-block h-2 w-2 rounded-full bg-accent" />
          <span className={change >= 0 ? 'text-up' : 'text-down'}>
            {change > 0 ? '+' : change < 0 ? '-' : ''}
            {fmt(Math.abs(change))}
          </span>
          {deltaMode === 'value' && changePct != null && (
            <span className={change >= 0 ? 'text-up' : 'text-down'}>
              (<Delta v={changePct} />)
            </span>
          )}
        </div>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer>
          <AreaChart accessibilityLayer={false} data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="sbPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00aff5" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#00aff5" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => (multiYear ? date(d, { month: 'short', year: 'numeric' }) : date(d, { month: 'short', year: '2-digit' }).replace(' ', " '"))}
              minTickGap={50}
              stroke="#adb5bd"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis domain={['auto', 'auto']} stroke="#adb5bd" fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmt(Number(v)).replace(/\.00(?=\D*$)/, '')} />
            <Tooltip
              cursor={{ stroke: '#adb5bd', strokeDasharray: '3 3' }}
              contentStyle={{ background: '#3b3b49', border: 'none', borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: '#adb5bd' }}
              labelFormatter={(d) => date(String(d))}
              formatter={(v) => [fmt(Number(v)), '']}
              separator=""
            />
            <ReferenceLine y={max.close} stroke="transparent" label={{ value: `max: ${fmt(max.close)}`, position: 'insideTopRight', fill: '#adb5bd', fontSize: 10.5, dy: -14 }} />
            <ReferenceLine y={min.close} stroke="transparent" label={{ value: `min: ${fmt(min.close)}`, position: 'insideBottomRight', fill: '#adb5bd', fontSize: 10.5, dy: 14 }} />
            {costPerShare != null && costPerShare > 0 && (
              <ReferenceLine
                y={costPerShare}
                stroke="#8b6cf6"
                strokeDasharray="4 3"
                strokeWidth={1.2}
                ifOverflow="extendDomain"
                label={{ value: `My cost per share: ${fmt(costPerShare)}`, position: 'insideBottomLeft', fill: '#ffffff', fontSize: 11.5 }}
              />
            )}
            <Area type="linear" dataKey="close" stroke="#00aff5" strokeWidth={1.6} fill="url(#sbPrice)" dot={false} isAnimationActive={false} />
            {dots.map((d) => (
              <ReferenceDot key={d.key} x={d.x} y={d.y} r={4.5} fill={d.color} stroke="#32323e" strokeWidth={2} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
