// Acceptance check: the same seed must produce a byte-identical log.
// Uses --fixed-ts, since `ts` is the only wall-clock field in an envelope.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

const CLI = 'packages/cli/src/index.ts'
const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['42', 'alpha', 'silent']
let failed = false

for (const seed of seeds) {
  const paths = ['runs/_det_a.jsonl', 'runs/_det_b.jsonl']
  for (const out of paths) {
    execFileSync('node', [CLI, 'run', '--seed', seed, '--fixed-ts', '--quiet', '--out', out], {
      stdio: 'ignore',
    })
  }
  const [a, b] = paths.map((p) => readFileSync(p, 'utf8'))
  const lines = a.trim().split('\n').length

  if (a === b) {
    console.log(`  ok   seed=${seed}  byte-identical (${lines} events)`)
  } else {
    failed = true
    console.error(`  FAIL seed=${seed}  logs diverge`)
    const [la, lb] = [a.split('\n'), b.split('\n')]
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if (la[i] !== lb[i]) {
        console.error(`    first divergence at line ${i + 1}:\n      A: ${la[i]}\n      B: ${lb[i]}`)
        break
      }
    }
  }

  const report = execFileSync('node', [CLI, 'verify', paths[0]], { encoding: 'utf8' })
  if (!report.startsWith('OK')) {
    failed = true
    console.error(`  FAIL seed=${seed}  verify: ${report.trim()}`)
  } else {
    console.log(`  ok   seed=${seed}  ${report.trim()}`)
  }
  for (const p of paths) rmSync(p, { force: true })
}

process.exit(failed ? 1 : 0)
