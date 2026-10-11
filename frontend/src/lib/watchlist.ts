import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'

export function useWatchlist() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['watchlist'], queryFn: api.watchlist })
  const invalidate = () => qc.invalidateQueries({ queryKey: ['watchlist'] })
  const add = useMutation({ mutationFn: api.watchAdd, onSettled: invalidate })
  const remove = useMutation({ mutationFn: api.watchRemove, onSettled: invalidate })
  const setNote = useMutation({ mutationFn: (v: { symbol: string; note: string | null }) => api.watchNote(v.symbol, v.note), onSettled: invalidate })
  const has = (symbol: string) => !!list.data?.some((w) => w.symbol === symbol.toUpperCase())
  const toggle = (symbol: string) => (has(symbol) ? remove.mutate(symbol) : add.mutate(symbol))
  return { list, add, remove, setNote, has, toggle, busy: add.isPending || remove.isPending }
}
