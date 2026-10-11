import type { ReactNode } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { money } from '../lib/format'
import { openInNewTab } from '../lib/links'

export const GROUP_COLORS = ['#5b8dd9', '#79cbdc', '#5b5bd0', '#6a35c9', '#5fcfc8', '#4a6fc7', '#8f6be8', '#3fa7b5', '#7d8ff0', '#a06ae0', '#2f8fbf', '#9ad3e8']

export type RingItem = { key: string; label: string; value: number; pct: number; color: string }

/** Single thick donut (Snowball style) starting at 12 o'clock, with the hovered slice shown in the centre. */
export function Ring({
  items,
  hover,
  onHover,
  onClick,
  href,
  idle,
  className = 'max-w-[380px]',
}: {
  items: RingItem[]
  hover: string | null
  onHover: (k: string | null) => void
  onClick?: (k: string) => void
  /** URL for a segment; enables middle-click / Ctrl/⌘-click to open it in a new tab. */
  href?: (k: string) => string | undefined
  idle?: ReactNode
  className?: string
}) {
  const data = [...items].sort((a, b) => b.value - a.value)
  const active = hover ? items.find((g) => g.key === hover) : null
  return (
    <div
      className={`relative mx-auto aspect-square w-full ${className}`}
      onMouseDown={(e) => e.button === 1 && hover && href?.(hover) && e.preventDefault()}
      onAuxClick={(e) => {
        const to = e.button === 1 && hover ? href?.(hover) : undefined
        if (to) openInNewTab(to)
      }}
    >
      <ResponsiveContainer>
        <PieChart accessibilityLayer={false}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="50%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
            onMouseEnter={(_, i) => onHover(data[i]?.key ?? null)}
            onMouseLeave={() => onHover(null)}
            onClick={(_, i, e) => {
              if (!data[i]) return
              const to = href?.(data[i].key)
              if (to && (e.metaKey || e.ctrlKey || e.shiftKey)) openInNewTab(to)
              else onClick?.(data[i].key)
            }}
            className={onClick ? 'cursor-pointer' : undefined}
          >
            {data.map((g) => (
              <Cell key={g.key} fill={g.color} opacity={hover && hover !== g.key ? 0.35 : 1} className="outline-none" />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
        {active ? (
          <div className="max-w-[45%]">
            <div className="truncate text-[13px] text-body">{active.label}</div>
            <div className="text-[17px] font-medium text-white">{active.pct.toFixed(2)}%</div>
            <div className="text-[12px] text-muted">{money(active.value)}</div>
          </div>
        ) : (
          idle
        )}
      </div>
    </div>
  )
}
