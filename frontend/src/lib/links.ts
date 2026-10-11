import { useCallback, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'

const openInNewTab = (to: string) => window.open(to, '_blank', 'noopener')

// Clicks on nested controls (buttons, checkboxes, real links…) keep their own behaviour.
const fromControl = (e: MouseEvent) => !!(e.target as HTMLElement).closest('a, button, input, select, textarea, label')

/**
 * Props that make a non-link element (e.g. a table row) behave like a link:
 * click navigates; middle-click or Ctrl/⌘/Shift-click opens it in a new tab.
 */
export function useLinkProps() {
  const navigate = useNavigate()
  return useCallback(
    (to: string) => ({
      onClick: (e: MouseEvent) => {
        if (e.defaultPrevented || fromControl(e)) return
        if (e.metaKey || e.ctrlKey || e.shiftKey) openInNewTab(to)
        else navigate(to)
      },
      onAuxClick: (e: MouseEvent) => {
        if (e.button !== 1 || fromControl(e)) return
        e.preventDefault()
        openInNewTab(to)
      },
      // Stop the browser's middle-click autoscroll from kicking in.
      onMouseDown: (e: MouseEvent) => {
        if (e.button === 1 && !fromControl(e)) e.preventDefault()
      },
    }),
    [navigate],
  )
}

export { openInNewTab }
