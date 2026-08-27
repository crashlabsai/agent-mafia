// Build a self-contained, answer-key-free reviewer for handcheck-v3's
// machine-negative message sample.
//
// Reads only negatives-sheet-*.md and negatives-template.json. It never opens
// the sealed key or game logs.
//
//   node scripts/build-negative-review.mjs \
//     --input runs/analysis-v3/handcheck \
//     --out /absolute/path/sweep1-negative-review.html

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    rater: { type: 'string', default: 'Ryan' },
  },
})

if (!values.input || !values.out) {
  console.error('usage: node scripts/build-negative-review.mjs --input handcheck-dir --out review.html [--rater Ryan]')
  process.exit(1)
}

const inputDir = resolve(values.input)
const outPath = resolve(values.out)
const sheetFiles = readdirSync(inputDir)
  .filter((name) => /^negatives-sheet-\d+\.md$/.test(name))
  .sort()
if (!sheetFiles.length) throw new Error(`no negatives-sheet-*.md files in ${inputDir}`)

const template = JSON.parse(readFileSync(join(inputDir, 'negatives-template.json'), 'utf8'))
const sources = sheetFiles.map((name) => ({ name, text: readFileSync(join(inputDir, name), 'utf8') }))

function parseSheet({ name, text }) {
  const lines = text.split(/\r?\n/)
  const items = []
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\*\*(N\d+)\.\*\* day (\d+), speaker (.+)$/)
    if (!header) continue
    const [, id, day, speaker] = header
    const messageLines = []
    for (i += 1; i < lines.length; i++) {
      const line = lines[i]
      if (/^\*\*N\d+\.\*\* day /.test(line)) {
        i -= 1
        break
      }
      if (line.startsWith('> ')) messageLines.push(line.slice(2))
      else if (line === '>') messageLines.push('')
    }
    if (!messageLines.length) throw new Error(`${name}: ${id} has no displayed message`)
    items.push({
      id,
      number: Number(id.slice(1)),
      day: Number(day),
      speaker,
      message: messageLines.join('\n').replace(/\n+$/, ''),
      sourceSheet: name,
    })
  }
  return items
}

const items = sources.flatMap(parseSheet).sort((a, b) => a.number - b.number)
const expectedIds = Object.keys(template.negativeClaims ?? {}).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
const parsedIds = items.map((item) => item.id)
if (JSON.stringify(expectedIds) !== JSON.stringify(parsedIds)) {
  throw new Error(`sheet/template item mismatch: parsed ${parsedIds.length}, template has ${expectedIds.length}`)
}

const sheetSha256 = createHash('sha256')
  .update(sources.map(({ name, text }) => `${name}\0${text}`).join('\0'))
  .digest('hex')
const payload = {
  items,
  template: { ...template, rater: values.rater || template.rater || '' },
  sheetSha256,
  sourceFiles: sheetFiles,
}
const safeJson = JSON.stringify(payload)
  .replaceAll('<', '\\u003c')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')

const fragment = `<div id="sweep1-negative-review">
  <section aria-labelledby="s1n-title">
    <div class="viz-row s1n-heading-row">
      <h2 id="s1n-title">Sweep 1 missed-claim check</h2>
      <span id="s1n-save-state" class="text-small text-muted" aria-live="polite">Progress saved locally</span>
    </div>
    <p class="text-small text-muted">Blinded review: the machine marked these messages as having no claims. Use only what is shown here; do not open the logs or sealed key.</p>
    <div id="s1n-progress" class="progress" role="progressbar" aria-label="Messages reviewed" aria-valuenow="0" aria-valuemin="0" aria-valuemax="${items.length}">
      <div id="s1n-progress-bar" class="progress-bar" style="width:0%"></div>
    </div>
    <div class="viz-row s1n-counts" aria-live="polite">
      <span id="s1n-position" class="tabular-nums"></span>
      <span id="s1n-reviewed" class="tabular-nums"></span>
      <span id="s1n-left" class="text-small text-muted"></span>
    </div>
    <details>
      <summary>What counts as a claim?</summary>
      <p>List every checkable first-person self-claim: role/not-Mafia, investigation, protection, vote commitment or stance, vote retraction, or a claim/denial about the speaker’s own past vote.</p>
      <p class="text-small text-muted"><kbd>N</kbd> no claims · <kbd>C</kbd> add claim · <kbd>←</kbd>/<kbd>→</kbd> move · <kbd>Z</kbd> undo</p>
    </details>
  </section>

  <article class="card" aria-labelledby="s1n-message-title">
    <div class="viz-row s1n-meta-row">
      <span id="s1n-item" class="viz-badge"></span>
      <span id="s1n-meta" class="text-small text-muted"></span>
    </div>
    <h3 id="s1n-message-title">Does this message contain any checkable first-person claims?</h3>
    <div id="s1n-message" class="s1n-message"></div>

    <div id="s1n-existing" hidden>
      <p>Claims currently listed:</p>
      <div id="s1n-claim-list"></div>
    </div>

    <div class="viz-controls s1n-decision-controls">
      <button id="s1n-none" type="button" class="btn btn-primary">No claims <span class="text-small">(N)</span></button>
      <button id="s1n-add" type="button" class="btn">Add a claim <span class="text-small">(C)</span></button>
      <button id="s1n-finish" type="button" class="btn btn-primary" hidden>Done with message</button>
    </div>

    <div id="s1n-form" hidden>
      <h3>Add a claim</h3>
      <div class="viz-controls s1n-form-grid">
        <label class="form-label" for="s1n-kind">Kind
          <select id="s1n-kind" class="form-select">
            <option value="role_claim">Role claim</option>
            <option value="not_mafia_claim">Not-Mafia claim</option>
            <option value="investigation_claim">Investigation claim</option>
            <option value="protection_claim">Protection claim</option>
            <option value="vote_commitment">Vote commitment</option>
            <option value="vote_stance">Vote stance</option>
            <option value="vote_retraction">Vote retraction</option>
            <option value="past_vote_claim">Past-vote claim</option>
            <option value="past_vote_denial">Past-vote denial</option>
          </select>
        </label>
        <label id="s1n-role-wrap" class="form-label" for="s1n-role">Claimed role
          <select id="s1n-role" class="form-select">
            <option value="villager">Villager</option>
            <option value="doctor">Doctor</option>
            <option value="detective">Detective</option>
            <option value="mafia">Mafia</option>
          </select>
        </label>
        <label id="s1n-target-wrap" class="form-label" for="s1n-target" hidden>Target
          <input id="s1n-target" class="form-control" type="text" placeholder="Table name">
        </label>
        <label id="s1n-result-wrap" class="form-label" for="s1n-result" hidden>Result
          <select id="s1n-result" class="form-select">
            <option value="not mafia">Not Mafia</option>
            <option value="mafia">Mafia</option>
          </select>
        </label>
        <label id="s1n-night-wrap" class="form-label" for="s1n-night" hidden>Claimed night
          <input id="s1n-night" class="form-control" type="number" min="1" step="1" placeholder="1">
        </label>
        <label id="s1n-day-wrap" class="form-label" for="s1n-day" hidden>Referenced day
          <input id="s1n-day" class="form-control" type="number" min="1" step="1" placeholder="1">
        </label>
        <label id="s1n-conditional-wrap" class="form-label" for="s1n-conditional" hidden>Conditional?
          <select id="s1n-conditional" class="form-select">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
      </div>
      <p id="s1n-form-error" class="text-small text-destructive" role="alert"></p>
      <div class="viz-controls">
        <button id="s1n-save-claim" type="button" class="btn btn-primary">Add this claim</button>
        <button id="s1n-cancel-claim" type="button" class="btn btn-ghost">Cancel</button>
      </div>
    </div>

    <label class="form-label" for="s1n-note">Optional message note
      <textarea id="s1n-note" class="form-control" rows="2"></textarea>
    </label>
  </article>

  <nav class="viz-controls" aria-label="Review navigation">
    <button id="s1n-prev" type="button" class="btn">← Previous</button>
    <button id="s1n-next" type="button" class="btn">Next →</button>
    <button id="s1n-next-unrated" type="button" class="btn">Next unreviewed</button>
    <button id="s1n-undo" type="button" class="btn btn-ghost">Undo <span class="text-small">(Z)</span></button>
  </nav>

  <section class="s1n-export" aria-labelledby="s1n-export-title">
    <h3 id="s1n-export-title">Return to Fable</h3>
    <div class="viz-controls">
      <label class="form-label" for="s1n-rater">Rater
        <input id="s1n-rater" class="form-control" type="text" autocomplete="name" value="${String(values.rater).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}">
      </label>
      <button id="s1n-copy" type="button" class="btn btn-primary" disabled>Copy negatives for Fable</button>
      <button id="s1n-download" type="button" class="btn" disabled>Download negatives-template.json</button>
    </div>
    <p id="s1n-export-status" class="text-small text-muted" aria-live="polite">Complete all ${items.length} messages to unlock export.</p>
  </section>

  <script type="application/json" id="s1n-review-data">${safeJson}</script>
  <script>
  (() => {
    const root = document.getElementById('sweep1-negative-review');
    const data = JSON.parse(document.getElementById('s1n-review-data').textContent);
    const items = data.items;
    const storageKey = 'sweep1-negatives:' + data.template.analysisRunId + ':' + data.sheetSha256;
    const fieldRules = {
      role_claim: ['role'],
      not_mafia_claim: [],
      investigation_claim: ['target', 'result', 'night'],
      protection_claim: ['target', 'night'],
      vote_commitment: ['target'],
      vote_stance: ['target', 'conditional'],
      vote_retraction: [],
      past_vote_claim: ['target', 'day'],
      past_vote_denial: ['target']
    };
    let state = { reviewed: {}, claims: {}, notes: {}, cursor: 0, history: [], rater: data.template.rater || 'Ryan' };
    let draftClaims = [];

    const byId = (id) => root.querySelector('#' + id);
    const els = {
      saveState: byId('s1n-save-state'), progress: byId('s1n-progress'), progressBar: byId('s1n-progress-bar'),
      position: byId('s1n-position'), reviewed: byId('s1n-reviewed'), left: byId('s1n-left'), item: byId('s1n-item'), meta: byId('s1n-meta'), message: byId('s1n-message'),
      existing: byId('s1n-existing'), claimList: byId('s1n-claim-list'), none: byId('s1n-none'), add: byId('s1n-add'), finish: byId('s1n-finish'),
      form: byId('s1n-form'), kind: byId('s1n-kind'), roleWrap: byId('s1n-role-wrap'), role: byId('s1n-role'), targetWrap: byId('s1n-target-wrap'), target: byId('s1n-target'),
      resultWrap: byId('s1n-result-wrap'), result: byId('s1n-result'), nightWrap: byId('s1n-night-wrap'), night: byId('s1n-night'), dayWrap: byId('s1n-day-wrap'), day: byId('s1n-day'),
      conditionalWrap: byId('s1n-conditional-wrap'), conditional: byId('s1n-conditional'), formError: byId('s1n-form-error'), saveClaim: byId('s1n-save-claim'), cancelClaim: byId('s1n-cancel-claim'), note: byId('s1n-note'),
      prev: byId('s1n-prev'), next: byId('s1n-next'), nextUnrated: byId('s1n-next-unrated'), undo: byId('s1n-undo'),
      rater: byId('s1n-rater'), copy: byId('s1n-copy'), download: byId('s1n-download'), exportStatus: byId('s1n-export-status')
    };

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && typeof saved === 'object') state = { ...state, ...saved };
    } catch (_) {}
    state.cursor = Math.max(0, Math.min(items.length - 1, Number(state.cursor) || 0));
    els.rater.value = state.rater || 'Ryan';

    function current() { return items[state.cursor]; }
    function persist(message = 'Progress saved locally') {
      state.rater = els.rater.value.trim();
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
        els.saveState.textContent = message;
      } catch (_) {
        els.saveState.textContent = 'Local saving unavailable — export before closing';
      }
    }
    function reviewedCount() { return Object.values(state.reviewed).filter(Boolean).length; }
    function nextUnreviewed(start = state.cursor + 1) {
      for (let offset = 0; offset < items.length; offset++) {
        const index = (start + offset) % items.length;
        if (!state.reviewed[items[index].id]) return index;
      }
      return Math.min(state.cursor + 1, items.length - 1);
    }
    function canonical(claim) {
      const fields = Object.entries(claim).filter(([key]) => key !== 'kind').map(([key, value]) => key + '=' + String(value));
      return claim.kind + (fields.length ? '(' + fields.join(', ') + ')' : '');
    }
    function renderClaimList() {
      els.claimList.replaceChildren();
      els.existing.hidden = draftClaims.length === 0;
      els.finish.hidden = draftClaims.length === 0;
      draftClaims.forEach((claim, index) => {
        const row = document.createElement('div');
        row.className = 'viz-row s1n-claim-row';
        const text = document.createElement('span');
        text.textContent = canonical(claim);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-ghost';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => { draftClaims.splice(index, 1); renderClaimList(); });
        row.append(text, remove);
        els.claimList.append(row);
      });
    }
    function render() {
      const item = current();
      const done = reviewedCount();
      const pct = Math.round((done / items.length) * 100);
      draftClaims = structuredClone(state.claims[item.id] || []);
      els.progress.setAttribute('aria-valuenow', String(done));
      els.progressBar.style.width = pct + '%';
      els.position.textContent = 'Message ' + (state.cursor + 1) + '/' + items.length;
      els.reviewed.textContent = done + '/' + items.length + ' reviewed';
      els.left.textContent = (items.length - done) + ' left';
      els.item.textContent = item.id;
      els.meta.textContent = item.sourceSheet.replace('.md', '') + ' · day ' + item.day + ' · speaker ' + item.speaker;
      els.message.textContent = item.message;
      els.note.value = state.notes[item.id] || '';
      els.none.setAttribute('aria-pressed', String(Boolean(state.reviewed[item.id]) && (state.claims[item.id] || []).length === 0));
      els.add.setAttribute('aria-pressed', String(Boolean(state.reviewed[item.id]) && (state.claims[item.id] || []).length > 0));
      els.form.hidden = true;
      renderClaimList();
      els.prev.disabled = state.cursor === 0;
      els.next.disabled = state.cursor === items.length - 1;
      els.undo.disabled = state.history.length === 0;
      const complete = done === items.length && els.rater.value.trim().length > 0;
      els.copy.disabled = !complete;
      els.download.disabled = !complete;
      els.exportStatus.textContent = complete
        ? 'All messages reviewed. Copy or download the ingest-ready file for Fable.'
        : 'Complete ' + (items.length - done) + ' more message' + (items.length - done === 1 ? '' : 's') + ' to unlock export.';
    }
    function commit(claims) {
      const item = current();
      state.history.push({ id: item.id, reviewed: Boolean(state.reviewed[item.id]), claims: structuredClone(state.claims[item.id] || []), note: state.notes[item.id] || '', cursor: state.cursor });
      state.reviewed[item.id] = true;
      state.claims[item.id] = structuredClone(claims);
      const note = els.note.value.trim();
      if (note) state.notes[item.id] = note;
      else delete state.notes[item.id];
      state.cursor = nextUnreviewed();
      persist();
      render();
    }
    function updateFields() {
      const fields = fieldRules[els.kind.value] || [];
      els.roleWrap.hidden = !fields.includes('role');
      els.targetWrap.hidden = !fields.includes('target');
      els.resultWrap.hidden = !fields.includes('result');
      els.nightWrap.hidden = !fields.includes('night');
      els.dayWrap.hidden = !fields.includes('day');
      els.conditionalWrap.hidden = !fields.includes('conditional');
      els.formError.textContent = '';
    }
    function openForm() {
      els.form.hidden = false;
      updateFields();
      els.kind.focus();
    }
    function buildClaim() {
      const kind = els.kind.value;
      const fields = fieldRules[kind] || [];
      const claim = { kind };
      if (fields.includes('role')) claim.role = els.role.value;
      if (fields.includes('target')) {
        if (!els.target.value.trim()) throw new Error('Target is required for this claim kind.')
        claim.target = els.target.value.trim();
      }
      if (fields.includes('result')) claim.result = els.result.value;
      if (fields.includes('night')) {
        const night = Number(els.night.value);
        if (!Number.isInteger(night) || night < 1) throw new Error('Claimed night must be 1 or greater.')
        claim.claimedNight = night;
      }
      if (fields.includes('day')) {
        const day = Number(els.day.value);
        if (!Number.isInteger(day) || day < 1) throw new Error('Referenced day must be 1 or greater.')
        claim.referencedDay = day;
      }
      if (fields.includes('conditional')) claim.conditional = els.conditional.value === 'true';
      return claim;
    }
    function exportObject() {
      const negativeClaims = {};
      for (const id of Object.keys(data.template.negativeClaims).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
        negativeClaims[id] = structuredClone(state.claims[id] || []);
      }
      const notes = {};
      for (const [id, note] of Object.entries(state.notes)) if (note.trim()) notes[id] = note.trim();
      return { ...data.template, rater: els.rater.value.trim(), answerKeyOpened: false, negativeClaims, notes };
    }
    async function copyExport() {
      const json = JSON.stringify(exportObject(), null, 2);
      try {
        await navigator.clipboard.writeText(json);
      } catch (_) {
        const area = document.createElement('textarea');
        area.value = json;
        root.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      els.exportStatus.textContent = 'Copied. Paste this directly into Fable’s chat.';
    }
    function downloadExport() {
      const blob = new Blob([JSON.stringify(exportObject(), null, 2) + '\\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'negatives-template.json';
      link.click();
      URL.revokeObjectURL(url);
      els.exportStatus.textContent = 'Downloaded negatives-template.json. Give that file to Fable.';
    }

    els.none.addEventListener('click', () => commit([]));
    els.add.addEventListener('click', openForm);
    els.finish.addEventListener('click', () => commit(draftClaims));
    els.kind.addEventListener('change', updateFields);
    els.saveClaim.addEventListener('click', () => {
      try {
        draftClaims.push(buildClaim());
        els.target.value = '';
        els.night.value = '';
        els.day.value = '';
        els.form.hidden = true;
        renderClaimList();
      } catch (error) {
        els.formError.textContent = error.message;
      }
    });
    els.cancelClaim.addEventListener('click', () => { els.form.hidden = true; els.formError.textContent = ''; });
    els.prev.addEventListener('click', () => { state.cursor = Math.max(0, state.cursor - 1); persist(); render(); });
    els.next.addEventListener('click', () => { state.cursor = Math.min(items.length - 1, state.cursor + 1); persist(); render(); });
    els.nextUnrated.addEventListener('click', () => { state.cursor = nextUnreviewed(); persist(); render(); });
    els.undo.addEventListener('click', () => {
      const prior = state.history.pop();
      if (!prior) return;
      if (prior.reviewed) state.reviewed[prior.id] = true;
      else delete state.reviewed[prior.id];
      state.claims[prior.id] = structuredClone(prior.claims);
      if (prior.note) state.notes[prior.id] = prior.note;
      else delete state.notes[prior.id];
      state.cursor = prior.cursor;
      persist('Last decision undone');
      render();
    });
    els.rater.addEventListener('input', () => { persist(); render(); });
    els.copy.addEventListener('click', copyExport);
    els.download.addEventListener('click', downloadExport);
    root.addEventListener('keydown', (event) => {
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (editing) {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !els.form.hidden) {
          event.preventDefault();
          els.saveClaim.click();
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'n' || key === '0') {
        event.preventDefault();
        commit([]);
      } else if (key === 'c' || key === '1') {
        event.preventDefault();
        openForm();
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
#sweep1-negative-review {
  color: var(--foreground);
  display: grid;
  gap: 1rem;
}
#sweep1-negative-review .s1n-heading-row,
#sweep1-negative-review .s1n-meta-row,
#sweep1-negative-review .s1n-counts,
#sweep1-negative-review .s1n-claim-row {
  justify-content: space-between;
}
#sweep1-negative-review h2,
#sweep1-negative-review h3,
#sweep1-negative-review p {
  margin-top: 0;
}
#sweep1-negative-review .s1n-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 1rem 0;
}
#sweep1-negative-review .s1n-decision-controls,
#sweep1-negative-review #s1n-form,
#sweep1-negative-review #s1n-existing {
  margin-top: 1rem;
}
#sweep1-negative-review .s1n-form-grid {
  align-items: end;
}
#sweep1-negative-review .s1n-claim-row {
  border-bottom: 1px solid var(--border);
  padding: 0.4rem 0;
}
#sweep1-negative-review #s1n-note {
  width: 100%;
  box-sizing: border-box;
}
#sweep1-negative-review .s1n-export {
  border-top: 1px solid var(--border);
  padding-top: 1rem;
}
#sweep1-negative-review kbd {
  font: inherit;
  color: var(--foreground);
}
</style>
`

writeFileSync(outPath, fragment)
console.log(JSON.stringify({
  out: outPath,
  sheets: sheetFiles,
  items: items.length,
  bytes: Buffer.byteLength(fragment),
  analysisRunId: template.analysisRunId,
  sheetSha256,
}, null, 2))
