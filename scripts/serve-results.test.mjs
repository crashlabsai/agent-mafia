import assert from 'node:assert/strict'
import test from 'node:test'
import { bearerAuthorized, createResultsServer } from './serve-results.mjs'

test('results server accepts only an exact bearer credential', () => {
  assert.equal(bearerAuthorized('Bearer launch-token', 'launch-token'), true)
  assert.equal(bearerAuthorized('Bearer launch-token-extra', 'launch-token'), false)
  assert.equal(bearerAuthorized('Basic launch-token', 'launch-token'), false)
  assert.equal(bearerAuthorized(undefined, 'launch-token'), false)
  assert.equal(bearerAuthorized('Bearer launch-token', ''), false)
})

test('results server rejects URL credentials and requires GET with a bearer header', async () => {
  const server = createResultsServer({ token: 'launch-token', dir: 'does-not-exist' })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`

    const queryCredential = await fetch(`${base}/status?token=launch-token`)
    assert.equal(queryCredential.status, 400)

    const mixedCredential = await fetch(`${base}/status?token=launch-token`, {
      headers: { authorization: 'Bearer launch-token' },
    })
    assert.equal(mixedCredential.status, 400)

    const status = await fetch(`${base}/status`, {
      headers: { authorization: 'Bearer launch-token' },
    })
    assert.equal(status.status, 200)
    assert.equal(status.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await status.json(), {
      dir: 'does-not-exist',
      games: [],
      totals: { done: 0, tokens: 0, failures: 0 },
      files: 0,
    })

    const post = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { authorization: 'Bearer launch-token' },
    })
    assert.equal(post.status, 405)
    assert.equal(post.headers.get('allow'), 'GET')
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
  }
})
