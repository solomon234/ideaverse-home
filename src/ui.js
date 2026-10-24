'use strict';
// The dashboard view. Plain DOM, no framework. mount(root, api) returns { update(data), destroy() }.
//   api.open(path)                       open a note
//   api.setProposalStatus(path, status)  rewrite a proposal's status line; resolves to the previous status
//   api.claudeRun(kind, payload)         kind 'ask' | 'triage' | 'log'; resolves to { ok, text, error, mode, draft, cancelled }
//   api.claudeCancel()                   stop a background run
//   api.appendLog(text)                  add a drafted log entry to the day's log; resolves to true if it did
//   api.completeLever(ref)               tick off the lever's source item; resolves to true if it did
//   api.addTodo(target, text)            add a todo to effort.todoTarget; resolves to true if it did
//   api.capture(text)                    append to today's scratch note; resolves to true if it did
//   api.createEffort(name)               create Efforts/<name>/README.md; resolves to the folder, or '' if not created
//   api.logMeeting({date,title,with,outcome,open})  append to that month's log; resolves to true if it did
//   api.archiveEffort(folder)            move an effort folder into Efforts/Archived; resolves to true if it moved
//   api.restoreEffort(folder)            move it back out
// All class names are prefixed iv- and styled under .ideaverse-root.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HUES = [212, 28, 160, 340, 270, 190, 50];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = n => '$' + Math.round(n).toLocaleString('en-US');
const fmtIso = iso => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : ''; };

/* ---------- pictures made from an effort's own data ---------- */
const art = {
  kanban(a) {
    const cards = a.cards.slice().sort((x, y) => x.d - y.d), done = cards.filter(c => c.d).length, open = cards.length - done;
    const cols = cards.length <= 42 ? 7 : cards.length <= 90 ? 10 : 14;
    return `<h2 class="iv-h">Board · ${cards.length} items</h2>
      <div class="iv-grid" style="grid-template-columns:repeat(${cols},1fr)" role="group" aria-label="Board items">${cards.map(c =>
        `<button class="iv-cell ${c.d ? '' : 'open'}" data-board="${esc(a.path)}" data-t="${esc(c.t)}" data-s="${c.d ? 'Done' : 'Open'}" aria-label="${c.d ? 'Done' : 'Open'}: ${esc(c.t)}"></button>`).join('')}</div>
      <div class="iv-key"><span><i class="o"></i>${open} open</span><span><i></i>${done} done</span></div>
      <p class="iv-cap" aria-live="polite">Hover or focus a square to read the item. Click to open the board.</p>`;
  },
  services(a) {
    const cx = 250, cy = 210, R = 150;
    const pts = a.nodes.map((n, i) => { const t = -Math.PI / 2 + i * 2 * Math.PI / a.nodes.length; return { n, x: cx + R * Math.cos(t), y: cy + R * Math.sin(t), c: Math.cos(t) }; });
    return `<h2 class="iv-h">What runs on the ${esc(a.hub)}</h2>
      <svg class="iv-svc" viewBox="0 0 500 440" role="img" aria-label="${esc(a.hub)} at the centre with ${a.nodes.length} services around it.${a.risk ? ' ' + esc(a.risk) + ' is flagged.' : ''}">
        ${a.base ? `<rect x="120" y="394" width="260" height="30" rx="15" class="iv-base"/><text x="250" y="414" text-anchor="middle">${esc(a.base)}</text>` : ''}
        ${pts.map(p => `<line class="iv-line" x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}"/>`).join('')}
        <circle class="iv-hub" cx="${cx}" cy="${cy}" r="40"/><text x="${cx}" y="${cy + 5}" text-anchor="middle" class="iv-hubt">${esc(a.hub)}</text>
        ${pts.map(p => { const r = p.n === a.risk; return `${r ? `<circle class="iv-pulse" cx="${p.x}" cy="${p.y}" r="9"/>` : ''}<circle class="${r ? 'iv-risk' : 'iv-node'}" cx="${p.x}" cy="${p.y}" r="9"/><text x="${p.x + (p.c > .2 ? 15 : p.c < -.2 ? -15 : 0)}" y="${p.y + (Math.abs(p.c) <= .2 ? (p.y < cy ? -16 : 26) : 5)}" text-anchor="${p.c > .2 ? 'start' : p.c < -.2 ? 'end' : 'middle'}">${esc(p.n)}</text>`; }).join('')}
      </svg>${a.risk ? `<p class="iv-cap"><b class="iv-warn">${esc(a.risk)}.</b> ${esc(a.riskNote || '')}</p>` : ''}`;
  },
  pipeline(a) {
    let marked = false;
    const groups = a.groups.slice(0, 3).map(g => {
      const shown = g.items.slice(0, 4);
      return `<h3 class="iv-gh">${esc(g.title)}</h3><ol class="iv-pipe">${shown.map(it => {
        const now = !marked && !it.c; if (now) marked = true;
        return `<li class="${it.c ? 'done' : now ? 'now' : 'todo'}"><i>${it.c ? '✓' : ''}</i><span>${esc(it.t)}${now ? '<em>NEXT</em>' : ''}</span></li>`;
      }).join('')}</ol>${g.items.length > 4 ? `<p class="iv-more">+${g.items.length - 4} more in the note</p>` : ''}`;
    }).join('');
    return `<h2 class="iv-h">Todo list</h2>${groups}`;
  },
  prices(a) {
    const [lo, hi] = a.axis, W = 440, x = v => 20 + (v - lo) / (hi - lo) * W;
    const ticks = []; for (let t = Math.ceil(lo / 5000) * 5000; t <= hi; t += 5000) ticks.push(t);
    const b = a.budget;
    const pts = a.listings.map((l, i) => { const up = i % 2 === 0; return `<g class="iv-pt"><line x1="${x(l.p)}" y1="${up ? 60 : 104}" x2="${x(l.p)}" y2="${up ? 91 : 136}" stroke="#fff"/><circle cx="${x(l.p)}" cy="91" r="5" fill="#fff"/>
        <text x="${Math.min(x(l.p), 420)}" y="${up ? 34 : 154}" text-anchor="${x(l.p) > 380 ? 'end' : 'middle'}">${esc(l.t)} · ${usd(l.p)}</text>${l.m ? `<text x="${Math.min(x(l.p), 420)}" y="${up ? 48 : 168}" text-anchor="${x(l.p) > 380 ? 'end' : 'middle'}" class="iv-dim">${esc(l.m)}</text>` : ''}</g>`; }).join('');
    const meter = a.goal && a.saved != null ? `<div class="iv-meter" role="img" aria-label="Saved ${usd(a.saved)} of ${usd(a.goal)}"><i style="width:${Math.min(100, a.saved / a.goal * 100)}%"></i></div><p class="iv-cap"><b>${usd(a.saved)} of ${usd(a.goal)}</b> saved. ${a.pulled ? `Listings pulled ${fmtIso(a.pulled)}; they may be stale.` : ''}</p>` : '';
    return `<h2 class="iv-h">Listings against budget</h2>
      <svg class="iv-axis" viewBox="0 0 480 190" role="img" aria-label="Price axis ${usd(lo)} to ${usd(hi)}.${b ? ' Budget ' + usd(b[0]) + ' to ' + usd(b[1]) + '.' : ''}">
        ${b ? `<rect class="iv-band" x="${x(b[0])}" y="78" width="${x(b[1]) - x(b[0])}" height="26" rx="6"/><text x="${(x(b[0]) + x(b[1])) / 2}" y="96" text-anchor="middle" class="iv-bt">Budget ${usd(b[0] / 1000)}k–${usd(b[1] / 1000)}k</text>` : ''}
        <line x1="20" y1="91" x2="${20 + W}" y2="91" stroke="rgba(255,255,255,.3)"/>
        ${ticks.map(t => `<text x="${x(t)}" y="124" text-anchor="middle" class="iv-dim">$${t / 1000}k</text>`).join('')}${pts}</svg>${meter}`;
  },
  ladder(a) {
    return `<h2 class="iv-h">Steps</h2><ol class="iv-ladder">${a.steps.map((s, i) => `<li class="${i + 1 === a.gate ? 'gate' : ''} ${s.c ? 'done' : ''}">${esc(s.t)}</li>`).join('')}</ol>${a.note ? `<p class="iv-gatenote"><span aria-hidden="true">▲</span>${esc(a.note)}</p>` : ''}`;
  },
  outline(a) {
    return `<h2 class="iv-h">In this note</h2><ol class="iv-ladder">${a.headings.map(h => `<li>${esc(h)}</li>`).join('')}</ol><p class="iv-cap">No checklist, board or table to draw from yet.</p>`;
  }
};

function mount(root, api) {
  const doc = root.ownerDocument;
  let data = null, claude = { title: '', status: 'idle', text: '', draft: false, id: 0 }, cur = 0, win = null, trayRows = [], pal = { open: false, sel: 0, items: [] }, needsOpen = false;

  root.classList.add('ideaverse-root');
  root.setAttribute('tabindex', '-1');
  root.innerHTML = `
    <header class="iv-status">
      <span class="iv-mark">Ideaverse</span>
      <div class="iv-needs-wrap"><button class="iv-chip" data-needs aria-expanded="false"><b class="hot" data-n="needs"></b> need you</button><ul class="iv-needs" hidden></ul></div>
      <button class="iv-chip" data-tray><b data-n="tray"></b> proposals to decide</button>
      <button class="iv-chip" data-recent>Last session <span data-n="last"></span></button>
      <span class="iv-sp"></span>
      <button class="iv-chip" data-new-effort>+ Effort</button>
      <button class="iv-chip" data-meeting>+ Meeting</button>
      <button class="iv-chip" data-capture>+ Capture</button>
      <button class="iv-chip k" data-pal aria-label="Open the command bar">Jump <kbd data-n="kbd">⌘K</kbd></button>
      <span class="iv-clock" data-n="clock"></span>
    </header>
    <main class="iv-stage"><div class="iv-track"></div></main>
    <button class="iv-nav iv-glass prev" aria-label="Previous effort"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg></button>
    <button class="iv-nav iv-glass next" aria-label="Next effort"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg></button>
    <div class="iv-dots" role="group" aria-label="Choose effort"></div>
    <div class="iv-layer" hidden><section class="iv-win iv-glass" role="dialog" aria-modal="true"></section></div>
    <div class="iv-dockwrap"><nav class="iv-dock iv-glass" aria-label="Vault">
      <button class="iv-d" data-view="efforts" aria-pressed="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/></svg><span>Efforts</span></button>
      <button class="iv-d" data-view="atlas" aria-pressed="false"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 3"/></svg><span>Atlas</span></button>
      <button class="iv-d" data-view="calendar" aria-pressed="false"><span class="iv-num" data-n="dnum"></span><span>Calendar</span></button>
      <button class="iv-d" data-view="aios" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span>AIOS</span><i class="iv-badge" data-n="badge"></i></button>
      <button class="iv-d" data-view="recent" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg><span>Recently</span></button>
    </nav></div>
    <div class="iv-pal" hidden><div class="iv-box iv-glass" role="dialog" aria-modal="true" aria-label="Command bar"><input class="iv-pin" placeholder="Jump to an effort or a view" aria-label="Jump to" autocomplete="off"><ul class="iv-plist" role="listbox"></ul></div></div>`;

  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const track = $('.iv-track'), layer = $('.iv-layer'), winEl = $('.iv-win'), needsBtn = $('[data-needs]'), needsUl = $('.iv-needs'), palEl = $('.iv-pal'), pin = $('.iv-pin'), plist = $('.iv-plist');
  const setN = (k, v) => $$(`[data-n="${k}"]`).forEach(e => { e.textContent = v; });

  /* ---------- effort slides ---------- */
  function renderSlides() {
    const N = data.efforts.length;
    if (!N) { track.innerHTML = `<section class="iv-slide"><div><h1>No efforts found</h1><p class="iv-sum">Looked in ${esc(data.root || 'the vault root')}/Efforts for folders with a README.md. Check the root folder in the plugin settings.</p><button class="iv-btn p" data-new-effort>New effort</button></div></section>`; return; }
    track.innerHTML = data.efforts.map((e, i) => {
      const old = e.daysAgo > data.staleDays, max = Math.max(...e.weeks, 1);
      const bars = e.weeks.map((w, k) => { const h = w ? 4 + Math.sqrt(w / max) * 26 : 2; return `<rect class="${w ? '' : 'z'}" x="${k * 11}" y="${32 - h}" width="8" height="${h}" rx="2"/>`; }).join('');
      const age = e.daysAgo <= 0 ? 'today' : e.daysAgo === 1 ? 'yesterday' : e.daysAgo + ' days ago';
      return `<section class="iv-slide ${old ? 'stale' : ''}" style="--h:${HUES[i % HUES.length]}" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${N}: ${esc(e.name)}" ${i === cur ? '' : 'inert'}>
        <div class="iv-copy"><div class="iv-eyebrow"><span class="iv-st ${e.tone}">${esc(e.status)}</span><span>${i + 1} of ${N}</span><span class="iv-age ${old ? 'old' : ''}">Changed ${age} · ${fmtIso(e.last)}</span></div>
          <h1 ${e.name.length > 16 ? 'style="font-size:clamp(30px,4vw,60px)"' : ''}>${esc(e.name)}</h1>
          ${e.lever ? `<div class="iv-lever iv-glass"><small>The lever</small><p>${esc(e.lever)}</p>${e.leverRef ? `<button class="iv-btn" data-lever="${i}">Mark done</button>` : ''}</div>` : ''}
          <form class="iv-add" data-form="todo" data-i="${i}"><input name="text" aria-label="Add a todo to ${esc(e.name)}" placeholder="Add a todo…" autocomplete="off" maxlength="200"><button class="iv-btn" type="submit">Add</button><small>Goes to ${esc(e.todoTarget.label)}.</small></form>
          ${data.claudeMode && data.claudeMode !== 'off' ? `<form class="iv-add" data-form="ask" data-i="${i}"><input name="q" aria-label="Ask Claude about ${esc(e.name)}" placeholder="Ask Claude about this effort…" autocomplete="off" maxlength="300"><button class="iv-btn" type="submit">Ask</button></form>` : ''}
          <div class="iv-spark"><svg width="154" height="34" viewBox="0 0 154 34" role="img" aria-label="Changes per week, last ${e.weeks.length} weeks: ${e.weeks.join(', ')}">${bars}</svg><small>Weeks with changes, last ${e.weeks.length}. From git history of this folder.</small></div>
          <details><summary>About this effort</summary>${e.summary ? `<p>${esc(e.summary)}</p>` : ''}${e.facts.length ? `<ul class="iv-facts">${e.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
            <div class="iv-links"><button class="iv-btn" data-open="${esc(e.path)}">Open README</button>${e.boardPath ? `<button class="iv-btn" data-open="${esc(e.boardPath)}">Open board</button>` : ''}<button class="iv-btn" data-archive="${esc(e.folder)}">Archive effort</button></div></details></div>
        <div class="iv-art iv-glass">${art[e.art.kind](e.art)}</div></section>`;
    }).join('');
    $('.iv-dots').innerHTML = data.efforts.map((e, i) => `<button aria-label="${esc(e.short)}" data-i="${i}"><i></i></button>`).join('');
    go(cur, true);
  }

  function go(i, instant) {
    const N = data.efforts.length; if (!N) return;
    cur = ((i % N) + N) % N;
    if (instant) { track.style.transition = 'none'; }
    track.style.transform = `translateX(${-cur * 100}%)`;
    if (instant) { void track.offsetWidth; track.style.transition = ''; }
    $$('.iv-slide').forEach((s, k) => k === cur ? s.removeAttribute('inert') : s.setAttribute('inert', ''));
    $$('.iv-dots button').forEach((b, k) => b.setAttribute('aria-current', k === cur));
  }

  /* ---------- status line, needs panel ---------- */
  function renderStatus() {
    setN('needs', data.needs.length); setN('tray', data.layers.aios.toDecide); setN('badge', data.layers.aios.toDecide || '');
    setN('last', data.sessions[0] ? data.sessions[0].date : 'none');
    needsUl.innerHTML = data.needs.length ? data.needs.map((n, i) => `<li data-i="${i}" tabindex="0"><b>${esc(n.title)}</b><span>${esc(n.why)}</span>${n.effort ? `<em>${esc(n.effort)}</em>` : ''}</li>`).join('') : '<li><b>Nothing open.</b><span>No unchecked Immediate todos or open items in the log.</span></li>';
  }
  function setNeeds(o) { needsOpen = o; needsUl.hidden = !o; needsBtn.setAttribute('aria-expanded', o); }

  /* ---------- windows ---------- */
  const rowPending = (r, i) => `<li class="iv-prop" data-i="${i}"><span class="t"><span class="iv-tag ${esc(r.status)}">${esc(r.status)}</span>${esc(r.topic)}</span><span class="to">→ ${esc(r.to || 'no destination set')}${r.session ? ' · ' + esc(fmtIso(r.session)) : ''}</span><span class="act"><button class="iv-btn" data-open="${esc(r.path)}">Open</button><button class="iv-btn p" data-act="promoted">Mark promoted</button><button class="iv-btn" data-act="dismissed">Dismiss</button></span></li>`;
  const rowMarked = (r, i) => `<li class="iv-prop done" data-i="${i}"><span class="t">Marked ${esc(r.marked)}: ${esc(r.topic)}</span><span class="to">Status line in the proposal now reads ${esc(r.marked)}.</span><span class="act"><button class="iv-btn" data-undo>Undo</button></span></li>`;
  const views = {
    atlas: () => { const L = data.layers.atlas; return ['Atlas', `<div class="iv-void"><b>${L.count}</b>${L.count === 1 ? 'note' : 'notes'} filed in Atlas.</div>${L.waiting.length ? `<ul class="iv-rows">${L.waiting.map(p => `<li class="iv-prop"><span class="t"><span class="iv-tag ${esc(p.status)}">${esc(p.status)}</span>${esc(p.topic)}</span><span class="to">→ ${esc(p.to)}</span><span class="act"><button class="iv-btn" data-open="${esc(p.path)}">Open</button></span></li>`).join('')}</ul><p class="iv-note">Proposals waiting to become notes in Atlas.</p>` : ''}`]; },
    calendar: () => { const L = data.layers.calendar; return ['Calendar', L.recent.length ? `<ul class="iv-rows">${L.recent.map(c => `<li><button class="iv-link" data-open="${esc(c.path)}"><time>${esc(c.date)}</time></button></li>`).join('')}</ul><p class="iv-note">${L.count} daily note${L.count === 1 ? '' : 's'} in the vault.</p>` : '<div class="iv-void"><b>0</b>daily notes yet.</div>']; },
    aios: () => ['AIOS · proposals tray', trayRows.length ? `<ul class="iv-rows">${trayRows.map((r, i) => r.marked ? rowMarked(r, i) : rowPending(r, i)).join('')}</ul>${data.claudeMode && data.claudeMode !== 'off' ? '<div class="act"><button class="iv-btn" data-claude-triage>Ask Claude to triage these</button></div>' : ''}<p class="iv-note">${data.proposals.counts.pending} pending and ${data.proposals.counts.draft} draft of ${data.proposals.files} files in Proposals. Marking a proposal edits only its status line; moving its content into the vault is still yours to do.</p>` : '<div class="iv-void"><b>0</b>proposals need a decision.</div>'],
    newEffort: () => ['New effort', `<form class="iv-form" data-form="effort"><label>Name<input name="name" autocomplete="off" required maxlength="80"></label><p class="iv-note">Creates Efforts/&lt;name&gt;/README.md with a status line, an overview and a Todo List with one Immediate item.</p><p class="iv-err" role="alert" hidden></p><div class="act"><button class="iv-btn p" type="submit">Create effort</button></div></form>`],
    meeting: () => ['Log a meeting', `<form class="iv-form" data-form="meeting"><label>Title<input name="title" autocomplete="off" required maxlength="120"></label><label>Date<input name="date" type="date" value="${esc(data.today)}" required></label><label>With<input name="with" autocomplete="off" placeholder="Names, separated by commas"></label><label>Outcome<textarea name="outcome" rows="3" placeholder="What was decided or learned"></textarea></label><label>Open items<input name="open" autocomplete="off" placeholder="Separate with semicolons; they show up under Needs you"></label><p class="iv-note">Adds an entry to the end of that month's log in AIOS/Logs. Earlier entries are not touched.</p><p class="iv-err" role="alert" hidden></p><div class="act"><button class="iv-btn p" type="submit">Add to log</button></div></form>`],
    capture: () => ['Capture to scratch', `<form class="iv-form" data-form="capture"><label>Note<textarea name="text" rows="4" required placeholder="A thought, a link, something to sort out later"></textarea></label><p class="iv-note">Adds a timestamped line to today's note in AIOS/Scratch (created if needed).</p><p class="iv-err" role="alert" hidden></p><div class="act"><button class="iv-btn p" type="submit">Capture</button></div></form>`],
    claude: () => [claude.title, claude.status === 'running'
      ? `<div class="iv-void"><b>…</b>Claude is reading your notes. This can take up to a minute.</div><div class="act"><button class="iv-btn" data-claude-cancel>Cancel</button></div>`
      : claude.status === 'error' ? `<div class="iv-void">${esc(claude.text)}</div>`
      : `<pre class="iv-answer">${esc(claude.text)}</pre>${claude.draft ? `<div class="act"><button class="iv-btn p" data-claude-log>Add to today's log</button></div><p class="iv-note">Nothing is written until you press the button. Edit the entry afterwards in the log note if needed.</p>` : ''}${claude.mode === 'background' ? '<p class="iv-note">Read-only run: Claude could read notes but not change them.</p>' : ''}`],
    archived: () => ['Archived efforts', (data.archived || []).length ? `<ul class="iv-rows">${data.archived.map(a => `<li class="iv-prop"><span class="t">${esc(a.name)}</span><span class="to">${esc(a.folder)} · last changed ${esc(fmtIso(a.last))}</span><span class="act"><button class="iv-btn" data-open="${esc(a.path)}">Open</button><button class="iv-btn p" data-restore="${esc(a.folder)}">Restore</button></span></li>`).join('')}</ul><p class="iv-note">Restore moves the folder back to Efforts.</p>` : '<div class="iv-void"><b>0</b>archived efforts.</div>'],
    recent: () => ['Recently', `${data.claudeMode && data.claudeMode !== 'off' ? '<div class="act" style="margin-bottom:10px"><button class="iv-btn" data-claude-log-draft>Draft today\'s log entry</button></div>' : ''}<ul class="iv-rows">${data.sessions.map(s => `<li><button class="iv-link" data-open="${esc(s.path)}"><time>${esc(s.date)}</time><b>${esc(s.title)}</b></button></li>`).join('')}</ul>`]
  };
  function startClaude(kind, payload, title) {
    const id = ++claude.id;
    claude = { id, title, status: 'running', text: '', draft: false, mode: '' };
    showView('claude');
    api.claudeRun(kind, payload).then(r => {
      if (claude.id !== id) return;
      claude = { id, title, status: r.ok ? 'done' : 'error', text: r.ok ? r.text : (r.error || 'Failed.'), draft: !!(r.ok && r.draft), mode: r.mode };
      if (r.cancelled) { if (win === 'claude') showView('efforts'); return; }
      if (win === 'claude') showView('claude');
    });
  }
  function showView(key, from) {
    $$('.iv-d').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === key));
    if (key === 'efforts') { win = null; layer.hidden = true; if (from !== 'silent') root.focus(); return; }
    if (key === 'aios' && win !== 'aios') trayRows = data.proposals.tray.map(p => Object.assign({}, p, { marked: '' }));
    win = key; const [title, body] = views[key]();
    winEl.innerHTML = `<header><h2>${esc(title)}</h2><button class="iv-x" aria-label="Close">×</button></header><div class="iv-body">${body}</div>`;
    layer.hidden = false; (winEl.querySelector('.iv-form input') || winEl.querySelector('.iv-x')).focus();
  }

  /* ---------- command bar ---------- */
  function palItems() {
    const q = pin.value.trim().toLowerCase();
    const all = [...data.efforts.map((e, i) => ({ t: e.name, k: 'effort', run: () => { showView('efforts'); go(i); } })),
      { t: 'Atlas', k: 'view', run: () => showView('atlas') }, { t: 'Calendar', k: 'view', run: () => showView('calendar') },
      { t: 'Proposals tray', k: 'AIOS', run: () => showView('aios') }, { t: 'Recently', k: 'view', run: () => showView('recent') },
      { t: `Archived efforts (${(data.archived || []).length})`, k: 'view', run: () => showView('archived') },
      { t: 'New effort…', k: 'create', run: () => showView('newEffort') }, { t: 'Log a meeting…', k: 'log', run: () => showView('meeting') }, { t: 'Capture to scratch…', k: 'log', run: () => showView('capture') },
      ...(data.claudeMode && data.claudeMode !== 'off' ? [{ t: 'Claude: triage proposals', k: 'claude', run: () => startClaude('triage', { paths: data.proposals.tray.map(p => p.path) }, 'Proposal triage') }, { t: "Claude: draft today's log entry", k: 'claude', run: () => startClaude('log', {}, "Draft log entry") }] : []),
      { t: 'Needs you', k: 'list', run: () => { showView('efforts'); setNeeds(true); } }];
    return all.filter(c => c.t.toLowerCase().includes(q));
  }
  function renderPal() {
    pal.items = palItems(); pal.sel = Math.min(pal.sel, Math.max(pal.items.length - 1, 0));
    plist.innerHTML = pal.items.map((c, i) => `<li role="option" aria-selected="${i === pal.sel}" data-i="${i}">${esc(c.t)}<span>${esc(c.k)}</span></li>`).join('') || '<li>No match</li>';
  }
  const openPal = () => { pal.open = true; palEl.hidden = false; pin.value = ''; pal.sel = 0; renderPal(); pin.focus(); };
  const closePal = () => { pal.open = false; palEl.hidden = true; root.focus(); };

  /* ---------- events ---------- */
  const on = (el, ev, fn) => el.addEventListener(ev, fn);
  on(root, 'click', ev => {
    const t = ev.target;
    const o = t.closest('[data-open]'); if (o) { api.open(o.dataset.open); return; }
    const cell = t.closest('.iv-cell'); if (cell) { api.open(cell.dataset.board); return; }
    if (t.closest('.iv-nav.prev')) return go(cur - 1);
    if (t.closest('.iv-nav.next')) return go(cur + 1);
    const dot = t.closest('.iv-dots button'); if (dot) return go(+dot.dataset.i);
    if (t.closest('[data-needs]')) return setNeeds(!needsOpen);
    const nl = t.closest('.iv-needs li[data-i]'); if (nl) { const n = data.needs[+nl.dataset.i]; if (n && n.path) api.open(n.path); setNeeds(false); return; }
    if (t.closest('[data-tray]')) return showView('aios', t);
    if (t.closest('[data-recent]')) return showView('recent', t);
    if (t.closest('[data-pal]')) return openPal();
    const d = t.closest('.iv-d'); if (d) return showView(d.dataset.view, d);
    if (t === layer || t.closest('.iv-x')) return showView('efforts');
    if (t === palEl) return closePal();
    const pi = t.closest('.iv-plist [data-i]'); if (pi && pal.items[+pi.dataset.i]) { const it = pal.items[+pi.dataset.i]; closePal(); it.run(); return; }
    if (t.closest('[data-claude-cancel]')) { api.claudeCancel(); return; }
    if (t.closest('[data-claude-triage]')) return startClaude('triage', { paths: data.proposals.tray.map(p => p.path) }, 'Proposal triage');
    if (t.closest('[data-claude-log-draft]')) return startClaude('log', {}, 'Draft log entry');
    if (t.closest('[data-claude-log]')) { api.appendLog(claude.text).then(ok => { if (ok) showView('recent'); }); return; }
    const lv = t.closest('[data-lever]');
    if (lv) { const e = data.efforts[+lv.dataset.lever]; if (e && e.leverRef) { lv.disabled = true; api.completeLever(e.leverRef).then(ok => { if (!ok && lv.isConnected) lv.disabled = false; }); } return; }
    if (t.closest('[data-new-effort]')) return showView('newEffort');
    if (t.closest('[data-meeting]')) return showView('meeting');
    if (t.closest('[data-capture]')) return showView('capture');
    const ar = t.closest('[data-archive]');
    if (ar) { // two clicks: the first arms the button, the second moves the folder
      if (!ar.dataset.armed) { ar.dataset.armed = '1'; ar.textContent = 'Click again to archive'; setTimeout(() => { if (ar.isConnected) { delete ar.dataset.armed; ar.textContent = 'Archive effort'; } }, 4000); return; }
      api.archiveEffort(ar.dataset.archive); return;
    }
    const rs = t.closest('[data-restore]'); if (rs) { api.restoreEffort(rs.dataset.restore).then(ok => { if (ok) showView('efforts'); }); return; }
    const act = t.closest('[data-act]');
    if (act) { const li = act.closest('.iv-prop'), r = trayRows[+li.dataset.i]; r.prev = r.status; r.marked = act.dataset.act; api.setProposalStatus(r.path, act.dataset.act).then(() => showView('aios')); return; }
    if (t.closest('[data-undo]')) { const li = t.closest('.iv-prop'), r = trayRows[+li.dataset.i]; api.setProposalStatus(r.path, r.prev).then(() => { r.marked = ''; showView('aios'); }); return; }
    if (needsOpen && !t.closest('.iv-needs-wrap')) setNeeds(false);
  });
  on(root, 'submit', ev => {
    const form = ev.target.closest('[data-form]'); if (!form) return;
    ev.preventDefault();
    const v = {}; for (const el of form.elements) if (el.name) v[el.name] = el.value;
    if (form.dataset.form === 'ask') {
      const e = data.efforts[+form.dataset.i]; if (!e || !v.q.trim()) return;
      return startClaude('ask', { folder: e.folder, name: e.name, question: v.q }, 'Ask about ' + e.name);
    }
    if (form.dataset.form === 'todo') {
      const e = data.efforts[+form.dataset.i]; if (!e || !v.text.trim()) return;
      form.querySelector('[type=submit]').disabled = true;
      api.addTodo(e.todoTarget, v.text).then(ok => { const b = form.querySelector('[type=submit]'); if (ok) form.reset(); if (b && b.isConnected) b.disabled = false; });
      return;
    }
    const btn = form.querySelector('[type=submit]'); btn.disabled = true;
    const fail = () => { btn.disabled = false; const p = form.querySelector('.iv-err'); p.textContent = 'Not saved. Obsidian shows the reason in a notice.'; p.hidden = false; };
    if (form.dataset.form === 'effort') {
      api.createEffort(v.name).then(folder => {
        if (!folder) return fail();
        showView('efforts'); const i = data.efforts.findIndex(e => e.folder === folder); if (i >= 0) go(i);
      });
    } else if (form.dataset.form === 'capture') api.capture(v.text).then(ok => ok ? showView('efforts') : fail());
    else api.logMeeting(v).then(ok => ok ? showView('recent') : fail());
  });
  on(root, 'mouseover', ev => { const c = ev.target.closest('.iv-cell'); if (c) c.closest('.iv-art').querySelector('.iv-cap').innerHTML = `<b>${esc(c.dataset.s)}:</b> ${esc(c.dataset.t)}`; });
  on(root, 'focusin', ev => { const c = ev.target.closest('.iv-cell'); if (c) c.closest('.iv-art').querySelector('.iv-cap').innerHTML = `<b>${esc(c.dataset.s)}:</b> ${esc(c.dataset.t)}`; });
  on(pin, 'input', () => { pal.sel = 0; renderPal(); });
  on(pin, 'keydown', ev => {
    if (ev.key === 'ArrowDown') { pal.sel = Math.min(pal.sel + 1, pal.items.length - 1); renderPal(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { pal.sel = Math.max(pal.sel - 1, 0); renderPal(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && pal.items[pal.sel]) { const it = pal.items[pal.sel]; closePal(); it.run(); }
  });
  on(root, 'keydown', ev => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); ev.stopPropagation(); pal.open ? closePal() : openPal(); return; }
    if (ev.key === 'Escape') { if (pal.open) closePal(); else if (needsOpen) { setNeeds(false); needsBtn.focus(); } else if (win) showView('efforts'); return; }
    if (!win && !pal.open && !/INPUT|TEXTAREA/.test(ev.target.tagName)) { if (ev.key === 'ArrowRight') go(cur + 1); if (ev.key === 'ArrowLeft') go(cur - 1); }
  });
  let sx = null;
  on($('.iv-stage'), 'touchstart', ev => { sx = ev.touches[0].clientX; });
  on($('.iv-stage'), 'touchend', ev => { if (sx === null) return; const d = ev.changedTouches[0].clientX - sx; if (Math.abs(d) > 60) go(cur + (d < 0 ? 1 : -1)); sx = null; });
  const dock = $('.iv-dock'), ds = $$('.iv-d');
  on(dock, 'pointermove', ev => ds.forEach(b => { const r = b.getBoundingClientRect(), dist = Math.abs(ev.clientX - (r.left + r.width / 2)); b.style.setProperty('--s', (1 + .3 * Math.pow(Math.max(0, 1 - dist / 110), 2)).toFixed(3)); }));
  on(dock, 'pointerleave', () => ds.forEach(b => b.style.setProperty('--s', 1)));

  /* ---------- clock and time-of-day tint ---------- */
  const tick = () => setN('clock', new Date().toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }));
  tick(); const timer = setInterval(tick, 30000);
  const now = new Date(), h = now.getHours();
  root.style.setProperty('--tod', h < 5 ? 'linear-gradient(180deg,rgba(10,20,60,.35),transparent)' : h < 9 ? 'linear-gradient(180deg,rgba(255,170,120,.16),transparent 60%)' : h < 17 ? 'none' : h < 21 ? 'linear-gradient(0deg,rgba(255,110,120,.16),transparent 55%)' : 'linear-gradient(180deg,rgba(10,20,70,.3),transparent)');
  setN('dnum', now.getDate());
  if (!/Mac|iPhone|iPad/.test((doc.defaultView.navigator || {}).platform || '')) setN('kbd', 'Ctrl K');

  return {
    update(d) {
      const keep = data && data.efforts[cur] ? data.efforts[cur].id : null;
      data = d; cur = Math.max(0, keep ? d.efforts.findIndex(e => e.id === keep) : 0);
      renderSlides(); renderStatus();
      if (win && win !== 'aios') showView(win);
    },
    focus() { root.focus(); },
    destroy() { clearInterval(timer); root.innerHTML = ''; root.classList.remove('ideaverse-root'); }
  };
}

module.exports = { mount };
