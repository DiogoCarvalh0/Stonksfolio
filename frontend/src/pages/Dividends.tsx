import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRight, CalendarDays, CalendarRange, Check, ChevronLeft, ChevronRight, List, MoreHorizontal, Percent, PiggyBank } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Big, Card, Delta, Empty, ErrorBox, Hint, Loading, PageHeader, Segmented, Select, Stat, SymbolLogo } from '../components/ui'
import { api, type DividendRecord, type Holding, type UpcomingDividend } from '../lib/api'
import { frequencyLabel } from './stock/util'
import { compactMoney, date, money, num, pct } from '../lib/format'

// ---------------------------------------------------------------- shared bits

const PURPLE = '#7c5ce6'
const YOC_LINE = '#6fd3e8'
const YOC_BOX = '#3b3f4f'
const FUTURE_BAR = '#2f7099'
const RECEIVED_BY = '#5597f6'
const DONUT = ['#6233c2', '#5cc6c8', '#5ea1d8', '#9b1ff0', '#8fe5d6', '#4a6fc7', '#c86df5', '#2bcbc4', '#3d7be0', '#a78bfa', '#7dd3fc', '#5b5bd0']

const axisProps = { stroke: '#9a9aab', fontSize: 11.5, tickLine: false, axisLine: false } as const
const gridProps = { stroke: '#4a4a58', strokeDasharray: '4 4', vertical: false } as const

type Group = 'holding' | 'sector' | 'country'
const GROUPS: { value: Group; label: string }[] = [
  { value: 'holding', label: 'Holdings' },
  { value: 'sector', label: 'Sectors' },
  { value: 'country', label: 'Countries' },
]

const ticker = (s: string) => s.split('.')[0]

/** Round axis ticks from 0 up to (at least) `max`, e.g. 0, 0.5, 1, 1.5 … */
function niceTicks(max: number, count = 5): number[] | undefined {
  if (!(max > 0)) return undefined
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const n = Math.ceil(max / step - 1e-9)
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toPrecision(12))
}

function yScale(values: number[]) {
  if (values.some((v) => v < 0)) return {}
  const ticks = niceTicks(Math.max(0, ...values))
  return ticks ? { ticks, domain: [0, ticks[ticks.length - 1]] as [number, number], interval: 0 as const } : {}
}

function groupKey(g: Group, h: { symbol: string; sector?: string | null; country?: string | null } | undefined, symbol: string) {
  if (g === 'holding') return symbol
  const v = g === 'sector' ? h?.sector : h?.country
  return v || 'Other'
}

function groupLabel(g: Group, key: string) {
  return g === 'holding' ? ticker(key) : key
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

function Tip({ active, payload, rows }: { active?: boolean; payload?: { payload: unknown }[]; rows: (p: any) => { title: ReactNode; lines: [ReactNode, ReactNode, string?][] } }) {
  if (!active || !payload?.length) return null
  const r = rows(payload[0].payload)
  return (
    <div className="rounded bg-panel-2 px-3 py-2 text-[12px] shadow-xl">
      <div className="mb-1 text-muted">{r.title}</div>
      {r.lines.map(([l, v, c], i) => (
        <div key={i} className="flex items-center justify-between gap-5">
          <span className="inline-flex items-center gap-1.5 text-body">
            {c && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />}
            {l}
          </span>
          <span className="text-white">{v}</span>
        </div>
      ))}
    </div>
  )
}

function HeadStat({ label, value, color }: { label: string; value: ReactNode; color: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="w-[3px] self-stretch rounded" style={{ background: color }} />
      <div>
        <div className="text-[13px] text-muted">{label}</div>
        <div className="text-[17px] font-medium text-white">{value}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page

export default function Dividends() {
  const q = useQuery({ queryKey: ['dividends'], queryFn: api.dividends })
  const holdingsQ = useQuery({ queryKey: ['holdings', true], queryFn: () => api.holdings(true) })
  const [tab, setTab] = useState<'upcoming' | 'received'>('upcoming')
  const [calView, setCalView] = useState<CalView>('calendar')

  if (q.isLoading || holdingsQ.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  if (holdingsQ.error) return <ErrorBox error={holdingsQ.error} />
  const d = q.data!
  const all = holdingsQ.data ?? []
  const open = all.filter((h) => !h.closed)
  const bySymbol = new Map(all.map((h) => [h.symbol, h]))

  const value = open.reduce((s, h) => s + (h.value || 0), 0)
  const cost = open.reduce((s, h) => s + (h.cost || 0), 0)
  const yieldPct = value ? open.reduce((s, h) => s + h.dividend_yield * (h.value || 0), 0) / value : null
  const yocPct = cost ? open.reduce((s, h) => s + h.yield_on_cost * (h.cost || 0), 0) / cost : null
  const gIncome = d.growth.filter((g) => g.last_year != null).reduce((s, g) => s + g.annual_income, 0)
  const divGrowth = gIncome ? d.growth.reduce((s, g) => s + (g.last_year ?? 0) * g.annual_income, 0) / gIncome : null

  const toCalendar = () => {
    setTab('upcoming')
    document.getElementById('calendar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <>
      <PageHeader
        title="Dividends"
        sub={d.tax_rate > 0 ? `Amounts are net of ${d.tax_rate}% withholding tax` : 'Amounts are gross (set a withholding tax rate in Settings)'}
      />

      <div className="mb-[25px] grid gap-[25px] lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <div className="grid grid-rows-2 gap-[25px] [&>.card]:flex [&>.card]:flex-col [&>.card]:justify-center">
          <Stat icon={<Percent size={12} />} color="#3fa9f5" label="Yield" hint="Current dividend yield of your holdings (trailing 12-month dividends / price), weighted by value. Yield on cost uses your average purchase price instead.">
            <Big>{pct(yieldPct, 2, false)}</Big>
            <div className="mt-1.5 text-[14px] text-body">{pct(yocPct, 2, false)} yield on cost</div>
          </Stat>
          <Stat icon={<PiggyBank size={12} />} color="#5cd59b" label="Dividends" hint="Expected dividend income over the next 12 months. The % is the income-weighted dividend-per-share growth of your holdings over the last full year.">
            <div className="-mt-8 mb-2 flex justify-end text-[14px]">{divGrowth != null && <Delta v={divGrowth} digits={1} />}</div>
            <div className="flex items-baseline gap-2">
              <Big>{money(d.projected_annual)}</Big>
              <span className="text-[14px] text-body">annually</span>
            </div>
            <div className="mt-1.5 text-[14px] text-body">{money(d.projected_annual / 12)} monthly</div>
          </Stat>
        </div>
        <YieldCard holdings={open} />
      </div>

      <DiversificationCard holdings={open} className="mb-[25px]" />

      <div className="mb-[25px] grid gap-[25px] lg:grid-cols-2">
        <GrowthCard d={d} bySymbol={bySymbol} />
        <FutureCard d={d} onCalendar={toCalendar} />
      </div>

      <ReceivedCards received={d.received} bySymbol={bySymbol} />

      <section id="calendar" className="scroll-mt-6">
        <Card
          title={
            <Segmented
              options={[
                { value: 'upcoming', label: 'Calendar (next 12m)' },
                { value: 'received', label: 'Received' },
              ]}
              value={tab}
              onChange={setTab}
            />
          }
          action={tab === 'upcoming' && d.upcoming.length > 0 ? <ViewToggle value={calView} onChange={setCalView} /> : undefined}
          className={tab === 'upcoming' ? undefined : '!p-0 overflow-hidden [&>div:first-child]:px-5 [&>div:first-child]:pt-5'}
        >
          {tab === 'upcoming' ? (
            <Upcoming upcoming={d.upcoming} bySymbol={bySymbol} view={calView} />
          ) : (
            <div className="overflow-x-auto"><ReceivedTable rows={d.received} /></div>
          )}
        </Card>
      </section>
    </>
  )
}

// ---------------------------------------------------------------- yield / payout

type YieldRow = { key: string; label: string; name: string; yield: number; yoc: number; income: number }

function aggregate(holdings: Holding[], group: Group): YieldRow[] {
  const m = new Map<string, { value: number; cost: number; y: number; c: number; income: number; name: string }>()
  for (const h of holdings) {
    if (!(h.annual_income > 0)) continue
    const k = groupKey(group, h, h.symbol)
    const a = m.get(k) ?? { value: 0, cost: 0, y: 0, c: 0, income: 0, name: group === 'holding' ? h.name : k }
    a.value += h.value || 0
    a.cost += h.cost || 0
    a.y += h.dividend_yield * (h.value || 0)
    a.c += h.yield_on_cost * (h.cost || 0)
    a.income += h.annual_income
    m.set(k, a)
  }
  return [...m.entries()].map(([k, a]) => ({
    key: k,
    label: groupLabel(group, k),
    name: a.name,
    yield: a.value ? a.y / a.value : 0,
    yoc: a.cost ? a.c / a.cost : 0,
    income: a.income,
  }))
}

/** Purple bar = current yield; grey box topped by a cyan line = yield on cost. */
function YieldShape(props: any) {
  const { x, y, width, height, payload } = props
  const top = Math.max(payload.yield, payload.yoc)
  if (!top || !height) return null
  const bottom = y + height
  const px = height / top
  const yieldH = payload.yield * px
  const yocY = bottom - payload.yoc * px
  return (
    <g>
      {payload.yoc > payload.yield && <rect x={x} y={yocY} width={width} height={bottom - yocY} fill={YOC_BOX} />}
      <path d={`M${x},${bottom} v${-yieldH + 4} q0,-4 4,-4 h${width - 8} q4,0 4,4 v${yieldH - 4} z`} fill={PURPLE} />
      <rect x={x} y={yocY - 1.5} width={width} height={3} fill={YOC_LINE} />
    </g>
  )
}

function YieldCard({ holdings }: { holdings: Holding[] }) {
  const [metric, setMetric] = useState<'yield' | 'payout'>('yield')
  const [group, setGroup] = useState<Group>('holding')
  const rows = useMemo(() => {
    const r = aggregate(holdings, group)
    return r.sort((a, b) => (metric === 'yield' ? b.yield - a.yield : b.income - a.income)).map((x) => ({ ...x, top: Math.max(x.yield, x.yoc) }))
  }, [holdings, group, metric])
  return (
    <Card
      title="Yield/Payout"
      hint="Purple: current dividend yield. The line above it marks your yield on cost (dividends / your average purchase price). Switch to Annual payout to see expected yearly income instead."
      action={
        <div className="flex items-center gap-2">
          <Select value={metric} onChange={setMetric} options={[{ value: 'yield', label: 'Yield (%)' }, { value: 'payout', label: 'Annual payout (€)' }]} />
          <Select value={group} onChange={setGroup} options={GROUPS} />
        </div>
      }
    >
      {!rows.length ? (
        <Empty>None of your holdings pay dividends.</Empty>
      ) : (
        <div className="h-[270px]">
          <ResponsiveContainer>
            <BarChart accessibilityLayer={false} data={rows} margin={{ top: 10, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} dy={6} interval={0} />
              <YAxis {...axisProps} {...yScale(rows.map((r) => (metric === 'yield' ? r.top : r.income)))} width={48} tickFormatter={(v) => (metric === 'yield' ? `${+Number(v).toFixed(2)}%` : compactMoney(Number(v)))} />
              <Tooltip
                cursor={{ fill: '#ffffff08' }}
                content={
                  <Tip
                    rows={(p: YieldRow) => ({
                      title: p.name,
                      lines:
                        metric === 'yield'
                          ? [
                              ['Yield', pct(p.yield, 2, false), PURPLE],
                              ['Yield on cost', pct(p.yoc, 2, false), YOC_LINE],
                            ]
                          : [['Annual payout', money(p.income), PURPLE]],
                    })}
                  />
                }
              />
              {metric === 'yield' ? (
                <Bar dataKey="top" shape={<YieldShape />} isAnimationActive={false} maxBarSize={170} />
              ) : (
                <Bar dataKey="income" fill={PURPLE} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={170} />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- diversification

function DonutLabel(props: any) {
  const { cx, cy, midAngle, outerRadius, percent } = props
  if (percent < 0.02) return null
  const r = outerRadius + 20
  const a = (-midAngle * Math.PI) / 180
  const x = cx + r * Math.cos(a)
  const y = cy + r * Math.sin(a)
  return (
    <text x={x} y={y} fill="#adb5bd" fontSize={11.5} textAnchor={x > cx + 4 ? 'start' : x < cx - 4 ? 'end' : 'middle'} dominantBaseline="central">
      {(percent * 100).toFixed(1)}%
    </text>
  )
}

function DiversificationCard({ holdings, className }: { holdings: Holding[]; className?: string }) {
  const [group, setGroup] = useState<Group>('holding')
  const [hover, setHover] = useState<string | null>(null)
  const items = useMemo(() => {
    const r = aggregate(holdings, group).sort((a, b) => b.income - a.income)
    const total = r.reduce((s, x) => s + x.income, 0)
    return r.map((x, i) => ({ ...x, pct: total ? (x.income / total) * 100 : 0, color: DONUT[i % DONUT.length] }))
  }, [holdings, group])
  return (
    <Card
      title="Passive income diversification"
      hint="How your expected annual dividend income is split across holdings, sectors or countries."
      action={<Select value={group} onChange={setGroup} options={GROUPS} />}
      className={className}
    >
      {!items.length ? (
        <Empty>No dividend income expected.</Empty>
      ) : (
        <div className="grid items-center gap-8 py-4 md:grid-cols-2">
          <div className="mx-auto aspect-square w-full max-w-[400px]">
            <ResponsiveContainer>
              <PieChart accessibilityLayer={false} margin={{ top: 30, right: 50, bottom: 30, left: 50 }}>
                <Pie
                  data={items}
                  dataKey="income"
                  nameKey="label"
                  innerRadius="69%"
                  outerRadius="100%"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  label={<DonutLabel />}
                  labelLine={false}
                  isAnimationActive={false}
                  onMouseEnter={(_, i) => setHover(items[i]?.key ?? null)}
                  onMouseLeave={() => setHover(null)}
                >
                  {items.map((x) => (
                    <Cell key={x.key} fill={x.color} opacity={hover && hover !== x.key ? 0.35 : 1} className="outline-none" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-4 md:pr-8">
            {items.map((x) => (
              <div key={x.key} onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)} className={clsx('transition', hover && hover !== x.key && 'opacity-50')}>
                <div className="mb-1.5 flex items-center justify-between gap-4 text-[14px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                    {group === 'holding' ? (
                      <Link to={`/stock/${x.key}`} className="truncate text-white hover:underline">
                        {x.label} - {x.name}
                      </Link>
                    ) : (
                      <span className="truncate text-white">{x.label}</span>
                    )}
                  </span>
                  <span className="shrink-0">
                    <span className="text-white">{x.pct.toFixed(1)}%</span> <span className="ml-1 text-muted">({money(x.income)})</span>
                  </span>
                </div>
                <div className="h-1.5 rounded bg-line">
                  <div className="h-1.5 rounded" style={{ width: `${x.pct}%`, background: x.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- growth

function GrowthCard({ d, bySymbol }: { d: { growth: { symbol: string; name: string; annual_income: number; cagr: number; years: number }[] }; bySymbol: Map<string, Holding> }) {
  const [group, setGroup] = useState<Group>('holding')
  const rows = useMemo(() => {
    const m = new Map<string, { w: number; g: number; name: string; years: number[] }>()
    for (const g of d.growth) {
      const k = groupKey(group, bySymbol.get(g.symbol), g.symbol)
      const a = m.get(k) ?? { w: 0, g: 0, name: group === 'holding' ? g.name : k, years: [] }
      const w = Math.max(g.annual_income, 1e-9)
      a.w += w
      a.g += g.cagr * w
      a.years.push(g.years)
      m.set(k, a)
    }
    return [...m.entries()]
      .map(([k, a]) => ({ key: k, label: groupLabel(group, k), name: a.name, cagr: a.g / a.w, years: Math.min(...a.years) }))
      .sort((a, b) => b.cagr - a.cagr)
  }, [d.growth, group, bySymbol])
  return (
    <Card
      title="Average annual growth"
      hint="Compound annual growth of the dividend per share over the last 5 full calendar years (fewer if the company has paid for less time). Sectors and countries are weighted by your income."
      action={<Select value={group} onChange={setGroup} options={GROUPS} />}
    >
      {!rows.length ? (
        <Empty>Not enough dividend history yet.</Empty>
      ) : (
        <div className="h-[300px]">
          <ResponsiveContainer>
            <BarChart accessibilityLayer={false} data={rows} margin={{ top: 10, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} dy={6} interval={0} />
              <YAxis {...axisProps} {...yScale(rows.map((r) => r.cagr))} width={44} tickFormatter={(v) => `${+Number(v).toFixed(1)}%`} />
              <Tooltip
                cursor={{ fill: '#ffffff08' }}
                content={<Tip rows={(p) => ({ title: p.name, lines: [[`${p.years}y avg. growth`, pct(p.cagr, 2), PURPLE]] })} />}
              />
              <Bar dataKey="cagr" isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={170}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={r.cagr >= 0 ? '#8452f0' : '#e16c66'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- future payments

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const today = () => new Date()
const ymLabel = (ym: string, withYear = false) => `${MONTHS[+ym.slice(5, 7) - 1]}${withYear ? ` '${ym.slice(2, 4)}` : ''}`

function FutureCard({ d, onCalendar }: { d: { projected_by_month: { month: string; amount: number }[]; projected_annual: number }; onCalendar: () => void }) {
  const [showEmpty, setShowEmpty] = useState(false)
  const [menu, setMenu] = useState(false)
  const ref = useClickOutside(menu, () => setMenu(false))
  const rows = useMemo(() => {
    const now = today()
    const all = Array.from({ length: 12 }, (_, i) => {
      const t = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const ym = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
      return { month: ym, amount: d.projected_by_month.find((m) => m.month === ym)?.amount ?? 0 }
    })
    const list = showEmpty ? all : all.filter((m) => m.amount > 0)
    return list.map((m) => ({ ...m, label: ymLabel(m.month) }))
  }, [d.projected_by_month, showEmpty])
  return (
    <Card
      title="Future payments"
      hint="Expected dividends for the next 12 months, based on the last 12 months of payouts and announced ex-dividend dates, for the shares you hold today."
      action={
        <div className="flex items-center gap-1">
          <button onClick={onCalendar} className="inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[14px] text-body hover:text-white">
            Calendar <ArrowRight size={15} />
          </button>
          <div className="relative" ref={ref}>
            <button onClick={() => setMenu((m) => !m)} className="cursor-pointer rounded p-1 text-body hover:text-white" title="Options">
              <MoreHorizontal size={18} />
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-52 rounded-md bg-panel-2 p-1 shadow-2xl">
                <button
                  onClick={() => {
                    setShowEmpty((s) => !s)
                    setMenu(false)
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left text-[13.5px] text-body hover:bg-line/60 hover:text-white"
                >
                  Show months without payments {showEmpty && <Check size={14} className="text-accent" />}
                </button>
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-4 flex gap-8">
        <HeadStat label="Next 12m" value={money(d.projected_annual)} color="#3fa9f5" />
        <HeadStat label="Monthly" value={money(d.projected_annual / 12)} color={YOC_LINE} />
      </div>
      {!rows.length ? (
        <Empty>No upcoming dividends expected.</Empty>
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer>
            <BarChart accessibilityLayer={false} data={rows} margin={{ top: 22, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} dy={6} interval={0} />
              <YAxis hide />
              <Tooltip cursor={{ fill: '#ffffff08' }} content={<Tip rows={(p) => ({ title: date(`${p.month}-01`, { month: 'long', year: 'numeric' }), lines: [['Expected', money(p.amount), FUTURE_BAR]] })} />} />
              <Bar dataKey="amount" fill={FUTURE_BAR} radius={[8, 8, 8, 8]} barSize={16} isAnimationActive={false}>
                <LabelList dataKey="amount" position="top" offset={8} fill="#adb5bd" fontSize={11} formatter={(v: unknown) => (Number(v) > 0 ? `€${Math.round(Number(v))}` : '')} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- received

type RecvRange = '12m' | 'ytd' | 'last_year' | '3y' | '5y' | 'all'
const RECV_RANGES: { value: RecvRange; label: string }[] = [
  { value: '12m', label: '12 trailing months' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_year', label: 'Last year' },
  { value: '3y', label: '3 years' },
  { value: '5y', label: '5 years' },
  { value: 'all', label: 'All time' },
]
type Interval = 'month' | 'quarter' | 'year'

const ym = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`

function rangeBounds(r: RecvRange, first: string | null): [string, string] {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (r) {
    case '12m': return [ym(new Date(y, m - 11, 1)), ym(now)]
    case 'ytd': return [`${y}-01`, ym(now)]
    case 'last_year': return [`${y - 1}-01`, `${y - 1}-12`]
    case '3y': return [ym(new Date(y, m - 35, 1)), ym(now)]
    case '5y': return [ym(new Date(y, m - 59, 1)), ym(now)]
    case 'all': return [first ? first.slice(0, 7) : ym(now), ym(now)]
  }
}

function bucketOf(month: string, iv: Interval) {
  if (iv === 'year') return month.slice(0, 4)
  if (iv === 'quarter') return `${month.slice(0, 4)}-Q${Math.floor((+month.slice(5, 7) - 1) / 3) + 1}`
  return month
}

function ReceivedCards({ received, bySymbol }: { received: DividendRecord[]; bySymbol: Map<string, Holding> }) {
  const [range, setRange] = useState<RecvRange>('12m')
  const [iv, setIv] = useState<Interval>('month')
  const [group, setGroup] = useState<Group>('holding')
  const first = received.length ? received[received.length - 1].date : null
  const [from, to] = rangeBounds(range, first)
  const inRange = useMemo(() => received.filter((r) => r.date.slice(0, 7) >= from && r.date.slice(0, 7) <= to), [received, from, to])
  const total = inRange.reduce((s, r) => s + (r.amount_eur || 0), 0)

  const timeline = useMemo(() => {
    const buckets: string[] = []
    const [fy, fm] = from.split('-').map(Number)
    for (let t = new Date(fy, fm - 1, 1); ym(t) <= to; t.setMonth(t.getMonth() + 1)) {
      const b = bucketOf(ym(t), iv)
      if (buckets[buckets.length - 1] !== b) buckets.push(b)
    }
    const sums = new Map<string, number>()
    for (const r of inRange) sums.set(bucketOf(r.date.slice(0, 7), iv), (sums.get(bucketOf(r.date.slice(0, 7), iv)) ?? 0) + (r.amount_eur || 0))
    const multiYear = from.slice(0, 4) !== to.slice(0, 4)
    return buckets.map((b) => ({
      key: b,
      label: iv === 'month' ? ymLabel(b, multiYear) : iv === 'quarter' ? `${b.slice(5)} '${b.slice(2, 4)}` : b,
      amount: sums.get(b) ?? 0,
    }))
  }, [inRange, from, to, iv])

  const byGroup = useMemo(() => {
    const m = new Map<string, { amount: number; name: string }>()
    for (const r of inRange) {
      const k = groupKey(group, bySymbol.get(r.symbol), r.symbol)
      const a = m.get(k) ?? { amount: 0, name: group === 'holding' ? r.name : k }
      a.amount += r.amount_eur || 0
      m.set(k, a)
    }
    return [...m.entries()].map(([k, a]) => ({ key: k, label: groupLabel(group, k), ...a })).sort((a, b) => b.amount - a.amount)
  }, [inRange, group, bySymbol])

  const rangeLabel = RECV_RANGES.find((r) => r.value === range)!.label.toLowerCase()
  return (
    <div className="mb-[25px] grid gap-[25px] lg:grid-cols-2">
      <Card
        title="Dividends received"
        hint="Dividends paid out to you in the selected period."
        action={
          <div className="flex items-center gap-1">
            <Select value={range} onChange={setRange} options={RECV_RANGES} />
            <Select value={iv} onChange={setIv} options={[{ value: 'month', label: 'Monthly' }, { value: 'quarter', label: 'Quarterly' }, { value: 'year', label: 'Yearly' }]} />
          </div>
        }
      >
        <div className="mb-4">
          <HeadStat label="Total" value={money(total)} color={PURPLE} />
        </div>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <BarChart accessibilityLayer={false} data={timeline} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="label" {...axisProps} dy={6} minTickGap={8} />
              <YAxis {...axisProps} {...yScale(timeline.map((r) => r.amount))} width={44} tickFormatter={(v) => compactMoney(Number(v))} />
              <Tooltip cursor={{ fill: '#ffffff08' }} content={<Tip rows={(p) => ({ title: p.label, lines: [['Received', money(p.amount), PURPLE]] })} />} />
              <Bar dataKey="amount" fill={PURPLE} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card
        title="Dividends received"
        hint={`Dividends received in the ${rangeLabel} period, by ${GROUPS.find((g) => g.value === group)!.label.toLowerCase()}. The period follows the card on the left.`}
        action={<Select value={group} onChange={setGroup} options={GROUPS} />}
      >
        {!byGroup.length ? (
          <Empty>No dividends received in this period.</Empty>
        ) : (
          <div className="h-[316px]">
            <ResponsiveContainer>
              <BarChart accessibilityLayer={false} data={byGroup} margin={{ top: 10, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} dy={6} interval={0} />
                <YAxis {...axisProps} {...yScale(byGroup.map((r) => r.amount))} width={44} tickFormatter={(v) => compactMoney(Number(v))} />
                <Tooltip cursor={{ fill: '#ffffff08' }} content={<Tip rows={(p) => ({ title: p.name, lines: [['Received', money(p.amount), RECEIVED_BY]] })} />} />
                <Bar dataKey="amount" fill={RECEIVED_BY} radius={[4, 4, 0, 0]} maxBarSize={170} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- tables

// ---------------------------------------------------------------- upcoming calendar / list

type CalView = 'calendar' | 'list'
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ymOf = (s: string) => s.slice(0, 7)
const ymLongLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: '2-digit' })
}
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const t = new Date(y, m - 1 + n, 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
}
const localAmount = (u: UpcomingDividend) => u.per_share * u.shares

function MonthPill({ amount }: { amount: number }) {
  return <span className="rounded-md bg-up/15 px-3 py-1 text-[14px] text-up">+{money(amount)}</span>
}

function ViewToggle({ value, onChange }: { value: CalView; onChange: (v: CalView) => void }) {
  const opts: { v: CalView; label: string; icon: ReactNode }[] = [
    { v: 'calendar', label: 'Calendar', icon: <CalendarDays size={15} /> },
    { v: 'list', label: 'List', icon: <List size={15} /> },
  ]
  return (
    <div className="inline-flex rounded-md bg-panel-2 p-1">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={clsx(
            'inline-flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-[13.5px] transition',
            value === o.v ? 'bg-white text-[#282832]' : 'text-muted hover:text-white',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Upcoming({ upcoming, bySymbol, view }: { upcoming: UpcomingDividend[]; bySymbol: Map<string, Holding>; view: CalView }) {
  const perYear = useMemo(() => {
    const m = new Map<string, number>()
    upcoming.forEach((u) => m.set(u.symbol, (m.get(u.symbol) ?? 0) + 1))
    return m
  }, [upcoming])
  const byMonth = useMemo(() => {
    const m = new Map<string, UpcomingDividend[]>()
    ;[...upcoming].sort((a, b) => a.date.localeCompare(b.date)).forEach((u) => {
      const k = ymOf(u.date)
      m.set(k, [...(m.get(k) ?? []), u])
    })
    return m
  }, [upcoming])

  if (!upcoming.length) return <Empty>No upcoming dividends expected.</Empty>
  const info = { perYear, bySymbol }
  return view === 'calendar' ? <MonthCalendar byMonth={byMonth} info={info} /> : <MonthList byMonth={byMonth} info={info} />
}

type RowInfo = { perYear: Map<string, number>; bySymbol: Map<string, Holding> }

function MonthCalendar({ byMonth, info }: { byMonth: Map<string, UpcomingDividend[]>; info: RowInfo }) {
  const months = [...byMonth.keys()]
  const today = new Date()
  const thisYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const first = months[0] < thisYm ? months[0] : thisYm
  const last = months[months.length - 1]
  const [ym, setYm] = useState(first)

  const items = byMonth.get(ym) ?? []
  const [y, m] = ym.split('-').map(Number)
  const lead = new Date(y, m - 1, 1).getDay()
  const days = new Date(y, m, 0).getDate()
  const cells = Math.ceil((lead + days) / 7) * 7
  const total = items.reduce((s, u) => s + u.amount_eur, 0)

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button disabled={ym <= first} onClick={() => setYm(shiftYm(ym, -1))} className="cursor-pointer rounded p-1 text-body hover:text-white disabled:cursor-default disabled:opacity-30">
          <ChevronLeft size={20} />
        </button>
        <h3 className="min-w-40 text-center text-[22px] text-white">{ymLongLabel(ym)}</h3>
        <button disabled={ym >= last} onClick={() => setYm(shiftYm(ym, 1))} className="cursor-pointer rounded p-1 text-body hover:text-white disabled:cursor-default disabled:opacity-30">
          <ChevronRight size={20} />
        </button>
        {total > 0 && <MonthPill amount={total} />}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-b border-dashed border-line px-3 pb-3 text-[13px] font-medium uppercase text-muted">{w}</div>
          ))}
          {Array.from({ length: cells }, (_, i) => {
            const day = i - lead + 1
            const inMonth = day >= 1 && day <= days
            const ds = `${ym}-${String(day).padStart(2, '0')}`
            const list = inMonth ? items.filter((u) => u.date === ds) : []
            const dayTotal = list.reduce((s, u) => s + u.amount_eur, 0)
            return (
              <div
                key={i}
                className={clsx('min-h-[110px] border-b border-dashed border-line p-2', i % 7 !== 6 && 'border-r', !inMonth && 'bg-panel-2/70')}
              >
                {inMonth && (
                  <>
                    <div className="mb-2 flex items-center justify-between px-1 text-[14px]">
                      <span className="text-body">{day}</span>
                      {dayTotal > 0 && <span className="text-up">+{money(dayTotal)}</span>}
                    </div>
                    <div className="space-y-1.5">
                      {list.map((u, k) => {
                        const h = info.bySymbol.get(u.symbol)
                        return (
                          <Link key={k} to={`/stock/${u.symbol}`} className="block rounded bg-panel-2 p-2 hover:bg-line">
                            <div className="flex min-w-0 items-center gap-2 text-[13px]">
                              <SymbolLogo symbol={u.symbol} size={22} />
                              <span className="font-semibold text-white">{ticker(u.symbol)}</span>
                              <span className="truncate text-body">{u.name}</span>
                            </div>
                            <div className="mt-1.5 text-[13px] text-body">
                              <span className="font-medium text-white">{money(localAmount(u), u.currency)}</span>
                              {h?.dividend_yield ? <> • {pct(h.dividend_yield, 2, false)}</> : null}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MonthList({ byMonth, info }: { byMonth: Map<string, UpcomingDividend[]>; info: RowInfo }) {
  return (
    <div className="space-y-8">
      {[...byMonth.entries()].map(([ym, items]) => (
        <div key={ym}>
          <div className="mb-3 flex items-center gap-4">
            <h3 className="text-[22px] text-white">{ymLongLabel(ym)}</h3>
            <MonthPill amount={items.reduce((s, u) => s + u.amount_eur, 0)} />
          </div>
          <div className="overflow-x-auto rounded-md bg-panel-2/40 px-4 py-2">
            <table className="w-full min-w-[720px] table-fixed">
              <colgroup>
                <col className="w-[34%]" />
                <col className="w-[18%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
              </colgroup>
              <tbody>
                {items.map((u, i) => {
                  const h = info.bySymbol.get(u.symbol)
                  return (
                    <tr key={i} className="border-t border-line/60 first:border-t-0">
                      <td className="py-3 pr-4">
                        <Link to={`/stock/${u.symbol}`} className="flex items-center gap-3 hover:underline">
                          <SymbolLogo symbol={u.symbol} size={40} />
                          <div className="min-w-0">
                            <div className="max-w-72 truncate text-[14.5px] text-white">{u.name}</div>
                            <div className="text-[13px] text-muted">{ticker(u.symbol)}</div>
                          </div>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-[14.5px] text-white">{date(u.date, { month: 'short', day: 'numeric', year: '2-digit' })}</div>
                        <div className="flex items-center gap-1.5 text-[13px] text-muted">
                          <span className={clsx('inline-block h-2 w-2 rounded-full', u.confirmed ? 'bg-up' : 'bg-line')} />
                          {u.confirmed ? 'Announced' : 'Estimated'}
                          <Hint text={u.confirmed ? 'Ex-dividend date announced by the company.' : 'Projected from the past payment schedule; date and amount may change.'} />
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-[14.5px] font-medium text-white">{money(localAmount(u), u.currency)}</div>
                        <div className="text-[13px] text-muted">
                          {num(u.shares, 3)}×{money(u.per_share, u.currency)}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-[14px] text-body">
                        <span className="inline-flex items-center gap-2">
                          <CalendarRange size={15} className="text-muted" />
                          {frequencyLabel(info.perYear.get(u.symbol) ?? 0)}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="text-[14.5px] text-white">{h?.dividend_yield ? pct(h.dividend_yield, 2, false) : '—'}</div>
                        <div className="text-[12px] text-muted">yield</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

function ReceivedTable({ rows }: { rows: DividendRecord[] }) {
  return (
    <table className="w-full">
      <thead className="bg-panel-2/50">
        <tr>
          <th className="th">Ex-date</th>
          <th className="th">Holding</th>
          <th className="th text-right">Shares</th>
          <th className="th text-right">Per share</th>
          <th className="th text-right">Amount (local)</th>
          <th className="th text-right">Amount (EUR)</th>
          <th className="th">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-line/60">
            <td className="td">{date(r.date)}</td>
            <td className="td">
              <Link to={`/stock/${r.symbol}`} className="font-medium hover:underline">{r.symbol}</Link>
            </td>
            <td className="td text-right">{num(r.shares, 4)}</td>
            <td className="td text-right">{money(r.per_share, r.currency, 4)}</td>
            <td className="td text-right">{money(r.amount_local, r.currency)}</td>
            <td className="td text-right font-medium">{money(r.amount_eur)}</td>
            <td className="td text-xs text-muted">{r.source}</td>
          </tr>
        ))}
        {!rows.length && (
          <tr><td colSpan={7}><Empty>No dividends received yet.</Empty></td></tr>
        )}
      </tbody>
    </table>
  )
}
