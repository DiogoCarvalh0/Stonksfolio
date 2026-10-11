import clsx from 'clsx'
import { ArrowDown, ArrowDownUp, ArrowUp, ChevronDown, ChevronUp, Download, MessageCircle, MoreHorizontal, Plus, RotateCcw, Search, SlidersHorizontal, Star, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLinkProps } from '../lib/links'
import SymbolSearch from '../components/SymbolSearch'
import { Delta, Empty, ErrorBox, HoverTip, Loading, Modal, SymbolLogo } from '../components/ui'
import type { WatchItem } from '../lib/api'
import { compactMoney, date, money, num, signedMoney, toneClass } from '../lib/format'
import { useWatchlist } from '../lib/watchlist'

// ---------------------------------------------------------------- ranges & changes

const RANGES = ['1d', '7d', '1m', '3m', '6m', 'YTD', '1y'] as const
type RangeKey = (typeof RANGES)[number]

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function rangeStart(r: RangeKey): string | null {
  const d = new Date()
  if (r === '1d') return null
  if (r === '7d') d.setDate(d.getDate() - 7)
  else if (r === '1m') d.setMonth(d.getMonth() - 1)
  else if (r === '3m') d.setMonth(d.getMonth() - 3)
  else if (r === '6m') d.setMonth(d.getMonth() - 6)
  else if (r === 'YTD') return `${d.getFullYear() - 1}-12-31`
  else if (r === '1y') d.setFullYear(d.getFullYear() - 1)
  return iso(d)
}

type Change = { abs: number; pct: number; series: number[] }

/** Change from the last close on/before `from` (or the previous close for 1d) to the latest close. */
function changeFrom(hist: [string, number][], from: string | null): Change | null {
  if (hist.length < 2) return null
  let i = hist.length - 2
  if (from) {
    i = -1
    for (let k = 0; k < hist.length && hist[k][0] <= from; k++) i = k
    if (i < 0) i = 0
  }
  const base = hist[i][1]
  const last = hist[hist.length - 1][1]
  if (!base) return null
  return { abs: last - base, pct: (last / base - 1) * 100, series: hist.slice(i).map((h) => h[1]) }
}

// ---------------------------------------------------------------- layout

type ChangeMode = 'both' | 'pct' | 'amount'
type Sort = { key: string; dir: 1 | -1 }
type Layout = { cols: string[]; spark: boolean; logos: boolean; compact: boolean; changeMode: ChangeMode; range: RangeKey; sort: Sort }

const DEFAULT_LAYOUT: Layout = {
  cols: ['note', 'value', 'change', 'pe_ttm', 'pe_fwd', 'sma200', 'vs_sma200', 'shares', 'insider'],
  spark: true,
  logos: true,
  compact: false,
  changeMode: 'both',
  range: 'YTD',
  sort: { key: 'change', dir: -1 },
}
const LAYOUT_KEY = 'stonksfolio.watchlist.layout'
const LEGACY_LAYOUT_KEY = 'stonks.watchlist.layout'

function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? localStorage.getItem(LEGACY_LAYOUT_KEY) ?? 'null')
      if (saved && typeof saved === 'object') {
        const merged = { ...DEFAULT_LAYOUT, ...saved } as Layout
        merged.cols = (merged.cols ?? []).filter((c) => COLS.some((x) => x.id === c))
        if (!RANGES.includes(merged.range)) merged.range = DEFAULT_LAYOUT.range
        return merged
      }
    } catch {
      /* ignore corrupt layout */
    }
    return DEFAULT_LAYOUT
  })
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)), [layout])
  const update = (p: Partial<Layout>) => setLayout((l) => ({ ...l, ...p }))
  return { layout, update, reset: () => setLayout(DEFAULT_LAYOUT) }
}

// ---------------------------------------------------------------- columns

type Ctx = { layout: Layout; change: Map<string, Change | null>; sinceAdded: Map<string, Change | null>; onNote: (w: WatchItem) => void }
type Col = {
  id: string
  label: string
  /** Header text, when it differs from the settings label. */
  header?: (ctx: Ctx) => string
  group: string
  hint?: string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  value: (w: WatchItem, ctx: Ctx) => number | string | null
  cell: (w: WatchItem, ctx: Ctx) => ReactNode
}

const cur = (w: WatchItem) => w.currency ?? 'USD'
const dash = <span className="text-muted">—</span>
const ratio = (v: number | null, d = 2) => (v == null ? dash : num(v, d))
const pctCell = (v: number | null, d = 2) => (v == null ? dash : `${num(v, d)}%`)
const moneyCell = (v: number | null, w: WatchItem) => (v == null ? dash : money(v, cur(w)))
const dateCell = (v: string | null) => (v ? date(v, { day: '2-digit', month: '2-digit', year: 'numeric' }) : dash)
const compactNum = (v: number | null) => (v == null ? dash : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(v))
const upside = (w: WatchItem) => (w.target_price && w.price ? (w.target_price / w.price - 1) * 100 : null)
const fromHigh = (w: WatchItem) => (w.high_52w && w.price ? (w.price / w.high_52w - 1) * 100 : null)
const fromLow = (w: WatchItem) => (w.low_52w && w.price ? (w.price / w.low_52w - 1) * 100 : null)
const RATING: Record<string, string> = { strong_buy: 'Strong buy', buy: 'Buy', hold: 'Hold', underperform: 'Underperform', sell: 'Sell', none: '—' }
const RATING_ORDER: Record<string, number> = { strong_buy: 1, buy: 2, hold: 3, underperform: 4, sell: 5 }

function ChangeCell({ c, w, mode }: { c: Change | null | undefined; w: WatchItem; mode: ChangeMode }) {
  if (!c) return dash
  return (
    <div className="leading-snug">
      {mode !== 'pct' && <div className={toneClass(c.abs)}>{signedMoney(c.abs, cur(w))}</div>}
      {mode !== 'amount' && <Delta v={c.pct} />}
    </div>
  )
}

const vsCell = (v: number | null) => (v == null ? dash : <Delta v={v} />)

const COLS: Col[] = [
  // general
  {
    id: 'note',
    label: 'Note',
    group: 'General',
    align: 'center',
    sortable: false,
    value: (w) => w.note,
    cell: (w, ctx) => (
      <HoverTip text={w.note ?? ''} label={w.note ? 'Edit note' : 'Add note'} onClick={() => ctx.onNote(w)} className={clsx('cursor-pointer rounded p-1.5 hover:bg-panel-2', w.note ? 'text-accent' : 'text-muted hover:text-white')}>
        <MessageCircle size={17} fill={w.note ? 'currentColor' : 'none'} fillOpacity={w.note ? 0.2 : 0} />
      </HoverTip>
    ),
  },
  { id: 'value', label: 'Current value', group: 'General', hint: 'Last closing price, in the security’s own currency', value: (w) => w.price, cell: (w) => <span className="text-white">{moneyCell(w.price, w)}</span> },
  {
    id: 'change',
    label: 'Change (selected range)',
    header: (ctx) => ctx.layout.range,
    group: 'General',
    hint: 'Price change over the range selected above the table',
    value: (w, ctx) => ctx.change.get(w.symbol)?.pct ?? null,
    cell: (w, ctx) => {
      const c = ctx.change.get(w.symbol)
      return (
        <div className="flex items-center gap-3">
          <div className="w-[104px] shrink-0">
            <ChangeCell c={c} w={w} mode={ctx.layout.changeMode} />
          </div>
          {ctx.layout.spark && c && <Spark values={c.series} />}
        </div>
      )
    },
  },
  {
    id: 'since_added',
    label: 'Since added',
    group: 'General',
    hint: 'Price change since you added it to the watchlist',
    value: (w, ctx) => ctx.sinceAdded.get(w.symbol)?.pct ?? null,
    cell: (w, ctx) => <ChangeCell c={ctx.sinceAdded.get(w.symbol)} w={w} mode={ctx.layout.changeMode} />,
  },
  { id: 'added_at', label: 'Date added', group: 'General', value: (w) => w.added_at, cell: (w) => <span className="text-muted-2">{dateCell(w.added_at)}</span> },
  { id: 'market_cap', label: 'Market cap', group: 'General', value: (w) => w.market_cap, cell: (w) => (w.market_cap == null ? dash : compactMoney(w.market_cap, cur(w) === 'GBp' ? 'GBP' : cur(w))) },
  { id: 'sector', label: 'Sector', group: 'General', align: 'left', value: (w) => w.sector, cell: (w) => w.sector ?? dash },
  { id: 'country', label: 'Country', group: 'General', align: 'left', value: (w) => w.country, cell: (w) => w.country ?? dash },
  // valuation
  { id: 'pe_ttm', label: 'P/E TTM', group: 'Valuation', hint: 'Price / earnings over the trailing twelve months', value: (w) => w.pe_ttm, cell: (w) => ratio(w.pe_ttm, 1) },
  { id: 'pe_fwd', label: 'P/E FWD', group: 'Valuation', hint: 'Price / analysts’ expected earnings for the next fiscal year', value: (w) => w.pe_fwd, cell: (w) => ratio(w.pe_fwd, 1) },
  { id: 'peg', label: 'PEG', group: 'Valuation', hint: 'P/E divided by expected earnings growth', value: (w) => w.peg, cell: (w) => ratio(w.peg) },
  { id: 'pb', label: 'P/B', group: 'Valuation', hint: 'Price / book value per share', value: (w) => w.pb, cell: (w) => ratio(w.pb) },
  { id: 'eps_ttm', label: 'EPS TTM', group: 'Valuation', value: (w) => w.eps_ttm, cell: (w) => moneyCell(w.eps_ttm, w) },
  { id: 'eps_fwd', label: 'EPS FWD', group: 'Valuation', value: (w) => w.eps_fwd, cell: (w) => moneyCell(w.eps_fwd, w) },
  {
    id: 'target',
    label: 'Target price',
    group: 'Valuation',
    hint: 'Analysts’ mean target price and the upside from the last price',
    value: upside,
    cell: (w) =>
      w.target_price == null ? (
        dash
      ) : (
        <div className="leading-snug">
          <div>{money(w.target_price, cur(w))}</div>
          <Delta v={upside(w)} />
        </div>
      ),
  },
  { id: 'rating', label: 'Analyst rating', group: 'Valuation', value: (w) => (w.recommendation ? (RATING_ORDER[w.recommendation] ?? 9) : null), cell: (w) => (w.recommendation ? (RATING[w.recommendation] ?? w.recommendation) : dash) },
  // technicals
  { id: 'sma50', label: '50D SMA', group: 'Technicals', hint: 'Simple moving average of the last 50 daily closes', value: (w) => w.sma50, cell: (w) => moneyCell(w.sma50, w) },
  { id: 'vs_sma50', label: 'Last price vs. 50D SMA', group: 'Technicals', hint: 'How far the last price is above (+) or below (−) the 50-day SMA', value: (w) => w.vs_sma50_pct, cell: (w) => vsCell(w.vs_sma50_pct) },
  { id: 'sma200', label: '200D SMA', group: 'Technicals', hint: 'Simple moving average of the last 200 daily closes', value: (w) => w.sma200, cell: (w) => moneyCell(w.sma200, w) },
  { id: 'vs_sma200', label: 'Last price vs. 200D SMA', group: 'Technicals', hint: 'How far the last price is above (+) or below (−) the 200-day SMA', value: (w) => w.vs_sma200_pct, cell: (w) => vsCell(w.vs_sma200_pct) },
  {
    id: 'high_52w',
    label: '52W high',
    group: 'Technicals',
    hint: 'Highest close of the last 52 weeks and how far below it the last price is',
    value: fromHigh,
    cell: (w) =>
      w.high_52w == null ? (
        dash
      ) : (
        <div className="leading-snug">
          <div>{money(w.high_52w, cur(w))}</div>
          <Delta v={fromHigh(w)} />
        </div>
      ),
  },
  {
    id: 'low_52w',
    label: '52W low',
    group: 'Technicals',
    hint: 'Lowest close of the last 52 weeks and how far above it the last price is',
    value: fromLow,
    cell: (w) =>
      w.low_52w == null ? (
        dash
      ) : (
        <div className="leading-snug">
          <div>{money(w.low_52w, cur(w))}</div>
          <Delta v={fromLow(w)} />
        </div>
      ),
  },
  { id: 'beta', label: 'Beta', group: 'Technicals', hint: 'Volatility relative to the market (1 = moves with the market)', value: (w) => w.beta, cell: (w) => ratio(w.beta) },
  // dividends
  { id: 'div_yield', label: 'Dividend yield', group: 'Dividends', hint: 'Dividends paid over the last 12 months divided by the last price', value: (w) => w.dividend_yield, cell: (w) => pctCell(w.dividend_yield) },
  { id: 'div_rate', label: 'Annual dividend', group: 'Dividends', hint: 'Expected dividend per share over the next 12 months', value: (w) => w.dividend_rate, cell: (w) => moneyCell(w.dividend_rate, w) },
  { id: 'payout', label: 'Payout ratio', group: 'Dividends', hint: 'Share of earnings paid out as dividends', value: (w) => w.payout_ratio, cell: (w) => pctCell(w.payout_ratio, 1) },
  { id: 'ex_div', label: 'Ex-dividend date', group: 'Dividends', value: (w) => w.ex_dividend_date, cell: (w) => dateCell(w.ex_dividend_date) },
  { id: 'next_pay_date', label: 'Date of the next payment', group: 'Dividends', value: (w) => w.next_payment_date, cell: (w) => dateCell(w.next_payment_date) },
  { id: 'next_payment', label: 'Next payment', group: 'Dividends', hint: 'Amount per share of the next announced dividend', value: (w) => w.next_payment, cell: (w) => moneyCell(w.next_payment, w) },
  // ownership
  { id: 'shares', label: 'Shares outstanding', group: 'Ownership', value: (w) => w.shares_outstanding, cell: (w) => compactNum(w.shares_outstanding) },
  { id: 'insider', label: 'Insider %', group: 'Ownership', hint: 'Share of the company held by insiders (management, directors)', value: (w) => w.insider_pct, cell: (w) => pctCell(w.insider_pct) },
  { id: 'institutions', label: 'Institutions %', group: 'Ownership', hint: 'Share held by institutional investors', value: (w) => w.institutions_pct, cell: (w) => pctCell(w.institutions_pct) },
  { id: 'short', label: 'Short % of float', group: 'Ownership', value: (w) => w.short_pct, cell: (w) => pctCell(w.short_pct) },
  // fundamentals
  { id: 'revenue_growth', label: 'Revenue growth', group: 'Fundamentals', hint: 'Year-over-year revenue growth (latest quarter)', value: (w) => w.revenue_growth, cell: (w) => (w.revenue_growth == null ? dash : <Delta v={w.revenue_growth} />) },
  { id: 'profit_margin', label: 'Profit margin', group: 'Fundamentals', value: (w) => w.profit_margin, cell: (w) => pctCell(w.profit_margin, 1) },
  { id: 'roe', label: 'ROE', group: 'Fundamentals', hint: 'Return on equity', value: (w) => w.roe, cell: (w) => pctCell(w.roe, 1) },
  { id: 'earnings', label: 'Next earnings', group: 'Fundamentals', value: (w) => w.earnings_date, cell: (w) => dateCell(w.earnings_date) },
]
const COL_BY_ID = new Map(COLS.map((c) => [c.id, c]))
const GROUPS = [...new Set(COLS.map((c) => c.group))]
const headerText = (c: Col, ctx: Ctx) => c.header?.(ctx) ?? c.label

// ---------------------------------------------------------------- small components

function Spark({ values }: { values: number[] }) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2) return null
  const w = 84
  const h = 32
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - lo) / span) * (h - 4)])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const color = values[values.length - 1] >= values[0] ? '#5cd59b' : '#f27362'
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

function Popover({ icon, title, open, setOpen, children, width = 300 }: { icon: ReactNode; title: string; open: boolean; setOpen: (o: boolean) => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open, setOpen])
  return (
    <div ref={ref} className="relative">
      <button
        title={title}
        aria-label={title}
        onClick={() => setOpen(!open)}
        className={clsx('grid h-11 w-11 cursor-pointer place-items-center rounded-md transition', open ? 'bg-line text-white' : 'bg-panel-2 text-body hover:bg-line hover:text-white')}
      >
        {icon}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-md border border-line bg-panel-2 p-2 shadow-2xl" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  )
}

function MenuTitle({ children }: { children: ReactNode }) {
  return <div className="px-2.5 pb-1.5 pt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{children}</div>
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-2 text-left text-[13.5px] text-body hover:bg-line/60">
      {children}
      <span className={clsx('relative h-5 w-9 rounded-full transition', on ? 'bg-accent' : 'bg-line')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', on ? 'left-[18px]' : 'left-0.5')} />
      </span>
    </button>
  )
}

function Check({ on }: { on: boolean }) {
  return <span className={clsx('grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[10px]', on ? 'border-accent bg-accent text-white' : 'border-muted/60')}>{on && '✓'}</span>
}

function LayoutMenu({ layout, update, reset }: { layout: Layout; update: (p: Partial<Layout>) => void; reset: () => void }) {
  const move = (i: number, d: -1 | 1) => {
    const cols = [...layout.cols]
    const j = i + d
    if (j < 0 || j >= cols.length) return
    ;[cols[i], cols[j]] = [cols[j], cols[i]]
    update({ cols })
  }
  const toggle = (id: string) => update({ cols: layout.cols.includes(id) ? layout.cols.filter((c) => c !== id) : [...layout.cols, id] })
  const hidden = COLS.filter((c) => !layout.cols.includes(c.id))
  return (
    <>
      <MenuTitle>Display</MenuTitle>
      <Toggle on={layout.spark} onChange={(spark) => update({ spark })}>
        Chart in change column
      </Toggle>
      <Toggle on={layout.logos} onChange={(logos) => update({ logos })}>
        Company logos
      </Toggle>
      <Toggle on={layout.compact} onChange={(compact) => update({ compact })}>
        Compact rows
      </Toggle>
      <div className="flex items-center justify-between px-2.5 py-2 text-[13.5px] text-body">
        Show change as
        <div className="flex rounded bg-panel p-0.5 text-[12.5px]">
          {(
            [
              ['both', 'Value + %'],
              ['pct', '%'],
              ['amount', 'Value'],
            ] as [ChangeMode, string][]
          ).map(([v, l]) => (
            <button key={v} onClick={() => update({ changeMode: v })} className={clsx('cursor-pointer rounded px-2 py-0.5', layout.changeMode === v ? 'bg-line text-white' : 'text-muted hover:text-white')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <MenuTitle>Shown columns · reorder with arrows</MenuTitle>
      {layout.cols.length === 0 && <div className="px-2.5 py-1.5 text-[13px] text-muted">Only the holding is shown.</div>}
      {layout.cols.map((id, i) => {
        const c = COL_BY_ID.get(id)!
        return (
          <div key={id} className="group flex items-center gap-2 rounded px-2.5 py-1.5 text-[13.5px] text-white hover:bg-line/60">
            <button className="flex flex-1 cursor-pointer items-center gap-2.5 text-left" onClick={() => toggle(id)}>
              <Check on />
              {c.label}
            </button>
            <button disabled={i === 0} onClick={() => move(i, -1)} className="cursor-pointer rounded p-0.5 text-muted hover:text-white disabled:opacity-25" aria-label="Move up">
              <ChevronUp size={15} />
            </button>
            <button disabled={i === layout.cols.length - 1} onClick={() => move(i, 1)} className="cursor-pointer rounded p-0.5 text-muted hover:text-white disabled:opacity-25" aria-label="Move down">
              <ChevronDown size={15} />
            </button>
          </div>
        )
      })}

      {GROUPS.map((g) => {
        const items = hidden.filter((c) => c.group === g)
        if (!items.length) return null
        return (
          <div key={g}>
            <MenuTitle>{g}</MenuTitle>
            {items.map((c) => (
              <button key={c.id} onClick={() => toggle(c.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13.5px] text-body hover:bg-line/60">
                <Check on={false} />
                {c.label}
              </button>
            ))}
          </div>
        )
      })}

      <div className="mt-2 border-t border-line pt-2">
        <button onClick={reset} className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-[13.5px] text-body hover:bg-line/60 hover:text-white">
          <RotateCcw size={14} /> Reset to default layout
        </button>
      </div>
    </>
  )
}

function SortMenu({ layout, update, ctx }: { layout: Layout; update: (p: Partial<Layout>) => void; ctx: Ctx }) {
  const options = [
    { key: 'name', label: 'Holding' },
    { key: 'added_at', label: 'Date added' },
    ...layout.cols.map((id) => COL_BY_ID.get(id)!).filter((c) => c.sortable !== false && c.id !== 'added_at').map((c) => ({ key: c.id, label: c.id === 'change' ? `Change (${ctx.layout.range})` : c.label })),
  ]
  const { sort } = layout
  return (
    <>
      <MenuTitle>Sort by</MenuTitle>
      {options.map((o) => (
        <button key={o.key} onClick={() => update({ sort: { key: o.key, dir: sort.key === o.key ? sort.dir : o.key === 'name' ? 1 : -1 } })} className={clsx('flex w-full cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-left text-[13.5px] hover:bg-line/60', sort.key === o.key ? 'text-accent' : 'text-body')}>
          {o.label}
          {sort.key === o.key && (sort.dir === 1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
        </button>
      ))}
      <div className="mt-2 flex gap-1 border-t border-line px-1 pt-2">
        {([1, -1] as const).map((d) => (
          <button key={d} onClick={() => update({ sort: { ...sort, dir: d } })} className={clsx('flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded py-1.5 text-[13px]', sort.dir === d ? 'bg-line text-white' : 'text-muted hover:text-white')}>
            {d === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            {d === 1 ? 'Ascending' : 'Descending'}
          </button>
        ))}
      </div>
    </>
  )
}

function NoteEditor({ item, onClose, onSave, saving }: { item: WatchItem; onClose: () => void; onSave: (note: string | null) => void; saving: boolean }) {
  const [text, setText] = useState(item.note ?? '')
  return (
    <Modal open onClose={onClose} title={`Note · ${item.name ?? item.symbol}`}>
      <textarea
        autoFocus
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSave(text)}
        placeholder="Why are you watching it? Target entry price, thesis, reminders…"
        className="input min-h-[150px] resize-y leading-relaxed"
      />
      <div className="mt-4 flex items-center justify-between">
        {item.note ? (
          <button className="btn-ghost !px-0 hover:!text-down" onClick={() => onSave(null)} disabled={saving}>
            <Trash2 size={15} /> Delete note
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onSave(text)} disabled={saving}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

function exportCsv(rows: WatchItem[], cols: Col[], ctx: Ctx) {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = ['Symbol', 'Name', 'Currency', ...cols.map((c) => (c.id === 'change' ? `Change ${ctx.layout.range} %` : c.label))]
  const lines = rows.map((w) => [w.symbol, w.name, w.currency, ...cols.map((c) => c.value(w, ctx))].map(esc).join(','))
  const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'watchlist.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

// ---------------------------------------------------------------- page

export default function Watchlist() {
  const linkProps = useLinkProps()
  const { list, add, remove, setNote } = useWatchlist()
  const { layout, update, reset } = useLayout()
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [noteFor, setNoteFor] = useState<WatchItem | null>(null)
  const [menu, setMenu] = useState<null | 'sort' | 'layout' | 'more'>(null)
  const setOpen = (m: typeof menu) => (o: boolean) => setMenu(o ? m : null)

  const items = useMemo(() => list.data ?? [], [list.data])
  const ctx: Ctx = useMemo(() => {
    const from = rangeStart(layout.range)
    return {
      layout,
      change: new Map(items.map((w) => [w.symbol, changeFrom(w.history, from)])),
      sinceAdded: new Map(items.map((w) => [w.symbol, changeFrom(w.history, w.added_at)])),
      onNote: setNoteFor,
    }
  }, [items, layout])
  const cols = layout.cols.map((id) => COL_BY_ID.get(id)!).filter(Boolean)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? items.filter((w) => [w.symbol, w.name, w.note, w.sector, w.country].some((s) => s?.toLowerCase().includes(q))) : items
    const { key, dir } = layout.sort
    const col = COL_BY_ID.get(key)
    const val = (w: WatchItem) => (key === 'name' ? (w.name ?? w.symbol).toLowerCase() : key === 'added_at' ? w.added_at : (col?.value(w, ctx) ?? null))
    return [...filtered].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      return (x < y ? -1 : x > y ? 1 : 0) * dir
    })
  }, [items, query, layout.sort, ctx])

  const sortBy = (key: string) => update({ sort: { key, dir: layout.sort.key === key ? (-layout.sort.dir as 1 | -1) : key === 'name' ? 1 : -1 } })
  const th = (key: string, rawLabel: string, opts: { hint?: string; align?: Col['align']; sortable?: boolean } = {}) => {
    const active = layout.sort.key === key
    const sortable = opts.sortable !== false
    const label = (rawLabel.length <= 9 ? rawLabel.replace(/ /g, '\u00a0') : rawLabel).replace(/\//g, '/\u2060')
    return (
      <th key={key} className={clsx('th max-w-[130px] !whitespace-normal align-bottom text-[14px] !font-normal leading-snug', opts.align === 'center' ? 'text-center' : 'text-left', sortable && 'cursor-pointer select-none', active ? '!text-accent' : '!text-body')} onClick={sortable ? () => sortBy(key) : undefined}>
        <span className="inline-flex items-end gap-1">
          {opts.hint ? (
            <HoverTip text={opts.hint} bubble className="cursor-pointer text-left">
              <span className="dotted decoration-muted/60">{label}</span>
            </HoverTip>
          ) : (
            <span>{label}</span>
          )}
          {active && (layout.sort.dir === 1 ? <ChevronUp size={15} className="mb-0.5 shrink-0" /> : <ChevronDown size={15} className="mb-0.5 shrink-0" />)}
        </span>
      </th>
    )
  }
  const pad = layout.compact ? '!py-1.5' : '!py-3.5'

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-panel-2 text-white">
            <Star size={18} fill="currentColor" />
          </span>
          <h1 className="text-[24px] font-medium text-white">Watchlist</h1>
          {list.data && <span className="text-[15px] text-muted">({list.data.length})</span>}
        </div>
        <div className="relative">
          <Popover icon={<MoreHorizontal size={20} />} title="More" open={menu === 'more'} setOpen={setOpen('more')} width={230}>
            <button
              disabled={!rows.length}
              onClick={() => {
                exportCsv(rows, cols, ctx)
                setMenu(null)
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-[13.5px] text-body hover:bg-line/60 hover:text-white disabled:opacity-40"
            >
              <Download size={14} /> Export as CSV
            </button>
            <button
              onClick={() => {
                reset()
                setMenu(null)
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-[13.5px] text-body hover:bg-line/60 hover:text-white"
            >
              <RotateCcw size={14} /> Reset layout
            </button>
          </Popover>
        </div>
      </div>

      <section className="card card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button className="flex h-11 cursor-pointer items-center gap-2 rounded-md bg-[#2b4a63] px-5 text-[15px] text-accent transition hover:bg-[#30587a]" onClick={() => setAdding(true)}>
            <Plus size={18} /> Add
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-11 items-center rounded-md bg-panel-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="h-full w-[200px] bg-transparent px-4 text-[14.5px] text-white outline-none placeholder:text-muted sm:w-[240px]" />
              {query ? (
                <button className="grid h-11 w-11 cursor-pointer place-items-center text-muted hover:text-white" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={17} />
                </button>
              ) : (
                <span className="grid h-11 w-11 place-items-center border-l border-bg/40 text-body">
                  <Search size={18} />
                </span>
              )}
            </div>
            <Popover icon={<ArrowDownUp size={18} />} title="Sort" open={menu === 'sort'} setOpen={setOpen('sort')} width={250}>
              <SortMenu layout={layout} update={update} ctx={ctx} />
            </Popover>
            <Popover icon={<SlidersHorizontal size={18} />} title="Customize layout" open={menu === 'layout'} setOpen={setOpen('layout')} width={320}>
              <LayoutMenu layout={layout} update={update} reset={reset} />
            </Popover>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => update({ range: r })} className={clsx('cursor-pointer rounded-full px-3 py-1.5 text-[13.5px] transition', layout.range === r ? 'bg-accent/10 text-accent' : 'text-body hover:text-white')}>
              {r}
            </button>
          ))}
        </div>

        {(add.isPending || add.error || remove.error || setNote.error) && (
          <div className="mt-4">
            {add.isPending ? <div className="text-[13.5px] text-muted">Adding {add.variables}… fetching prices</div> : <ErrorBox error={add.error ?? remove.error ?? setNote.error} />}
          </div>
        )}

        <div className="mt-4">
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorBox error={list.error} />
          ) : !items.length ? (
            <Empty>
              <div className="flex flex-col items-center gap-3 py-8">
                <Star size={28} className="text-muted" />
                <div>Your watchlist is empty.</div>
                <div className="text-[13px] text-muted">Add stocks or ETFs here, or click the ☆ on any stock page.</div>
              </div>
            </Empty>
          ) : !rows.length ? (
            <Empty>Nothing matches “{query}”.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full [&_td]:!px-2 [&_th]:!px-2">
                <thead>
                  <tr className="border-b border-line">
                    {th('name', 'Holding')}
                    {cols.map((c) => th(c.id, headerText(c, ctx), { hint: c.hint, align: c.align, sortable: c.sortable }))}
                    <th className="th w-12" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr key={w.symbol} className="cursor-pointer border-b border-line/70 text-[15px] last:border-0 hover:bg-white/[0.02]" {...linkProps(`/stock/${w.symbol}`)}>
                      <td className={clsx('td', pad)}>
                        <div className="flex items-center gap-3">
                          {layout.logos && <SymbolLogo symbol={w.symbol} size={layout.compact ? 30 : 40} />}
                          <div className="min-w-0">
                            <div className="max-w-[190px] truncate text-white" title={w.name ?? w.symbol}>
                              {w.name ?? w.symbol}
                            </div>
                            <div className="flex items-center gap-2 text-[13.5px] text-muted">
                              {w.symbol}
                              {w.held && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10.5px] text-accent">In portfolio</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      {cols.map((c) => (
                        <td key={c.id} className={clsx('td text-[15px]', pad, c.align === 'center' && 'text-center')}>
                          {c.cell(w, ctx)}
                        </td>
                      ))}
                      <td className={clsx('td text-right', pad)}>
                        <button
                          className="grid h-9 w-9 cursor-pointer place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-down"
                          title="Remove from watchlist"
                          disabled={remove.isPending}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Remove ${w.name ?? w.symbol} from your watchlist?`)) remove.mutate(w.symbol)
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add to watchlist">
        <div className="min-h-[320px]">
          <SymbolSearch
            autoFocus
            onSelect={(r) => {
              setAdding(false)
              add.mutate(r.symbol)
            }}
          />
        </div>
      </Modal>
      {noteFor && (
        <NoteEditor
          item={noteFor}
          saving={setNote.isPending}
          onClose={() => setNoteFor(null)}
          onSave={(note) => setNote.mutate({ symbol: noteFor.symbol, note: note?.trim() || null }, { onSuccess: () => setNoteFor(null) })}
        />
      )}
    </>
  )
}
