// Build a self-contained, answer-key-free reviewer for handcheck-v3 sheets.
//
// The generated fragment embeds only the rater-facing Markdown and ratings
// template. It never opens the sealed key or game logs. Identical displayed
// messages are grouped so a reviewer reads them once while still issuing one
// independent ruling per extracted claim.
//
//   node scripts/build-handcheck-review.mjs \
//     --input runs/analysis-v3/handcheck-calibration \
//     --out /absolute/path/sweep1-calibration-review.html

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    rater: { type: 'string', default: 'Ryan' },
  },
})

if (!values.input || !values.out) {
  console.error('usage: node scripts/build-handcheck-review.mjs --input handcheck-dir --out review.html [--rater Ryan]')
  process.exit(1)
}

const inputDir = resolve(values.input)
const outPath = resolve(values.out)
const sheetFiles = readdirSync(inputDir)
  .filter((name) => /^sheet-\d+\.md$/.test(name))
  .sort()
if (!sheetFiles.length) throw new Error(`no sheet-*.md files in ${inputDir}`)

const templatePath = join(inputDir, 'ratings-template.json')
const template = JSON.parse(readFileSync(templatePath, 'utf8'))
const sources = sheetFiles.map((name) => ({ name, text: readFileSync(join(inputDir, name), 'utf8') }))

function parseSheet({ name, text }) {
  const lines = text.split(/\r?\n/)
  const items = []
  let rejectedSection = false

  for (let i = 0; i < lines.length; i++) {
    if (/^## Machine-rejected investigation\/protection candidates/.test(lines[i])) rejectedSection = true
    const header = lines[i].match(/^\*\*(\d+)\.\*\* \[(.+?)\] — day (\d+), speaker (.+)$/)
    if (!header) continue

    const [, id, descriptor, day, speaker] = header
    const descriptorParts = descriptor.split(' · ')
    const kind = descriptorParts.shift()
    const fields = descriptorParts
    const messageLines = []
    let quote = ''
    let resolvingContext = ''
    let resolvingSeq = null

    for (i += 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^\*\*\d+\.\*\* \[/.test(line)) {
        i -= 1
        break
      }
      if (/^## Machine-rejected investigation\/protection candidates/.test(line)) {
        rejectedSection = true
        continue
      }
      if (line.startsWith('> ')) {
        messageLines.push(line.slice(2))
        continue
      }
      if (line === '>') {
        messageLines.push('')
        continue
      }
      const claimed = line.match(/^\s+claimed span: "([\s\S]*)"$/)
      if (claimed) {
        quote = claimed[1]
        continue
      }
      const context = line.match(/^\s+R12b resolving context — speaker's own prior message(?: \(seq (\d+)\))?: "([\s\S]*)"$/)
      if (context) {
        resolvingSeq = context[1] ? Number(context[1]) : null
        resolvingContext = context[2]
      }
    }

    if (!messageLines.length) throw new Error(`${name}: item ${id} has no displayed message`)
    if (!quote) throw new Error(`${name}: item ${id} has no claimed span`)
    items.push({
      id,
      number: Number(id),
      sourceSheet: name,
      kind,
      fields,
      day: Number(day),
      speaker,
      message: messageLines.join('\n').replace(/\n+$/, ''),
      quote,
      resolvingContext,
      resolvingSeq,
      rejectedSection,
    })
  }
  return items
}

const items = sources.flatMap(parseSheet).sort((a, b) => a.number - b.number)
const expectedIds = Object.keys(template.positiveRatings ?? {}).sort((a, b) => Number(a) - Number(b))
const parsedIds = items.map((item) => item.id)
if (JSON.stringify(expectedIds) !== JSON.stringify(parsedIds)) {
  throw new Error(`sheet/template item mismatch: parsed ${parsedIds.length}, template has ${expectedIds.length}`)
}

// Group only on information already displayed to the blinded rater. This can
// never reveal hidden game identity, model identity, role truth, or verdict.
const groupsByMessage = new Map()
for (const item of items) {
  const key = JSON.stringify([item.day, item.speaker, item.message])
  if (!groupsByMessage.has(key)) groupsByMessage.set(key, { firstItem: item.number, claims: [] })
  groupsByMessage.get(key).claims.push(item)
}
const groups = [...groupsByMessage.values()]
  .sort((a, b) => a.firstItem - b.firstItem)
  .map((group, index) => ({
    index,
    day: group.claims[0].day,
    speaker: group.claims[0].speaker,
    message: group.claims[0].message,
    claims: group.claims.sort((a, b) => a.number - b.number).map((claim) => ({
      id: claim.id,
      number: claim.number,
      sourceSheet: claim.sourceSheet,
      kind: claim.kind,
      fields: claim.fields,
      quote: claim.quote,
      resolvingContext: claim.resolvingContext,
      resolvingSeq: claim.resolvingSeq,
      rejectedSection: claim.rejectedSection,
    })),
  }))

const sheetSha256 = createHash('sha256')
  .update(sources.map(({ name, text }) => `${name}\0${text}`).join('\0'))
  .digest('hex')
const payload = {
  groups,
  template: { ...template, rater: values.rater || template.rater || '' },
  sheetSha256,
  sourceFiles: sheetFiles,
  itemCount: items.length,
}
const safeJson = JSON.stringify(payload)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')

const fragment = `<div id="sweep1-calibration-review">
  <section aria-labelledby="s1-review-title">
    <div class="viz-row s1-heading-row">
      <h2 id="s1-review-title">Sweep 1 calibration review</h2>
      <span id="s1-save-state" class="text-small text-muted" aria-live="polite">Progress saved locally</span>
    </div>
    <p class="text-small text-muted">Blinded review: use only what is shown here. Do not open the logs or sealed key.</p>
    <div id="s1-progress" class="progress" role="progressbar" aria-label="Claims rated" aria-valuenow="0" aria-valuemin="0" aria-valuemax="${items.length}">
      <div id="s1-progress-bar" class="progress-bar" style="width:0%"></div>
    </div>
    <div class="viz-row s1-counts" aria-live="polite">
      <span id="s1-position" class="tabular-nums"></span>
      <span id="s1-rated" class="tabular-nums"></span>
      <span id="s1-breakdown" class="text-small text-muted"></span>
    </div>
    <details class="s1-help">
      <summary>Rules and keyboard shortcuts</summary>
      <p><strong>OK</strong>: a genuine first-person claim of the shown kind, with the shown fields, asserted in this message.</p>
      <p><strong>BAD</strong>: not a claim, wrong kind, hedged, a group statement, wrong fields, or not asserted in this message.</p>
      <p class="text-small text-muted"><kbd>O</kbd> OK · <kbd>B</kbd> BAD · <kbd>U</kbd> unsure · <kbd>←</kbd>/<kbd>→</kbd> move · <kbd>Z</kbd> undo · <kbd>N</kbd> note</p>
    </details>
  </section>

  <article class="card" aria-labelledby="s1-claim-title">
    <div class="viz-row s1-meta-row">
      <span id="s1-kind" class="viz-badge"></span>
      <span id="s1-meta" class="text-small text-muted"></span>
    </div>
    <h3 id="s1-claim-title"></h3>
    <div id="s1-fields" class="viz-row s1-fields"></div>
    <div id="s1-message" class="s1-message"></div>
    <p id="s1-span-fallback" class="text-small" hidden></p>
    <div id="s1-context-wrap" class="s1-context" hidden>
      <p class="text-small text-muted">Resolving context from the speaker’s prior message</p>
      <p id="s1-context"></p>
    </div>

    <div class="viz-controls s1-ruling-controls" aria-label="Ruling">
      <button id="s1-ok" type="button" class="btn btn-primary">OK <span class="text-small">(O)</span></button>
      <button id="s1-bad" type="button" class="btn">BAD <span class="text-small">(B)</span></button>
      <button id="s1-unsure" type="button" class="btn btn-ghost">Unsure <span class="text-small">(U)</span></button>
    </div>

    <div id="s1-reason-panel" hidden>
      <p id="s1-reason-prompt">Choose a quick reason, or write your own:</p>
      <div id="s1-reasons" class="viz-controls"></div>
      <label class="form-label" for="s1-note">Note</label>
      <textarea id="s1-note" class="form-control" rows="2" placeholder="Short reason for Fable’s amendment review"></textarea>
      <div class="viz-controls">
        <button id="s1-save-note" type="button" class="btn btn-primary">Save and continue</button>
        <button id="s1-cancel-note" type="button" class="btn btn-ghost">Cancel</button>
      </div>
    </div>
  </article>

  <nav class="viz-controls" aria-label="Review navigation">
    <button id="s1-prev" type="button" class="btn">← Previous</button>
    <button id="s1-next" type="button" class="btn">Next →</button>
    <button id="s1-next-unrated" type="button" class="btn">Next unrated</button>
    <button id="s1-undo" type="button" class="btn btn-ghost">Undo <span class="text-small">(Z)</span></button>
  </nav>

  <section class="s1-export" aria-labelledby="s1-export-title">
    <h3 id="s1-export-title">Return to Fable</h3>
    <div class="viz-controls">
      <label class="form-label" for="s1-rater">Rater
        <input id="s1-rater" class="form-control" type="text" autocomplete="name" value="${String(values.rater).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}">
      </label>
      <button id="s1-copy" type="button" class="btn btn-primary" disabled>Copy ratings for Fable</button>
      <button id="s1-download" type="button" class="btn" disabled>Download ratings-template.json</button>
    </div>
    <p id="s1-export-status" class="text-small text-muted" aria-live="polite">Complete all ${items.length} claims to unlock export.</p>
  </section>

  <script type="application/json" id="s1-review-data">${safeJson}</script>
  <script>
  (() => {
    const root = document.getElementById('sweep1-calibration-review');
    const data = JSON.parse(document.getElementById('s1-review-data').textContent);
    const groups = data.groups;
    const flat = groups.flatMap((group, groupIndex) => group.claims.map((claim, claimIndex) => ({ groupIndex, claimIndex, claim })));
    const storageKey = 'sweep1-review:' + data.template.analysisRunId + ':' + data.sheetSha256;
    const reasonLabels = [
      'Not a claim',
      'Wrong claim kind',
      'Wrong extracted fields',
      'Hedged or conditional',
      'Group statement, not first-person',
      'Not asserted in this message'
    ];
    let state = { ratings: {}, notes: {}, cursor: 0, history: [], rater: data.template.rater || 'Ryan' };
    let pendingRuling = null;

    const byId = (id) => root.querySelector('#' + id);
    const els = {
      saveState: byId('s1-save-state'), progress: byId('s1-progress'), progressBar: byId('s1-progress-bar'),
      position: byId('s1-position'), rated: byId('s1-rated'), breakdown: byId('s1-breakdown'),
      kind: byId('s1-kind'), meta: byId('s1-meta'), title: byId('s1-claim-title'), fields: byId('s1-fields'),
      message: byId('s1-message'), spanFallback: byId('s1-span-fallback'), contextWrap: byId('s1-context-wrap'), context: byId('s1-context'),
      ok: byId('s1-ok'), bad: byId('s1-bad'), unsure: byId('s1-unsure'),
      reasonPanel: byId('s1-reason-panel'), reasonPrompt: byId('s1-reason-prompt'), reasons: byId('s1-reasons'), note: byId('s1-note'),
      saveNote: byId('s1-save-note'), cancelNote: byId('s1-cancel-note'),
      prev: byId('s1-prev'), next: byId('s1-next'), nextUnrated: byId('s1-next-unrated'), undo: byId('s1-undo'),
      rater: byId('s1-rater'), copy: byId('s1-copy'), download: byId('s1-download'), exportStatus: byId('s1-export-status')
    };

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && typeof saved === 'object') state = { ...state, ...saved };
    } catch (_) {}
    state.cursor = Math.max(0, Math.min(flat.length - 1, Number(state.cursor) || 0));
    els.rater.value = state.rater || 'Ryan';

    function persist(message = 'Progress saved locally') {
      state.rater = els.rater.value.trim();
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
        els.saveState.textContent = message;
      } catch (_) {
        els.saveState.textContent = 'Local saving unavailable — export a backup before closing';
      }
    }

    function textWithHighlight(container, text, quote) {
      container.replaceChildren();
      const index = text.indexOf(quote);
      const parts = index < 0 ? [{ text }] : [
        { text: text.slice(0, index) },
        { text: quote, highlight: true },
        { text: text.slice(index + quote.length) }
      ];
      for (const part of parts) {
        if (!part.text) continue;
        const node = part.highlight ? document.createElement('mark') : document.createTextNode(part.text);
        if (part.highlight) node.textContent = part.text;
        container.append(node);
      }
      els.spanFallback.hidden = index >= 0;
      els.spanFallback.textContent = index < 0 ? 'Claimed span: “' + quote + '”' : '';
    }

    function counts() {
      const values = Object.values(state.ratings);
      return {
        total: values.length,
        ok: values.filter((v) => v === 'OK').length,
        bad: values.filter((v) => v === 'BAD').length,
        unsure: values.filter((v) => v === 'UNSURE').length
      };
    }

    function current() { return flat[state.cursor]; }

    function render() {
      const entry = current();
      const group = groups[entry.groupIndex];
      const claim = entry.claim;
      const c = counts();
      const pct = Math.round((c.total / flat.length) * 100);
      const groupRated = group.claims.filter((it) => state.ratings[it.id]).length;

      els.progress.setAttribute('aria-valuenow', String(c.total));
      els.progressBar.style.width = pct + '%';
      els.position.textContent = 'Message ' + (entry.groupIndex + 1) + '/' + groups.length + ' · claim ' + (entry.claimIndex + 1) + '/' + group.claims.length;
      els.rated.textContent = c.total + '/' + flat.length + ' rated';
      els.breakdown.textContent = (flat.length - c.total) + ' left';
      els.kind.textContent = claim.kind.replaceAll('_', ' ');
      els.meta.textContent = claim.sourceSheet.replace('.md', '') + ' · item ' + claim.id + ' · day ' + group.day + ' · speaker ' + group.speaker + (group.claims.length > 1 ? ' · ' + groupRated + '/' + group.claims.length + ' claims in this message rated' : '');
      els.title.textContent = 'Is this extracted claim correct?';
      els.fields.replaceChildren();
      for (const field of claim.fields) {
        const chip = document.createElement('span');
        chip.className = 'viz-badge';
        chip.textContent = field;
        els.fields.append(chip);
      }
      textWithHighlight(els.message, group.message, claim.quote);
      els.contextWrap.hidden = !claim.resolvingContext;
      els.context.textContent = claim.resolvingContext ? (claim.resolvingSeq ? 'Seq ' + claim.resolvingSeq + ': ' : '') + claim.resolvingContext : '';

      const ruling = state.ratings[claim.id] || '';
      els.ok.setAttribute('aria-pressed', String(ruling === 'OK'));
      els.bad.setAttribute('aria-pressed', String(ruling === 'BAD'));
      els.unsure.setAttribute('aria-pressed', String(ruling === 'UNSURE'));
      els.note.value = state.notes[claim.id] || '';
      pendingRuling = null;
      els.reasonPanel.hidden = true;
      els.prev.disabled = state.cursor === 0;
      els.next.disabled = state.cursor === flat.length - 1;
      els.undo.disabled = state.history.length === 0;
      const complete = c.total === flat.length && els.rater.value.trim().length > 0;
      els.copy.disabled = !complete;
      els.download.disabled = !complete;
      els.exportStatus.textContent = complete
        ? 'All claims rated. Copy or download the ingest-ready file for Fable.'
        : 'Complete ' + (flat.length - c.total) + ' more claim' + (flat.length - c.total === 1 ? '' : 's') + ' to unlock export.';
    }

    function nextUnrated(start = state.cursor + 1) {
      for (let offset = 0; offset < flat.length; offset++) {
        const index = (start + offset) % flat.length;
        if (!state.ratings[flat[index].claim.id]) return index;
      }
      return Math.min(state.cursor + 1, flat.length - 1);
    }

    function commit(ruling, note = '') {
      const id = current().claim.id;
      state.history.push({ id, previousRating: state.ratings[id] || '', previousNote: state.notes[id] || '', cursor: state.cursor });
      state.ratings[id] = ruling;
      if (note.trim()) state.notes[id] = note.trim();
      else delete state.notes[id];
      state.cursor = nextUnrated();
      persist();
      render();
    }

    function openReason(ruling) {
      pendingRuling = ruling;
      els.reasonPrompt.textContent = ruling === 'BAD'
        ? 'Why is this BAD? Choose a quick reason, or write your own:'
        : ruling === 'UNSURE'
          ? 'What makes this uncertain? Add a short note:'
          : 'Add an optional note to this OK ruling:';
      els.reasons.hidden = ruling !== 'BAD';
      els.reasonPanel.hidden = false;
      els.note.value = state.notes[current().claim.id] || '';
      if (ruling !== 'BAD') els.note.focus();
    }

    function exportObject() {
      const positiveRatings = {};
      for (const id of Object.keys(data.template.positiveRatings).sort((a, b) => Number(a) - Number(b))) {
        positiveRatings[id] = state.ratings[id] || '';
      }
      const notes = {};
      for (const [id, note] of Object.entries(state.notes)) if (note.trim()) notes[id] = note.trim();
      return {
        ...data.template,
        rater: els.rater.value.trim(),
        answerKeyOpened: false,
        positiveRatings,
        notes
      };
    }

    async function copyExport() {
      const json = JSON.stringify(exportObject(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
        els.exportStatus.textContent = 'Copied. Paste this directly into Fable’s chat.';
      } catch (_) {
        const area = document.createElement('textarea');
        area.value = json;
        root.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        els.exportStatus.textContent = 'Copied. Paste this directly into Fable’s chat.';
      }
    }

    function downloadExport() {
      const blob = new Blob([JSON.stringify(exportObject(), null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ratings-template.json';
      link.click();
      URL.revokeObjectURL(url);
      els.exportStatus.textContent = 'Downloaded ratings-template.json. Give that file to Fable.';
    }

    for (const [index, label] of reasonLabels.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.textContent = (index + 1) + '. ' + label;
      button.addEventListener('click', () => commit('BAD', label));
      els.reasons.append(button);
    }

    els.ok.addEventListener('click', () => commit('OK'));
    els.bad.addEventListener('click', () => openReason('BAD'));
    els.unsure.addEventListener('click', () => openReason('UNSURE'));
    els.saveNote.addEventListener('click', () => {
      if (!pendingRuling) return;
      const note = els.note.value.trim();
      if (!note) {
        els.note.setCustomValidity('Please add a short note.');
        els.note.reportValidity();
        return;
      }
      els.note.setCustomValidity('');
      commit(pendingRuling, note);
    });
    els.cancelNote.addEventListener('click', () => { pendingRuling = null; els.reasonPanel.hidden = true; });
    els.prev.addEventListener('click', () => { state.cursor = Math.max(0, state.cursor - 1); persist(); render(); });
    els.next.addEventListener('click', () => { state.cursor = Math.min(flat.length - 1, state.cursor + 1); persist(); render(); });
    els.nextUnrated.addEventListener('click', () => { state.cursor = nextUnrated(); persist(); render(); });
    els.undo.addEventListener('click', () => {
      const prior = state.history.pop();
      if (!prior) return;
      if (prior.previousRating) state.ratings[prior.id] = prior.previousRating;
      else delete state.ratings[prior.id];
      if (prior.previousNote) state.notes[prior.id] = prior.previousNote;
      else delete state.notes[prior.id];
      state.cursor = prior.cursor;
      persist('Last decision undone');
      render();
    });
    els.rater.addEventListener('input', () => { persist(); render(); });
    els.copy.addEventListener('click', copyExport);
    els.download.addEventListener('click', downloadExport);

    root.addEventListener('keydown', (event) => {
      const editing = ['INPUT', 'TEXTAREA'].includes(event.target.tagName);
      if (editing) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !els.reasonPanel.hidden) {
          event.preventDefault();
          els.saveNote.click();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (pendingRuling === 'BAD' && /^[1-6]$/.test(key)) {
        event.preventDefault();
        commit('BAD', reasonLabels[Number(key) - 1]);
      } else if (key === 'o' || key === '1') {
        event.preventDefault();
        commit('OK');
      } else if (key === 'b' || key === '2') {
        event.preventDefault();
        openReason('BAD');
      } else if (key === 'u' || key === '3') {
        event.preventDefault();
        openReason('UNSURE');
      } else if (key === 'n') {
        event.preventDefault();
        openReason(state.ratings[current().claim.id] || 'UNSURE');
      } else if (key === 'z') {
        event.preventDefault();
        els.undo.click();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        els.prev.click();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        els.next.click();
      }
    });

    render();
  })();
  </script>
</div>

<style>
#sweep1-calibration-review {
  color: var(--foreground);
  display: grid;
  gap: 1rem;
}
#sweep1-calibration-review .s1-heading-row,
#sweep1-calibration-review .s1-meta-row,
#sweep1-calibration-review .s1-counts {
  justify-content: space-between;
}
#sweep1-calibration-review h2,
#sweep1-calibration-review h3,
#sweep1-calibration-review p {
  margin-top: 0;
}
#sweep1-calibration-review .s1-help p:last-child,
#sweep1-calibration-review .s1-export p:last-child {
  margin-bottom: 0;
}
#sweep1-calibration-review .s1-fields {
  margin-bottom: 0.75rem;
}
#sweep1-calibration-review .s1-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 1rem 0;
}
#sweep1-calibration-review mark {
  color: var(--foreground);
  background: color-mix(in srgb, var(--yellow) 32%, transparent);
}
#sweep1-calibration-review .s1-context {
  border-left: 3px solid var(--border);
  padding-left: 0.75rem;
  margin: 1rem 0;
}
#sweep1-calibration-review .s1-context p {
  margin-bottom: 0.4rem;
}
#sweep1-calibration-review .s1-ruling-controls,
#sweep1-calibration-review #s1-reason-panel {
  margin-top: 1rem;
}
#sweep1-calibration-review #s1-reasons {
  margin-bottom: 0.75rem;
}
#sweep1-calibration-review #s1-note {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 0.75rem;
}
#sweep1-calibration-review .s1-export {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}
#sweep1-calibration-review kbd {
  font: inherit;
  color: var(--foreground);
}
@media (max-width: 520px) {
  #sweep1-calibration-review .s1-heading-row,
  #sweep1-calibration-review .s1-meta-row,
  #sweep1-calibration-review .s1-counts {
    align-items: flex-start;
  }
}
</style>
`

writeFileSync(outPath, fragment)
console.log(JSON.stringify({
  out: outPath,
  sheets: sheetFiles,
  items: items.length,
  messages: groups.length,
  bytes: Buffer.byteLength(fragment),
  analysisRunId: template.analysisRunId,
  sheetSha256,
}, null, 2))
