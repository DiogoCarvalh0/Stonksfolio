import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ImportDialog from '../components/ImportDialog'
import TransactionForm from '../components/TransactionForm'
import { Card, Empty, ErrorBox, Loading, PageHeader } from '../components/ui'
import { api, type Transaction } from '../lib/api'
import { date, money, num } from '../lib/format'

export const TYPE_STYLE: Record<string, string> = {
  BUY: 'bg-up/15 text-emerald-300',
  SELL: 'bg-down/15 text-rose-300',
  DIVIDEND: 'bg-amber-400/15 text-amber-300',
}

export function TxTable({ rows, onEdit, onDelete, showSymbol = true }: { rows: Transaction[]; onEdit?: (t: Transaction) => void; onDelete?: (t: Transaction) => void; showSymbol?: boolean }) {
  return (
    <table className="w-full">
      <thead className="bg-panel-2/50">
        <tr>
          <th className="th">Date</th>
          <th className="th">Type</th>
          {showSymbol && <th className="th">Symbol</th>}
          <th className="th text-right">Quantity</th>
          <th className="th text-right">Price</th>
          <th className="th text-right">Fees</th>
          <th className="th text-right">Total</th>
          <th className="th">Notes</th>
          {(onEdit || onDelete) && <th className="th" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="group border-t border-line/60 hover:bg-panel-2/40">
            <td className="td">{date(t.date)}</td>
            <td className="td">
              <span className={clsx('rounded px-2 py-0.5 text-xs font-medium', TYPE_STYLE[t.type])}>{t.type}</span>
            </td>
            {showSymbol && (
              <td className="td">
                <Link to={`/stock/${t.symbol}`} className="font-medium hover:underline">{t.symbol}</Link>
                <div className="max-w-52 truncate text-xs text-muted">{t.name}</div>
              </td>
            )}
            <td className="td text-right">{num(t.quantity, 6)}</td>
            <td className="td text-right">{money(t.price, t.currency, 4)}</td>
            <td className="td text-right text-muted">{t.fees ? money(t.fees, t.currency) : '—'}</td>
            <td className="td text-right font-medium">{money(t.total, t.currency)}</td>
            <td className="td max-w-48 truncate text-xs text-muted">{t.notes}</td>
            {(onEdit || onDelete) && (
              <td className="td text-right">
                <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100">
                  {onEdit && (
                    <button className="btn-ghost p-1.5" onClick={() => onEdit(t)} title="Edit">
                      <Pencil size={14} />
                    </button>
                  )}
                  {onDelete && (
                    <button className="btn-ghost p-1.5 hover:text-down" onClick={() => onDelete(t)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function useTxActions() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Transaction | null | undefined>(undefined)
  const del = useMutation({ mutationFn: (id: number) => api.deleteTx(id), onSuccess: () => qc.invalidateQueries() })
  const onDelete = (t: Transaction) => {
    if (confirm(`Delete ${t.type} ${t.quantity} ${t.symbol} on ${t.date}?`)) del.mutate(t.id)
  }
  return { editing, setEditing, onDelete, error: del.error }
}

export default function Transactions() {
  const q = useQuery({ queryKey: ['transactions'], queryFn: () => api.transactions() })
  const { editing, setEditing, onDelete, error } = useTxActions()
  const [importOpen, setImportOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [type, setType] = useState('')

  const rows = useMemo(() => {
    const f = filter.trim().toUpperCase()
    return (q.data ?? []).filter(
      (t) => (!f || t.symbol.includes(f) || (t.name ?? '').toUpperCase().includes(f)) && (!type || t.type === type),
    )
  }, [q.data, filter, type])

  return (
    <>
      <PageHeader
        title="Transactions"
        sub={`${q.data?.length ?? 0} transactions`}
        actions={
          <>
            <a className="btn-ghost" href="/api/transactions/export">
              <Download size={16} /> Export
            </a>
            <button className="btn-ghost" onClick={() => setImportOpen(true)}>
              <Upload size={16} /> Import CSV
            </button>
            <button className="btn-primary" onClick={() => setEditing(null)}>
              <Plus size={16} /> Add
            </button>
          </>
        }
      />
      {error && <div className="mb-4"><ErrorBox error={error} /></div>}
      <Card className="!p-0 overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <input className="input max-w-xs" placeholder="Filter by symbol or name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select className="input w-40" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="DIVIDEND">Dividend</option>
          </select>
        </div>
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="p-4"><ErrorBox error={q.error} /></div>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <TxTable rows={rows} onEdit={setEditing} onDelete={onDelete} />
          </div>
        ) : (
          <Empty>No transactions.</Empty>
        )}
      </Card>
      {editing !== undefined && <TransactionForm open initial={editing} onClose={() => setEditing(undefined)} />}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}
