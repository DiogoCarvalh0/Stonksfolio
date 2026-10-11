import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Briefcase, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Delta, Empty } from '../../components/ui'
import { api, type Transaction } from '../../lib/api'
import { date, money, num, pct } from '../../lib/format'
import { dash, type Detail } from './util'

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[5px] text-[14px]">
      <span className="text-muted">{label}</span>
      <span className="text-right whitespace-nowrap text-white">{children}</span>
    </div>
  )
}

function Col({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between text-[15px] font-medium text-white">
        {title}
        {action}
      </div>
      {children}
    </div>
  )
}

function Gain({ v, p }: { v: number | null | undefined; p?: number | null }) {
  if (v == null) return <>{dash}</>
  return (
    <span className={clsx('inline-flex items-center gap-1', v >= 0 ? 'text-up' : 'text-down')}>
      {v >= 0 ? '+' : '-'}
      {money(Math.abs(v))}
      {p != null && (
        <>
          {' ('}
          <Delta v={p} />)
        </>
      )}
    </span>
  )
}

const dmy = (d: string) => date(d, { day: '2-digit', month: '2-digit', year: 'numeric' })
const OP_STYLE: Record<string, string> = { BUY: 'text-up', SELL: 'text-down', DIVIDEND: 'text-accent' }
const OP_LABEL: Record<string, string> = { BUY: 'Buy', SELL: 'Sell', DIVIDEND: 'Dividend' }

function TxRows({ d, onAdd, onEdit, onDelete }: { d: Detail; onAdd: () => void; onEdit: (t: Transaction) => void; onDelete: (t: Transaction) => void }) {
  const sec = d.security
  const last = d.prices[d.prices.length - 1]?.close
  const rows = d.transactions
  const totals = rows.reduce(
    (a, t) => {
      if (t.type === 'BUY') a.buy += t.quantity * t.price
      if (t.type === 'SELL') a.sell += t.quantity * t.price
      a.fee += t.fees
      return a
    },
    { buy: 0, sell: 0, fee: 0 },
  )
  const cur = rows[0]?.currency ?? sec.currency
  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-4">
          <button onClick={onAdd} className="flex cursor-pointer items-center gap-2 rounded-md bg-[#2b4a63] px-4 py-2.5 text-[14px] text-accent transition hover:bg-[#30587a]">
            <Plus size={17} /> Add
          </button>
          <div className="inline-flex gap-8 rounded-md border border-line px-4 py-2.5 text-[13px]">
            {([['Buy', totals.buy, '#5cd59b'], ['Sell', totals.sell, '#f27362'], ['Fee', totals.fee, '#8950fc']] as const)
              .filter(([, v]) => v > 0)
              .map(([l, v, c]) => (
                <div key={l}>
                  <div className="flex items-center gap-1.5 text-body">
                    <span className="h-1 w-1 rounded-full" style={{ background: c }} />
                    {l}
                  </div>
                  <div className="mt-0.5 text-white">{money(v, cur)}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="-mx-[31.5px] overflow-x-auto px-[21px]">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-line">
              <th className="th">Operation</th>
              <th className="th">Holding</th>
              <th className="th">Date</th>
              <th className="th">Shares</th>
              <th className="th">Price</th>
              <th className="th">Fee / Tax</th>
              <th className="th">Summ</th>
              <th className="th">Total profit</th>
              <th className="th">Note</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const summ = t.type === 'BUY' ? -(t.quantity * t.price + t.fees) : t.quantity * t.price - t.fees
              const sameCur = t.currency === sec.currency
              const gainPct = t.type === 'BUY' && last && t.price && sameCur ? (last / t.price - 1) * 100 : null
              const gain = gainPct != null ? t.quantity * (last! - t.price) : null
              return (
                <tr key={t.id} className="border-b border-line/70 last:border-0">
                  <td className={clsx('td', OP_STYLE[t.type])}>{OP_LABEL[t.type]}</td>
                  <td className="td">
                    <div className="max-w-56 truncate text-white">{sec.name}</div>
                    <div className="text-[12.6px] text-muted">{sec.symbol}</div>
                  </td>
                  <td className="td">{dmy(t.date)}</td>
                  <td className="td">{num(t.quantity, 6)}</td>
                  <td className="td">{money(t.price, t.currency)}</td>
                  <td className="td">{money(t.fees, t.currency)}</td>
                  <td className={clsx('td', summ < 0 ? 'text-down' : 'text-up')}>
                    {summ < 0 ? '-' : '+'}
                    {money(Math.abs(summ), t.currency)}
                  </td>
                  <td className="td">
                    {gainPct != null ? (
                      <>
                        <Delta v={gainPct} />
                        <div className={clsx('dotted', gain! >= 0 ? 'text-up' : 'text-down')}>
                          {gain! >= 0 ? '+' : '-'}
                          {money(Math.abs(gain!), t.currency)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">{dash}</span>
                    )}
                  </td>
                  <td className="td max-w-40 truncate text-[12.6px] text-muted">{t.notes}</td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => onEdit(t)} title="Edit" className="grid h-9 w-9 cursor-pointer place-items-center rounded-md bg-[#2b4a63] text-accent hover:bg-[#30587a]">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => onDelete(t)} title="Delete" className="grid h-9 w-9 cursor-pointer place-items-center rounded-md bg-[#4a2f35] text-down hover:bg-[#5a353b]">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function IncomeRows({ d }: { d: Detail }) {
  const rows = [...d.dividends_received].reverse()
  if (!rows.length) return <Empty>No dividends received from this holding yet.</Empty>
  return (
    <div className="-mx-[31.5px] overflow-x-auto px-[21px]">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-line">
            <th className="th">Operation</th>
            <th className="th">Date</th>
            <th className="th">Shares</th>
            <th className="th">Per share</th>
            <th className="th">Tax</th>
            <th className="th">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/70 last:border-0">
              <td className="td text-up">Dividends</td>
              <td className="td">{dmy(r.date)}</td>
              <td className="td">{num(r.shares, 6)}</td>
              <td className="td">{money(r.per_share, r.currency, 4)}</td>
              <td className="td">{money(r.tax_eur)}</td>
              <td className="td text-up">+{money(r.amount_eur)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MyPosition({ d, onAdd, onEdit, onDelete }: { d: Detail; onAdd: () => void; onEdit: (t: Transaction) => void; onDelete: (t: Transaction) => void }) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [tab, setTab] = useState<'tx' | 'income'>('tx')
  const p = d.position
  if (!p) return null
  const capital = p.unrealized + p.realized
  const capitalBase = p.cost || null
  const cur = d.security.currency
  return (
    <div>
      <h2 className="mb-4 text-[19px] font-medium text-white">My positions</h2>
      <section className="card px-[31.5px] pt-7">
        <div className="mb-4 flex items-center gap-2.5 text-[15px] text-white">
          <Briefcase size={16} className="text-muted" />
          My portfolio
          {p.closed && <span className="rounded bg-line px-2 py-0.5 text-[12px] text-body">Closed</span>}
        </div>
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-2 xl:grid-cols-3">
          <Col title="General">
            <Row label="Shares">{num(p.quantity, 6)} shares</Row>
            <Row label="Current value">{money(p.value)}</Row>
            <Row label="Cost per share">{money(p.avg_price, cur)}</Row>
            <Row label="Cost basis">{money(p.cost)}</Row>
            <Row label="Share in portfolio">{pct(p.weight, 2, false)}</Row>
          </Col>
          <Col title="Dividends">
            <Row label="Next 12 months">{money(p.annual_income)}</Row>
            <Row label="Yield on cost">{pct(p.yield_on_cost, 2, false)}</Row>
            <Row label="Received">{money(p.dividends)}</Row>
            <Row label="Tax">
              {settings.data ? (
                <Link to="/settings" className="hover:text-accent" title="Change in settings">
                  {pct(settings.data.dividend_tax_rate * 100, 0, false)} ✎
                </Link>
              ) : (
                dash
              )}
            </Row>
          </Col>
          <Col title="Returns">
            <Row label="Total profit"><Gain v={p.total_profit} p={p.total_profit_pct} /></Row>
            <Row label="Capital gain"><Gain v={capital} p={capitalBase ? (capital / capitalBase) * 100 : null} /></Row>
            <Row label="Fees paid"><span className={p.fees ? 'text-down' : ''}>{p.fees ? `-${money(p.fees)}` : money(0)}</span></Row>
            <Row label="IRR">{p.irr != null ? <Delta v={p.irr} /> : dash}</Row>
          </Col>
        </div>
        <nav className="mt-8 flex gap-8">
          {([['tx', 'Transactions'], ['income', 'Incomes']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'cursor-pointer border-b-2 pb-5 text-[14px] transition',
                tab === id ? 'border-accent text-accent' : 'border-transparent text-body hover:text-white',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </section>
      <section className="card card-pad mt-[25px]">
        {tab === 'tx' ? <TxRows d={d} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} /> : <IncomeRows d={d} />}
      </section>
    </div>
  )
}
