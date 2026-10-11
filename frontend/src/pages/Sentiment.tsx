import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, ErrorBox, Loading } from '../components/ui'
import { api } from '../lib/api'
import { date } from '../lib/format'

const BANDS = [
  { from: 0, to: 25, rating: 'extreme fear', lines: ['EXTREME', 'FEAR'] },
  { from: 25, to: 45, rating: 'fear', lines: ['FEAR'] },
  { from: 45, to: 55, rating: 'neutral', lines: ['NEUTRAL'] },
  { from: 55, to: 75, rating: 'greed', lines: ['GREED'] },
  { from: 75, to: 100, rating: 'extreme greed', lines: ['EXTREME', 'GREED'] },
]

const COLORS: Record<string, string> = {
  'extreme fear': '#f27362',
  fear: '#f5a25d',
  neutral: '#adb5bd',
  greed: '#9ad37a',
  'extreme greed': '#5cd59b',
}

// CNN treats band upper bounds as inclusive (e.g. 45 → fear)
const ratingOf = (v: number) => BANDS.find((b) => Math.round(v) <= b.to)?.rating ?? 'extreme greed'
const colorOf = (rating: string | null | undefined, v?: number) => COLORS[rating ?? ''] ?? COLORS[ratingOf(v ?? 50)]
const title = (r: string) => r.replace(/\b\w/g, (c) => c.toUpperCase())

// ---------------------------------------------------------------- gauge geometry

const CX = 250
const CY = 250
const R_OUT = 235
const R_IN = 150
// Bands are drawn with equal width (like CNN), so scores map piecewise-linearly onto the dial.
const STOPS = [0, 25, 45, 55, 75, 100]
function dial(v: number) {
  const c = Math.min(100, Math.max(0, v))
  const i = Math.min(STOPS.length - 2, STOPS.findIndex((s, k) => c <= STOPS[k + 1] && c >= s))
  return (i + (c - STOPS[i]) / (STOPS[i + 1] - STOPS[i])) * (100 / (STOPS.length - 1))
}
const angleD = (d: number) => Math.PI - (d / 100) * Math.PI
const angle = (v: number) => angleD(dial(v))
const ptD = (r: number, d: number) => [CX + r * Math.cos(angleD(d)), CY - r * Math.sin(angleD(d))] as const
const pt = (r: number, v: number) => ptD(r, dial(v))

function bandPath(from: number, to: number) {
  const gap = 0.5
  const a = dial(from) + gap
  const b = dial(to) - gap
  const [x1, y1] = ptD(R_OUT, a)
  const [x2, y2] = ptD(R_OUT, b)
  const [x3, y3] = ptD(R_IN, b)
  const [x4, y4] = ptD(R_IN, a)
  return `M${x1},${y1} A${R_OUT},${R_OUT} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_IN},${R_IN} 0 0 0 ${x4},${y4} Z`
}

function Gauge({ score, rating }: { score: number; rating?: string | null }) {
  const active = rating && rating in COLORS ? rating : ratingOf(score)
  const [nx, ny] = pt(R_IN - 8, score)
  const perp = angle(score) + Math.PI / 2
  const w = 7
  const base = [
    [CX + w * Math.cos(perp), CY - w * Math.sin(perp)],
    [CX - w * Math.cos(perp), CY + w * Math.sin(perp)],
  ]
  return (
    <svg viewBox="0 0 500 265" className="w-full max-w-[620px]">
      {BANDS.map((b) => {
        const on = b.rating === active
        const c = COLORS[b.rating]
        const mid = (b.from + b.to) / 2
        const [lx, ly] = pt((R_OUT + R_IN) / 2, mid)
        const rot = 90 - (angle(mid) * 180) / Math.PI
        return (
          <g key={b.rating}>
            <path d={bandPath(b.from, b.to)} fill={on ? `${c}33` : '#3b3b49'} stroke={on ? c : 'none'} strokeWidth={2} />
            <text
              x={lx}
              y={ly}
              transform={`rotate(${rot} ${lx} ${ly})`}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={on ? c : '#9a9aab'}
              fontSize={b.lines.length > 1 ? 15 : 17}
              fontWeight={700}
              letterSpacing={1}
            >
              {b.lines.map((l, i) => (
                <tspan key={l} x={lx} dy={b.lines.length > 1 ? (i === 0 ? '-0.55em' : '1.1em') : 0}>
                  {l}
                </tspan>
              ))}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 21 }, (_, i) => i * 5)
        .filter((v) => v % 25 !== 0)
        .map((v) => {
          const [x, y] = pt(R_IN - 18, v)
          return <circle key={v} cx={x} cy={y} r={1.8} fill="#6b6b7d" />
        })}
      {[0, 25, 50, 75, 100].map((v) => {
        const [x, y] = pt(R_IN - 20, v)
        return (
          <text key={v} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fill="#9a9aab" fontSize={15}>
            {v}
          </text>
        )
      })}
      <polygon points={`${base[0].join(',')} ${base[1].join(',')} ${nx},${ny}`} fill="#e9ecef" />
      <circle cx={CX} cy={CY} r={46} fill="#282832" />
      <text x={CX} y={CY - 8} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={38} fontWeight={700}>
        {Math.round(score)}
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------- page

export default function Sentiment() {
  const q = useQuery({ queryKey: ['sentiment'], queryFn: api.sentiment, staleTime: 5 * 60_000 })

  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const d = q.data!
  const monthTicks = d.history.filter((p, i) => i === 0 || p.date.slice(0, 7) !== d.history[i - 1].date.slice(0, 7)).map((p) => p.date)

  return (
    <>
      <Card className="mb-[25px]">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="card-title">Fear &amp; Greed Index</h2>
            <div className="mt-1 text-[13.5px] text-muted">What emotion is driving the market now?</div>
          </div>
          <a href="https://edition.cnn.com/markets/fear-and-greed" target="_blank" rel="noreferrer" className="text-[13px] text-accent hover:underline">
            Source: CNN
          </a>
        </div>
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col items-center">
            <Gauge score={d.score} rating={d.rating} />
            <div className="mt-1 text-[22px] font-medium" style={{ color: colorOf(d.rating, d.score) }}>
              {title(d.rating)}
            </div>
            {d.timestamp && <div className="mt-2 text-[12.5px] text-muted">Last updated {new Date(d.timestamp).toLocaleString()}</div>}
          </div>
          <div className="space-y-7">
            {d.previous.map((p) => {
              const r = ratingOf(p.score)
              const c = COLORS[r]
              return (
                <div key={p.label}>
                  <div className="text-[13px] text-muted">{p.label}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[16px] font-medium text-white">{title(r)}</span>
                    <span className="flex-1 border-b border-dashed border-line" />
                    <span className="grid h-11 w-11 place-items-center rounded-full border-2 text-[16px] font-semibold text-white" style={{ borderColor: c, background: `${c}22` }}>
                      {Math.round(p.score)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>

      <Card title="Timeline" className="mb-[25px]">
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart accessibilityLayer={false} data={d.history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fg-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00aff5" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#00aff5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#4a4a58" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="date" ticks={monthTicks} interval="preserveStartEnd" tickFormatter={(s: string) => date(s, { month: 'short', year: '2-digit' })} stroke="#9a9aab" fontSize={11.5} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#9a9aab" fontSize={11.5} tickLine={false} axisLine={false} width={36} />
              <ReferenceLine y={25} stroke={COLORS['extreme fear']} strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={75} stroke={COLORS['extreme greed']} strokeDasharray="4 4" strokeOpacity={0.6} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { date: string; score: number; rating: string | null }
                  return (
                    <div className="rounded bg-panel-2 px-3 py-2 text-[12px] shadow-xl">
                      <div className="mb-1 text-muted">{date(p.date)}</div>
                      <div className="flex justify-between gap-5">
                        <span style={{ color: colorOf(p.rating, p.score) }}>{title(p.rating ?? ratingOf(p.score))}</span>
                        <span className="text-white">{Math.round(p.score)}</span>
                      </div>
                    </div>
                  )
                }}
              />
              <Area type="monotone" dataKey="score" stroke="#00aff5" strokeWidth={2} fill="url(#fg-fill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-[25px] sm:grid-cols-2 xl:grid-cols-4">
        {d.indicators.map((i) => {
          const c = colorOf(i.rating, i.score ?? 50)
          return (
            <div key={i.key} className="card card-pad !py-5">
              <div className="text-[14.5px] text-white">{i.label}</div>
              <div className="mt-1 text-[12.5px] text-muted">{i.description}</div>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-[15px] font-medium" style={{ color: c }}>{title(i.rating ?? '')}</span>
                <span className="text-[15px] text-white">{i.score != null ? Math.round(i.score) : '—'}</span>
              </div>
              <div className="relative mt-2 h-1.5 rounded-full bg-panel-2">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, Math.max(0, i.score ?? 0))}%`, background: c }} />
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
