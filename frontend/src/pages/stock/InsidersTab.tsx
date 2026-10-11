import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { Card, Empty, ErrorBox, Loading, Pills, Segmented } from '../../components/ui'
import { api, type InsiderKind } from '../../lib/api'
import { compactMoney, date, money, num, toneClass } from '../../lib/format'

type Period = '3m' | '6m' | '1y' | 'all'
const PERIOD_MONTHS: Record<Period, number | null> = { '3m': 3, '6m': 6, '1y': 12, all: null }
const KIND: Record<InsiderKind, { label: string; cls: string }> = {
  buy: { label: 'Buy', cls: 'bg-up/15 text-up' },
  sell: { label: 'Sell', cls: 'bg-down/15 text-down' },
  award: { label: 'Award', cls: 'bg-panel-2 text-body' },
  gift: { label: 'Gift', cls: 'bg-panel-2 text-body' },
  exercise: { label: 'Option exercise', cls: 'bg-panel-2 text-body' },
  other: { label: 'Other', cls: 'bg-panel-2 text-body' },
}
const PAGE = 20

function since(months: number | null) {
  if (months == null) return ''
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString().slice(0, 10)
}

export default function InsidersTab({ symbol }: { symbol: string }) {
  const q = useQuery({ queryKey: ['insiders', symbol], queryFn: () => api.insiders(symbol), staleTime: 3600_000 })
  const [period, setPeriod] = useState<Period>('1y')
  const [scope, setScope] = useState<'trades' | 'all'>('trades')
  const [shown, setShown] = useState(PAGE)

  const inPeriod = useMemo(() => {
    const from = since(PERIOD_MONTHS[period])
    return (q.data?.transactions ?? []).filter((t) => !from || (t.date ?? '') >= from)
  }, [q.data, period])
  const rows = scope === 'trades' ? inPeriod.filter((t) => t.kind === 'buy' || t.kind === 'sell') : inPeriod

  if (q.isLoading) return <Loading label="Loading insider trades…" />
  if (q.error) return <ErrorBox error={q.error} />
  const { transactions, currency, source } = q.data!
  if (!transactions.length)
    return (
      <Card>
        <Empty>
          No insider trades available. Insider filings are only published for companies reporting to the US SEC (Form 4).
        </Empty>
    </Card>
    )

  const cur = currency ?? 'USD'
  const total = (k: InsiderKind) => inPeriod.filter((t) => t.kind === k).reduce((s, t) => s + (t.value ?? 0), 0)
  const trades = (k: InsiderKind) => {
    const n = inPeriod.filter((t) => t.kind === k).length
    return `${n} ${n === 1 ? 'trade' : 'trades'}`
  }
  const buys = total('buy')
  const sells = total('sell')
  const summary = [
    { label: 'Insider buys', value: compactMoney(buys, cur), sub: trades('buy'), cls: 'text-white' },
    { label: 'Insider sells', value: compactMoney(sells, cur), sub: trades('sell'), cls: 'text-white' },
    { label: 'Net buying', value: compactMoney(buys - sells, cur), sub: 'buys − sells', cls: toneClass(buys - sells) },
  ]

  return (
    <Card
      title="Insider transactions"
      action={<Segmented options={['3m', '6m', '1y', 'all'] as const} value={period} onChange={(p) => { setPeriod(p); setShown(PAGE) }} />}
    >
      <div className="mb-6 grid grid-cols-3 gap-2 rounded-lg bg-panel-2/50 p-3 sm:gap-3 sm:p-4">
        {summary.map((s) => (
          <div key={s.label} className="min-w-0">
            <div className="text-[12.6px] text-muted">{s.label}</div>
            <div className={clsx('mt-1 truncate text-[15px] font-medium sm:text-xl', s.cls)}>{s.value}</div>
            <div className="text-[12px] text-muted">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="mb-4">
        <Pills
          options={[
            { value: 'trades', label: 'Buys & sells' },
            { value: 'all', label: 'All transactions' },
          ]}
          value={scope}
          onChange={(s) => { setScope(s); setShown(PAGE) }}
        />
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full sm:min-w-[600px]">
            <thead>
              <tr>
                <th className="th">Date</th>
                <th className="th">Insider</th>
                <th className="th">Type</th>
                <th className="th hidden text-right sm:table-cell">Shares</th>
                <th className="th hidden text-right sm:table-cell">Price</th>
                <th className="th text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((t, i) => (
                <tr key={i} className="border-b border-line/70 text-[13.5px]" title={t.text ?? undefined}>
                  <td className="px-2 py-2.5 whitespace-nowrap text-body">{date(t.date, { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                  <td className="px-2 py-2.5">
                    <div className="text-white">{t.insider}</div>
                    {t.position && <div className="text-[12px] text-muted">{t.position}</div>}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={clsx('rounded px-2 py-0.5 text-[12px] whitespace-nowrap', KIND[t.kind].cls)}>{KIND[t.kind].label}</span>
                  </td>
                  <td className="hidden px-2 py-2.5 text-right text-white tabular-nums sm:table-cell">{num(t.shares, 0)}</td>
                  <td className="hidden px-2 py-2.5 text-right text-white tabular-nums sm:table-cell">{t.price ? money(t.price, cur) : '—'}</td>
                  <td className="px-2 py-2.5 text-right text-white tabular-nums">{t.value ? compactMoney(t.value, cur) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown && (
            <button className="mt-4 w-full cursor-pointer rounded-md bg-panel-2 py-2 text-[13px] text-body hover:bg-line hover:text-white" onClick={() => setShown((n) => n + PAGE)}>
              Show more ({rows.length - shown} remaining)
            </button>
          )}
        </div>
      ) : (
        <Empty>{scope === 'trades' ? 'No open-market buys or sells by insiders in this period.' : 'No insider transactions in this period.'}</Empty>
      )}
      <div className="mt-4 text-right text-[12.6px] text-muted">
        SEC Form 4 filings via Yahoo Finance{source !== symbol ? ` (primary listing ${source})` : ''} · Values in {cur}
      </div>
    </Card>
  )
}
