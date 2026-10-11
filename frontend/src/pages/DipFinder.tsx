import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useLinkProps } from '../lib/links'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Empty, ErrorBox, Loading, Segmented, Select, SymbolLogo } from '../components/ui'
import { api, type Dip, type DipSource } from '../lib/api'
import { compactMoney, money, num, pct, toneClass } from '../lib/format'

type Metric = 'vs_sma200' | 'vs_sma50' | 'rsi14' | 'insider_net_value' | 'insider_net_trades'

const METRICS: { value: Metric; label: string; sub: string }[] = [
  { value: 'vs_sma200', label: '200-day SMA', sub: 'Price vs 200 day simple moving average' },
  { value: 'vs_sma50', label: '50-day SMA', sub: 'Price vs 50 day simple moving average' },
  { value: 'rsi14', label: 'RSI (14)', sub: 'Relative Strength Index — below 30 is oversold, above 70 overbought' },
  { value: 'insider_net_value', label: 'Insider net value', sub: 'Open-market insider buys minus sells by value, last 6 months' },
  { value: 'insider_net_trades', label: 'Insider net trades', sub: 'Number of open-market insider buys minus sells, last 6 months' },
]
const isInsider = (m: Metric) => m === 'insider_net_value' || m === 'insider_net_trades'

const SOURCES: { value: DipSource; label: string }[] = [
  { value: 'holdings', label: 'Holdings' },
  { value: 'watchlist', label: 'Watchlist' },
  { value: 'all', label: 'Both' },
]

const UP = '#5cd59b'
const DOWN = '#f27362'
const ticker = (s: string) => s.split('.')[0]
const axisProps = { stroke: '#9a9aab', fontSize: 11.5, tickLine: false, axisLine: false } as const

/** Round 1-2-5 ticks that always include 0, e.g. -5, 0, 5 … 25. */
function niceTicks(values: number[]) {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  if (hi === lo) return [0, 1]
  const mag = 10 ** Math.floor(Math.log10((hi - lo) / 8))
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => (hi - lo) / s <= 8) ?? 10 * mag
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => start + i * step)
}

const signed = (v: number | null | undefined, s: string) => (v != null && v > 0 ? `+${s}` : s)
const fmt = (m: Metric, d: Dip) => {
  const v = d[m]
  if (m === 'rsi14') return num(v, 1)
  if (m === 'insider_net_value') return signed(v, compactMoney(v, d.insider_currency ?? 'USD'))
  if (m === 'insider_net_trades') return signed(v, num(v, 0))
  return pct(v, 2)
}
const axisFmt = (m: Metric, v: number) =>
  m === 'rsi14' || m === 'insider_net_trades'
    ? String(v)
    : m === 'insider_net_value'
      ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v)
      : `${v}%`
const barColor = (m: Metric, v: number) => (m === 'rsi14' ? (v < 30 ? DOWN : v > 70 ? UP : '#5ea1d8') : v < 0 ? DOWN : UP)

export default function DipFinder() {
  const [source, setSource] = useState<DipSource>('all')
  const [metric, setMetric] = useState<Metric>('vs_sma200')
  const q = useQuery({ queryKey: ['dips', source], queryFn: () => api.dips(source) })
  const linkProps = useLinkProps()

  const rows = useMemo(
    () =>
      (q.data ?? [])
        // keep stocks/ETFs without insider data visible, ranked as if their value were 0
        .filter((d) => d[metric] != null || isInsider(metric))
        // insider metrics: strongest buying first; price metrics: deepest dip first
        .sort((a, b) => (((a[metric] ?? 0) as number) - ((b[metric] ?? 0) as number)) * (isInsider(metric) ? -1 : 1)),
    [q.data, metric],
  )
  const missing = (q.data ?? []).filter((d) => d[metric] == null)
  const ticks = metric === 'rsi14' ? [0, 30, 50, 70, 100] : niceTicks(rows.flatMap((d) => (d[metric] == null ? [] : [d[metric] as number])))
  const info = METRICS.find((m) => m.value === metric)!
  const [chartWidth, setChartWidth] = useState(0)
  // Turn tickers vertical when there isn't enough horizontal room per bar (e.g. on phones)
  const longest = Math.max(0, ...rows.map((d) => ticker(d.symbol).length))
  const vertical = chartWidth > 0 && (chartWidth - 62) / Math.max(1, rows.length) < longest * 7.5 + 8

  return (
    <>
      <Card className="mb-[25px]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Dip Finder</h2>
            <div className="mt-1 text-[13.5px] text-muted">{info.sub}</div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Segmented options={SOURCES} value={source} onChange={setSource} />
            <Select options={METRICS} value={metric} onChange={setMetric} />
          </div>
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <Empty>{source === 'watchlist' ? 'Your watchlist is empty.' : 'No price history available.'}</Empty>
        ) : (
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%" onResize={(w) => setChartWidth(w)}>
              <BarChart accessibilityLayer={false} data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#4a4a58" strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="symbol"
                  tickFormatter={ticker}
                  {...axisProps}
                  interval={0}
                  {...(vertical ? { angle: -90, textAnchor: 'end', height: longest * 7.5 + 12, dx: -4, dy: 2 } : {})}
                />
                <YAxis
                  {...axisProps}
                  width={52}
                  ticks={ticks}
                  domain={[ticks[0], ticks[ticks.length - 1]]}
                  interval={0}
                  tickFormatter={(v: number) => axisFmt(metric, v)}
                />
                {metric === 'rsi14' ? (
                  <>
                    <ReferenceLine y={30} stroke={DOWN} strokeDasharray="4 4" />
                    <ReferenceLine y={70} stroke={UP} strokeDasharray="4 4" />
                  </>
                ) : (
                  <ReferenceLine y={0} stroke="#9a9aab" />
                )}
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as Dip
                    return (
                      <div className="rounded bg-panel-2 px-3 py-2 text-[12px] shadow-xl">
                        <div className="mb-1 text-white">{d.name}</div>
                        <div className="flex justify-between gap-5 text-body">
                          <span>{info.label}</span>
                          <span className="text-white">{d[metric] == null ? 'No data' : fmt(metric, d)}</span>
                        </div>
                        {isInsider(metric) && d.insider_net_value != null && (
                          <>
                            <div className="flex justify-between gap-5 text-body">
                              <span>Buys</span>
                              <span className="text-up">
                                {d.insider_buys} · {compactMoney(d.insider_buy_value, d.insider_currency ?? 'USD')}
                              </span>
                            </div>
                            <div className="flex justify-between gap-5 text-body">
                              <span>Sells</span>
                              <span className="text-down">
                                {d.insider_sells} · {compactMoney(d.insider_sell_value, d.insider_currency ?? 'USD')}
                              </span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between gap-5 text-body">
                          <span>Price</span>
                          <span className="text-white">{money(d.price, d.currency ?? 'EUR')}</span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey={metric} radius={[3, 3, 3, 3]} maxBarSize={56}>
                  {rows.map((d) => (
                    <Cell key={d.symbol} fill={barColor(metric, (d[metric] ?? 0) as number)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {missing.length > 0 && (
          <p className="mt-3 text-[12px] text-muted">
            {isInsider(metric) ? 'No insider data (non-US companies, ETFs) for' : 'Not enough price history for'}:{' '}
            {missing.map((d) => ticker(d.symbol)).join(', ')}
          </p>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="th pl-5">Holding</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">50-day SMA</th>
                  <th className="th text-right">200-day SMA</th>
                  <th className="th text-right">RSI (14)</th>
                  <th className="th pr-5 text-right">Insiders (6m)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.symbol} {...linkProps(`/stock/${d.symbol}`)} className="cursor-pointer border-b border-[#5a5a6c] text-[15px] last:border-0 hover:bg-white/[0.02]">
                    <td className="td pl-5">
                      <div className="flex items-center gap-3">
                        <SymbolLogo symbol={d.symbol} size={36} />
                        <div className="min-w-0">
                          <div className="max-w-[260px] truncate text-white">{d.name}</div>
                          <div className="text-muted">{d.symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="td text-right text-white">{money(d.price, d.currency ?? 'EUR')}</td>
                    <MetricCell value={d.vs_sma50} base={d.sma50} currency={d.currency} />
                    <MetricCell value={d.vs_sma200} base={d.sma200} currency={d.currency} />
                    <td className={clsx('td text-right', d.rsi14 == null ? 'text-muted' : d.rsi14 < 30 ? 'text-down' : d.rsi14 > 70 ? 'text-up' : 'text-white')}>
                      {num(d.rsi14, 1)}
                    </td>
                    <td className="td whitespace-nowrap pr-5 text-right">
                      {d.insider_net_value == null ? (
                        <span className="text-muted">—</span>
                      ) : (
                        <>
                          <div className={toneClass(d.insider_net_value)}>{fmt('insider_net_value', d)}</div>
                          <div className="text-[13px] text-muted">
                            {d.insider_buys} buys · {d.insider_sells} sells
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

function MetricCell({ value, base, currency }: { value: number | null; base: number | null; currency: string | null }) {
  return (
    <td className="td text-right">
      <div className={toneClass(value)}>{pct(value, 2)}</div>
      <div className="text-[13px] text-muted">{money(base, currency ?? 'EUR')}</div>
    </td>
  )
}
