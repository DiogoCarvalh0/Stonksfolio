import type { StockDetail } from '../../lib/api'

export type Detail = StockDetail
export type Sec = StockDetail['security']

export const dash = '—'

export const isFund = (sec: Sec) => sec.quote_type === 'ETF' || sec.quote_type === 'MUTUALFUND'

const DAY = 86400_000
const toTime = (d: string) => new Date(d + 'T00:00:00').getTime()

export function frequencyLabel(perYear: number) {
  if (perYear >= 10) return 'Monthly'
  if (perYear >= 4) return 'Quarterly'
  if (perYear >= 2) return 'Semi-annual'
  if (perYear >= 1) return 'Annual'
  return 'Irregular'
}

export type DivStats = {
  byYear: { year: string; amount: number }[]
  annualPayout: number | null
  yieldPct: number | null
  payoutPct: number | null
  nextExDate: string | null
  growth: Record<1 | 3 | 5 | 10, number | null>
  growthStreak: number
  streak: number
  perYear: number
  last: { date: string; amount: number } | null
}

export function dividendStats(d: Detail): DivStats {
  const hist = d.dividend_history
  const info = d.security.info ?? {}
  const price = d.prices[d.prices.length - 1]?.close ?? null
  const now = new Date()
  const thisYear = now.getFullYear()
  const yearMap = new Map<number, number>()
  // the first year of loaded history is usually partial; leave it out of the yearly totals
  const firstPrice = d.prices[0]?.date
  const partialYear = firstPrice && firstPrice.slice(5) > '01-15' ? +firstPrice.slice(0, 4) : null
  for (const h of hist) if (+h.date.slice(0, 4) !== partialYear) yearMap.set(+h.date.slice(0, 4), (yearMap.get(+h.date.slice(0, 4)) ?? 0) + h.amount)
  const byYear = [...yearMap.entries()].sort((a, b) => a[0] - b[0]).map(([y, amount]) => ({ year: String(y), amount }))

  const cutoff = now.getTime() - 365 * DAY
  const ttmEvents = hist.filter((h) => toTime(h.date) > cutoff)
  const ttm = ttmEvents.reduce((a, h) => a + h.amount, 0)
  const annualPayout = typeof info.dividendRate === 'number' ? info.dividendRate : ttm || null
  const yieldPct =
    typeof info.dividendYield === 'number' ? info.dividendYield : annualPayout && price ? (annualPayout / price) * 100 : null
  const payoutPct = typeof info.payoutRatio === 'number' && info.payoutRatio > 0 ? info.payoutRatio * 100 : null

  const lastFull = thisYear - 1
  const full = (y: number) => yearMap.get(y) ?? 0
  const cagr = (n: number) => {
    const a = full(lastFull - n)
    const b = full(lastFull)
    return a > 0 && b > 0 ? ((b / a) ** (1 / n) - 1) * 100 : null
  }
  let growthStreak = 0
  for (let y = lastFull; full(y) > 0 && full(y - 1) > 0 && full(y) > full(y - 1) * 1.0001; y--) growthStreak++
  let streak = 0
  for (let y = lastFull; full(y) > 0; y--) streak++

  const lastYearCount = hist.filter((h) => +h.date.slice(0, 4) === lastFull).length
  const perYear = lastYearCount || ttmEvents.length

  const cal = info.calendar ?? {}
  const calEx = typeof cal['Ex-Dividend Date'] === 'string' ? (cal['Ex-Dividend Date'] as string) : null
  const today = now.toISOString().slice(0, 10)
  const nextExDate = calEx && calEx >= today ? calEx : null

  return {
    byYear,
    annualPayout,
    yieldPct,
    payoutPct,
    nextExDate,
    growth: { 1: cagr(1), 3: cagr(3), 5: cagr(5), 10: cagr(10) },
    growthStreak,
    streak,
    perYear,
    last: hist.length ? hist[hist.length - 1] : null,
  }
}

/** Trailing-twelve-month dividend yield (%) for every price point. */
export function ttmYieldSeries(d: Detail) {
  const divs = d.dividend_history.map((h) => ({ t: toTime(h.date), a: h.amount }))
  const out: { date: string; close: number }[] = []
  let lo = 0
  let hi = 0
  let sum = 0
  for (const p of d.prices) {
    const t = toTime(p.date)
    while (hi < divs.length && divs[hi].t <= t) sum += divs[hi++].a
    while (lo < hi && divs[lo].t <= t - 365 * DAY) sum -= divs[lo++].a
    if (p.close > 0 && divs.length && t >= divs[0].t + 365 * DAY) out.push({ date: p.date, close: (sum / p.close) * 100 })
  }
  return out
}

export function yoy(values: (number | null)[] | undefined, columns: string[]): number | null {
  if (!values) return null
  const idx = columns.filter((c) => /^\d{4}$/.test(c)).length
  const a = values[idx - 2]
  const b = values[idx - 1]
  return a != null && b != null && a !== 0 ? ((b - a) / Math.abs(a)) * 100 : null
}
