import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowDownUp, ChevronDown, ChevronUp, ExternalLink, MoreHorizontal, Plus, Search, Share } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLinkProps } from '../lib/links'
import { GROUP_COLORS, Ring, type RingItem } from '../components/Ring'
import TransactionForm from '../components/TransactionForm'
import { Checkbox, Delta, Empty, ErrorBox, Loading, SymbolLogo } from '../components/ui'
import { api, type AllocItem, type Holding } from '../lib/api'
import { date, money, num, pct, signedMoney } from '../lib/format'

type Cur = 'local' | 'EUR'
type View = 'holdings' | 'general' | 'dividends' | 'returns'
type Ctx = { cur: Cur }

// Amounts come from the API in EUR; `fx` converts the holding currency into EUR.
const amt = (h: Holding, eur: number | null | undefined, c: Ctx) => (eur == null ? null : c.cur === 'EUR' || !h.fx ? eur : eur / h.fx)
const ccy = (h: Holding, c: Ctx) => (c.cur === 'EUR' ? 'EUR' : h.currency)
const perShare = (v: number | null, q: number) => (v != null && q > 0 ? v / q : null)

type Col = {
  key: string
  label: string
  hint?: string
  sort: (h: Holding) => number | string | null
  cell: (h: Holding, c: Ctx) => ReactNode
  total?: (rows: Holding[]) => ReactNode
}

const Two = ({ top, bottom, strong = true }: { top: ReactNode; bottom?: ReactNode; strong?: boolean }) => (
  <>
    <div className={clsx(strong ? 'font-medium text-white' : 'text-body')}>{top}</div>
    {bottom !== undefined && <div className="text-muted">{bottom}</div>}
  </>
)
const Profit = ({ v, p, cur }: { v: number | null; p: number | null; cur: string }) => (
  <>
    <div className={clsx('dotted inline-block', (v ?? 0) >= 0 ? 'text-up' : 'text-down')}>{signedMoney(v, cur)}</div>
    <div>
      <Delta v={p} />
    </div>
  </>
)
const sum = (rows: Holding[], f: (h: Holding) => number | null | undefined) => rows.reduce((a, h) => a + (f(h) ?? 0), 0)
const wavg = (rows: Holding[], f: (h: Holding) => number, w: (h: Holding) => number) => {
  const tw = sum(rows, w)
  return tw ? sum(rows, (h) => f(h) * w(h)) / tw : 0
}

const C: Record<string, Col> = {
  shares: { key: 'shares', label: 'Shares', sort: (h) => h.quantity, cell: (h) => <span className="text-white">{num(h.quantity, 6)}</span>, total: (r) => num(sum(r, (h) => h.quantity), 2) },
  cost: {
    key: 'cost',
    label: 'Cost basis',
    hint: 'Total cost / average cost per share',
    sort: (h) => h.cost,
    cell: (h, c) => {
      const v = c.cur === 'EUR' ? h.cost : h.cost_local
      return <Two top={money(v, ccy(h, c))} bottom={money(perShare(v, h.quantity), ccy(h, c))} />
    },
    total: (r) => money(sum(r, (h) => h.cost)),
  },
  value: {
    key: 'value',
    label: 'Current value',
    hint: 'Market value / current price',
    sort: (h) => h.value,
    cell: (h, c) => <Two top={money(amt(h, h.value, c), ccy(h, c))} bottom={money(c.cur === 'EUR' ? perShare(h.value, h.quantity) ?? (h.price ?? 0) * h.fx : h.price, ccy(h, c))} />,
    total: (r) => money(sum(r, (h) => h.value)),
  },
  dividends: {
    key: 'dividends',
    label: 'Dividends',
    hint: 'Dividends received / per share held',
    sort: (h) => h.dividends,
    cell: (h, c) => <Two top={money(amt(h, h.dividends, c), ccy(h, c))} bottom={money(perShare(amt(h, h.dividends, c), h.quantity) ?? 0, ccy(h, c))} />,
    total: (r) => money(sum(r, (h) => h.dividends)),
  },
  yield: {
    key: 'yield',
    label: 'Dividend yield',
    hint: 'Trailing 12m yield / yield on cost',
    sort: (h) => h.dividend_yield,
    cell: (h) => <Two top={pct(h.dividend_yield, 2, false)} bottom={pct(h.yield_on_cost, 2, false)} strong={false} />,
    total: (r) => (
      <Two
        top={pct(wavg(r, (h) => h.dividend_yield, (h) => h.value), 2, false)}
        bottom={pct(wavg(r, (h) => h.yield_on_cost, (h) => h.cost), 2, false)}
      />
    ),
  },
  profit: {
    key: 'profit',
    label: 'Total profit',
    hint: 'Capital gain + realized gains + dividends',
    sort: (h) => h.total_profit,
    cell: (h, c) => <Profit v={amt(h, h.total_profit, c)} p={h.total_profit_pct} cur={ccy(h, c)} />,
    total: (r) => {
      const p = sum(r, (h) => h.total_profit)
      const base = sum(r, (h) => (h.total_profit_pct ? (h.total_profit / h.total_profit_pct) * 100 : h.cost))
      return <Profit v={p} p={base ? (p / base) * 100 : null} cur="EUR" />
    },
  },
  daily: {
    key: 'daily',
    label: 'Daily',
    hint: 'Change since the previous close',
    sort: (h) => h.day_change_pct,
    cell: (h, c) => <Profit v={amt(h, h.day_change, c)} p={h.day_change_pct} cur={ccy(h, c)} />,
    total: (r) => {
      const d = sum(r, (h) => h.day_change)
      const prev = sum(r, (h) => h.value) - d
      return <Profit v={d} p={prev ? (d / prev) * 100 : null} cur="EUR" />
    },
  },
  weight: { key: 'weight', label: 'Share in portfolio', sort: (h) => h.weight, cell: (h) => <span className="text-white">{h.weight.toFixed(2)}%</span>, total: (r) => `${sum(r, (h) => h.weight).toFixed(2)}%` },
  sector: { key: 'sector', label: 'Sector', sort: (h) => h.sector ?? h.asset_type, cell: (h) => <span className="text-body">{h.sector ?? h.asset_type}</span> },
  country: { key: 'country', label: 'Country', sort: (h) => h.country ?? '', cell: (h) => <span className="text-body">{h.country ?? '—'}</span> },
  first: { key: 'first', label: 'First buy', sort: (h) => h.first_buy ?? '', cell: (h) => <span className="text-body">{date(h.first_buy)}</span> },
  received: {
    key: 'received',
    label: 'Received',
    hint: 'Net dividends received so far',
    sort: (h) => h.dividends,
    cell: (h, c) => <span className="font-medium text-white">{money(amt(h, h.dividends, c), ccy(h, c))}</span>,
    total: (r) => money(sum(r, (h) => h.dividends)),
  },
  income: {
    key: 'income',
    label: 'Next 12 months',
    hint: 'Expected net income over the next 12 months, based on the trailing 12m dividends',
    sort: (h) => h.annual_income,
    cell: (h, c) => <span className="font-medium text-white">{money(amt(h, h.annual_income, c), ccy(h, c))}</span>,
    total: (r) => money(sum(r, (h) => h.annual_income)),
  },
  divyield: { key: 'divyield', label: 'Dividend yield', sort: (h) => h.dividend_yield, cell: (h) => <span className="text-white">{pct(h.dividend_yield, 2, false)}</span>, total: (r) => pct(wavg(r, (h) => h.dividend_yield, (h) => h.value), 2, false) },
  yoc: { key: 'yoc', label: 'Yield on cost', sort: (h) => h.yield_on_cost, cell: (h) => <span className="text-white">{pct(h.yield_on_cost, 2, false)}</span>, total: (r) => pct(wavg(r, (h) => h.yield_on_cost, (h) => h.cost), 2, false) },
  gain: {
    key: 'gain',
    label: 'Capital gain',
    hint: 'Unrealized gain on the shares you still hold',
    sort: (h) => h.unrealized,
    cell: (h, c) => <Profit v={amt(h, h.unrealized, c)} p={h.unrealized_pct} cur={ccy(h, c)} />,
    total: (r) => {
      const g = sum(r, (h) => h.unrealized)
      const cost = sum(r, (h) => h.cost)
      return <Profit v={g} p={cost ? (g / cost) * 100 : null} cur="EUR" />
    },
  },
  realized: {
    key: 'realized',
    label: 'Realized',
    hint: 'Gains locked in by selling',
    sort: (h) => h.realized,
    cell: (h, c) => <span className={clsx(h.realized > 0 ? 'text-up' : h.realized < 0 ? 'text-down' : 'text-body')}>{signedMoney(amt(h, h.realized, c), ccy(h, c))}</span>,
    total: (r) => signedMoney(sum(r, (h) => h.realized)),
  },
  fees: {
    key: 'fees',
    label: 'Fees paid',
    sort: (h) => h.fees,
    cell: (h, c) => <span className="text-body">{money(amt(h, h.fees, c), ccy(h, c))}</span>,
    total: (r) => money(sum(r, (h) => h.fees)),
  },
  irr: { key: 'irr', label: 'IRR', hint: 'Annualized money-weighted return of this position', sort: (h) => h.irr, cell: (h) => <Delta v={h.irr} /> },
}

const VIEWS: { value: View; label: string; cols: string[] }[] = [
  { value: 'holdings', label: 'My holdings', cols: ['shares', 'cost', 'value', 'dividends', 'yield', 'profit', 'daily'] },
  { value: 'general', label: 'General', cols: ['shares', 'cost', 'value', 'weight', 'sector', 'country', 'first'] },
  { value: 'dividends', label: 'Dividends', cols: ['received', 'income', 'divyield', 'yoc'] },
  { value: 'returns', label: 'Returns', cols: ['gain', 'realized', 'dividends', 'fees', 'profit', 'irr', 'daily'] },
]

function exportCsv(rows: Holding[]) {
  const keys: (keyof Holding)[] = ['symbol', 'name', 'currency', 'quantity', 'avg_price', 'price', 'cost', 'value', 'weight', 'unrealized', 'realized', 'dividends', 'fees', 'total_profit', 'total_profit_pct', 'dividend_yield', 'yield_on_cost', 'annual_income', 'irr', 'sector', 'country']
  const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [keys.join(','), ...rows.map((h) => keys.map((k) => esc(h[k])).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `holdings-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function RowMenu({ h, onAdd }: { h: Holding; onAdd: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button className="grid h-9 w-9 cursor-pointer place-items-center rounded-md bg-panel-2 text-body hover:bg-line hover:text-white" onClick={() => setOpen((o) => !o)}>
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-20 w-48 overflow-hidden rounded-md border border-line bg-panel-2 py-1 text-sm shadow-xl">
          <Link to={`/stock/${h.symbol}`} className="flex items-center gap-2 px-3 py-2 text-body hover:bg-line hover:text-white">
            <ExternalLink size={14} /> Open
          </Link>
          <button
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-body hover:bg-line hover:text-white"
            onClick={() => {
              setOpen(false)
              onAdd()
            }}
          >
            <Plus size={14} /> Add transaction
          </button>
        </div>
      )}
    </div>
  )
}

function HoldingsTable() {
  const linkProps = useLinkProps()
  const [cur, setCur] = useState<Cur>('EUR')
  const [view, setView] = useState<View>('holdings')
  const [showSold, setShowSold] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'value', dir: -1 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [addFor, setAddFor] = useState<string | null>(null)
  const res = useQuery({ queryKey: ['holdings', showSold], queryFn: () => api.holdings(showSold) })
  const cols = VIEWS.find((v) => v.value === view)!.cols.map((k) => C[k])
  const ctx = { cur }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const col = C[sort.key]
    const val = (h: Holding) => (sort.key === 'name' ? h.name : col ? col.sort(h) : 0)
    return (res.data ?? [])
      .filter((h) => !needle || h.symbol.toLowerCase().includes(needle) || h.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const x = val(a) ?? -Infinity
        const y = val(b) ?? -Infinity
        return (typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : x > y ? 1 : x < y ? -1 : 0) * sort.dir
      })
  }, [res.data, q, sort])
  const totalRows = selected.size ? rows.filter((h) => selected.has(h.symbol)) : rows
  const allSelected = rows.length > 0 && rows.every((h) => selected.has(h.symbol))
  const toggle = (s: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const th = (key: string, label: string, hint?: string) => {
    const active = sort.key === key
    return (
      <th
        key={key}
        title={hint}
        className={clsx('th cursor-pointer select-none text-[14px] !font-normal', active ? '!text-accent' : '!text-body')}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'name' ? 1 : -1 }))}
      >
        <span className="inline-flex items-center gap-1">
          <span className={clsx(key !== 'name' && 'dotted decoration-muted/60')}>{label}</span>
          {active && (sort.dir === 1 ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
        </span>
      </th>
    )
  }

  return (
    <section className="card card-pad">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex rounded-md bg-panel-2 p-1">
          {(
            [
              ['local', 'In holding currency'],
              ['EUR', 'In EUR'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              className={clsx('cursor-pointer rounded px-3.5 py-1.5 text-[15px] transition', cur === v ? 'bg-white text-[#282832]' : 'text-body hover:text-white')}
              onClick={() => setCur(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <Checkbox checked={showSold} onChange={setShowSold}>
          <span className="text-[15px] text-white">Show sold</span>
        </Checkbox>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex h-10 w-56 items-center rounded-md bg-panel-2">
            <input className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[15px] text-body outline-none placeholder:text-muted" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
            <Search size={18} className="mr-3 text-body" />
          </div>
          <button
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-md bg-panel-2 text-body hover:bg-line hover:text-white"
            title="Reverse sort order"
            onClick={() => setSort((s) => ({ ...s, dir: -s.dir as 1 | -1 }))}
          >
            <ArrowDownUp size={17} />
          </button>
          <button className="grid h-10 w-10 cursor-pointer place-items-center rounded-md bg-panel-2 text-body hover:bg-line hover:text-white" title="Export CSV" onClick={() => exportCsv(rows)}>
            <Share size={17} />
          </button>
        </div>
      </div>

      <div className="mt-5 mb-2 flex flex-wrap items-center px-1 text-[15px]">
        {VIEWS.map((v, i) => (
          <span key={v.value} className="flex items-center">
            {i > 0 && <span className="mx-2 h-3.5 w-px bg-line" />}
            <button className={clsx('cursor-pointer px-1', view === v.value ? 'text-white' : 'text-muted hover:text-body')} onClick={() => setView(v.value)}>
              {v.label}
            </button>
          </span>
        ))}
      </div>

      {res.isLoading ? (
        <Loading />
      ) : res.error ? (
        <ErrorBox error={res.error} />
      ) : !rows.length ? (
        <Empty>No holdings.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="th w-10">
                  <Checkbox checked={allSelected} onChange={(v) => setSelected(v ? new Set(rows.map((h) => h.symbol)) : new Set())}>
                    {null}
                  </Checkbox>
                </th>
                {th('name', 'Holding')}
                {cols.map((c) => th(c.key, c.label, c.hint))}
                <th className="th w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.symbol} className={clsx('border-b border-[#5a5a6c] text-[15px] hover:bg-white/[0.02]', h.closed && 'opacity-60')}>
                  <td className="td">
                    <Checkbox checked={selected.has(h.symbol)} onChange={() => toggle(h.symbol)}>
                      {null}
                    </Checkbox>
                  </td>
                  <td className="td cursor-pointer" {...linkProps(`/stock/${h.symbol}`)}>
                    <div className="flex items-center gap-3">
                      <SymbolLogo symbol={h.symbol} size={40} />
                      <div className="min-w-0">
                        <div className="max-w-[260px] truncate text-white">{h.name}</div>
                        <div className="text-muted">
                          {h.symbol}
                          {h.closed && <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 text-[10px]">sold</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  {cols.map((c) => (
                    <td key={c.key} className="td text-[15px]">
                      {c.cell(h, ctx)}
                    </td>
                  ))}
                  <td className="td">
                    <RowMenu h={h} onAdd={() => setAddFor(h.symbol)} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[16px] font-medium text-white">
                <td />
                <td className="td align-top !py-3.5 text-[16px]">
                  {selected.size ? `Selected (${selected.size})` : 'Total'}
                  {cur === 'local' && <div className="text-[12px] font-normal text-muted">in EUR</div>}
                </td>
                {cols.map((c) => (
                  <td key={c.key} className="td align-top !py-3.5 text-[16px]">
                    {c.total?.(totalRows)}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {addFor && <TransactionForm open defaultSymbol={addFor} onClose={() => setAddFor(null)} />}
    </section>
  )
}

function BreakdownCard({ title, items, note }: { title: string; items: AllocItem[]; note?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const ring: RingItem[] = items.map((it, i) => ({ ...it, color: GROUP_COLORS[i % GROUP_COLORS.length] }))
  return (
    <section className="card card-pad">
      <h2 className="mb-5 text-[15px] text-white">{title}</h2>
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
        <Ring items={ring} hover={hover} onHover={setHover} className="max-w-[200px]" idle={<div className="text-[13px] text-muted">{items.length} groups</div>} />
        <ul className="min-w-0">
          {ring.map((g) => (
            <li
              key={g.key}
              className={clsx('relative flex items-center gap-3 border-b border-line/70 py-2.5 pr-1 pl-4 text-[14px] last:border-0', hover === g.key && 'bg-white/[0.03]')}
              onMouseEnter={() => setHover(g.key)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="absolute inset-y-1 left-0 w-1 rounded-sm" style={{ background: g.color }} />
              <span className="min-w-0 flex-1 truncate text-white" title={g.label}>
                {g.label}
              </span>
              <span className="text-muted">{money(g.value)}</span>
              <span className="w-16 text-right text-white">{g.pct.toFixed(2)}%</span>
            </li>
          ))}
        </ul>
      </div>
      {note && <p className="mt-4 text-[12px] text-muted">{note}</p>}
    </section>
  )
}

export default function Holdings() {
  const alloc = useQuery({ queryKey: ['allocation'], queryFn: api.allocation })
  return (
    <div className="space-y-6">
      <HoldingsTable />
      {alloc.data && alloc.data.holding.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-2">
          <BreakdownCard title="Sectors" items={alloc.data.sector} note="ETFs are split by their underlying sector weights when Yahoo provides them." />
          <BreakdownCard title="Countries" items={alloc.data.country} />
        </div>
      )}
    </div>
  )
}
