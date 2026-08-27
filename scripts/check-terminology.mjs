// Acceptance check: "round" is never used bare — it otherwise means a game, a
// day/night cycle, and a discussion pass all at once.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['packages', 'docs', 'README.md']
// Allowed: the qualified game term, plus words that merely contain "round"
// or use it in an unrelated sense. The rule is about "round" naming a unit of
// game structure, not about the letters.
const ALLOWED =
  /discussionRounds?|discussion rounds?|round[- ]trip|ground|Math\.round|\.round\(|"round"|`round`/gi
const BARE = /\bRounds?\b/gi

const files = []
const walk = (p) => {
  if (p.includes('node_modules')) return
  const st = statSync(p)
  if (st.isDirectory()) for (const f of readdirSync(p)) walk(join(p, f))
  else if (/\.(ts|md|mjs)$/.test(p)) files.push(p)
}
for (const r of ROOTS) walk(r)

let bad = 0
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    const stripped = line.replace(ALLOWED, '')
    for (const m of stripped.matchAll(BARE)) {
      console.error(`  ${f}:${i + 1}  bare "${m[0]}"  ->  ${line.trim().slice(0, 90)}`)
      bad += 1
    }
  })
}
console.log(bad === 0 ? `  ok   no bare "round" in ${files.length} files` : `  FAIL ${bad} bare uses`)
process.exit(bad ? 1 : 0)
