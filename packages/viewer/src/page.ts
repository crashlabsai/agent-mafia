import { CORE_JS, STYLES } from './client.ts'

/**
 * The live observer page, assembled from the shared client renderer.
 *
 * Everything about reading a game — seat cards, day sections, action cards,
 * visibility filtering, reading-position sync — lives in client.ts and is
 * shared verbatim with the static replay exporter. This file adds only what
 * being live requires: the run picker, polling, the new-game dialog, the
 * status badge, and the stop button.
 *
 * No backticks and no template placeholders inside the embedded script.
 */
export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-mafia observer</title>
<style>` + STYLES + `</style>
</head>
<body>
<header>
  <h1><span class="dice">&#127922;</span>agent-mafia</h1>
  <select id="runSel" title="pick a run"></select>
  <select id="modeSel" title="whose view">
    <option value="omniscient">Omniscient view</option>
    <option value="public">Public view</option>
  </select>
  <span id="status" class="badge">no run selected</span>
  <span class="spacer"></span>
  <label class="toggle"><input type="checkbox" id="thoughts" checked> thoughts</label>
  <button id="foldBtn" title="collapse or expand every day">Collapse days</button>
  <label class="toggle"><input type="checkbox" id="follow" checked> follow</label>
  <button id="stopBtn" class="danger" style="display:none">Stop run</button>
  <button id="newBtn" class="primary">New game</button>
</header>
<div id="seatsbar">
  <div id="reading"></div>
  <div id="seats"></div>
</div>
<div id="feed"><div id="empty">Pick a run, or start a new game.</div></div>
<div id="stderr"></div>

<dialog id="newDlg">
  <h2>Start a game</h2>
  <div class="row">
    <label><input type="radio" name="driver" value="agent" checked> agent seats</label>
    <label><input type="radio" name="driver" value="scripted"> scripted (free, instant)</label>
  </div>
  <div id="modelsWrap">
    <div class="note">Pick models; seats cycle through them in order. Grey ones have no credential.</div>
    <div class="mgrid" id="mgrid"></div>
  </div>
  <div class="row">
    <input type="text" id="seedInp" placeholder="seed (optional)" style="flex:1">
    <button id="goBtn" class="primary">Start</button>
    <button id="cancelBtn">Cancel</button>
  </div>
  <div class="note" id="dlgErr" style="color:var(--warn)"></div>
</dialog>

<script>` + CORE_JS + `
(function () {
  'use strict';
  var state = MafiaCore.state;
  var metaInfo = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return MafiaCore.esc(s); }
  function getJSON(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function render() {
    var d = MafiaCore.renderAll();
    var run = null;
    state.runs.forEach(function (r) { if (r.file === state.file) run = r; });
    var status = $('status');
    if (!state.file) { status.textContent = 'no run selected'; status.className = 'badge'; }
    else if (run && run.live) { status.innerHTML = '&#9679; live &middot; day ' + d.day + ' ' + esc(d.phase); status.className = 'badge live'; }
    else if (d.endSeq !== Infinity) { status.textContent = d.winner ? d.winner + ' won' : 'stalemate'; status.className = 'badge'; }
    else if (run && run.exitCode !== null && run.exitCode !== 0) { status.textContent = 'exited ' + run.exitCode; status.className = 'badge err'; }
    else { status.textContent = state.events.length + ' events'; status.className = 'badge'; }
    $('stopBtn').style.display = run && run.live ? '' : 'none';
    var errBox = $('stderr');
    if (run && run.stderrTail && run.stderrTail.length) {
      errBox.style.display = 'block';
      errBox.textContent = run.stderrTail.join('\\n');
    } else {
      errBox.style.display = 'none';
    }
  }

  // ---- polling ------------------------------------------------------------

  function pickRun(file) {
    state.file = file; state.events = []; state.lastSeq = -1; state.renderedKey = '';
    state.folded = {}; state.readSeq = Infinity;
    $('runSel').value = file;
    pollLog();
  }

  function pollLog() {
    if (!state.file) return;
    getJSON('/api/log?file=' + encodeURIComponent(state.file) + '&after=' + state.lastSeq)
      .then(function (r) {
        if (r.events && r.events.length) {
          state.events = state.events.concat(r.events);
          state.lastSeq = state.events[state.events.length - 1].seq;
        }
        render();
      })
      .catch(function () { /* transient; next tick retries */ });
  }

  function pollRuns() {
    getJSON('/api/runs').then(function (runs) {
      state.runs = runs;
      var sel = $('runSel');
      var have = Array.prototype.map.call(sel.options, function (o) { return o.value; }).join(',');
      var want = runs.map(function (r) { return r.file; }).join(',');
      if (have !== want) {
        sel.innerHTML = '';
        runs.forEach(function (r) {
          var o = document.createElement('option');
          o.value = r.file;
          o.textContent = (r.live ? '\\u25cf ' : '') + r.file;
          sel.appendChild(o);
        });
        if (state.file) sel.value = state.file;
        else if (runs.length) pickRun(runs[0].file);
      } else {
        Array.prototype.forEach.call(sel.options, function (o) {
          var r = null;
          runs.forEach(function (x) { if (x.file === o.value) r = x; });
          if (r) o.textContent = (r.live ? '\\u25cf ' : '') + r.file;
        });
      }
      render();
    }).catch(function () {});
  }

  // ---- new game dialog ----------------------------------------------------

  function openDialog() {
    getJSON('/api/meta').then(function (m) {
      metaInfo = m;
      void metaInfo;
      var grid = $('mgrid');
      grid.innerHTML = '';
      m.models.forEach(function (mod) {
        var lab = document.createElement('label');
        lab.className = mod.reachable ? '' : 'off';
        var cb = document.createElement('input');
        cb.type = 'checkbox'; cb.value = mod.key; cb.disabled = !mod.reachable;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + mod.label));
        var prov = document.createElement('span');
        prov.className = 'prov';
        prov.textContent = mod.provider + (mod.reasoning !== 'visible' ? ' \\u00b7 ' + mod.reasoning : '');
        lab.appendChild(prov);
        grid.appendChild(lab);
      });
      $('dlgErr').textContent = '';
      $('newDlg').showModal();
    });
  }

  function startGame() {
    var driver = document.querySelector('input[name=driver]:checked').value;
    var models = Array.prototype.filter.call(document.querySelectorAll('#mgrid input:checked'), function () { return true; })
      .map(function (cb) { return cb.value; });
    var body = { driver: driver, models: models, seed: $('seedInp').value.trim() || undefined };
    postJSON('/api/run', body).then(function (r) {
      if (!r.ok) { $('dlgErr').textContent = r.body.error || 'failed'; return; }
      $('newDlg').close();
      pollRuns();
      setTimeout(function () { pickRun(r.body.file); }, 400);
    });
  }

  // ---- wiring -------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    $('runSel').onchange = function () { pickRun(this.value); };
    $('newBtn').onclick = openDialog;
    $('cancelBtn').onclick = function () { $('newDlg').close(); };
    $('goBtn').onclick = startGame;
    $('stopBtn').onclick = function () {
      if (state.file) postJSON('/api/stop', { file: state.file }).then(pollRuns);
    };
    document.querySelectorAll('input[name=driver]').forEach(function (r) {
      r.onchange = function () {
        $('modelsWrap').style.display = this.value === 'agent' ? '' : 'none';
      };
    });
    pollRuns();
    setInterval(pollLog, 1500);
    setInterval(pollRuns, 5000);
  });
})();
</script>
</body>
</html>`
