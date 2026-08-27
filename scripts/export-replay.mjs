// Export one finished game log as a self-contained replay page.
//
//   node scripts/export-replay.mjs runs/validate/v1.jsonl \
//        --out site/replays/v1.html --title "Seven models, two liars" \
//        [--spotlight 41,87] [--data-href ../data/v1.jsonl]
//
// The page embeds the full event stream and composes the same client
// renderer the live observer uses (packages/viewer/src/client.ts), so a
// published replay is pixel-for-pixel the tool itself: seat cards that track
// the reading line, per-seat and omniscient views, collapsible days,
// thoughts toggle. It opens from file:// with zero network.
//
// Spotlights are optional seq numbers rendered as chips that scroll to the
// moment and flash it — the exact frames launch screenshots are taken from.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { CORE_JS, STYLES } from '../packages/viewer/src/client.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    title: { type: 'string' },
    spotlight: { type: 'string' },
    'data-href': { type: 'string' },
  },
})
const logPath = positionals[0]
if (!logPath || !values.out) {
  console.error('usage: node scripts/export-replay.mjs <log.jsonl> --out <page.html> [--title t] [--spotlight seq,seq] [--data-href url]')
  process.exit(1)
}

const events = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const created = events.find((e) => e.type === 'game_created')
if (!created) { console.error(`${logPath} has no game_created event`); process.exit(1) }
const ended = events.findLast((e) => e.type === 'game_ended')

const names = {}
for (const s of created.payload.seats) names[s.id] = s.name
const models = events.filter((e) => e.type === 'seat_bound')
  .map((e) => e.payload.modelKey)
const uniqueModels = [...new Set(models)]
const winner = ended ? (ended.payload.winner ? `${ended.payload.winner} wins` : 'stalemate') : 'unfinished'
const days = ended ? ended.day : Math.max(...events.map((e) => e.day))
const title = values.title ?? `agent-mafia — ${created.roomId}`
const spotlights = (values.spotlight ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))

// Safe to sit inside a <script> element: no closing tags, no line separators.
const payload = JSON.stringify(events)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const spotBar = spotlights.length
  ? `<div id="spots">${spotlights.map((s, i) =>
      `<button class="spotchip" data-goto="${s}">moment ${i + 1}</button>`).join('')}</div>`
  : ''

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(uniqueModels.join(' · '))} play Mafia — every lie checkable against the log. Flip to any seat's view to see exactly what it knew.">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLES}
  #metastrip {
    display: flex; gap: 10px 18px; align-items: center; flex-wrap: wrap;
    padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--line);
  }
  #metastrip h1 { font-size: 15px; font-weight: 650; }
  #metastrip .sub { color: var(--dim); font-size: 12px; }
  #metastrip a { color: var(--detective); font-size: 12px; }
  #spots { display: flex; gap: 8px; padding: 8px 14px 0; flex-wrap: wrap; }
  .spotchip {
    font-size: 11.5px; padding: 3px 10px; border-radius: 999px;
    background: #231a10; border: 1px solid #6b4a1e; color: var(--warn); cursor: pointer;
  }
</style>
</head>
<body>
<div id="metastrip">
  <h1>&#127922; ${esc(title)}</h1>
  <span class="sub">${esc(uniqueModels.join(' · '))} &middot; ${esc(winner)} &middot; ${days} day${days === 1 ? '' : 's'}</span>
  <span class="spacer"></span>
  <select id="modeSel" title="whose view">
    <option value="omniscient">Omniscient view</option>
    <option value="public">Public view</option>
  </select>
  <label class="toggle"><input type="checkbox" id="thoughts" checked> thoughts</label>
  <button id="foldBtn" title="collapse or expand every day">Collapse days</button>
  ${values['data-href'] ? `<a href="${esc(values['data-href'])}">raw log</a>` : ''}
  <a href="https://github.com/crashlabsai/agent-mafia">how this is checkable</a>
</div>
<div id="seatsbar">
  ${spotBar}
  <div id="reading"></div>
  <div id="seats"></div>
</div>
<div id="feed"></div>

<script>${CORE_JS}
(function () {
  'use strict';
  var EMBEDDED = ${payload};
  document.addEventListener('DOMContentLoaded', function () {
    var state = MafiaCore.state;
    state.events = EMBEDDED;
    state.lastSeq = EMBEDDED.length ? EMBEDDED[EMBEDDED.length - 1].seq : -1;
    state.file = 'static';

    // Deep links: #view=seat-2 opens on a seat's subjective game, #e41 jumps
    // to a moment.
    var hash = location.hash.replace(/^#/, '');
    var view = /view=([a-z0-9-]+)/.exec(hash);
    MafiaCore.renderAll();
    if (view) MafiaCore.setMode(view[1]);

    function goto(seq) {
      var el = document.querySelector('[data-seq="' + seq + '"]');
      if (!el) return;
      var details = el.closest('details.dayblock');
      if (details) details.open = true;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('spot');
      setTimeout(function () { el.classList.remove('spot'); }, 2600);
    }
    var jump = /(^|&)e(\\d+)/.exec(hash);
    if (jump) setTimeout(function () { goto(Number(jump[2])); }, 100);

    Array.prototype.forEach.call(document.querySelectorAll('.spotchip'), function (b) {
      b.onclick = function () { goto(Number(b.getAttribute('data-goto'))); };
    });

    // A static page opens at the top — the story reads forward.
    var feed = document.getElementById('feed');
    if (feed && !jump) feed.scrollTop = 0;
  });
})();
</script>
</body>
</html>
`

mkdirSync(dirname(values.out), { recursive: true })
writeFileSync(values.out, html)
console.log(`wrote ${values.out} (${events.length} events, ${uniqueModels.length} models, ${winner})`)
