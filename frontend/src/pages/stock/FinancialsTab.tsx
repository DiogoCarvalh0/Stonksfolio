import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Fragment, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, Empty, ErrorBox, Loading, Pills } from '../../components/ui'
import { api, type FinRow } from '../../lib/api'
import { num } from '../../lib/format'

type St = 'income' | 'balance' | 'cashflow'
const DEFAULTS: Record<St, string[]> = {
  income: ['Total Revenue', 'Net Income'],
  balance: ['Total Assets', 'Total Liabilities Net Minority Interest'],
  cashflow: ['Operating Cash Flow', 'Free Cash Flow'],
}
const COLORS = ['#00aff5', '#8950fc', '#5cd59b', '#f5a623', '#f27362', '#2bcbc4']

function fmtCell(v: number | null, kind: FinRow['kind']) {
  if (v == null) return '-'
  const val = kind === 'per_share' ? v : v / 1e6
  const s = num(Math.abs(val), kind === 'per_share' ? 2 : 0)
  return v < 0 ? `(${s})` : s
}

function axisFmt(v: number) {
  const a = Math.abs(v)
  if (a >= 1e12) return `${+(v / 1e12).toFixed(1)}tn`
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}bn`
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}m`
  return num(v, 2)
}

export default function FinancialsTab({ symbol, currency }: { symbol: string; currency: string }) {
  const q = useQuery({ queryKey: ['financials', symbol], queryFn: () => api.financials(symbol), staleTime: 3600_000 })
  const [st, setSt] = useState<St>('income')
  const [selected, setSelected] = useState<string[]>(DEFAULTS.income)

  const statement = q.data?.[st]
  const rows = useMemo(() => statement?.sections.flatMap((s) => s.rows) ?? [], [statement])
  const chartRows = selected.map((k) => rows.find((r) => r.key === k)).filter((r): r is FinRow => !!r)
  const data = useMemo(
    () =>
      (statement?.columns ?? []).map((c, i) => {
        const o: Record<string, string | number | null> = { col: c }
        for (const r of chartRows) o[r.label] = r.values[i]
        return o
      }),
    [statement, chartRows],
  )

  if (q.isLoading) return <Loading label="Loading financials…" />
  if (q.error) return <ErrorBox error={q.error} />
  const hasAny = q.data && Object.values(q.data).some((s) => s.sections.length)
  if (!hasAny) return <Card><Empty>No financial statements available for this security.</Empty></Card>

  const color = (key: string) => COLORS[selected.indexOf(key) % COLORS.length]
  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between text-[13px] text-body">
        <span>💡 Click on a row in the table to make it appear on the graph</span>
        {selected.length > 0 && (
          <button className="cursor-pointer hover:text-white" onClick={() => setSelected([])}>Clear all</button>
        )}
      </div>
      <div className="h-80">
        {chartRows.length ? (
          <ResponsiveContainer>
            <BarChart accessibilityLayer={false} data={data} margin={{ top: 10, right: 5, left: 0, bottom: 0 }} barGap={0}>
              <CartesianGrid stroke="#41414f" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="col" stroke="#adb5bd" fontSize={11} tickLine={false} axisLine={{ stroke: '#41414f' }} />
              <YAxis stroke="#adb5bd" fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => axisFmt(Number(v))} />
              <Tooltip
                cursor={{ fill: '#ffffff08' }}
                contentStyle={{ background: '#3b3b49', border: 'none', borderRadius: 6, fontSize: 12 }}
                formatter={(v, name) => [axisFmt(Number(v)), name]}
              />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: '#adb5bd' }} />
              {chartRows.map((r) => (
                <Bar key={r.key} dataKey={r.label} fill={color(r.key)} maxBarSize={52} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-muted">Select rows below to chart them</div>
        )}
      </div>

      <div className="mt-6 mb-4 flex flex-wrap items-center justify-between gap-3">
        <Pills
          options={[
            { value: 'income', label: 'Income statement' },
            { value: 'balance', label: 'Balance sheet' },
            { value: 'cashflow', label: 'Cash flow' },
          ]}
          value={st}
          onChange={(v) => {
            setSt(v)
            setSelected(DEFAULTS[v])
          }}
        />
        <span className="text-[12.6px] text-body">Annual · Values, {currency}</span>
      </div>

      {statement && statement.sections.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="th w-[34%]" />
                {statement.columns.map((c) => (
                  <th key={c} className="th text-right">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statement.sections.map((s) => (
                <Fragment key={s.title}>
                  <tr className="bg-[#474756]">
                    <td colSpan={statement.columns.length + 1} className="px-2 py-2.5 text-[14px] font-medium text-white">{s.title}</td>
                  </tr>
                  {s.rows.map((r) => {
                    const on = selected.includes(r.key)
                    return (
                      <tr
                        key={r.key}
                        onClick={() => toggle(r.key)}
                        className={clsx('cursor-pointer border-b border-line/70 transition hover:bg-white/[0.03]', on && 'bg-[#2b2b36]')}
                      >
                        <td className="relative px-2 py-2.5 text-[13.5px] text-white">
                          {on && <span className="absolute inset-y-0 left-0 w-1" style={{ background: color(r.key) }} />}
                          <span className="dotted">{r.label}</span>
                        </td>
                        {r.values.map((v, i) => (
                          <td key={i} className={clsx('px-2 py-2.5 text-right text-[13.5px] tabular-nums', v != null && v < 0 ? 'text-down' : 'text-white')}>
                            {fmtCell(v, r.kind)}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-right text-[12.6px] text-muted">In millions of {currency}, except per share values</div>
        </div>
      ) : (
        <Empty>No data for this statement.</Empty>
      )}
    </Card>
  )
}
