import { shuffle } from './rng.ts'

/**
 * Seat display names, dealt from a fixed pool and shuffled per game.
 *
 * The shuffle is driven by the game seed through the same counter-based RNG
 * as the role deal, so a seed always seats the same names — replay and the
 * byte-determinism check depend on that — while every new seed deals a fresh
 * name-to-seat assignment. First names only, and the assignment carries no
 * information: a name says nothing about role, model, or seat index.
 */
export const NAME_POOL = [
  'Sam', 'Palmer', 'Josie', 'Bryan', 'Michael', 'Tim',
  'Liv', 'Ryan', 'Dylan', 'Moxie', 'Cyan', 'Trae',
] as const

/** Names for `count` seats, in seat order. Consumes RNG draws from `counter`. */
export function dealNames(
  count: number,
  seed: string,
  counter: number,
): { value: string[]; counter: number } {
  const s = shuffle(NAME_POOL, seed, counter)
  const value = Array.from({ length: count }, (_, i) => {
    const n = s.value[i % NAME_POOL.length] as string
    return i < NAME_POOL.length ? n : `${n}-${Math.floor(i / NAME_POOL.length) + 1}`
  })
  return { value, counter: s.counter }
}
