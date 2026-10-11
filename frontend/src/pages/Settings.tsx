import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import SymbolSearch from '../components/SymbolSearch'
import { Card, ErrorBox, Loading, PageHeader } from '../components/ui'
import { api } from '../lib/api'

const BENCHMARKS = [
  { symbol: 'IWDA.AS', label: 'iShares Core MSCI World (EUR)' },
  { symbol: 'VWCE.DE', label: 'Vanguard FTSE All-World (EUR)' },
  { symbol: 'CSPX.AS', label: 'iShares Core S&P 500 (USD)' },
  { symbol: 'SXR8.DE', label: 'iShares Core S&P 500 (EUR)' },
  { symbol: 'EXSA.DE', label: 'iShares STOXX Europe 600 (EUR)' },
  { symbol: '^GSPC', label: 'S&P 500 index (price only)' },
]

export default function Settings() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings })
  const [benchmark, setBenchmark] = useState('')
  const [tax, setTax] = useState('0')
  useEffect(() => {
    if (q.data) {
      setBenchmark(q.data.benchmark)
      setTax(String(q.data.dividend_tax_rate))
    }
  }, [q.data])
  const save = useMutation({
    mutationFn: () => api.saveSettings({ benchmark, dividend_tax_rate: Number(tax) || 0 }),
    onSuccess: () => qc.invalidateQueries(),
  })

  if (q.isLoading) return <Loading />

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid max-w-3xl gap-6">
        <Card title="Benchmark">
          <p className="mb-3 text-sm text-muted">Compared against your time-weighted return on the dashboard. Converted to EUR.</p>
          <div className="mb-3 flex flex-wrap gap-2">
            {BENCHMARKS.map((b) => (
              <button
                key={b.symbol}
                onClick={() => setBenchmark(b.symbol)}
                className={`rounded-lg border px-3 py-1.5 text-xs cursor-pointer ${benchmark === b.symbol ? 'border-accent text-white' : 'border-line text-muted hover:text-white'}`}
                title={b.label}
              >
                {b.symbol}
              </button>
            ))}
          </div>
          <label className="label">Or search any ticker (current: {benchmark})</label>
          <SymbolSearch onSelect={(r) => setBenchmark(r.symbol)} />
        </Card>
        <Card title="Dividends">
          <label className="label">Withholding tax applied to auto-calculated dividends (%)</label>
          <input type="number" min={0} max={100} step="0.1" className="input max-w-40" value={tax} onChange={(e) => setTax(e.target.value)} />
          <p className="mt-2 text-xs text-muted">
            Dividends are calculated from Yahoo ex-dividend dates and your holdings on the previous day. For exact net amounts per
            payout, add DIVIDEND transactions instead (they replace the automatic ones for that symbol).
          </p>
        </Card>
        {save.error && <ErrorBox error={save.error} />}
        <div>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : save.isSuccess ? 'Saved ✓' : 'Save settings'}
          </button>
        </div>
        <Card title="About data">
          <p className="text-sm text-muted">
            Prices, dividends, splits, FX rates and fundamentals come from Yahoo Finance (free, unofficial) and refresh automatically
            twice a day. Prices are end-of-day closes. All values are reported in EUR.
          </p>
        </Card>
      </div>
    </>
  )
}
