import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import './index.css'
import Common from './pages/Common'
import DipFinder from './pages/DipFinder'
import Dividends from './pages/Dividends'
import Growth from './pages/Growth'
import Holdings from './pages/Holdings'
import Sentiment from './pages/Sentiment'
import Settings from './pages/Settings'
import Stock from './pages/stock/Stock'
import Transactions from './pages/Transactions'
import Watchlist from './pages/Watchlist'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
})

// Touch devices never send mouseleave, so whatever was last tapped (chart tooltip/highlight,
// hovered donut slice, …) stays "hovered" forever. Release it when the user touches elsewhere.
let lastHovered: Element | null = null
document.addEventListener('mouseover', (e) => (lastHovered = e.target as Element), { capture: true, passive: true })
document.addEventListener(
  'touchstart',
  (e) => {
    const el = lastHovered
    if (!el || !el.isConnected || el.contains(e.target as Node)) return
    const chart = el.closest('.recharts-wrapper')
    if (chart?.contains(e.target as Node)) return
    lastHovered = null
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
  },
  { passive: true, capture: true },
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Common />} />
            <Route path="holdings" element={<Holdings />} />
            <Route path="dividends" element={<Dividends />} />
            <Route path="growth" element={<Growth />} />
            <Route path="dip-finder" element={<DipFinder />} />
            <Route path="sentiment" element={<Sentiment />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="income" element={<Navigate to="/" replace />} />
            <Route path="watchlist" element={<Watchlist />} />
            <Route path="stock/:symbol" element={<Stock />} />
            <Route path="settings" element={<Settings />} />
            <Route path="diversification" element={<Navigate to="/holdings" replace />} />
            <Route path="allocation" element={<Navigate to="/holdings" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
