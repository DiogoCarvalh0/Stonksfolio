export type Summary = {
  currency: string
  value: number
  cost: number
  unrealized: number
  unrealized_pct: number | null
  realized: number
  dividends: number
  fees: number
  total_profit: number
  total_profit_pct: number | null
  day_change: number
  day_change_pct: number | null
  twr: number
  xirr: number | null
  benchmark: string | null
  benchmark_return: number | null
  annual_income: number
  portfolio_yield: number | null
  holdings_count: number
  first_date: string | null
  warnings: string[]
}

export type PerfPoint = {
  date: string
  value: number
  invested: number
  dividends: number
  profit: number
  twr: number
  benchmark: number | null
}

/** EUR price index of a benchmark, rebased to 1 and aligned 1:1 with the performance series. */
export type BenchmarkSeries = { symbol: string; name: string; index: (number | null)[] | null }

export type Holding = {
  symbol: string
  name: string
  currency: string
  quote_type: string | null
  asset_type: string
  sector: string | null
  country: string | null
  exchange: string | null
  quantity: number
  avg_price: number | null
  price: number | null
  fx: number
  cost_local: number
  value: number
  cost: number
  weight: number
  unrealized: number
  unrealized_pct: number | null
  realized: number
  dividends: number
  fees: number
  total_profit: number
  total_profit_pct: number | null
  day_change: number
  day_change_pct: number | null
  dividend_yield: number
  yield_on_cost: number
  annual_income: number
  first_buy: string | null
  closed: boolean
  irr: number | null
}

export type AllocItem = { key: string; label: string; value: number; pct: number }
export type Allocation = Record<'holding' | 'asset_type' | 'sector' | 'country' | 'currency', AllocItem[]> & { total: number }

export type DividendRecord = {
  date: string
  symbol: string
  name: string
  shares: number
  per_share: number
  currency: string
  amount_local: number
  amount_eur: number
  tax_eur: number
  source: 'auto' | 'manual'
}

export type UpcomingDividend = {
  date: string
  symbol: string
  name: string
  per_share: number
  currency: string
  shares: number
  amount_eur: number
  confirmed: boolean
}

export type Dividends = {
  received: DividendRecord[]
  by_month: { month: string; amount: number }[]
  by_year: { year: string; amount: number }[]
  upcoming: UpcomingDividend[]
  projected_by_month: { month: string; amount: number }[]
  total: number
  ttm: number
  projected_annual: number
  tax_rate: number
  growth: DividendGrowth[]
}

export type Sentiment = {
  score: number
  rating: string
  timestamp: string | null
  previous: { label: string; score: number }[]
  history: { date: string; score: number; rating: string | null }[]
  indicators: { key: string; label: string; description: string; score: number | null; rating: string | null }[]
}

export type DipSource = 'holdings' | 'watchlist' | 'all'

export type Dip = {
  symbol: string
  name: string
  currency: string | null
  held: boolean
  price: number | null
  sma50: number | null
  sma200: number | null
  vs_sma50: number | null
  vs_sma200: number | null
  high_52w: number | null
  from_high: number | null
  rsi14: number | null
  /** Open-market insider trades over the last 6 months; null when no insider data exists (e.g. non-US). */
  insider_buy_value: number | null
  insider_sell_value: number | null
  insider_net_value: number | null
  insider_buys: number | null
  insider_sells: number | null
  insider_net_trades: number | null
  insider_currency: string | null
}

export type DividendGrowth = {
  symbol: string
  name: string
  annual_income: number
  /** Per-share dividend CAGR (%) over `years` full calendar years. */
  cagr: number
  years: number
  last_year: number | null
}

export type TxType = 'BUY' | 'SELL' | 'DIVIDEND'

export type Transaction = {
  id: number
  date: string
  type: TxType
  symbol: string
  name: string | null
  quantity: number
  price: number
  fees: number
  currency: string
  notes: string | null
  total: number
}

export type TxInput = Omit<Transaction, 'id' | 'name' | 'total' | 'currency'> & { currency?: string | null }

export type SearchResult = { symbol: string; name: string; exchange: string; type: string; isin?: string }
export type Listing = SearchResult & { currency: string | null; primary: boolean }

export type SecurityInfo = Record<string, any> & {
  calendar?: Record<string, string | string[]>
}

export type StockDetail = {
  security: {
    symbol: string
    name: string
    currency: string
    quote_type: string | null
    sector: string | null
    industry: string | null
    country: string | null
    exchange: string | null
    sector_weights: Record<string, number> | null
    info: SecurityInfo
  }
  prices: { date: string; close: number }[]
  dividend_history: { date: string; amount: number }[]
  position: Holding | null
  transactions: Transaction[]
  dividends_received: DividendRecord[]
}

export type FinRow = { key: string; label: string; kind: 'money' | 'per_share' | 'shares'; values: (number | null)[] }
export type Statement = { columns: string[]; sections: { title: string; rows: FinRow[] }[] }
export type WatchItem = {
  symbol: string
  name: string | null
  currency: string | null
  quote_type: string | null
  exchange: string | null
  sector: string | null
  country: string | null
  note: string | null
  added_at: string
  held: boolean
  price: number | null
  history: [string, number][]
  pe_ttm: number | null
  pe_fwd: number | null
  peg: number | null
  pb: number | null
  eps_ttm: number | null
  eps_fwd: number | null
  sma50: number | null
  sma200: number | null
  vs_sma50_pct: number | null
  vs_sma200_pct: number | null
  high_52w: number | null
  low_52w: number | null
  shares_outstanding: number | null
  insider_pct: number | null
  institutions_pct: number | null
  short_pct: number | null
  market_cap: number | null
  beta: number | null
  dividend_yield: number | null
  dividend_rate: number | null
  payout_ratio: number | null
  ex_dividend_date: string | null
  next_payment_date: string | null
  next_payment: number | null
  earnings_date: string | null
  target_price: number | null
  recommendation: string | null
  revenue_growth: number | null
  profit_margin: number | null
  roe: number | null
}

export type Financials = { income: Statement; balance: Statement; cashflow: Statement }
export type InsiderKind = 'buy' | 'sell' | 'award' | 'gift' | 'exercise' | 'other'
export type InsiderTx = {
  date: string | null
  insider: string
  position: string | null
  kind: InsiderKind
  text: string | null
  shares: number | null
  value: number | null
  price: number | null
  ownership: string | null
}
export type Insiders = { source: string; currency: string | null; transactions: InsiderTx[] }
export type Settings = { benchmark: string; dividend_tax_rate: number }
export type Status = { running: boolean; last_run: string | null; last_error: string | null; base_currency: string }
export type ImportField = 'date' | 'type' | 'symbol' | 'exchange' | 'quantity' | 'price' | 'fees' | 'currency' | 'notes'
export type ColumnMapping = Partial<Record<ImportField, number>>
export type ImportPreview = { headers: string[]; sample: string[][]; mapping: ColumnMapping }

export class ApiError extends Error {
  details: string[]
  constructor(message: string, details: string[] = []) {
    super(message)
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    let details: string[] = []
    try {
      const body = await res.json()
      const d = body.detail
      if (typeof d === 'string') msg = d
      else if (Array.isArray(d)) msg = d.map((e: any) => `${e.loc?.slice(1).join('.')}: ${e.msg}`).join('; ')
      else if (d?.errors) {
        details = d.errors
        msg = d.errors[0]
      }
    } catch {
      /* not json */
    }
    throw new ApiError(msg, details)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  summary: () => request<Summary>('/summary'),
  performance: (benchmarks?: string[]) =>
    request<{ benchmark: string | null; series: PerfPoint[]; benchmarks?: BenchmarkSeries[] }>(
      `/performance${benchmarks ? `?benchmarks=${encodeURIComponent(benchmarks.join(','))}` : ''}`,
    ),
  holdings: (includeClosed = false) => request<Holding[]>(`/holdings?include_closed=${includeClosed}`),
  allocation: () => request<Allocation>('/allocation'),
  dividends: () => request<Dividends>('/dividends'),
  sentiment: () => request<Sentiment>('/sentiment'),
  dips: (source: DipSource) => request<Dip[]>(`/dips?source=${source}`),
  transactions: (symbol?: string) =>
    request<Transaction[]>(`/transactions${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`),
  createTx: (tx: TxInput) => request<Transaction>('/transactions', json('POST', tx)),
  updateTx: (id: number, tx: TxInput) => request<Transaction>(`/transactions/${id}`, json('PUT', tx)),
  deleteTx: (id: number) => request<void>(`/transactions/${id}`, { method: 'DELETE' }),
  importPreview: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<ImportPreview>('/transactions/import/preview', { method: 'POST', body: fd })
  },
  importCsv: (file: File, mapping?: ColumnMapping) => {
    const fd = new FormData()
    fd.append('file', file)
    if (mapping) fd.append('mapping', JSON.stringify(mapping))
    return request<{ imported: number }>('/transactions/import', { method: 'POST', body: fd })
  },
  search: (q: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
  stock: (symbol: string) => request<StockDetail>(`/stock/${encodeURIComponent(symbol)}`),
  listings: (symbol: string) => request<Listing[]>(`/stock/${encodeURIComponent(symbol)}/listings`),
  primary: (symbol: string) => request<{ symbol: string | null }>(`/stock/${encodeURIComponent(symbol)}/primary`),
  sellable: (symbol: string, date: string, exclude?: number) =>
    request<{ symbol: string; date: string; quantity: number }>(
      `/stock/${encodeURIComponent(symbol)}/sellable?date=${date}${exclude != null ? `&exclude=${exclude}` : ''}`,
    ),
  financials: (symbol: string) => request<Financials>(`/stock/${encodeURIComponent(symbol)}/financials`),
  insiders: (symbol: string) => request<Insiders>(`/stock/${encodeURIComponent(symbol)}/insiders`),
  settings: () => request<Settings>('/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('/settings', json('PUT', s)),
  status: () => request<Status>('/status'),
  watchlist: () => request<WatchItem[]>('/watchlist'),
  watchAdd: (symbol: string) => request<WatchItem>('/watchlist', json('POST', { symbol })),
  watchNote: (symbol: string, note: string | null) =>
    request<{ symbol: string; note: string | null }>(`/watchlist/${encodeURIComponent(symbol)}/note`, json('PUT', { note })),
  watchRemove: (symbol: string) => request<void>(`/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
  refresh: () => request<{ status: string }>('/refresh', { method: 'POST' }),
}
