import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EngineEvent, EventEnvelope, GameState } from '@mafia/protocol'

export interface EventSink {
  append(e: EventEnvelope): void
}

/** JSON with recursively sorted keys, so hashing is representation-stable. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/** The chain's genesis input, versioned so a format change breaks loudly. */
export const HASH_CHAIN_GENESIS = 'agent-mafia-log-v1'

export function chainHash(prev: string, env: Omit<EventEnvelope, 'hash'>): string {
  return createHash('sha256').update(prev).update(stableStringify(env)).digest('hex')
}

/**
 * Stamps engine events with seq, identity and a tamper-evidence hash chain,
 * then fans them out to a sink.
 *
 * Each envelope's hash covers the previous hash plus the whole envelope, so
 * the final event's hash pins the entire transcript: republish that one value
 * and any later alteration of any field of any line is detectable. This is
 * integrity after publication, not provenance — providers' words remain
 * external inputs, attested only by their retained response ids.
 */
export class EventWriter {
  private seq = 0
  private prevHash = HASH_CHAIN_GENESIS
  private readonly sink: EventSink
  private readonly clock: (seq: number) => string

  constructor(sink: EventSink, clock: (seq: number) => string) {
    this.sink = sink
    this.clock = clock
  }

  write(state: GameState, events: EngineEvent[]): EventEnvelope[] {
    return events.map((e) => {
      const bare: Omit<EventEnvelope, 'hash'> = {
        seq: this.seq,
        roomId: state.roomId,
        matchId: state.match.matchId,
        gameIndex: state.match.gameIndex,
        ts: this.clock(this.seq),
        ...e,
      }
      const env: EventEnvelope = { ...bare, hash: chainHash(this.prevHash, bare) }
      this.prevHash = env.hash as string
      this.seq += 1
      this.sink.append(env)
      return env
    })
  }
}

export class MemorySink implements EventSink {
  readonly events: EventEnvelope[] = []
  append(e: EventEnvelope): void {
    this.events.push(e)
  }
}

export class JsonlFileSink implements EventSink {
  private readonly path: string

  constructor(path: string) {
    this.path = path
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '')
  }
  append(e: EventEnvelope): void {
    appendFileSync(this.path, `${JSON.stringify(e)}\n`)
  }
}

export class TeeSink implements EventSink {
  private readonly sinks: EventSink[]

  constructor(sinks: EventSink[]) {
    this.sinks = sinks
  }
  append(e: EventEnvelope): void {
    for (const s of this.sinks) s.append(e)
  }
}

export function readLog(path: string): EventEnvelope[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as EventEnvelope)
}

/** Real time. The only nondeterministic field in the log. */
export const wallClock = (): string => new Date().toISOString()

/** Logical time, so two runs of the same seed produce byte-identical logs. */
export const fixedClock = (seq: number): string =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + seq * 1000).toISOString()
