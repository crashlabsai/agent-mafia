import { test } from 'node:test'
import assert from 'node:assert/strict'
import { draw, drawInt, pick, shuffle } from '../src/rng.ts'

test('a draw is a pure function of seed and counter', () => {
  assert.deepEqual(draw('abc', 7), draw('abc', 7))
  assert.notEqual(draw('abc', 7).value, draw('abc', 8).value)
  assert.notEqual(draw('abc', 7).value, draw('abd', 7).value)
})

test('draw advances the counter by exactly one', () => {
  assert.equal(draw('s', 3).counter, 4)
})

test('drawInt stays in range', () => {
  for (let i = 0; i < 5000; i++) {
    const v = drawInt('seed', i, 7).value
    assert.ok(v >= 0 && v < 7, `out of range: ${v}`)
  }
})

test('drawInt is roughly uniform', () => {
  const buckets = new Array(6).fill(0) as number[]
  for (let i = 0; i < 60_000; i++) buckets[drawInt('u', i, 6).value] = (buckets[drawInt('u', i, 6).value] ?? 0) + 1
  for (const b of buckets) {
    assert.ok(b > 9000 && b < 11000, `bucket ${b} outside expected band`)
  }
})

test('shuffle is deterministic, a permutation, and advances the counter', () => {
  const items = [1, 2, 3, 4, 5, 6, 7]
  const a = shuffle(items, 'x', 0)
  const b = shuffle(items, 'x', 0)
  assert.deepEqual(a.value, b.value)
  assert.deepEqual([...a.value].sort((p, q) => p - q), items)
  assert.equal(a.counter, items.length - 1)
  assert.deepEqual(items, [1, 2, 3, 4, 5, 6, 7], 'input must not be mutated')
})

test('shuffle actually permutes across seeds', () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8]
  const seen = new Set<string>()
  for (let i = 0; i < 50; i++) seen.add(shuffle(items, `s${i}`, 0).value.join(''))
  assert.ok(seen.size > 40, `only ${seen.size} distinct orders in 50 seeds`)
})

test('pick rejects an empty list', () => {
  assert.throws(() => pick([], 'x', 0))
})
