import { useEffect, useRef } from 'react'

// Self-scheduling poll that NEVER overlaps requests.
// If a request is still in flight when the interval elapses, the next
// tick is skipped and rescheduled after the current one finishes. This
// prevents out-of-order updates (which made the progress bar jump
// backwards) and request pile-ups that caused UI stutter.
export function usePolling(fn, intervalMs) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let cancelled = false
    let timer = null
    let inFlight = false

    const loop = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        await fnRef.current()
      } finally {
        inFlight = false
        if (!cancelled) timer = setTimeout(loop, intervalMs)
      }
    }

    loop()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [intervalMs])
}
