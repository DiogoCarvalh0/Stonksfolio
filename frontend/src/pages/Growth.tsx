import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRight, CalendarDays, Check, Table2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import SymbolSearch from '../components/SymbolSearch'
import { Card, Delta, Empty, ErrorBox, Loading, Pills, Tone } from '../components/ui'
import { api, type BenchmarkSeries, type PerfPoint } from '../lib/api'
import { compactMoney, date, money, pct, signedMoney, toneClass } from '../lib/format'
import { downsample, rangeStart, type Range } from '../lib/range'

// ---------------------------------------------------------------- benchmarks

const PRESETS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^NDX', label: 'Nasdaq 100' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: 'IWDA.AS', label: 'MSCI World' },
  { symbol: 'VWCE.DE', label: 'FTSE All-World' },
  { symbol: 'EXSA.DE', label: 'STOXX Europe 600' },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50' },
  { symbol: '^AEX', label: 'AEX' },
]
const MAX_BENCHMARKS = 4
const PORTFOLIO_COLOR = '#3fa9f5'
const INVESTED_COLOR = '#8950fc'
const PROFIT_COLOR = '#5cd59b'
const UP_BAR = '#7dd3ae'
const DOWN_BAR = '#e16c66'
const BENCH_COLORS = ['#f5a623', '#e85d9b', '#2bcbc4', '#c86df5']
const STORAGE_KEY = 'stonksfolio.growth.benchmarks'
const LEGACY_STORAGE_KEY = 'stonks.growth.benchmarks'

const benchLabel = (symbol: string, name?: string) => PRESETS.find((p) => p.symbol === symbol)?.label ?? name ?? symbol

type Bench = { symbol: string; label: string; color: string }
type Row = PerfPoint & { b: (number | null)[] }

function useStoredBenchmarks() {
  const [list, setList] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null')
      if (Array.isArray(v)) return v.filter((s) => typeof s === 'string').slice(0, MAX_BENCHMARKS)
    } catch {
      /* ignore */
    }
    return ['^GSPC']
  })
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(list)), [list])
  return [list, setList] as const
}

function useClickOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, onClose])
  return ref
}

function BenchmarkBar({ selected, names, onChange }: { selected: string[]; names: Record<string, string>; onChange: (s: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const toggle = (sym: string) =>
    onChange(selected.includes(sym) ? selected.filter((s) => s !== sym) : selected.length < MAX_BENCHMARKS ? [...selected, sym] : selected)
  return (
    <section className="card flex flex-wrap items-center gap-3 px-5 py-4 md:px-8">
      <span className="text-[15px] text-white">Benchmarks:</span>
      {selected.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-2 rounded bg-panel-2 px-3 py-1.5 text-[14px] text-body">
          <Dot color={BENCH_COLORS[i % BENCH_COLORS.length]} />
          {benchLabel(s, names[s])}
          <button className="cursor-pointer text-muted hover:text-white" onClick={() => toggle(s)} aria-label={`Remove ${s}`}>
            <X size={14} />
          </button>
        </span>
      ))}
      <div className="relative" ref={ref}>
        <button className="cursor-pointer px-1 text-[14px] text-accent hover:text-white" onClick={() => setOpen((o) => !o)}>
          Select
        </button>
        {open && (
          <div className="absolute left-0 z-30 mt-2 w-72 rounded-md bg-panel-2 p-2 shadow-2xl">
            {PRESETS.map((p) => {
              const on = selected.includes(p.symbol)
              return (
                <button
                  key={p.symbol}
                  disabled={!on && selected.length >= MAX_BENCHMARKS}
                  onClick={() => toggle(p.symbol)}
                  className="flex w-full cursor-pointer items-center justify-between rounded px-3 py-2 text-left text-[13px] hover:bg-line disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="text-body">
                    {p.label} <span className="text-muted">{p.symbol}</span>
                  </span>
                  {on && <Check size={14} className="text-accent" />}
                </button>
              )
            })}
            <div className="mt-2 border-t border-line px-1 pt-3 pb-1">
              <div className="label">Any index, ETF or stock</div>
              <SymbolSearch
                placeholder="Search ticker…"
                onSelect={(r) => {
                  if (!selected.includes(r.symbol) && selected.length < MAX_BENCHMARKS) onChange([...selected, r.symbol])
                  setOpen(false)
                }}
              />
              {selected.length >= MAX_BENCHMARKS && <div className="mt-1.5 text-[12px] text-muted">Up to {MAX_BENCHMARKS} benchmarks</div>}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- periods

type Preset = Exclude<Range, '3Y'>
type Period = { kind: 'preset'; range: Preset } | { kind: 'custom'; from: string; to: string }
const PERIODS: { value: Preset; label: string }[] = [
  { value: '7D', label: '7d' },
  { value: '1M', label: '1m' },
  { value: '3M', label: '3m' },
  { value: '6M', label: '6m' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1y' },
  { value: '5Y', label: '5y' },
  { value: 'MAX', label: 'all' },
]
const PHRASES: Record<Preset, string> = {
  '7D': 'over the last 7 days',
  '1M': 'over the last month',
  '3M': 'over the last 3 months',
  '6M': 'over the last 6 months',
  YTD: 'since the beginning of the year',
  '1Y': 'over the last year',
  '5Y': 'over the last 5 years',
  MAX: 'since you started investing',
}

function slicePeriod<T extends { date: string }>(rows: T[], p: Period): T[] {
  const start = p.kind === 'preset' ? rangeStart(p.range) : p.from
  const end = p.kind === 'custom' ? p.to : null
  let out = rows
  if (start) {
    // keep the last point before the start so changes are measured from the period start
    const idx = rows.findIndex((r) => r.date >= start)
    out = idx === -1 ? rows.slice(-1) : rows.slice(Math.max(0, idx - 1))
  }
  return end ? out.filter((r) => r.date <= end) : out
}

const shortDate = (d: string) => date(d, { month: 'short', day: 'numeric', year: '2-digit' })

function periodLabel(rows: { date: string }[], p: Period) {
  if (!rows.length) return ''
  const start = p.kind === 'preset' ? rangeStart(p.range) : p.from
  const from = start && start > rows[0].date ? start : rows[0].date
  return `${shortDate(from)} - ${shortDate(rows[rows.length - 1].date)}`
}

function PeriodPicker({ value, onChange, min, max }: { value: Period; onChange: (p: Period) => void; min: string; max: string }) {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside(open, () => setOpen(false))
  const [from, setFrom] = useState(value.kind === 'custom' ? value.from : min)
  const [to, setTo] = useState(value.kind === 'custom' ? value.to : max)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODS.map((o) => {
        const active = value.kind === 'preset' && value.range === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange({ kind: 'preset', range: o.value })}
            className={clsx('cursor-pointer rounded-full px-3 py-1.5 text-[13.5px] transition', active ? 'bg-accent/10 text-accent' : 'text-body hover:text-white')}
          >
            {o.label}
          </button>
        )
      })}
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          title="Custom period"
          className={clsx('cursor-pointer rounded-full p-1.5 transition', value.kind === 'custom' ? 'bg-accent/10 text-accent' : 'text-body hover:text-white')}
        >
          <CalendarDays size={18} />
        </button>
        {open && (
          <div className="absolute left-0 z-30 mt-2 w-64 space-y-3 rounded-md bg-panel-2 p-4 shadow-2xl">
            <div>
              <label className="label">From</label>
              <input type="date" className="input !bg-panel" min={min} max={to} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" className="input !bg-panel" min={from} max={max} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button
              className="btn-primary w-full"
              disabled={!from || !to || from > to}
              onClick={() => {
                onChange({ kind: 'custom', from, to })
                setOpen(false)
              }}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shared chart bits

const axisProps = { stroke: '#9a9aab', fontSize: 11.5, tickLine: false, axisLine: false } as const
const gridProps = { stroke: '#4a4a58', strokeDasharray: '4 4', vertical: false } as const
const tooltipBox = 'rounded bg-panel-2 px-3 py-2 text-[12px] shadow-xl'

function timeTick(rows: { date: string }[]) {
  const span = rows.length ? (Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 864e5 : 0
  return (d: string) => {
    if (span <= 95) return date(d, { day: 'numeric', month: 'short' })
    const dt = new Date(d + 'T00:00:00')
    if (span > 730 && dt.getMonth() === 0) return String(dt.getFullYear())
    return `${dt.toLocaleDateString(undefined, { month: 'short' })} '${String(dt.getFullYear()).slice(2)}`
  }
}

/** One tick per month boundary (every 1/3/6 months depending on span) so labels never repeat. */
function monthTicks(rows: { date: string }[]): string[] | undefined {
  if (rows.length < 2) return undefined
  const span = (Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 864e5
  if (span <= 95) return undefined
  const step = span <= 400 ? 1 : span <= 1100 ? 3 : 6
  const out: string[] = []
  let prev = rows[0].date.slice(0, 7)
  for (const r of rows) {
    const ym = r.date.slice(0, 7)
    if (ym !== prev && (Number(ym.slice(5)) - 1) % step === 0) out.push(r.date)
    prev = ym
  }
  return out
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
}

function LegendRow({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-body">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <Dot color={i.color} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

function ChartTooltip({ active, payload, label, title, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className={tooltipBox}>
      <div className="mb-1 text-muted">{title(label)}</div>
      {payload.map((p: any) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-body">
            <Dot color={String(p.payload?.[`${p.dataKey}Color`] ?? p.color)} />
            {p.name}
          </span>
          {fmt(Number(p.value))}
        </div>
      ))}
    </div>
  )
}

/**
 * Simulates putting the same cash flows into each benchmark: the period starts with the portfolio's value
 * in the benchmark, then every net deposit/withdrawal buys/sells benchmark units at that day's price.
 */
function simulate(rows: Row[], n: number): (number | null)[][] {
  const units: (number | null)[] = Array(n).fill(null)
  return rows.map((r, i) =>
    Array.from({ length: n }, (_, k) => {
      const px = r.b[k]
      if (px == null || px <= 0) return null
      const u = units[k]
      units[k] = u == null ? r.value / px : Math.max(0, u + (r.invested - rows[i - 1].invested) / px)
      return units[k]! * px
    }),
  )
}

function CompareChips({ benches, on, onToggle }: { benches: Bench[]; on: boolean; onToggle: () => void }) {
  if (!benches.length) return <div className="text-[13px] text-muted">Select a benchmark at the top to compare</div>
  return (
    <div className="flex flex-wrap items-center gap-2 text-[14px]">
      <span className="text-body">Benchmarks:</span>
      {benches.map((b) => (
        <span key={b.symbol} className={clsx('inline-flex items-center gap-1.5 rounded bg-panel-2 px-2.5 py-1 text-[13px]', on ? 'text-body' : 'text-muted')}>
          {on && <Dot color={b.color} />}
          {b.label}
        </span>
      ))}
      <button className={clsx('cursor-pointer px-1', on ? 'text-accent hover:text-white' : 'text-white hover:text-accent')} onClick={onToggle}>
        {on ? 'Hide' : 'Compare'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- 1. portfolio value

function ValueCard({ rows, benches }: { rows: Row[]; benches: Bench[] }) {
  const [period, setPeriod] = useState<Period>({ kind: 'preset', range: 'YTD' })
  const sliced = useMemo(() => slicePeriod(rows, period), [rows, period])
  const { data, deltas, lead } = useMemo(() => {
    const sims = simulate(sliced, benches.length)
    const data = sliced.map((r, i) => {
      const o: Record<string, number | string | null> = { date: r.date, value: r.value, invested: r.invested }
      benches.forEach((_, k) => (o[`b${k}`] = sims[i][k]))
      return o
    })
    const first = data[0]
    const last = data[data.length - 1]
    const num = (v: unknown) => (typeof v === 'number' ? v : null)
    const deltas = last
      ? [
          { label: 'Portfolio', color: PORTFOLIO_COLOR, v: (last.value as number) - (first.value as number) },
          ...benches.map((b, k) => {
            const a = num(first[`b${k}`])
            const z = num(last[`b${k}`])
            return { label: b.label, color: b.color, v: a != null && z != null ? z - a : null }
          }),
        ]
      : []
    const lb = last ? num(last.b0) : null
    const lead = lb ? { diff: (last.value as number) - lb, pct: (((last.value as number) - lb) / lb) * 100 } : null
    return { data: downsample(data), deltas, lead }
  }, [sliced, benches])

  return (
    <Card title="Portfolio value" hint="Market value of your holdings. Benchmark lines show what the same deposits and withdrawals would be worth if invested in the benchmark instead.">
      {lead && benches[0] && (
        <div className="mb-5 rounded-md bg-panel-2 px-5 py-3.5 text-[14.5px] text-body">
          {lead.diff >= 0 ? '🎉 ' : '📉 '}Portfolio is {lead.diff >= 0 ? 'ahead of' : 'behind'} <b className="font-semibold text-white">{benches[0].label}</b> by{' '}
          <span className={toneClass(lead.diff)}>
            {money(Math.abs(lead.diff))} ({pct(Math.abs(lead.pct), 2, false)})
          </span>{' '}
          <b className="font-semibold text-white">{period.kind === 'preset' ? PHRASES[period.range] : `since ${date(period.from)}`}</b>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} min={rows[0].date} max={rows[rows.length - 1].date} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
          <span className="text-muted">{periodLabel(sliced, period)}</span>
          {deltas.map((d) => (
            <span key={d.label} className="inline-flex items-center gap-1.5" title={d.label}>
              <Dot color={d.color} />
              <Tone v={d.v}>{signedMoney(d.v)}</Tone>
            </span>
          ))}
        </div>
      </div>
      <div className="h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer={false} data={data} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gPortfolioValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={PORTFOLIO_COLOR} stopOpacity={0.3} />
                <stop offset="100%" stopColor={PORTFOLIO_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" ticks={monthTicks(data as { date: string }[])} interval="preserveStartEnd" tickFormatter={timeTick(data as { date: string }[])} minTickGap={28} {...axisProps} />
            <YAxis {...axisProps} width={58} domain={['auto', 'auto']} tickFormatter={(v) => compactMoney(v).replace('€', '')} />
            <Tooltip content={<ChartTooltip title={(l: string) => date(l)} fmt={(v: number) => <span className="text-white">{money(v)}</span>} />} />
            <Area type="monotone" dataKey="value" name="Portfolio" stroke={PORTFOLIO_COLOR} fill="url(#gPortfolioValue)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {benches.map((b, k) => (
              <Line key={b.symbol} type="monotone" dataKey={`b${k}`} name={b.label} stroke={b.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            ))}
            <Line type="stepAfter" dataKey="invested" name="Invested" stroke={INVESTED_COLOR} strokeDasharray="5 5" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <LegendRow items={[{ label: 'Portfolio', color: PORTFOLIO_COLOR }, ...benches.map((b) => ({ label: b.label, color: b.color })), { label: 'Invested', color: INVESTED_COLOR }]} />
    </Card>
  )
}

// ---------------------------------------------------------------- 2. portfolio performance (profit)

function ProfitCard({ rows, benches }: { rows: Row[]; benches: Bench[] }) {
  const [period, setPeriod] = useState<Period>({ kind: 'preset', range: 'MAX' })
  const [compare, setCompare] = useState(false)
  const sliced = useMemo(() => slicePeriod(rows, period), [rows, period])
  const { data, profit, ret, benchStats } = useMemo(() => {
    if (!sliced.length) return { data: [], profit: 0, ret: null, benchStats: [] }
    const sims = simulate(sliced, benches.length)
    const f = sliced[0]
    const data = sliced.map((r, i) => {
      const o: Record<string, number | string | null> = { date: r.date, profit: r.profit - f.profit }
      benches.forEach((_, k) => {
        const s = sims[i][k]
        o[`b${k}`] = s == null ? null : s - f.value - (r.invested - f.invested)
      })
      return o
    })
    const l = sliced[sliced.length - 1]
    const lastRow = data[data.length - 1]
    // Simple return: profit as a share of the capital put in (value at the start + net deposits in the period).
    const base = f.value + (l.invested - f.invested)
    const pctOf = (v: number | null) => (v != null && base > 0 ? (v / base) * 100 : null)
    const benchStats = benches.map((b, k) => {
      const v = lastRow[`b${k}`]
      const profit = typeof v === 'number' ? v : null
      return { ...b, profit, ret: pctOf(profit) }
    })
    const profit = l.profit - f.profit
    return { data: downsample(data), profit, ret: pctOf(profit), benchStats }
  }, [sliced, benches])
  const color = compare ? PORTFOLIO_COLOR : PROFIT_COLOR

  return (
    <Card title="Portfolio performance" hint="Profit over the period: change in value minus net deposits, plus dividends. The % is that profit relative to the money put in (value at the start of the period plus net deposits). Benchmarks assume the same deposits on the same dates.">
      <div className="mb-4">
        <CompareChips benches={benches} on={compare} onToggle={() => setCompare((c) => !c)} />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} min={rows[0].date} max={rows[rows.length - 1].date} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
          <span className="text-muted">{periodLabel(sliced, period)}</span>
          <span className="inline-flex items-center gap-1.5" title="Portfolio">
            <Dot color={color} />
            <span className={clsx('dotted', toneClass(profit))}>{signedMoney(profit)}</span>
            <span className="text-muted">
              (<Delta v={ret} />)
            </span>
          </span>
          {compare &&
            benchStats.map((b) => (
              <span key={b.symbol} className="inline-flex items-center gap-1.5" title={b.label}>
                <Dot color={b.color} />
                <Tone v={b.profit}>{signedMoney(b.profit)}</Tone>
                <span className="text-muted">
                  (<Delta v={b.ret} />)
                </span>
              </span>
            ))}
        </div>
      </div>
      <div className="h-[340px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart accessibilityLayer={false} data={data} margin={{ top: 10, right: 5, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gProfit" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" ticks={monthTicks(data as { date: string }[])} interval="preserveStartEnd" tickFormatter={timeTick(data as { date: string }[])} minTickGap={28} {...axisProps} />
            <YAxis {...axisProps} width={58} domain={['auto', 'auto']} tickFormatter={(v) => compactMoney(v).replace('€', '')} />
            <ReferenceLine y={0} stroke="#cfd2da" strokeDasharray="2 3" />
            <Tooltip content={<ChartTooltip title={(l: string) => date(l)} fmt={(v: number) => <Tone v={v}>{signedMoney(v)}</Tone>} />} />
            <Area type="monotone" dataKey="profit" name="Portfolio" stroke={color} fill="url(#gProfit)" strokeWidth={2} dot={false} isAnimationActive={false} />
            {compare &&
              benches.map((b, k) => (
                <Line key={b.symbol} type="monotone" dataKey={`b${k}`} name={b.label} stroke={b.color} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {compare && <LegendRow items={[{ label: 'Portfolio', color }, ...benches.map((b) => ({ label: b.label, color: b.color }))]} />}
    </Card>
  )
}

// ---------------------------------------------------------------- 3. dynamics of returns

type RetBar = { key: string; label: string; p: number; b: (number | null)[] }

/** Time-weighted return per calendar month or year, chained from period-end index values. */
function periodReturns(rows: Row[], n: number, by: 'month' | 'year'): RetBar[] {
  if (!rows.length) return []
  const ends = new Map<string, Row>()
  for (const r of rows) ends.set(by === 'month' ? r.date.slice(0, 7) : r.date.slice(0, 4), r)
  const out: RetBar[] = []
  let prevTwr = 1
  let prevB = rows[0].b
  for (const [key, r] of ends) {
    const [y, m] = key.split('-').map(Number)
    out.push({
      key,
      label: by === 'year' ? key : `${new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' })} ${String(y).slice(2)}`,
      p: (r.twr / prevTwr - 1) * 100,
      b: Array.from({ length: n }, (_, k) => {
        const a = prevB[k]
        const z = r.b[k]
        return a && z != null ? (z / a - 1) * 100 : null
      }),
    })
    prevTwr = r.twr
    prevB = r.b
  }
  return out
}

const fmtBarPct = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 10 ? a.toFixed(0) : a >= 1 ? a.toFixed(1).replace(/\.0$/, '') : a.toFixed(2)
  return `${v < 0 ? '-' : '+'}${s}%`
}

function BarLabel(props: any) {
  const { x, y, width, height, value } = props
  if (value == null) return null
  const top = Math.min(y, y + height)
  const bottom = Math.max(y, y + height)
  return (
    <text x={x + width / 2} y={value >= 0 ? top - 7 : bottom + 15} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={value >= 0 ? PROFIT_COLOR : '#f27362'}>
      {fmtBarPct(value)}
    </text>
  )
}

function ReturnsCard({ rows, benches }: { rows: Row[]; benches: Bench[] }) {
  const [tab, setTab] = useState('12m')
  const [compare, setCompare] = useState(false)
  const [details, setDetails] = useState(false)
  const years = useMemo(() => {
    const a = Number(rows[0].date.slice(0, 4))
    const b = Number(rows[rows.length - 1].date.slice(0, 4))
    return Array.from({ length: b - a + 1 }, (_, i) => String(b - i))
  }, [rows])
  const monthly = useMemo(() => periodReturns(rows, benches.length, 'month'), [rows, benches.length])
  const yearly = useMemo(() => periodReturns(rows, benches.length, 'year'), [rows, benches.length])
  const bars = tab === 'all' ? yearly : tab === '12m' ? monthly.slice(-12) : monthly.filter((m) => m.key.startsWith(tab))
  const data = bars.map((r) => {
    const o: Record<string, number | string | null> = { label: r.label, p: r.p, pColor: compare ? PORTFOLIO_COLOR : r.p >= 0 ? UP_BAR : DOWN_BAR }
    benches.forEach((_, k) => (o[`b${k}`] = r.b[k]))
    return o
  })

  return (
    <Card title="Dynamics of portfolio returns" hint="Time-weighted return of each month (or of each year under “all”), unaffected by deposits and withdrawals.">
      <div className="mb-4">
        <CompareChips benches={benches} on={compare} onToggle={() => setCompare((c) => !c)} />
      </div>
      <Pills options={[{ value: 'all', label: 'all' }, { value: '12m', label: '12m' }, ...years.map((y) => ({ value: y, label: y }))]} value={tab} onChange={setTab} />
      {data.length === 0 ? (
        <Empty>No data for this period</Empty>
      ) : (
        <div className="mt-5 h-[380px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart accessibilityLayer={false} data={data} margin={{ top: 24, right: 5, left: 0, bottom: 8 }} barCategoryGap="22%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} fontSize={12.5} tickMargin={10} />
              <YAxis {...axisProps} width={46} tickFormatter={(v) => `${Math.round(v)}%`} />
              <ReferenceLine y={0} stroke="#6b6b7b" />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                content={<ChartTooltip title={(l: string) => l} fmt={(v: number) => <Tone v={v}>{pct(v)}</Tone>} />}
              />
              <Bar dataKey="p" name="Portfolio" radius={3} maxBarSize={96} isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.pColor as string} />
                ))}
                {!compare && <LabelList dataKey="p" content={BarLabel} />}
              </Bar>
              {compare &&
                benches.map((b, k) => (
                  <Bar key={b.symbol} dataKey={`b${k}`} name={b.label} fill={b.color} fillOpacity={0.85} radius={3} maxBarSize={96} isAnimationActive={false} />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <LegendRow items={[{ label: 'Portfolio', color: compare ? PORTFOLIO_COLOR : UP_BAR }, ...(compare ? benches.map((b) => ({ label: b.label, color: b.color })) : [])]} />
      {details && bars.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Period</th>
                <th className="th text-right">Portfolio</th>
                {benches.map((b) => (
                  <th key={b.symbol} className="th text-right">
                    {b.label}
                  </th>
                ))}
                {benches[0] && <th className="th text-right">vs {benches[0].label}</th>}
              </tr>
            </thead>
            <tbody>
              {[...bars].reverse().map((r) => (
                <tr key={r.key} className="border-b border-line/60 last:border-0">
                  <td className="td text-white">{r.label}</td>
                  <td className="td text-right">
                    <Tone v={r.p}>{pct(r.p)}</Tone>
                  </td>
                  {benches.map((b, k) => (
                    <td key={b.symbol} className="td text-right">
                      <Tone v={r.b[k]}>{pct(r.b[k])}</Tone>
                    </td>
                  ))}
                  {benches[0] && (
                    <td className="td text-right">
                      <Tone v={r.b[0] == null ? null : r.p - r.b[0]}>{r.b[0] == null ? '—' : pct(r.p - r.b[0])}</Tone>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-6 border-t border-line pt-5">
        <button className="inline-flex cursor-pointer items-center gap-2 text-[15px] text-body hover:text-white" onClick={() => setDetails((d) => !d)}>
          <Table2 size={17} /> {details ? 'Hide details' : 'View details'} <ArrowRight size={16} className={clsx('transition', details && 'rotate-90')} />
        </button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- page

export default function Growth() {
  const [selected, setSelected] = useStoredBenchmarks()
  const perf = useQuery({
    queryKey: ['performance', selected],
    queryFn: () => api.performance(selected),
    placeholderData: keepPreviousData,
  })

  const { rows, benches, names, missing } = useMemo(() => {
    const series = perf.data?.series ?? []
    const list: BenchmarkSeries[] = perf.data?.benchmarks ?? []
    const names = Object.fromEntries(list.map((b) => [b.symbol, b.name]))
    const ok = list.filter((b) => b.index)
    const benches: Bench[] = ok.map((b) => {
      const i = selected.indexOf(b.symbol)
      return { symbol: b.symbol, label: benchLabel(b.symbol, b.name), color: BENCH_COLORS[(i < 0 ? 0 : i) % BENCH_COLORS.length] }
    })
    const rows: Row[] = series.map((p, i) => ({ ...p, b: ok.map((b) => b.index?.[i] ?? null) }))
    return { rows, benches, names, missing: list.filter((b) => !b.index).map((b) => b.symbol) }
  }, [perf.data, selected])

  if (perf.isLoading) return <Loading />
  if (perf.error) return <ErrorBox error={perf.error} />
  if (!rows.length)
    return (
      <Card title="Growth">
        <Empty>Add transactions to see how your portfolio grows over time.</Empty>
      </Card>
    )

  return (
    <div className="space-y-6">
      <BenchmarkBar selected={selected} names={names} onChange={setSelected} />
      {missing.length > 0 && <div className="text-[13px] text-amber-200">No price data for {missing.join(', ')}</div>}
      <ValueCard rows={rows} benches={benches} />
      <ProfitCard rows={rows} benches={benches} />
      <ReturnsCard rows={rows} benches={benches} />
    </div>
  )
}
