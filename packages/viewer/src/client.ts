/**
 * The shared client renderer — one source of truth for how a game reads.
 *
 * Two pages compose from this module: the live observer (page.ts), which
 * polls a localhost API, and the static replay export (scripts/
 * export-replay.mjs), which embeds a finished log into a self-contained HTML
 * file. Both must render identically or the published replays stop being an
 * honest picture of the tool, so everything about *reading* a game lives
 * here and only the transport differs.
 *
 * STYLES is the full stylesheet; CORE_JS is the render core, exposed to glue
 * scripts as window.MafiaCore. The core references only elements both shells
 * provide (seats bar, feed, mode select, thoughts toggle, fold button) and
 * null-guards anything optional. No backticks and no template placeholders
 * appear inside either string, so they can be embedded anywhere.
 */

export const STYLES = `
  :root {
    --bg: #0e1014; --panel: #161a21; --panel2: #1c212b; --line: #262d3a;
    --text: #dde1e8; --dim: #8b93a3; --faint: #5a6172;
    --mafia: #e5484d; --doctor: #25b8a8; --detective: #6f9dff; --villager: #8b93a3;
    --live: #58d68d; --warn: #f5b04c; --night: #bb9af7; --vote: #6f9dff;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--text);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    height: 100vh; display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--line);
  }
  header h1 { font-size: 15px; font-weight: 650; margin-right: 6px; }
  header h1 .dice { margin-right: 6px; }
  select, button, input[type=text] {
    background: var(--panel2); color: var(--text); border: 1px solid var(--line);
    border-radius: 7px; padding: 6px 10px; font: inherit; font-size: 13px;
  }
  select:hover, button:hover { border-color: #39435a; }
  button { cursor: pointer; }
  button.primary { background: #2b3550; border-color: #3d4c74; }
  button.danger { background: #3a2226; border-color: #5c2f35; }
  .spacer { flex: 1; }
  .toggle { color: var(--dim); font-size: 12px; display: flex; gap: 5px; align-items: center; }
  .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--dim);
  }
  .badge.live { color: var(--live); border-color: #2c5e43; }
  .badge.err { color: var(--warn); border-color: #6b4a1e; }

  #seatsbar { background: var(--panel); border-bottom: 1px solid var(--line); }
  #reading {
    padding: 6px 14px 0; color: var(--faint); font-size: 11px;
    letter-spacing: .05em; text-transform: uppercase;
  }
  #reading b { color: var(--dim); }
  #seats { display: flex; gap: 8px; padding: 8px 14px 10px; overflow-x: auto; }
  .seat {
    min-width: 128px; padding: 8px 10px; border-radius: 9px;
    background: var(--panel2); border: 1px solid var(--line);
    transition: opacity .25s ease;
  }
  .seat.dead { opacity: 0.4; }
  .seat.selected { border-color: #4a5d8f; box-shadow: 0 0 0 1px #4a5d8f inset; }
  .seat .nm { font-weight: 650; }
  .seat .who { color: var(--faint); font-size: 11px; }
  .seat .model { color: var(--dim); font-size: 11px; margin-top: 2px; }
  .chip {
    display: inline-block; font-size: 10.5px; font-weight: 650; letter-spacing: .02em;
    padding: 1px 7px; border-radius: 999px; margin-top: 4px; color: #0d0f12;
  }
  .chip.mafia { background: var(--mafia); }
  .chip.doctor { background: var(--doctor); }
  .chip.detective { background: var(--detective); }
  .chip.villager { background: var(--villager); }
  .chip.hidden { background: transparent; color: var(--faint); border: 1px dashed var(--line); }

  #feed { flex: 1; overflow-y: auto; padding: 8px 18px 30px; }

  details.dayblock { margin: 10px 0 0; }
  details.dayblock > summary {
    cursor: pointer; list-style: none; user-select: none;
    display: flex; align-items: center; gap: 10px;
    margin: 14px 0 6px; color: var(--text); font-size: 13px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase;
  }
  details.dayblock > summary::-webkit-details-marker { display: none; }
  details.dayblock > summary::before {
    content: "\\25B8"; color: var(--faint); font-size: 11px; transition: transform .15s ease;
  }
  details.dayblock[open] > summary::before { transform: rotate(90deg); }
  details.dayblock > summary::after { content: ""; flex: 1; height: 1px; background: var(--line); }
  .sumx { display: none; color: var(--warn); font-weight: 600; text-transform: none; letter-spacing: 0; font-size: 12px; }
  details.dayblock:not([open]) .sumx { display: inline; }
  .sumn { color: var(--faint); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 12px; }

  .divider {
    margin: 16px 0 8px; color: var(--dim); font-size: 11.5px; font-weight: 650;
    letter-spacing: .06em; text-transform: uppercase;
    display: flex; align-items: center; gap: 10px;
  }
  .divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }

  .bubble {
    max-width: 760px; margin: 8px 0; padding: 8px 12px;
    background: var(--panel); border: 1px solid var(--line);
    border-left: 3px solid var(--line); border-radius: 9px;
  }
  .bubble .hd { font-size: 12px; color: var(--dim); margin-bottom: 3px; }
  .bubble .hd b { color: var(--text); }
  .bubble.mafiachat { background: #1d1518; border-left-color: var(--mafia); }
  .bubble .txt { white-space: pre-wrap; }

  .thought {
    max-width: 760px; margin: 10px 0 2px; padding: 7px 12px;
    color: var(--dim); font-style: italic; font-size: 13px;
    border-left: 3px dashed #3a4358; background: transparent;
    white-space: pre-wrap;
  }
  .thought .hd { font-style: normal; font-size: 11px; color: var(--faint); margin-bottom: 2px; }
  body.nothoughts .thought { display: none; }

  .evt { margin: 6px 0; color: var(--dim); font-size: 13px; }
  .evt.truth { color: var(--faint); }
  .evt.errline { color: var(--mafia); }

  .act {
    max-width: 760px; margin: 8px 0; padding: 7px 12px;
    display: flex; gap: 9px; align-items: baseline;
    background: var(--panel2); border: 1px solid var(--line);
    border-left: 3px solid var(--line); border-radius: 9px; font-size: 13.5px;
  }
  .act b { color: var(--text); }
  .act .ico { flex: 0 0 auto; }
  .act.night { border-left-color: var(--night); }
  .act.vote { border-left-color: var(--vote); }
  .act.invest { border-left-color: var(--doctor); }
  .act.tally { border-left-color: var(--vote); background: #1a2030; }
  .act.dawn { border-left-color: var(--faint); }

  .deathcard {
    max-width: 760px; margin: 12px 0; padding: 10px 14px;
    display: flex; gap: 10px; align-items: baseline;
    background: #231a10; border: 1px solid #6b4a1e; border-left: 4px solid var(--warn);
    border-radius: 9px; font-size: 15px; font-weight: 650; color: var(--warn);
  }
  .deathcard .why { color: var(--dim); font-weight: 400; font-size: 13px; }

  .spot { outline: 2px solid var(--warn); outline-offset: 3px; border-radius: 9px; }

  .banner {
    margin: 22px 0; padding: 14px 18px; border-radius: 10px; font-weight: 700;
    background: var(--panel2); border: 1px solid var(--line); font-size: 16px;
  }
  #empty { color: var(--faint); padding: 40px; text-align: center; }

  dialog {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 12px; padding: 20px; width: min(560px, 92vw);
  }
  dialog::backdrop { background: rgba(0,0,0,.55); }
  dialog h2 { font-size: 15px; margin-bottom: 12px; }
  .mgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin: 10px 0; }
  .mgrid label { display: flex; gap: 7px; align-items: center; font-size: 13px; }
  .mgrid label.off { color: var(--faint); }
  .mgrid .prov { color: var(--faint); font-size: 11px; margin-left: auto; }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
  .note { color: var(--dim); font-size: 12px; margin-top: 10px; }
  #stderr {
    background: #14161b; border-top: 1px solid var(--line); color: var(--warn);
    font: 11.5px/1.5 ui-monospace, monospace; padding: 6px 14px;
    max-height: 90px; overflow-y: auto; display: none; white-space: pre-wrap;
  }
`

export const CORE_JS = `
var MafiaCore = (function () {
  'use strict';
  var state = {
    file: null, events: [], lastSeq: -1, mode: 'omniscient',
    runs: [], renderedKey: '', readSeq: Infinity, folded: {}, allFolded: false
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- derived game state -------------------------------------------------

  function derive(events) {
    var d = { seats: [], names: {}, roles: {}, models: {}, winner: null, reason: null,
              deaths: [], endSeq: Infinity, marks: [], day: 1, phase: '' };
    events.forEach(function (e) {
      var p = e.payload || {};
      if (e.type === 'game_created' && p.seats) {
        d.seats = p.seats;
        p.seats.forEach(function (s) { d.names[s.id] = s.name; });
      }
      if (e.type === 'role_assigned') d.roles[p.seat] = p.role;
      if (e.type === 'seat_bound') d.models[p.seat] = p.modelKey;
      if (e.type === 'seat_died') d.deaths.push({ seq: e.seq, seat: p.seat, day: p.day, cause: p.cause, role: p.role });
      if (e.type === 'phase_changed') { d.day = p.day; d.phase = p.to; d.marks.push({ seq: e.seq, day: p.day, phase: p.to }); }
      if (e.type === 'game_ended') {
        d.endSeq = e.seq; d.winner = p.winner || null; d.reason = p.reason || 'win';
        (p.finalRoles || []).forEach(function (r) { d.roles[r.seat] = r.role; });
      }
    });
    return d;
  }

  function stateAt(d, seq) {
    var dead = {};
    d.deaths.forEach(function (x) { if (x.seq <= seq) dead[x.seat] = x; });
    var mark = null;
    d.marks.forEach(function (m) { if (m.seq <= seq) mark = m; });
    return { dead: dead, ended: d.endSeq <= seq, day: mark ? mark.day : 1, phase: mark ? mark.phase : 'night chat' };
  }

  function visibleTo(e, mode) {
    if (mode === 'omniscient') return true;
    if (e.visibility === 'public') return true;
    if (e.visibility === 'omniscient') {
      return mode !== 'public' && e.type === 'role_assigned' && e.payload && e.payload.seat === mode;
    }
    if (mode === 'public') return false;
    return (e.visibility.seats || []).indexOf(mode) >= 0;
  }

  function roleVisible(seatId, mode, d, at) {
    if (!d.roles[seatId]) return null;
    if (mode === 'omniscient') return d.roles[seatId];
    if (at.ended) return d.roles[seatId];
    if (at.dead[seatId] && at.dead[seatId].role) return at.dead[seatId].role;
    if (mode !== 'public') {
      if (seatId === mode) return d.roles[seatId];
      var intro = state.events.filter(function (e) {
        return e.type === 'mafia_introduced' && visibleTo(e, mode);
      })[0];
      if (intro && intro.visibility.seats && intro.visibility.seats.indexOf(mode) >= 0
          && intro.payload.fellowMafia && intro.payload.fellowMafia.indexOf(seatId) >= 0) {
        return 'mafia';
      }
    }
    return null;
  }

  // ---- rendering ----------------------------------------------------------

  var SEAT_HUES = ['#6f9dff', '#e0af68', '#9ece6a', '#f7768e', '#bb9af7', '#2ac3de', '#ff9e64',
                   '#7dcfff', '#e0c080', '#c3e88d', '#f78c6c'];
  function hueOf(seatId, d) {
    var i = d.seats.map(function (s) { return s.id; }).indexOf(seatId);
    return SEAT_HUES[(i >= 0 ? i : 0) % SEAT_HUES.length];
  }

  function renderSeats(d) {
    var seatsEl = $('seats');
    if (!seatsEl) return;
    var at = stateAt(d, state.readSeq);
    var html = '';
    d.seats.forEach(function (s) {
      var role = roleVisible(s.id, state.mode, d, at);
      var dead = at.dead[s.id];
      var cls = 'seat' + (dead ? ' dead' : '') + (state.mode === s.id ? ' selected' : '');
      html += '<div class="' + cls + '" data-seat="' + esc(s.id) + '" style="border-top:3px solid ' + hueOf(s.id, d) + '">'
        + '<div class="nm">' + esc(s.name) + (dead ? ' &#128128;' : '') + '</div>'
        + '<div class="who">' + esc(s.id) + '</div>';
      if (state.mode === 'omniscient' && d.models[s.id]) {
        html += '<div class="model">' + esc(d.models[s.id]) + '</div>';
      }
      html += role
        ? '<span class="chip ' + esc(role) + '">' + esc(role) + '</span>'
        : '<span class="chip hidden">?</span>';
      if (dead) {
        html += '<div class="who">' + (dead.cause === 'kill' ? 'killed night ' : 'executed day ') + dead.day + '</div>';
      }
      html += '</div>';
    });
    seatsEl.innerHTML = html;
    var readingEl = $('reading');
    if (readingEl) {
      var alive = d.seats.length - Object.keys(at.dead).length;
      readingEl.innerHTML = d.seats.length
        ? 'reading: <b>day ' + at.day + ' &middot; ' + esc(String(at.phase).replace('_', ' ')) + '</b>'
          + ' &middot; ' + alive + ' alive'
          + (at.ended ? ' &middot; game over' : '')
        : '';
    }
    Array.prototype.forEach.call(document.querySelectorAll('.seat'), function (el) {
      el.style.cursor = 'pointer';
      el.onclick = function () {
        var id = el.getAttribute('data-seat');
        setMode(state.mode === id ? 'omniscient' : id);
      };
    });
  }

  function line(e, cls, text) {
    return '<div class="evt ' + cls + '" data-seq="' + e.seq + '">' + text + '</div>';
  }
  function act(e, cls, ico, text) {
    return '<div class="act ' + cls + '" data-seq="' + e.seq + '"><span class="ico">' + ico + '</span><span>' + text + '</span></div>';
  }

  function renderEvent(e, d) {
    var p = e.payload || {};
    var nm = function (id) { return id ? esc(d.names[id] || id) : 'nobody'; };
    switch (e.type) {
      case 'game_created':
        return line(e, '', 'game <b>' + esc(e.roomId) + '</b> &middot; seed ' + esc(p.gameSeed || ''));
      case 'role_assigned':
        return line(e, 'truth', '&#127183; ' + nm(p.seat) + ' is dealt <b>' + esc(p.role) + '</b>');
      case 'mafia_introduced':
        return line(e, 'truth', '&#128374;&#65039; mafia know each other: ' + (p.fellowMafia || []).map(nm).join(', '));
      case 'phase_changed':
        return '<div class="divider" data-seq="' + e.seq + '">' + esc(String(p.to).replace('_', ' ')) + '</div>';
      case 'reasoning_recorded':
        return '<div class="thought" data-seq="' + e.seq + '"><div class="hd">' + nm(e.actor) + ' &middot; rationale (provider-exposed)</div>'
          + esc(p.text || '') + '</div>';
      case 'message_sent':
      case 'mafia_message_sent': {
        var mafiaCh = e.type === 'mafia_message_sent';
        return '<div class="bubble' + (mafiaCh ? ' mafiachat' : '') + '" data-seq="' + e.seq + '" style="border-left-color:' + hueOf(e.actor, d) + '">'
          + '<div class="hd"><b>' + nm(e.actor) + '</b>'
          + (mafiaCh ? ' &middot; mafia channel' : '')
          + (state.mode === 'omniscient' && d.roles[e.actor] ? ' &middot; ' + esc(d.roles[e.actor]) : '')
          + '</div><div class="txt">' + esc(p.text || '') + '</div></div>';
      }
      case 'passed':
        return line(e, '', nm(e.actor) + ' stays silent');
      case 'night_action_submitted': {
        var verb = p.action === 'no_action' ? 'takes <b>no action</b>'
          : p.action === 'night_kill' ? 'moves to <b>kill ' + nm(p.target) + '</b>'
          : p.action === 'night_protect' ? '<b>protects ' + nm(p.target) + '</b>'
          : '<b>investigates ' + nm(p.target) + '</b>';
        return act(e, 'night', '&#127769;', nm(p.seat) + ' ' + verb);
      }
      case 'investigation_result':
        return act(e, 'invest', '&#128269;', nm(e.actor) + ' learns ' + nm(p.target) + ' is <b>' + esc(p.result) + '</b>');
      case 'night_resolved':
        if (p.killed) return '';
        return act(e, 'dawn', '&#127749;', '<b>nobody died</b>'
          + (p.protected ? ' &mdash; a protection held' : ''));
      case 'vote_cast':
        return act(e, 'vote', '&#128499;&#65039;', nm(p.seat) + ' votes <b>' + (p.target ? nm(p.target) : 'abstain') + '</b>');
      case 'vote_tallied': {
        var parts = Object.keys(p.tally || {}).map(function (k) { return nm(k) + ': ' + p.tally[k]; });
        var outcome = p.executed ? nm(p.executed) + ' is executed' : (p.tie ? 'tie &mdash; nobody executed' : 'nobody executed');
        return act(e, 'tally', '&#9878;&#65039;', (parts.join(', ') || 'no votes')
          + (p.abstain ? ', ' + p.abstain + ' abstained' : '') + ' &rarr; <b>' + outcome + '</b>');
      }
      case 'seat_died':
        return '<div class="deathcard" data-seq="' + e.seq + '"><span>&#128128;</span><span>' + nm(p.seat)
          + (p.cause === 'kill' ? ' is dead &mdash; killed in the night' : ' is executed by the town')
          + (p.role ? ' <span class="why">&middot; they were <b>' + esc(p.role) + '</b></span>' : '')
          + '</span></div>';
      case 'timeout':
        return line(e, 'errline', '&#9201;&#65039; ' + nm(p.seat) + ' timed out &rarr; ' + esc(p.defaultApplied)
          + (p.error ? ' &mdash; ' + esc(p.error) : ''));
      case 'action_rejected':
        return line(e, 'errline', '&#9940; ' + nm(e.actor) + ' rejected: ' + esc(p.reason || ''));
      case 'game_ended':
        return '<div class="banner" data-seq="' + e.seq + '">' + (p.winner
          ? String(p.winner).toUpperCase() + ' WINS'
          : 'STALEMATE' + (p.cause ? ' &mdash; ' + esc(p.cause) : '')) + '</div>';
      default:
        return '';
    }
  }

  function renderFeed(d) {
    var feed = $('feed');
    if (!feed) return;
    var visible = state.events.filter(function (e) { return visibleTo(e, state.mode); });
    if (visible.length === 0) {
      feed.innerHTML = '<div id="empty">Nothing visible in this view yet.</div>';
      return;
    }
    Array.prototype.forEach.call(document.querySelectorAll('details.dayblock'), function (el) {
      state.folded[el.getAttribute('data-day')] = !el.open;
    });

    var byDay = {};
    var order = [];
    visible.forEach(function (e) {
      var k = String(e.day || 1);
      if (!byDay[k]) { byDay[k] = []; order.push(k); }
      byDay[k].push(e);
    });

    var html = '';
    order.forEach(function (k) {
      var evs = byDay[k];
      var deaths = d.deaths.filter(function (x) { return String(x.day) === k; });
      var deathNote = deaths.map(function (x) {
        return '&#128128; ' + esc(d.names[x.seat] || x.seat)
          + (x.cause === 'kill' ? ' killed' : ' executed')
          + (x.role ? ' (' + esc(x.role) + ')' : '');
      }).join(' &middot; ');
      var open = state.folded[k] ? '' : ' open';
      html += '<details class="dayblock" data-day="' + k + '"' + open + '>'
        + '<summary>day ' + k
        + ' <span class="sumn">' + evs.length + ' events</span>'
        + (deathNote ? ' <span class="sumx">' + deathNote + '</span>' : '')
        + '</summary>';
      evs.forEach(function (e) { html += renderEvent(e, d); });
      html += '</details>';
    });
    feed.innerHTML = html;
    var follow = $('follow');
    if (follow && follow.checked) feed.scrollTop = feed.scrollHeight;
    syncReading(d);
  }

  // ---- reading-position sync ---------------------------------------------

  var syncPending = false;
  function syncReading(d) {
    var feed = $('feed');
    if (!feed) return;
    var lineY = feed.getBoundingClientRect().top + feed.clientHeight * 0.6;
    var els = feed.querySelectorAll('[data-seq]');
    var seq = -1;
    for (var i = els.length - 1; i >= 0; i--) {
      var r = els[i].getBoundingClientRect();
      if (r.height > 0 && r.top < lineY) { seq = Number(els[i].getAttribute('data-seq')); break; }
    }
    if (seq === -1 && els.length) seq = Number(els[0].getAttribute('data-seq'));
    if (seq !== state.readSeq) {
      state.readSeq = seq;
      renderSeats(d);
    }
  }

  function renderAll() {
    var d = derive(state.events);
    var key = state.file + '|' + state.mode + '|' + state.lastSeq;
    if (key !== state.renderedKey) {
      state.renderedKey = key;
      renderFeed(d);
      rebuildModeOptions(d);
    }
    renderSeats(d);
    return d;
  }

  function rebuildModeOptions(d) {
    var sel = $('modeSel');
    if (!sel) return;
    var want = ['omniscient', 'public'].concat(d.seats.map(function (s) { return s.id; }));
    var have = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (want.join(',') !== have.join(',')) {
      sel.innerHTML = '';
      want.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v === 'omniscient' ? 'Omniscient view'
          : v === 'public' ? 'Public view'
          : (d.names[v] || v) + "'s view";
        sel.appendChild(o);
      });
      sel.value = state.mode;
    }
  }

  function setMode(mode) {
    state.mode = mode;
    state.renderedKey = '';
    var sel = $('modeSel');
    if (sel) sel.value = mode;
    renderAll();
  }

  // ---- shared control wiring ---------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var feed = $('feed');
    if (feed) feed.addEventListener('scroll', function () {
      if (syncPending) return;
      syncPending = true;
      requestAnimationFrame(function () {
        syncPending = false;
        syncReading(derive(state.events));
      });
    });
    var modeSel = $('modeSel');
    if (modeSel) modeSel.onchange = function () { setMode(this.value); };
    var thoughts = $('thoughts');
    if (thoughts) thoughts.onchange = function () {
      document.body.classList.toggle('nothoughts', !this.checked);
    };
    var foldBtn = $('foldBtn');
    if (foldBtn) foldBtn.onclick = function () {
      state.allFolded = !state.allFolded;
      var fold = state.allFolded;
      Array.prototype.forEach.call(document.querySelectorAll('details.dayblock'), function (el) {
        el.open = !fold;
        state.folded[el.getAttribute('data-day')] = fold;
      });
      this.textContent = fold ? 'Expand days' : 'Collapse days';
      syncReading(derive(state.events));
    };
  });

  return { state: state, derive: derive, renderAll: renderAll, setMode: setMode, esc: esc };
})();
`
