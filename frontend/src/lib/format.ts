const LOCALE = undefined // browser locale

export function money(v: number | null | undefined, currency = 'EUR', digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  const cur = currency === 'GBp' ? 'GBP' : currency
  const val = currency === 'GBp' ? v / 100 : v
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(val)
  } catch {
    return `${num(val, digits)} ${cur}`
  }
}

export function compactMoney(v: number | null | undefined, currency = 'EUR'): string {
  if (v == null) return '—'
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(v)
  } catch {
    return num(v, 0)
  }
}

export function num(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)
}

export function pct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v == null || Number.isNaN(v)) return '—'
  const s = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
  return `${signed && v > 0 ? '+' : ''}${s}%`
}

export function signedMoney(v: number | null | undefined, currency = 'EUR'): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${money(v, currency)}`
}

export function date(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }) {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(LOCALE, opts)
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'short', year: '2-digit' })
}

export const toneClass = (v: number | null | undefined) =>
  v == null || Math.abs(v) < 1e-9 ? 'text-body' : v > 0 ? 'text-up' : 'text-down'

export const PALETTE = [
  '#6c3fd1', '#2bcbc4', '#4aa3df', '#a40ff2', '#6fe8d4', '#18d99b', '#4b45d6', '#a782e8', '#2d5aa0', '#8ac4ef',
  '#c86df5', '#3bb3a3', '#7e8cf0', '#5f6b7a',
]
