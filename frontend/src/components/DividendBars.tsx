import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { compactMoney, money, monthLabel } from '../lib/format'
import type { MonthBar } from '../lib/range'

export default function DividendBars({ data, height = 160, showAxis = false }: { data: MonthBar[]; height?: number; showAxis?: boolean }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart accessibilityLayer={false} data={data}>
          {showAxis && <CartesianGrid stroke="#1c2436" vertical={false} />}
          <XAxis dataKey="month" tickFormatter={monthLabel} stroke="#5b6478" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
          {showAxis && <YAxis stroke="#5b6478" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => compactMoney(v)} width={56} />}
          <Tooltip
            cursor={{ fill: '#ffffff08' }}
            contentStyle={{ background: '#182032', border: '1px solid #232c40', borderRadius: 10, fontSize: 12 }}
            labelFormatter={(m) => monthLabel(String(m))}
            formatter={(v, name) => [money(Number(v)), name === 'received' ? 'Received' : 'Projected']}
          />
          <Bar dataKey="received" stackId="d" fill="#34d399" isAnimationActive={false} />
          <Bar dataKey="projected" stackId="d" fill="#34d39955" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
