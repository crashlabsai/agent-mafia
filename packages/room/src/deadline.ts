export interface DeadlineResult<T> {
  value: T
  timedOut: boolean
  /**
   * Set when the driver threw rather than ran out of time.
   *
   * Keeping these apart matters: an API error reported as a timeout looks like
   * a slow model, and a systematic failure can run a whole game to completion
   * looking merely sluggish. The distinction is what makes such a bug visible.
   */
  error: string | null
}

/** Resolves to `fallback` if `p` has not settled within `ms`, or if it throws. */
export async function withDeadline<T>(
  p: Promise<T>,
  ms: number | null,
  fallback: () => T,
): Promise<DeadlineResult<T>> {
  const guarded = p.then(
    (value) => ({ value, timedOut: false, error: null as string | null }),
    (err: unknown) => ({
      value: fallback(),
      timedOut: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  )

  if (ms === null) return guarded

  let timer: ReturnType<typeof setTimeout> | undefined
  const TIMED_OUT = Symbol('timeout')
  try {
    const race = await Promise.race([
      guarded,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
      }),
    ])
    if (race === TIMED_OUT) return { value: fallback(), timedOut: true, error: null }
    return race
  } finally {
    if (timer) clearTimeout(timer)
  }
}
