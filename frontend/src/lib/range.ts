export const RANGES = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'MAX'] as const
export type Range = (typeof RANGES)[number] | '7D'

export function rangeStart(range: Range, today = new Date()): string | null {
  const d = new Date(today)
  switch (range) {
    case '7D': d.setDate(d.getDate() - 7); break
    case '1M': d.setMonth(d.getMonth() - 1); break
    case '3M': d.setMonth(d.getMonth() - 3); break
    case '6M': d.setMonth(d.getMonth() - 6); break
    case 'YTD': return `${today.getFullYear()}-01-01`
    case '1Y': d.setFullYear(d.getFullYear() - 1); break
    case '3Y': d.setFullYear(d.getFullYear() - 3); break
    case '5Y': d.setFullYear(d.getFullYear() - 5); break
    case 'MAX': return null
  }
  return d.toISOString().slice(0, 10)
}

export function sliceRange<T extends { date: string }>(rows: T[], range: Range): T[] {
  const start = rangeStart(range)
  if (!start) return rows
  // include the last point before the start so returns are measured from the range start
  const idx = rows.findIndex((r) => r.date >= start)
  if (idx === -1) return rows.slice(-1)
  return rows.slice(Math.max(0, idx - 1))
}

export function downsample<T>(rows: T[], max = 600): T[] {
  if (rows.length <= max) return rows
  const step = Math.ceil(rows.length / max)
  const out = rows.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1])
  return out
}

export type MonthBar = { month: string; received: number; projected: number }

/** Continuous month axis: `past` months up to the current month, then `future` months of projections. */
export function monthSeries(
  received: { month: string; amount: number }[],
  projected: { month: string; amount: number }[],
  past = 12,
  future = 12,
): MonthBar[] {
  const rec = new Map(received.map((m) => [m.month, m.amount]))
  const proj = new Map(projected.map((m) => [m.month, m.amount]))
  const now = new Date()
  const out: MonthBar[] = []
  for (let i = -(past - 1); i <= future; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ month: key, received: i <= 0 ? rec.get(key) ?? 0 : 0, projected: i >= 0 ? proj.get(key) ?? 0 : 0 })
  }
  return out
}
