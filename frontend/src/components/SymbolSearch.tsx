import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { api, type SearchResult } from '../lib/api'

type Props = {
  onSelect: (r: SearchResult) => void
  placeholder?: string
  initial?: string
  autoFocus?: boolean
}

export default function SymbolSearch({ onSelect, placeholder = 'Ticker, name or ISIN…', initial = '', autoFocus }: Props) {
  const [q, setQ] = useState(initial)
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>({})

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !list.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const { data = [], isFetching, isSuccess } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 1,
    staleTime: 5 * 60_000,
  })

  const pick = (r: SearchResult) => {
    onSelect(r)
    setQ(initial ? r.symbol : '')
    setOpen(false)
  }

  const raw = q.trim().toUpperCase()
  const isIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(raw)
  const options: SearchResult[] = data
  const settled = isSuccess && !isFetching && debounced.toUpperCase() === raw
  const show = open && !!q.trim()

  // The list is portalled to <body> with fixed positioning so modals/popovers with overflow can't clip it;
  // it opens downwards (or upwards when there's more room) and scrolls within the space available.
  const place = useCallback(() => {
    const r = box.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const up = below < 200 && above > below
    setPos({
      left: r.left,
      width: r.width,
      maxHeight: Math.max(120, Math.min(360, up ? above : below)),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    })
  }, [])

  useLayoutEffect(() => {
    if (!show) return
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [show, place])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Keep clicks in the portalled list from counting as "outside" for parent popovers, and keep input focus.
  useEffect(() => {
    const el = list.current
    if (!show || !el) return
    const h = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    el.addEventListener('mousedown', h)
    return () => el.removeEventListener('mousedown', h)
  }, [show])

  return (
    <div ref={box} className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        className="input pl-9"
        value={q}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.preventDefault()
          if (!open || !options.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, options.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (options[active]) pick(options[active])
          } else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {show &&
        createPortal(
          <div ref={list} style={pos} className="fixed z-[60] overflow-y-auto overscroll-contain rounded bg-panel-2 shadow-2xl ring-1 ring-black/20">
            {!settled && !data.length && <div className="px-3 py-2 text-sm text-muted">Searching…</div>}
            {settled && !data.length && (
              <div className="px-3 py-2 text-sm text-muted">{isIsin ? 'No security found for this ISIN' : 'No matching securities — pick one from the list'}</div>
            )}
            {options.map((r, i) => (
              <button
                type="button"
                key={r.symbol + i}
                data-idx={i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === active ? 'bg-line' : ''}`}
              >
                <span className="w-24 shrink-0 font-semibold">{r.symbol}</span>
                <span className="flex-1 truncate text-body">{r.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {r.exchange}
                  {r.type && ` · ${r.type}`}
                  {r.isin && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">ISIN</span>}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  )
}
