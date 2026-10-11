import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Check, ChevronDown, HelpCircle, Loader2, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { pct, toneClass } from '../lib/format'

export function Card({ title, hint, action, children, className, bodyClass }: { title?: ReactNode; hint?: string; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx('card card-pad', className)}>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h2 className="card-title flex items-center gap-1">
              {title}
              {hint && <Hint text={hint} />}
            </h2>
          )}
          {action}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

/** Button with a styled hover tooltip. With `pinOnClick` a click keeps the tooltip open. */
export function HoverTip({
  text,
  children,
  className,
  onClick,
  pinOnClick,
  label,
  bubble,
}: {
  text: ReactNode
  children: ReactNode
  className?: string
  onClick?: () => void
  pinOnClick?: boolean
  label?: string
  /** Let clicks propagate to the parent (e.g. a sortable table header). */
  bubble?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const open = !!text && (hover || pinned)

  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150)
    const below = r.top < 90
    setPos({ x, y: below ? r.bottom + 8 : r.top - 8, below })
  }, [open])

  useEffect(() => {
    if (!pinned) return
    const close = (e: Event) => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      setPinned(false)
      setHover(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [pinned])

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label ?? (typeof text === 'string' ? text : undefined)}
        className={clsx('inline-flex items-center focus:outline-none', className)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={(e) => {
          if (!bubble) e.stopPropagation()
          if (pinOnClick) setPinned((p) => !p)
          else setHover(false)
          onClick?.()
        }}
      >
        {children}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[1000] w-max max-w-[280px] whitespace-pre-line rounded-md border border-line bg-panel-2 px-3 py-2 text-[12.5px] font-normal leading-snug text-body shadow-xl"
            style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}

export function Hint({ text }: { text: string }) {
  return (
    <HoverTip text={text} pinOnClick className="cursor-help text-muted/70 hover:text-white">
      <HelpCircle size={12} />
    </HoverTip>
  )
}

export function Stat({ icon, color, label, hint, children }: { icon: ReactNode; color: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-medium">
        <span className="grid h-5 w-5 place-items-center rounded" style={{ background: `${color}26`, color }}>
          {icon}
        </span>
        {label}
        {hint && <Hint text={hint} />}
      </div>
      {children}
    </div>
  )
}

export function Big({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('text-[24.5px] font-medium leading-tight', className ?? 'text-white')}>{children}</span>
}

/** ▲ 12.34% style change indicator (Snowball style). */
export function Delta({ v, digits = 2, className, children }: { v: number | null | undefined; digits?: number; className?: string; children?: ReactNode }) {
  if (v == null || Number.isNaN(v)) return <span className={clsx('text-muted', className)}>—</span>
  const up = v >= 0
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap', v === 0 ? 'text-body' : up ? 'text-up' : 'text-down', className)}>
      {v !== 0 && <Tri up={up} />}
      {children ?? pct(Math.abs(v), digits, false)}
    </span>
  )
}

export function Tri({ up }: { up: boolean }) {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" className={clsx('shrink-0', !up && 'rotate-180')} fill="currentColor">
      <path d="M4.5 0L9 6H0z" />
    </svg>
  )
}

export function Tone({ v, children }: { v: number | null | undefined; children: ReactNode }) {
  return <span className={toneClass(v)}>{children}</span>
}

/** Text-only period selector: "7d 1m 3m … all" with the active one in accent blue. */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly T[] | { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const opts = (options as any[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)) as { value: T; label: string }[]
  return (
    <div className="flex max-w-full flex-wrap items-center gap-x-1">
      {opts.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx('cursor-pointer rounded px-2 py-1 text-[13px] transition', value === o.value ? 'text-accent' : 'text-body hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Rounded pills used for "Sectors / Classes / Currencies…" switchers. */
export function Pills<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'cursor-pointer rounded-full px-3 py-1.5 text-[13px] transition',
            value === o.value ? 'bg-white text-[#282832]' : 'bg-panel-2 text-body hover:bg-line',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm">
      <span className={clsx('grid h-4 w-4 place-items-center rounded-sm', checked ? 'bg-up' : 'bg-panel-2')}>
        {checked && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke="white" strokeWidth="2">
            <path d="M1 4l3 3 5-6" />
          </svg>
        )}
      </span>
      <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

const LOGO_BG = ['#6c3fd1', '#2b7fd1', '#1bab9a', '#c2410c', '#9d174d', '#4b45d6', '#0e7490', '#7c3aed']

/** Company logo; falls back to the primary listing's logo, then to coloured initials. */
export function SymbolLogo({ symbol, size = 35, fallback }: { symbol: string; size?: number; fallback?: string | null }) {
  const [state, setState] = useState({ symbol, failed: 0 })
  const failed = state.symbol === symbol ? state.failed : 0
  const fail = () => setState({ symbol, failed: failed + 1 })
  const primary = useQuery({
    queryKey: ['primary', symbol],
    queryFn: () => api.primary(symbol),
    enabled: failed === 1 && fallback === undefined,
    staleTime: Infinity,
    retry: false,
  })
  const alt = fallback !== undefined ? fallback : primary.data?.symbol
  const altReady = fallback !== undefined || primary.isFetched || primary.isError
  const base = symbol.split('.')[0].split('-')[0]
  const color = LOGO_BG[[...symbol].reduce((a, c) => a + c.charCodeAt(0), 0) % LOGO_BG.length]
  const style = { width: size, height: size }
  const src = failed === 0 ? symbol : failed === 1 && alt && alt !== symbol ? alt : null
  if (!src && !(failed === 1 && !altReady))
    return (
      <span className="grid shrink-0 place-items-center rounded text-[11px] font-semibold text-white" style={{ ...style, background: color }}>
        {base.slice(0, 4)}
      </span>
    )
  if (!src) return <span className="shrink-0 rounded bg-panel-2" style={style} />
  return (
    <img
      key={src}
      src={`https://financialmodelingprep.com/image-stock/${encodeURIComponent(src)}.png`}
      onError={fail}
      alt=""
      loading="lazy"
      className="shrink-0 rounded bg-white object-contain p-0.5"
      style={style}
    />
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 className="animate-spin" size={16} /> {label}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
      {error instanceof Error ? error.message : String(error)}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-muted">{children}</div>
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        className={clsx('card max-h-[90vh] w-full overflow-auto p-7 shadow-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="card-title">{title}</h3>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-medium text-white">{title}</h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function SimpleStat({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: number | null; hint?: string }) {
  return (
    <div className="card px-6 py-5">
      <div className="flex items-center gap-1 text-[13px] font-medium">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className={clsx('mt-2 text-xl font-medium', tone !== undefined ? toneClass(tone) : 'text-white')}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-muted">{sub}</div>}
    </div>
  )
}

/** Snowball-style "Label ⌄" dropdown. */
export function Select<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[14px] text-body hover:text-white">
        {current?.label}
        <ChevronDown size={15} className={clsx('transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-44 rounded-md bg-panel-2 p-1 shadow-2xl">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={clsx('flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-1.5 text-left text-[13.5px] hover:bg-line/60', o.value === value ? 'text-accent' : 'text-body hover:text-white')}
            >
              {o.label}
              {o.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
