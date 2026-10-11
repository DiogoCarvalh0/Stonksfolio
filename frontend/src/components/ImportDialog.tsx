import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { api, ApiError, type ColumnMapping, type ImportField, type ImportPreview } from '../lib/api'
import { ErrorBox, Modal } from './ui'

const SAMPLE = `date,type,symbol,quantity,price,fees,currency,notes
2023-01-15,BUY,AAPL,10,135.50,1.00,USD,
2023-02-01,BUY,VWCE.DE,20,98.20,0,EUR,monthly
2023-06-10,SELL,AAPL,5,180.00,1.00,USD,
`

const FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'type', label: 'Type (BUY/SELL/DIVIDEND)', required: true },
  { key: 'symbol', label: 'Symbol / ticker', required: true },
  { key: 'exchange', label: 'Exchange (e.g. NASDAQ, XETRA, AS)' },
  { key: 'quantity', label: 'Quantity', required: true },
  { key: 'price', label: 'Price', required: true },
  { key: 'fees', label: 'Fees' },
  { key: 'currency', label: 'Currency' },
  { key: 'notes', label: 'Notes' },
]

function Errors({ error }: { error: unknown }) {
  return (
    <div className="space-y-2">
      <ErrorBox error={error} />
      {error instanceof ApiError && error.details.length > 1 && (
        <ul className="max-h-40 list-disc overflow-auto pl-5 text-xs text-rose-200">
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const preview = useMutation({
    mutationFn: (f: File) => api.importPreview(f),
    onSuccess: (p: ImportPreview) => setMapping(p.mapping),
  })
  const imp = useMutation({
    mutationFn: ({ f, m }: { f: File; m: ColumnMapping }) => api.importCsv(f, m),
    onSuccess: () => qc.invalidateQueries(),
  })
  const close = () => {
    imp.reset()
    preview.reset()
    setFile(null)
    setMapping({})
    onClose()
  }
  const sampleUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`
  const p = preview.data
  const missing = FIELDS.filter((f) => f.required && mapping[f.key] == null)
  const used = Object.values(mapping)
  const duplicates = new Set(used.filter((v, i) => used.indexOf(v) !== i))

  return (
    <Modal open={open} onClose={close} title="Import transactions (CSV)" wide>
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Upload a CSV and choose which column holds each field. Required: <code className="text-slate-200">date, type, symbol, quantity, price</code>;
          optional: <code className="text-slate-200">exchange, fees, currency, notes</code>. Type is BUY, SELL or DIVIDEND. Symbols are Yahoo Finance tickers
          (e.g. <code>ASML.AS</code>, <code>VWCE.DE</code>, <code>ULVR.L</code>), or plain tickers plus an exchange column (<code>ASML</code> + <code>AMS</code>). Comma or semicolon separated; dates as YYYY-MM-DD or
          DD/MM/YYYY. Leave currency empty to use the security's trading currency.
        </p>
        {!p && (
          <>
            <pre className="overflow-x-auto rounded-lg bg-panel-2 p-3 text-xs text-slate-300">{SAMPLE}</pre>
            <a className="btn-ghost -ml-3 w-fit" href={sampleUrl} download="stonksfolio-sample.csv">
              <Download size={14} /> Download template
            </a>
          </>
        )}
        <input
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-slate-200"
          onChange={(e) => {
            imp.reset()
            preview.reset()
            setMapping({})
            const f = e.target.files?.[0] ?? null
            setFile(f)
            if (f) preview.mutate(f)
          }}
        />
        {preview.isPending && <p className="text-muted">Reading file…</p>}
        {preview.error && <Errors error={preview.error} />}

        {p && !imp.data && (
          <>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              {FIELDS.map((f) => {
                const v = mapping[f.key]
                return (
                  <div key={f.key}>
                    <label className="label">
                      {f.label}
                      {f.required && <span className="text-rose-300"> *</span>}
                    </label>
                    <select
                      className="input"
                      value={v ?? ''}
                      onChange={(e) =>
                        setMapping((m) => {
                          const next = { ...m }
                          if (e.target.value === '') delete next[f.key]
                          else next[f.key] = Number(e.target.value)
                          return next
                        })
                      }
                    >
                      <option value="">{f.required ? '— choose column —' : '— not in file —'}</option>
                      {p.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    {v != null && duplicates.has(v) && <p className="mt-1 text-xs text-amber-300">Column used for more than one field</p>}
                  </div>
                )
              })}
            </div>

            {p.sample.length > 0 && (
              <div>
                <p className="label">Preview (first {p.sample.length} rows)</p>
                <div className="overflow-x-auto rounded-lg bg-panel-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        {FIELDS.map((f) => (
                          <th key={f.key} className="px-2 py-1.5 font-medium whitespace-nowrap">
                            {f.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {p.sample.map((row, r) => (
                        <tr key={r} className="border-t border-line/50 text-slate-300">
                          {FIELDS.map((f) => {
                            const i = mapping[f.key]
                            return (
                              <td key={f.key} className="px-2 py-1.5 whitespace-nowrap">
                                {i != null ? row[i] ?? '' : <span className="text-muted">—</span>}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {imp.error && <Errors error={imp.error} />}
        {imp.data && (
          <div className="rounded-xl border border-up/40 bg-up/10 px-4 py-3 text-emerald-200">Imported {imp.data.imported} transactions.</div>
        )}
        <div className="flex items-center justify-end gap-2">
          {p && !imp.data && missing.length > 0 && (
            <span className="mr-auto text-xs text-amber-300">Choose a column for: {missing.map((f) => f.key).join(', ')}</span>
          )}
          <button className="btn-ghost" onClick={close}>
            {imp.data ? 'Close' : 'Cancel'}
          </button>
          {!imp.data && (
            <button
              className="btn-primary"
              disabled={!file || !p || missing.length > 0 || imp.isPending}
              onClick={() => file && imp.mutate({ f: file, m: mapping })}
            >
              {imp.isPending ? 'Importing… (downloading prices)' : 'Import'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
