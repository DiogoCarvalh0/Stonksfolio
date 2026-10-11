import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { api, type Transaction, type TxInput, type TxType } from '../lib/api'
import { num } from '../lib/format'
import SymbolSearch from './SymbolSearch'
import { ErrorBox, Modal } from './ui'

const today = () => new Date().toISOString().slice(0, 10)
const CURRENCIES = ['', 'EUR', 'USD', 'GBP', 'GBp', 'CHF', 'DKK', 'SEK', 'NOK', 'CAD', 'JPY', 'HKD', 'AUD', 'PLN']

export default function TransactionForm({
  open,
  onClose,
  initial,
  defaultSymbol,
}: {
  open: boolean
  onClose: () => void
  initial?: Transaction | null
  defaultSymbol?: string
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<TxInput>(() =>
    initial
      ? { date: initial.date, type: initial.type, symbol: initial.symbol, quantity: initial.quantity, price: initial.price, fees: initial.fees, currency: initial.currency, notes: initial.notes }
      : { date: today(), type: 'BUY', symbol: defaultSymbol ?? '', quantity: 0, price: 0, fees: 0, currency: '', notes: '' },
  )
  const set = <K extends keyof TxInput>(k: K, v: TxInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = useMutation({
    mutationFn: (tx: TxInput) => (initial ? api.updateTx(initial.id, tx) : api.createTx(tx)),
    onSuccess: () => {
      qc.invalidateQueries()
      onClose()
    },
  })

  const isDiv = form.type === 'DIVIDEND'
  const isSell = form.type === 'SELL'
  const sellable = useQuery({
    queryKey: ['sellable', form.symbol, form.date, initial?.id],
    queryFn: () => api.sellable(form.symbol, form.date, initial?.id),
    enabled: open && isSell && !!form.symbol && /^\d{4}-\d{2}-\d{2}$/.test(form.date),
  })
  const available = isSell ? sellable.data?.quantity : undefined
  const overSell = available != null && form.quantity > available + 1e-6
  const total = form.quantity * form.price + (form.type === 'BUY' ? form.fees : -form.fees)

  return (
    <Modal open={open} onClose={onClose} title={initial ? 'Edit transaction' : 'Add transaction'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate({ ...form, currency: form.currency || null, notes: form.notes || null })
        }}
      >
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-panel-2 p-1">
          {(['BUY', 'SELL', 'DIVIDEND'] as TxType[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => set('type', t)}
              className={clsx(
                'rounded-md py-1.5 text-sm font-medium cursor-pointer',
                form.type === t ? (t === 'SELL' ? 'bg-down/80 text-white' : t === 'BUY' ? 'bg-up/80 text-slate-900' : 'bg-amber-400/90 text-slate-900') : 'text-muted',
              )}
            >
              {t === 'DIVIDEND' ? 'Dividend' : t === 'BUY' ? 'Buy' : 'Sell'}
            </button>
          ))}
        </div>

        <div>
          <label className="label">Security — search by ticker, name or ISIN (e.g. ASML.AS or IE00BK5BQT80)</label>
          {form.symbol ? (
            <div className="flex items-center justify-between rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm">
              <span className="font-semibold">{form.symbol}</span>
              <button type="button" className="text-xs text-muted hover:text-white" onClick={() => set('symbol', '')}>
                change
              </button>
            </div>
          ) : (
            <SymbolSearch autoFocus onSelect={(r) => set('symbol', r.symbol)} />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" required max={today()} value={form.date} onChange={(e) => set('date', e.target.value)} />
          </div>
          <div>
            <label className="label">Currency (blank = security currency)</label>
            <select className="input" value={form.currency ?? ''} onChange={(e) => set('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c || 'Auto'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{isDiv ? 'Shares (or 1 if entering a total)' : 'Quantity'}</label>
            <input
              type="number"
              step="any"
              min="0"
              max={available}
              className={clsx('input', overSell && '!border-down')}
              required
              value={form.quantity || ''}
              onChange={(e) => set('quantity', Number(e.target.value))}
            />
            {isSell && form.symbol && available != null && (
              <div className={clsx('mt-1 text-xs', overSell ? 'text-down' : 'text-muted')}>
                {overSell ? 'More than you hold — ' : ''}Available: {+available.toFixed(6)} shares
                {available > 0 && form.quantity !== available && (
                  <button type="button" className="ml-2 cursor-pointer text-accent hover:underline" onClick={() => set('quantity', available)}>
                    Sell all
                  </button>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="label">{isDiv ? 'Dividend per share (or total)' : 'Price per share'}</label>
            <input type="number" step="any" min="0" className="input" required value={form.price || ''} onChange={(e) => set('price', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">{isDiv ? 'Withholding tax' : 'Fees'}</label>
            <input type="number" step="any" min="0" className="input" value={form.fees || ''} onChange={(e) => set('fees', Number(e.target.value))} />
          </div>
          <div>
            <label className="label">{isDiv ? 'Net amount' : 'Total'}</label>
            <div className="input bg-transparent">
              {num(total)} {form.currency || ''}
            </div>
          </div>
        </div>
        {isDiv && (
          <p className="text-xs text-muted">
            Dividends are calculated automatically from your holdings. Add them manually only if you want exact net amounts — once a
            symbol has a manual dividend, automatic ones for that symbol are ignored.
          </p>
        )}
        <div>
          <label className="label">Notes</label>
          <input className="input" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </div>
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!form.symbol || !form.quantity || overSell || (isSell && available === 0) || save.isPending}>
            {save.isPending ? 'Saving… (fetching market data)' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
