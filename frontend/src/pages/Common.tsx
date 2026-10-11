import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, Banknote, ChevronRight, Eye, EyeOff, LineChart, MoreHorizontal, Orbit, PiggyBank, Plus, Upload, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLinkProps } from '../lib/links'
import { GROUP_COLORS, Ring } from '../components/Ring'
import ImportDialog from '../components/ImportDialog'
import TransactionForm from '../components/TransactionForm'
import { Big, Delta, ErrorBox, Loading, Stat, SymbolLogo, Tone } from '../components/ui'
import { api, type Holding, type Summary } from '../lib/api'
import { money, pct, signedMoney } from '../lib/format'

const FUND_TYPES = new Set(['ETF', 'MUTUALFUND'])
const groupOf = (h: Holding) => (FUND_TYPES.has(h.quote_type ?? '') ? 'Funds' : h.sector || (h.quote_type === 'CRYPTOCURRENCY' ? 'Crypto' : 'Other'))

export default function Common() {
  const summary = useQuery({ queryKey: ['summary'], queryFn: api.summary })
  const holdings = useQuery({ queryKey: ['holdings', false], queryFn: () => api.holdings(false) })
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  if (summary.isLoading) return <Loading />
  if (summary.error) return <ErrorBox error={summary.error} />
  const s = summary.data!

  if (!s.first_date) {
    return (
      <>
        <div className="card mx-auto mt-6 max-w-xl px-10 py-12 text-center">
          <h1 className="text-xl font-medium text-white">Your portfolio is empty</h1>
          <p className="mt-2 text-sm text-muted">Add your first transaction or import a CSV to start tracking performance, dividends and diversification.</p>
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Add transaction
            </button>
            <button className="btn-secondary" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import CSV
            </button>
          </div>
        </div>
        {addOpen && <TransactionForm open onClose={() => setAddOpen(false)} />}
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      {s.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-5 py-3 text-sm text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>{s.warnings.join(' · ')}</div>
        </div>
      )}
      <StatCards s={s} />
      {holdings.data && holdings.data.length > 0 && <PortfolioBreakdown holdings={holdings.data} />}
    </div>
  )
}

const MASK = '••••••'

/** Single compact summary card shown instead of the four stat cards on phones. */
function MobileSummary({ s }: { s: Summary }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem('hideValues') === '1')
  const toggle = () => {
    localStorage.setItem('hideValues', hidden ? '0' : '1')
    setHidden(!hidden)
  }
  const m = (v: string) => (hidden ? MASK : v)
  const chip = (v: number | null | undefined) => (
    <span className={clsx('rounded px-1.5 py-0.5', v == null || v === 0 ? 'bg-white/5' : v > 0 ? 'bg-up/10' : 'bg-down/10')}>
      <Delta v={v} className="text-[14px]" />
    </span>
  )
  const line = (label: string, v: number, p: number | null | undefined) => (
    <div className="flex items-center justify-between gap-3 text-[15px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
        <Tone v={v}>{m(signedMoney(v))}</Tone>
        {chip(p)}
      </span>
    </div>
  )
  return (
    <div className="card sm:hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-[28px] font-medium leading-tight text-white">{m(money(s.value))}</span>
          <button className="cursor-pointer text-muted hover:text-white" onClick={toggle} aria-label={hidden ? 'Show values' : 'Hide values'}>
            {hidden ? <Eye size={20} /> : <EyeOff size={20} />}
          </button>
        </div>
        <div className="space-y-1.5">
          {line('Total profit', s.total_profit, s.total_profit_pct)}
          {line('Daily', s.day_change, s.day_change_pct)}
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-line px-5 py-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[14px] text-muted">
            <span className="grid h-6 w-6 place-items-center rounded bg-[#8950fc26] text-[#8950fc]">
              <PiggyBank size={14} />
            </span>
            IRR
          </div>
          <div className="text-[20px] text-white">{pct(s.xirr, 2, false)}</div>
        </div>
        <div className="text-right">
          <div className="mb-1 flex items-center justify-end gap-2 text-[14px] text-muted">
            <span className="grid h-6 w-6 place-items-center rounded bg-[#5cd59b26] text-[#5cd59b]">
              <Banknote size={14} />
            </span>
            Passive income
          </div>
          <div className="text-[20px] text-white">
            {pct(s.portfolio_yield, 2, false)} <span className="text-[15px] text-muted">({m(money(s.annual_income))})</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCards({ s }: { s: Summary }) {
  return (
    <>
    <MobileSummary s={s} />
    <div className="hidden gap-6 sm:grid sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={<Wallet size={12} />} color="#4f7cf7" label="Value" hint="Current market value of open positions, in EUR">
        <Big>{money(s.value)}</Big>
        <div className="mt-2 text-sm text-muted">{money(s.cost)} invested</div>
      </Stat>
      <Stat icon={<LineChart size={12} />} color="#5cd59b" label="Total profit" hint="Unrealized + realized gains + dividends − fees">
        <div className="flex flex-wrap items-baseline gap-2">
          <Big className={clsx('dotted decoration-muted/50', s.total_profit >= 0 ? 'text-white' : 'text-down')}>{signedMoney(s.total_profit)}</Big>
          <Delta v={s.total_profit_pct} className="text-sm" />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
          <Tone v={s.day_change}>{signedMoney(s.day_change)}</Tone>
          <Delta v={s.day_change_pct} />
          <span className="text-muted">daily</span>
        </div>
      </Stat>
      <Stat icon={<PiggyBank size={12} />} color="#8950fc" label="IRR" hint="Money-weighted annualized return (XIRR)">
        <Big>{pct(s.xirr, 2, false)}</Big>
        <div className="mt-2 text-sm text-muted">
          <span className="text-body">{pct(s.twr, 2, false)}</span> time-weighted
        </div>
      </Stat>
      <Stat icon={<Banknote size={12} />} color="#5cd59b" label="Passive income" hint="Trailing-12-month dividend yield on current value">
        <Big>{pct(s.portfolio_yield, 2, false)}</Big>
        <div className="mt-2 text-sm text-muted">{money(s.annual_income)} annually</div>
      </Stat>
    </div>
    </>
  )
}

type Row = { key: string; label: string; sub: string; value: number; cost: number; profit: number; pct: number; color: string; holding?: Holding }
type GroupSort = 'name' | 'value' | 'gain' | 'pct'

function PortfolioBreakdown({ holdings }: { holdings: Holding[] }) {
  const navigate = useNavigate()
  const linkProps = useLinkProps()
  const [hover, setHover] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: GroupSort; dir: 1 | -1 }>({ key: 'pct', dir: -1 })
  const total = holdings.reduce((a, h) => a + h.value, 0)

  const groups: Row[] = useMemo(() => {
    const m = new Map<string, { value: number; cost: number; profit: number; count: number }>()
    for (const h of holdings) {
      const k = groupOf(h)
      const g = m.get(k) ?? { value: 0, cost: 0, profit: 0, count: 0 }
      g.value += h.value
      g.cost += h.cost
      g.profit += h.unrealized
      g.count += 1
      m.set(k, g)
    }
    // colours follow alphabetical order so they stay stable when values move
    return [...m.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, g], i) => ({
        key: k,
        label: k,
        sub: `${g.count} item${g.count === 1 ? '' : 's'}`,
        value: g.value,
        cost: g.cost,
        profit: g.profit,
        pct: total ? (g.value / total) * 100 : 0,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
      }))
  }, [holdings, total])

  const current = group ? groups.find((g) => g.key === group) : null
  const rows: Row[] = useMemo(() => {
    if (!group) return groups
    return holdings
      .filter((h) => groupOf(h) === group)
      .sort((a, b) => b.value - a.value)
      .map((h, i) => ({
        key: h.symbol,
        label: h.name,
        sub: h.symbol,
        value: h.value,
        cost: h.cost,
        profit: h.unrealized,
        pct: total ? (h.value / total) * 100 : 0,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        holding: h,
      }))
  }, [group, groups, holdings, total])

  const sorted = useMemo(() => {
    const val = (g: Row) => (sort.key === 'name' ? g.label : sort.key === 'gain' ? g.profit : g.value)
    return [...rows].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir
    })
  }, [rows, sort])

  const open = (k: string) => {
    setHover(null)
    if (!group) setGroup(k)
  }
  const head = (key: GroupSort, label: string) => (
    <th className="th">
      <button
        className={clsx('inline-flex cursor-pointer items-center gap-1', sort.key === key && 'text-white')}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : -1 }))}
      >
        <span className={clsx(sort.key === key && 'dotted')}>{label}</span>
        {sort.key === key && (sort.dir === -1 ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
      </button>
    </th>
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.05fr)]">
      <section className="card card-pad">
        <h2 className="mb-4 flex items-center gap-1.5 text-[15px]">
          {current ? (
            <>
              <button className="cursor-pointer text-muted hover:text-white" onClick={() => setGroup(null)}>
                Portfolio
              </button>
              <ChevronRight size={14} className="text-muted" />
              <span className="text-white">{current.label}</span>
            </>
          ) : (
            <span className="text-white">Portfolio</span>
          )}
        </h2>
        <Ring
          items={rows}
          hover={hover}
          onHover={setHover}
          onClick={group ? (k) => navigate(`/stock/${k}`) : open}
          href={group ? (k) => `/stock/${k}` : undefined}
          idle={
            current ? (
              <div>
                <div className="text-[13px] text-body">{current.label}</div>
                <div className="text-[17px] font-medium text-white">{current.pct.toFixed(2)}%</div>
                <div className="text-[12px] text-muted">{money(current.value)}</div>
              </div>
            ) : (
              <div>
                <div className="text-[13px] text-body">Total value</div>
                <div className="text-[19px] font-medium text-white">{money(total)}</div>
                <div className="text-[12px] text-muted">{holdings.length} holding{holdings.length === 1 ? '' : 's'}</div>
              </div>
            )
          }
        />
        <p className="mt-4 text-center text-[12px] text-muted">{group ? 'Click a slice to open the holding' : 'Click a group to see its holdings'}</p>
      </section>
      <section className="card card-pad overflow-x-auto">
        <div className="-mt-2 mb-2 flex min-h-[28px] items-center justify-between">
          {current ? (
            <button className="inline-flex cursor-pointer items-center gap-1 text-[14px] text-accent hover:text-white" onClick={() => setGroup(null)}>
              <ArrowLeft size={15} /> All groups
            </button>
          ) : (
            <span />
          )}
          <span className="px-2 text-muted"><MoreHorizontal size={20} /></span>
        </div>
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-line">
              {head('name', 'Name')}
              {head('value', 'Value/Invested')}
              {head('gain', 'Gain')}
              {head('pct', 'Allocation')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((g) => (
              <tr
                key={g.key}
                className={clsx('cursor-pointer border-b border-line/70 transition last:border-0 hover:bg-white/[0.03]', hover === g.key && 'bg-white/[0.03]')}
                onMouseEnter={() => setHover(g.key)}
                onMouseLeave={() => setHover(null)}
                {...(g.holding ? linkProps(`/stock/${g.key}`) : { onClick: () => open(g.key) })}
              >
                <td className="relative py-3.5 pr-3 pl-4">
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: g.color }} />
                  <div className="flex items-center gap-3">
                    {g.holding ? (
                      <SymbolLogo symbol={g.key} size={44} />
                    ) : (
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-white" style={{ background: g.color }}>
                        <Orbit size={22} strokeWidth={1.5} />
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="max-w-[260px] truncate text-[15px] text-white">{g.label}</div>
                      <div className="text-[13px] text-muted">{g.sub}</div>
                    </div>
                  </div>
                </td>
                <td className="td text-[15px]">
                  <div className="font-medium text-white">{money(g.value)}</div>
                  <div className="text-muted">{money(g.cost)}</div>
                </td>
                <td className="td text-[15px]">
                  <div className={clsx('dotted inline-block', g.profit >= 0 ? 'text-up' : 'text-down')}>{signedMoney(g.profit)}</div>
                  <div>
                    <Delta v={g.cost ? (g.profit / g.cost) * 100 : null} />
                  </div>
                </td>
                <td className="td text-[15px] text-white">{g.pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
