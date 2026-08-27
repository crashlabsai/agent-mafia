import { byProvider, type ModelEntry } from './catalog.ts'
import type { Provider } from './provider.ts'

/**
 * Checking the catalog against what a provider actually serves.
 *
 * A wire id is a claim about someone else's deployment, and it goes stale
 * without warning: a model retires, an alias is dropped, an id gains a date
 * suffix. The failure that produces is a 404 on a seat's first wake, several
 * seats into a run that has already spent tokens — and, worse, a leaderboard
 * that silently omits whichever models were unreachable that day. Probing turns
 * that into one cheap list call.
 */

export type ProbeStatus =
  /** The provider serves this exact id. */
  | 'served'
  /** The provider answered, and this id was not in its list. */
  | 'missing'
  /** No credential, or the list call failed — nothing was learned either way. */
  | 'unchecked'

export interface ProbeRow {
  key: string
  provider: string
  wireId: string
  status: ProbeStatus
  /** Why it is unchecked, or the closest served id when it is missing. */
  note: string | null
}

export interface ProbeReport {
  provider: string
  rows: ProbeRow[]
  /** Ids the provider serves that no catalog entry names. Informational. */
  uncatalogued: string[]
  error: string | null
}

/**
 * Compare catalog entries against a list of served ids.
 *
 * Pure, so the comparison is testable without a credential; the network lives
 * in {@link probeProvider}.
 */
export function compareCatalog(entries: ModelEntry[], servedIds: string[]): ProbeRow[] {
  const served = new Set(servedIds)
  return entries.map((entry) => {
    if (served.has(entry.wireId)) {
      return { key: entry.key, provider: entry.provider, wireId: entry.wireId, status: 'served' as const, note: null }
    }
    return {
      key: entry.key,
      provider: entry.provider,
      wireId: entry.wireId,
      status: 'missing' as const,
      note: nearest(entry.wireId, servedIds),
    }
  })
}

/**
 * The served id most likely to be what a missing entry meant.
 *
 * Almost every drift in practice is a prefix relation — `claude-haiku-4-5`
 * losing its undated alias, `gpt-5.5` becoming `gpt-5.5-2026-01-01` — so the
 * longest shared prefix finds the intended id without a general edit distance.
 */
function nearest(wireId: string, servedIds: string[]): string | null {
  let best: string | null = null
  let bestShared = 0
  for (const candidate of servedIds) {
    let shared = 0
    while (shared < candidate.length && shared < wireId.length && candidate[shared] === wireId[shared]) {
      shared += 1
    }
    if (shared > bestShared) {
      bestShared = shared
      best = candidate
    }
  }
  // Anything shorter than this is coincidence, not a near miss.
  return bestShared >= 6 ? best : null
}

/** Probe one provider. Never throws: an unreachable provider is a report row. */
export async function probeProvider(provider: Provider): Promise<ProbeReport> {
  const entries = byProvider(provider.id)

  if (!provider.isConfigured()) {
    return {
      provider: provider.id,
      rows: entries.map((e) => ({
        key: e.key,
        provider: e.provider,
        wireId: e.wireId,
        status: 'unchecked' as const,
        note: 'no credential',
      })),
      uncatalogued: [],
      error: null,
    }
  }

  let servedIds: string[]
  try {
    servedIds = await provider.listModels()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      provider: provider.id,
      rows: entries.map((e) => ({
        key: e.key,
        provider: e.provider,
        wireId: e.wireId,
        status: 'unchecked' as const,
        note: 'list call failed',
      })),
      uncatalogued: [],
      error: detail,
    }
  }

  const catalogued = new Set(entries.map((e) => e.wireId))
  return {
    provider: provider.id,
    rows: compareCatalog(entries, servedIds),
    uncatalogued: servedIds.filter((id) => !catalogued.has(id)),
    error: null,
  }
}
