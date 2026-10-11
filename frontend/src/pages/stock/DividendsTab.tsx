import clsx from 'clsx'
import { CheckCircle2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Delta, Empty } from '../../components/ui'
import { date, money, num, pct } from '../../lib/format'
import PriceChart, { RangeTabs } from './PriceChart'
import { dash, dividendStats, frequencyLabel, ttmYieldSeries, type Detail } from './util'

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-[130px]">
      <div className="text-[12.6px] text-muted">{label}</div>
      <div className="mt-1.5 text-[14px] text-white">{children}</div>
    </div>
  )
}

const dmy = (d: string) => date(d, { day: '2-digit', month: '2-digit', year: 'numeric' })

function PayoutTable({ d }: { d: Detail }) {
  const cur = d.security.currency
  const stats = dividendStats(d)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(10)
  const rows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const hist = d.dividend_history
    const out = hist.map((h, i) => {
      const prev = hist[i - 1]
      const change = prev && Math.abs(h.amount - prev.amount) > 1e-6 ? ((h.amount - prev.amount) / prev.amount) * 100 : null
      const sameYear = hist.filter((x) => x.date.slice(0, 4) === h.date.slice(0, 4)).length
      return { ...h, change, upcoming: h.date > today, period: frequencyLabel(stats.perYear || sameYear) }
    })
    if (stats.nextExDate && (!hist.length || stats.nextExDate > hist[hist.length - 1].date)) {
      out.push({ date: stats.nextExDate, amount: stats.last?.amount ?? 0, change: null, upcoming: true, period: frequencyLabel(stats.perYear) })
    }
    return out.reverse()
  }, [d, stats.nextExDate, stats.perYear, stats.last])
  if (!rows.length) return <Empty>This security has not paid dividends.</Empty>
  const pages = Math.ceil(rows.length / size)
  const view = rows.slice(page * size, page * size + size)
  const pageBtn = 'grid h-8 min-w-8 cursor-pointer place-items-center rounded-md bg-panel-2 px-2 text-[12.6px] text-body hover:bg-line disabled:cursor-default disabled:opacity-40'
  const nums = [...new Set([0, page - 2, page - 1, page, page + 1, page + 2, pages - 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b)
  return (
    <>
      <div className="-mx-[31.5px] overflow-x-auto px-[21px]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <th className="th">State</th>
              <th className="th">Ex.dividend date</th>
              <th className="th">Amount</th>
              <th className="th">Period</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.date} className="border-b border-line/70">
                <td className="td">
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-body">
                    {r.upcoming ? <Clock size={13} className="text-[#f5a623]" /> : <CheckCircle2 size={13} className="text-accent" />}
                    {r.upcoming ? 'Expected' : 'Paid'}
                  </span>
                </td>
                <td className="td">{dmy(r.date)}</td>
                <td className="td">
                  <div className={r.upcoming ? 'text-muted' : 'text-white'}>{money(r.amount, cur, r.amount < 0.1 ? 4 : 2)}</div>
                  {r.change != null && <Delta v={r.change} className="dotted text-[12px]" />}
                </td>
                <td className="td">
                  <span className="rounded bg-line px-2 py-1 text-[12px] text-body">{r.period}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button className={pageBtn} disabled={page === 0} onClick={() => setPage(0)}><ChevronsLeft size={14} /></button>
          <button className={pageBtn} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-muted">…</span>}
              <button className={clsx(pageBtn, n === page && '!bg-accent !text-white')} onClick={() => setPage(n)}>{n + 1}</button>
            </span>
          ))}
          <button className={pageBtn} disabled={page >= pages - 1} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
          <button className={pageBtn} disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}><ChevronsRight size={14} /></button>
        </div>
        <div className="flex items-center gap-3 text-[12.6px] text-body">
          <select className="input !h-8 !w-auto !py-0" value={size} onChange={(e) => { setSize(+e.target.value); setPage(0) }}>
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          See {page * size + 1}-{Math.min(rows.length, page * size + size)} from {rows.length}
        </div>
      </div>
    </>
  )
}

function AnnualChart({ d }: { d: Detail }) {
  const cur = d.security.currency
  const stats = dividendStats(d)
  const [range, setRange] = useState<'5y' | '10y' | 'all'>('10y')
  const data = useMemo(() => {
    const thisYear = new Date().getFullYear()
    const map = new Map(stats.byYear.map((y) => [+y.year, y.amount]))
    const first = range === 'all' ? Math.min(thisYear, ...map.keys()) : thisYear - (range === '5y' ? 5 : 10)
    const out = []
    for (let y = first; y <= thisYear; y++) {
      const paid = map.get(y) ?? 0
      const forecast = y === thisYear && stats.annualPayout ? Math.max(0, stats.annualPayout - paid) : 0
      out.push({ year: String(y), Dividends: paid, Forecast: forecast })
    }
    return out
  }, [stats.byYear, stats.annualPayout, range])
  return (
    <Card title="Payout history" action={<span className="text-[12.6px] text-muted">Annual, {cur}</span>}>
      <div className="mb-3"><RangeTabs options={['5y', '10y', 'all'] as const} value={range} onChange={setRange} /></div>
      <div className="h-72">
        <ResponsiveContainer>
          <BarChart accessibilityLayer={false} data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#41414f" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="year" stroke="#adb5bd" fontSize={11} tickLine={false} axisLine={{ stroke: '#41414f' }} />
            <YAxis stroke="#adb5bd" fontSize={11} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: '#ffffff08' }}
              contentStyle={{ background: '#3b3b49', border: 'none', borderRadius: 6, fontSize: 12 }}
              formatter={(v, name) => [money(Number(v), cur, 4), name]}
            />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: '#adb5bd' }} />
            <Bar dataKey="Dividends" stackId="a" fill="#3699ff" maxBarSize={36} />
            <Bar dataKey="Forecast" stackId="a" fill="#1d5a74" radius={[3, 3, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

export default function DividendsTab({ d }: { d: Detail }) {
  const cur = d.security.currency
  const s = dividendStats(d)
  const yieldRows = useMemo(() => ttmYieldSeries(d), [d])
  const spark = s.byYear.filter((y) => +y.year < new Date().getFullYear()).slice(-15)
  const g = (v: number | null) => (v == null ? dash : pct(v, 2, false))
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-[16px] font-medium text-white">Summary</div>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <Cell label="Dividend yield">{s.yieldPct ? pct(s.yieldPct, 2, false) : dash}</Cell>
                <Cell label="Annual payout">{s.annualPayout ? money(s.annualPayout, cur) : dash}</Cell>
                <Cell label="Next ex. div date">{s.nextExDate ? date(s.nextExDate, { day: 'numeric', month: 'long', year: '2-digit' }) : dash}</Cell>
                <Cell label="Payout">{s.payoutPct ? pct(s.payoutPct, 2, false) : dash}</Cell>
                <Cell label="Frequency">{s.perYear ? frequencyLabel(s.perYear) : dash}</Cell>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[16px] font-medium text-white">Growth</div>
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <Cell label="1 year">{g(s.growth[1])}</Cell>
                <Cell label="3 years">{g(s.growth[3])}</Cell>
                <Cell label="5 years">{g(s.growth[5])}</Cell>
                <Cell label="Dividend growth streak">{s.growthStreak ? `${s.growthStreak} y` : dash}</Cell>
                <Cell label="Dividend streak">{s.streak ? `${s.streak} y` : dash}</Cell>
              </div>
            </div>
          </div>
          {spark.length > 1 && (
            <div className="h-36 w-full max-w-[320px]">
              <ResponsiveContainer>
                <AreaChart accessibilityLayer={false} data={spark} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <defs>
                    <linearGradient id="sbSpark" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00aff5" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#00aff5" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    contentStyle={{ background: '#3b3b49', border: 'none', borderRadius: 6, fontSize: 12 }}
                    labelFormatter={(_, p) => p?.[0]?.payload?.year ?? ''}
                    formatter={(v) => [money(Number(v), cur, 4), 'Annual']}
                  />
                  <Area type="linear" dataKey="amount" stroke="#00aff5" strokeWidth={1.6} fill="url(#sbSpark)" dot={{ r: 2.5, fill: '#00aff5', strokeWidth: 0 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>
      <Card title="Payout history">
        <PayoutTable d={d} />
      </Card>
      {s.byYear.length > 0 && <AnnualChart d={d} />}
      {yieldRows.length > 0 && (
        <Card title="Div yield, TTM" hint="Dividends paid over the trailing twelve months divided by the price on each day">
          <PriceChart rows={yieldRows} fmt={(v) => `${num(v, 2)}%`} ranges={['6m', 'YTD', '1y', '5y', '10y', 'all']} deltaMode="points" />
        </Card>
      )}
    </>
  )
}
