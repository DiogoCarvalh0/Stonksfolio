import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, ExternalLink, Loader2, Plus, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import TransactionForm from '../../components/TransactionForm'
import { Card, Delta, ErrorBox, Loading, SymbolLogo } from '../../components/ui'
import { api, type Transaction } from '../../lib/api'
import { compactMoney, date, money, num, pct } from '../../lib/format'
import { useTxActions } from '../Transactions'
import { useWatchlist } from '../../lib/watchlist'
import MyPosition from './MyPosition'
import DividendsTab from './DividendsTab'
import FinancialsTab from './FinancialsTab'
import InsidersTab from './InsidersTab'
import PriceChart from './PriceChart'
import { dash, dividendStats, isFund, yoy, type Detail, type Sec } from './util'

const ratio = (v: unknown, d = 2) => (typeof v === 'number' ? num(v, d) : dash)
const pair = (a: ReactNode, b: ReactNode) => (
  <>
    {a}
    <span className="mx-1.5 text-muted">|</span>
    {b}
  </>
)
export const priceFmt = (cur: string) => (v: number) => money(v, cur)
const bigMoney = (v: unknown, cur: string) => {
  if (typeof v !== 'number') return dash
  const c = cur === 'GBp' ? 'GBP' : cur
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, notation: 'compact', maximumFractionDigits: 2 })
      .format(v).replace(/T$/, 'tn').replace(/B$/, 'bn').replace(/M$/, 'm')
  } catch {
    return compactMoney(v, c)
  }
}

export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-[3px] text-[12.6px]">
      <span className="whitespace-nowrap text-muted">{label}</span>
      <span className="text-right text-white">{children}</span>
    </div>
  )
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[12.6px] text-muted">{label}</div>
      <div className="mt-1 text-[16px] font-medium text-white">{children}</div>
    </div>
  )
}

function earningsDate(sec: Sec) {
  const e = sec.info?.calendar?.['Earnings Date']
  const d = Array.isArray(e) ? e[0] : e
  return d ? date(d, { day: 'numeric', month: 'short' }) : dash
}

type Tab = 'overview' | 'insiders' | 'dividends' | 'financials'
type TabDef = { id: Tab; label: string; short?: string }

function WatchButton({ symbol }: { symbol: string }) {
  const w = useWatchlist()
  const on = w.has(symbol)
  return (
    <button
      onClick={() => w.toggle(symbol)}
      disabled={w.busy || w.list.isLoading}
      title={on ? 'Remove from watchlist' : 'Add to watchlist'}
      className={clsx('grid h-9 w-9 cursor-pointer place-items-center rounded-md disabled:opacity-60', on ? 'bg-accent/30 text-accent hover:bg-accent/40' : 'bg-panel-2 text-body hover:bg-line hover:text-white')}
    >
      <Star size={16} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

function ListingSwitcher({ sec }: { sec: Sec }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const q = useQuery({ queryKey: ['listings', sec.symbol], queryFn: () => api.listings(sec.symbol), staleTime: 3600_000 })
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const base = (s: string) => s.split('.')[0]
  const label = `${base(sec.symbol)} • ${sec.exchange ?? dash}`
  const listings = q.data ?? []
  if (listings.length < 2)
    return (
      <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
        {label}
        {q.isLoading && <Loader2 size={12} className="animate-spin" />}
      </div>
    )
  const primary = listings.find((l) => l.primary)?.symbol ?? null
  return (
    <div className="relative mt-0.5" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="Switch exchange" className="inline-flex cursor-pointer items-center gap-1 text-[13px] text-muted hover:text-white">
        {label}
        <ChevronDown size={14} className={clsx('transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 max-h-[60vh] min-w-64 overflow-y-auto rounded-md bg-panel-2 p-1.5 shadow-2xl">
          {listings.map((l) => {
            const current = l.symbol.toUpperCase() === sec.symbol.toUpperCase()
            return (
              <button
                key={l.symbol}
                onClick={() => {
                  setOpen(false)
                  if (!current) navigate({ pathname: `/stock/${encodeURIComponent(l.symbol)}`, search: params.toString() })
                }}
                className={clsx('flex w-full cursor-pointer items-center gap-3 rounded px-2.5 py-2 text-left text-[14px] hover:bg-line/60', current ? 'text-accent' : 'text-body hover:text-white')}
              >
                <SymbolLogo symbol={l.symbol} size={28} fallback={l.symbol === primary ? null : primary} />
                <span className="flex-1 whitespace-nowrap">
                  <span className={clsx('font-medium', !current && 'text-white')}>{base(l.symbol)}:{l.exchange}</span>
                  {l.currency && <span>, {l.currency}</span>}
                  {l.primary && <span className="ml-2 rounded bg-line px-1.5 py-0.5 text-[11px] text-muted">Primary</span>}
                </span>
                {current && <Check size={14} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Header({ d, tab, tabs, onAdd }: { d: Detail; tab: Tab; tabs: TabDef[]; onAdd: () => void }) {
  const { security: sec, prices } = d
  const info = sec.info ?? {}
  const last = prices[prices.length - 1]
  const prev = prices[prices.length - 2]
  const chg = last && prev ? last.close - prev.close : null
  const chgPct = last && prev ? (chg! / prev.close) * 100 : null
  const div = dividendStats(d)
  const fund = isFund(sec)
  const [, setParams] = useSearchParams()
  const metrics: [string, ReactNode][] = fund
    ? [
        ['Expense ratio', typeof info.netExpenseRatio === 'number' ? pct(info.netExpenseRatio, 2, false) : dash],
        ['Total assets', bigMoney(info.totalAssets, sec.currency)],
        ['YTD return', typeof info.ytdReturn === 'number' ? pct(info.ytdReturn, 2, false) : dash],
        ['Dividend yield', div.yieldPct ? pct(div.yieldPct, 2, false) : dash],
      ]
    : [
        ['Earnings date', earningsDate(sec)],
        ['P/E TTM | FWD', pair(ratio(info.trailingPE, 1), ratio(info.forwardPE, 1))],
        ['EPS TTM | FWD', pair(
          typeof info.trailingEps === 'number' ? money(info.trailingEps, sec.currency) : dash,
          typeof info.forwardEps === 'number' ? money(info.forwardEps, sec.currency) : dash,
        )],
        ['Market cap', bigMoney(info.marketCap, sec.currency)],
        ['Dividend yield', div.yieldPct ? pct(div.yieldPct, 2, false) : dash],
      ]
  return (
    <section className="card px-5 pt-7 sm:px-[31.5px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <SymbolLogo symbol={sec.symbol} size={50} fallback={info.primary_symbol !== undefined ? info.primary_symbol : undefined} />
          <div className="min-w-0">
            <h1 className="truncate text-[19px] font-medium text-white">{sec.name}</h1>
            <ListingSwitcher sec={sec} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {info.website && (
            <a href={info.website} target="_blank" rel="noreferrer" title="Website" className="grid h-9 w-9 place-items-center rounded-md bg-panel-2 text-body hover:bg-line hover:text-white">
              <ExternalLink size={15} />
            </a>
          )}
          <WatchButton symbol={sec.symbol} />
          <button onClick={onAdd} title="Add transaction" className="grid h-9 w-9 cursor-pointer place-items-center rounded-md bg-panel-2 text-body hover:bg-line hover:text-white">
            <Plus size={17} />
          </button>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[26px] font-medium text-white">{money(last?.close, sec.currency)}</span>
          {chg != null && (
            <span className={clsx('text-[13px]', chg >= 0 ? 'text-up' : 'text-down')}>
              {chg >= 0 ? '+' : '-'}
              {money(Math.abs(chg), sec.currency)} (<Delta v={chgPct} />)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          {metrics.map(([l, v]) => (
            <Metric key={l} label={l}>
              {v}
            </Metric>
          ))}
        </div>
      </div>
      <nav className="mt-6 flex gap-5 overflow-x-auto sm:gap-7">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
            className={clsx(
              'cursor-pointer whitespace-nowrap border-b-2 pb-4 text-[14px] transition',
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-body hover:text-white',
            )}
          >
            {t.short ? (
              <>
                <span className="sm:hidden">{t.short}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </>
            ) : (
              t.label
            )}
          </button>
        ))}
      </nav>
    </section>
  )
}

function SideGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="mb-1.5 text-[14px] font-medium text-white">{title}</div>
      {children}
    </div>
  )
}

function SideStats({ d }: { d: Detail }) {
  const sec = d.security
  const info = sec.info ?? {}
  const div = dividendStats(d)
  const fund = isFund(sec)
  const fin = useQuery({ queryKey: ['financials', sec.symbol], queryFn: () => api.financials(sec.symbol), staleTime: 3600_000, enabled: !fund })
  const g = (label: string, st: 'income' | 'cashflow', key: string) => {
    const s = fin.data?.[st]
    const row = s?.sections.flatMap((x) => x.rows).find((r) => r.key === key)
    const v = yoy(row?.values, s?.columns ?? [])
    return (
      <KV label={label}>
        {v == null ? dash : <span className={v >= 0 ? 'text-up' : 'text-down'}>{pct(v, 2, false)}</span>}
      </KV>
    )
  }
  return (
    <Card className="h-full">
      {fund ? (
        <SideGroup title="Fund">
          <KV label="Category">{info.category ?? dash}</KV>
          <KV label="Fund family">{info.fundFamily ?? dash}</KV>
          <KV label="Total assets">{bigMoney(info.totalAssets, sec.currency)}</KV>
          <KV label="Expense ratio">{typeof info.netExpenseRatio === 'number' ? pct(info.netExpenseRatio, 2, false) : dash}</KV>
          <KV label="Beta">{ratio(info.beta, 3)}</KV>
        </SideGroup>
      ) : (
        <>
          <SideGroup title="Estimate">
            <KV label="P/E">{ratio(info.trailingPE, 1)}</KV>
            <KV label="EPS">{typeof info.trailingEps === 'number' ? money(info.trailingEps, sec.currency) : dash}</KV>
            <KV label="P/B">{ratio(info.priceToBook)}</KV>
            <KV label="Beta">{ratio(info.beta, 3)}</KV>
          </SideGroup>
          <SideGroup title="Growth">
            {g('Revenue, YoY', 'income', 'Total Revenue')}
            {g('Net income, YoY', 'income', 'Net Income')}
            {g('FCF, YoY', 'cashflow', 'Free Cash Flow')}
          </SideGroup>
          <SideGroup title="Forecast">
            <KV label="P/E (FWD)">{ratio(info.forwardPE, 1)}</KV>
            <KV label="EPS (FWD)">{typeof info.forwardEps === 'number' ? money(info.forwardEps, sec.currency) : dash}</KV>
            <KV label="Target price">{typeof info.targetMeanPrice === 'number' ? money(info.targetMeanPrice, sec.currency) : dash}</KV>
          </SideGroup>
        </>
      )}
      <SideGroup title="Dividends">
        <KV label="Dividend yield">{div.yieldPct ? pct(div.yieldPct, 2, false) : dash}</KV>
        <KV label="Annual payout">{div.annualPayout ? money(div.annualPayout, sec.currency) : dash}</KV>
        <KV label="Next ex. div date">{div.nextExDate ? date(div.nextExDate, { day: 'numeric', month: 'long', year: '2-digit' }) : dash}</KV>
        {!fund && <KV label="Payout">{div.payoutPct ? pct(div.payoutPct, 2, false) : dash}</KV>}
        <KV label="Div.growth, 5y">{div.growth[5] != null ? pct(div.growth[5], 2, false) : dash}</KV>
        <KV label="Dividend growth streak">{div.growthStreak ? `${div.growthStreak} y` : dash}</KV>
      </SideGroup>
    </Card>
  )
}

function About({ sec }: { sec: Sec }) {
  const info = sec.info ?? {}
  const [more, setMore] = useState(false)
  const fund = isFund(sec)
  const left: [string, ReactNode][] = [
    ['Ticker', sec.symbol],
    ['ISIN', info.isin ?? dash],
    ['Currency', sec.currency],
  ]
  const right: [string, ReactNode][] = fund
    ? [
        ['Fund family', info.fundFamily ?? dash],
        ['Category', info.category ?? dash],
        ['Exchange', sec.exchange ?? dash],
      ]
    : [
        ['Country', sec.country ?? dash],
        ['Sector', sec.sector ?? dash],
        ['Industry', sec.industry ?? dash],
      ]
  return (
    <Card title={fund ? 'About the fund' : 'About the company'}>
      <div className="grid gap-x-16 md:grid-cols-2">
        <div>{left.map(([l, v]) => <KV key={l} label={l}>{v}</KV>)}</div>
        <div>{right.map(([l, v]) => <KV key={l} label={l}>{v}</KV>)}</div>
      </div>
      {info.longBusinessSummary && (
        <>
          <p className={clsx('mt-5 text-[13.5px] leading-relaxed text-body', !more && 'line-clamp-4')}>{info.longBusinessSummary}</p>
          <button className="mt-2 cursor-pointer text-[13px] text-accent hover:underline" onClick={() => setMore((m) => !m)}>
            {more ? 'Hide' : 'Show'}
          </button>
        </>
      )}
      {sec.sector_weights && (
        <div className="mt-6">
          <div className="mb-3 text-[14px] font-medium text-white">Sector weights</div>
          <div className="grid gap-x-16 gap-y-3 md:grid-cols-2">
            {Object.entries(sec.sector_weights)
              .sort((a, b) => b[1] - a[1])
              .map(([k, w]) => (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-[12.6px]">
                    <span className="text-body">{k}</span>
                    <span className="text-white">{(w * 100).toFixed(2)}%</span>
                  </div>
                  <div className="h-1 rounded bg-line">
                    <div className="h-1 rounded bg-accent" style={{ width: `${w * 100}%` }} />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function Overview({ d, onAdd, onEdit, onDelete }: { d: Detail; onAdd: () => void; onEdit: (t: Transaction) => void; onDelete: (t: Transaction) => void }) {
  const sec = d.security
  const fund = isFund(sec)
  const markers = d.transactions
    .filter((t) => t.type === 'BUY' || t.type === 'SELL')
    .map((t) => ({ key: t.id, date: t.date, color: t.type === 'BUY' ? '#5cd59b' : '#f27362' }))
  return (
    <>
      <div className="grid gap-[25px] xl:grid-cols-[1fr_240px]">
        <Card title="Price history" action={<span className="text-[12.6px] text-muted">Price ({sec.currency})</span>}>
          <PriceChart rows={d.prices} fmt={priceFmt(sec.currency)} markers={markers} costPerShare={d.position && !d.position.closed && d.position.quantity > 0 ? d.position.avg_price : null} height={fund ? 330 : 400} />
          {markers.length > 0 && (
            <div className="mt-3 flex gap-4 text-[12px] text-muted">
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-up" />My buys</span>
              <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-down" />My sells</span>
            </div>
          )}
        </Card>
        <SideStats d={d} />
      </div>
      {d.position && <MyPosition d={d} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} />}
      <About sec={sec} />
    </>
  )
}

export default function Stock() {
  const { symbol = '' } = useParams()
  const [params] = useSearchParams()
  const q = useQuery({ queryKey: ['stock', symbol], queryFn: () => api.stock(symbol) })
  const [addOpen, setAddOpen] = useState(false)
  const { editing, setEditing, onDelete } = useTxActions()

  if (q.isLoading) return <Loading label={`Loading ${symbol}…`} />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const sec = d.security
  const fund = isFund(sec)
  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    ...(!fund ? [{ id: 'insiders' as Tab, label: 'Insider Trading', short: 'Insiders' }] : []),
    { id: 'dividends', label: 'Dividends' },
    ...(!fund ? [{ id: 'financials' as Tab, label: 'Financials' }] : []),
  ]
  const requested = params.get('tab') as Tab | null
  const tab: Tab = tabs.some((t) => t.id === requested) ? requested! : 'overview'
  const crumbs = fund ? ['ETFs', sec.info?.category] : ['Stocks', sec.country, sec.sector]

  return (
    <div className="space-y-[25px]">
      <div className="flex flex-wrap items-center gap-2 text-[12.6px] text-body">
        {crumbs.filter(Boolean).map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted">•</span>}
            {i === 0 ? <Link to="/" className="hover:text-white">{c}</Link> : c}
          </span>
        ))}
      </div>
      <Header d={d} tab={tab} tabs={tabs} onAdd={() => setAddOpen(true)} />
      {tab === 'overview' && <Overview d={d} onAdd={() => setAddOpen(true)} onEdit={setEditing} onDelete={onDelete} />}
      {tab === 'insiders' && <InsidersTab symbol={sec.symbol} />}
      {tab === 'dividends' && <DividendsTab d={d} />}
      {tab === 'financials' && <FinancialsTab symbol={sec.symbol} currency={sec.info?.financialCurrency ?? sec.currency} />}
      {addOpen && <TransactionForm open defaultSymbol={sec.symbol} onClose={() => setAddOpen(false)} />}
      {editing !== undefined && <TransactionForm open initial={editing} onClose={() => setEditing(undefined)} />}
    </div>
  )
}
