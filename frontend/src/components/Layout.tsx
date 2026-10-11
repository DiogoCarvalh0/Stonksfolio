import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChartColumn, ChartPie, CircleDashed, FileText, Gauge, Plus, TrendingDown, RefreshCw, Rocket, Search, Settings as SettingsIcon, Star } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { api } from '../lib/api'
import SymbolSearch from './SymbolSearch'
import TransactionForm from './TransactionForm'
import { Modal } from './ui'

export const TABS = [
  { to: '/', label: 'Dashboard', icon: CircleDashed },
  { to: '/holdings', label: 'Holdings', icon: ChartPie },
  { to: '/dividends', label: 'Dividends', icon: ChartColumn },
  { to: '/growth', label: 'Growth', icon: Rocket },
  { to: '/dip-finder', label: 'Dip Finder', icon: TrendingDown },
  { to: '/sentiment', label: 'Market Sentiment', icon: Gauge },
  { to: '/transactions', label: 'Transactions', icon: FileText },
]

export default function Layout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const navType = useNavigationType()
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0)
  }, [pathname, navType])
  const qc = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const status = useQuery({
    queryKey: ['status'],
    queryFn: api.status,
    refetchInterval: (q) => (q.state.data?.running ? 2000 : 60000),
  })
  const refresh = useMutation({
    mutationFn: api.refresh,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status'] }),
  })
  const running = status.data?.running || refresh.isPending
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) qc.invalidateQueries()
    wasRunning.current = !!running
  }, [running, qc])

  const tab = TABS.find((t) => t.to === pathname)
  const nav = (
    <>
      {TABS.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) =>
            clsx(
              'shrink-0 rounded-md px-4 py-2.5 text-[15px] whitespace-nowrap transition',
              isActive ? 'bg-panel-2 text-white' : 'text-muted-2 hover:text-white',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </>
  )

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-[70px] max-w-[1340px] items-center gap-3 px-4 md:px-[50px]">
          <Link to="/" title="Stonksfolio" className="block h-11 w-11 shrink-0 overflow-hidden rounded-full">
            <img src="/logo.png" alt="Stonksfolio" className="h-full w-full object-cover" />
          </Link>
          <nav className="ml-4 hidden items-center gap-1 xl:flex">{nav}</nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button className="flex h-10 cursor-pointer items-center gap-2 rounded-md bg-[#2b4a63] px-4 text-[15px] text-accent transition hover:bg-[#30587a]" onClick={() => setAddOpen(true)}>
              <Plus size={18} className="rounded-full bg-accent p-0.5 text-[#2b4a63]" strokeWidth={3} />
              <span className="hidden sm:inline">Add</span>
            </button>
            <button className="btn-ghost h-10 px-2.5 !text-accent" onClick={() => setSearchOpen(true)} title="Search by ticker, name or ISIN">
              <Search size={21} />
            </button>
            <NavLink to="/watchlist" className={({ isActive }) => clsx('btn-ghost h-10 px-2.5 !text-accent', isActive && 'bg-panel-2')} title="Watchlist">
              {({ isActive }) => <Star size={20} fill={isActive ? 'currentColor' : 'none'} />}
            </NavLink>
            <button
              className="btn-ghost h-10 px-2.5"
              onClick={() => refresh.mutate()}
              disabled={running}
              title={status.data?.last_run ? `Prices updated ${new Date(status.data.last_run).toLocaleString()}` : 'Update prices'}
            >
              <RefreshCw size={18} className={clsx(running && 'animate-spin')} />
            </button>
            <NavLink to="/settings" className={({ isActive }) => clsx('btn-ghost h-10 px-2.5', isActive && '!text-accent')} title="Settings">
              <SettingsIcon size={18} />
            </NavLink>
            <span className="ml-1 hidden rounded-md px-2 text-[14px] text-body sm:inline">EUR</span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1340px] gap-1 overflow-x-auto px-4 pb-2 md:px-[50px] xl:hidden">{nav}</nav>
      </header>

      <main className="mx-auto w-full max-w-[1340px] flex-1 px-4 py-6 md:px-[50px] md:py-8">
        {tab && (
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] text-muted">{tab.to === '/' ? 'Portfolios' : 'My portfolio'}</span>
              <span className="text-[17px] text-muted">/</span>
              <h1 className="text-[24px] font-medium text-white">{tab.to === '/' ? 'My portfolio' : tab.label}</h1>
            </div>
            <div className="text-[13px] text-muted">
              {status.data?.last_run ? `Prices updated ${new Date(status.data.last_run).toLocaleString()}` : 'Prices not updated yet'}
              {status.data?.last_error && (
                <span className="ml-2 text-amber-400" title={status.data.last_error}>
                  · some symbols failed
                </span>
              )}
            </div>
          </div>
        )}
        <Outlet />
      </main>
      {addOpen && <TransactionForm open onClose={() => setAddOpen(false)} />}
      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Search">
        <div className="min-h-[320px]">
          <SymbolSearch
            autoFocus
            placeholder="Ticker, name or ISIN…"
            onSelect={(r) => {
              setSearchOpen(false)
              navigate(`/stock/${r.symbol}`)
            }}
          />
        </div>
      </Modal>
    </div>
  )
}
