/**
 * Counter-based deterministic RNG.
 *
 * There is no generator object and no hidden state: a draw is a pure function of
 * (seed, counter). The counter lives in GameState, so replaying a log reproduces
 * RNG position exactly and a fork from any seq continues correctly.
 */

export function hashString(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** One mulberry32 step over a hashed word. Returns a float in [0, 1). */
function mix(a: number): number {
  let t = (a + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), 1 | t)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function draw(seed: string, counter: number): { value: number; counter: number } {
  return { value: mix(hashString(`${seed}#${counter}`)), counter: counter + 1 }
}

/** Uniform integer in [0, bound). */
export function drawInt(
  seed: string,
  counter: number,
  bound: number,
): { value: number; counter: number } {
  const d = draw(seed, counter)
  return { value: Math.floor(d.value * bound), counter: d.counter }
}

/** Fisher-Yates, driven entirely by the counter. Does not mutate `items`. */
export function shuffle<T>(
  items: readonly T[],
  seed: string,
  counter: number,
): { value: T[]; counter: number } {
  const out = [...items]
  let c = counter
  for (let i = out.length - 1; i > 0; i--) {
    const d = drawInt(seed, c, i + 1)
    c = d.counter
    const j = d.value
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return { value: out, counter: c }
}

/** Deterministic pick from a non-empty list. */
export function pick<T>(
  items: readonly T[],
  seed: string,
  counter: number,
): { value: T; counter: number } {
  if (items.length === 0) throw new Error('pick from empty list')
  const d = drawInt(seed, counter, items.length)
  return { value: items[d.value] as T, counter: d.counter }
}
