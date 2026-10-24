'use strict';
// Pure functions: markdown text in, plain data out. No Obsidian, no DOM, no filesystem.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clean(s) {
  return String(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trunc(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(—-]+$/, '') + '…';
}

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (k) fm[k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  return { fm, body: text.slice(m[0].length) };
}

// Headings split the body into sections. Fenced code is skipped so a "# comment" in a code block is not a heading.
function sections(body) {
  const out = [{ level: 0, title: '', lines: [] }];
  let fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) out.push({ level: h[1].length, title: clean(h[2]), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

// Top-level list items, with wrapped continuation lines folded in. checked: true, false, or null for a plain bullet.
function listItems(lines) {
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const m = /^(?:- |\d+[.)] )(?:\[( |x|X)\] )?(.*)$/.exec(raw);
    if (m) {
      cur = { checked: m[1] === undefined ? null : m[1] !== ' ', raw: m[2] };
      out.push(cur);
    } else if (cur && /^\s{2,}[^\s-]/.test(raw)) cur.raw += ' ' + raw.trim();
    else if (!/^\s/.test(raw) || raw.trim() === '') cur = null;
  }
  return out.map(i => ({ checked: i.checked, t: clean(i.raw) })).filter(i => i.t);
}

function parseStatus(fm, body, secs) {
  let full = '';
  const bold = /\*\*Status:\*\*\s*([^\n]*(?:\n(?!\s*\n)[^\n]*)*)/i.exec(body);
  if (bold) full = clean(bold[1]);
  if (!full) {
    const s = secs.find(x => /^status$/i.test(x.title));
    const line = s && s.lines.find(l => l.trim());
    if (line) full = clean(line);
  }
  if (!full && fm.status) full = clean(fm.status);
  if (!full) return { label: 'Active', tone: 'active', full: '' };
  const parts = full.split(/\s+—\s+/);
  let label = parts[0];
  if (parts[1] && parts[1].length <= 24) label += ' · ' + parts[1];
  label = trunc(label.charAt(0).toUpperCase() + label.slice(1), 40);
  const head = full.slice(0, 140);
  const tone = /not started|idle|paused|on hold/i.test(head) ? 'idle' : /wait|pending|blocked|review/i.test(head) ? 'wait' : 'active';
  return { label, tone, full };
}

function isKanban(text) {
  return /^---[\s\S]*?\bkanban-plugin:/.test(text.slice(0, 400));
}

function parseKanban(text) {
  const { body } = splitFrontmatter(text);
  const cards = [];
  for (const s of sections(body)) {
    if (s.level !== 2) continue;
    const laneDone = /done|complete|archive/i.test(s.title);
    for (const i of listItems(s.lines)) cards.push({ t: i.t.replace(/\s*\(details\)\s*$/i, ''), d: laneDone || i.checked === true, lane: s.title });
  }
  return cards;
}

function parseTables(lines) {
  const tables = [];
  let cur = null;
  for (const l of lines) {
    if (/^\s*\|/.test(l)) {
      const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => clean(c));
      if (!cur) { cur = { header: cells, rows: [] }; tables.push(cur); }
      else if (!cells.every(c => /^:?-+:?$/.test(c))) cur.rows.push(cells);
    } else cur = null;
  }
  return tables;
}

function money(s) {
  const m = /\$\s?([\d,]+(?:\.\d+)?)(k)?/i.exec(String(s));
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
}

// Price listings against a budget, with savings progress (a purchase you are saving toward). Returns null when the note has no listings table.
function parsePrices(body, secs) {
  const lines = body.split(/\r?\n/);
  const tables = parseTables(lines);
  const lt = tables.find(t => t.header.some(h => /price/i.test(h)));
  if (!lt) return null;
  const pi = lt.header.findIndex(h => /price/i.test(h)), mi = lt.header.findIndex(h => /mileage|miles/i.test(h));
  const listings = lt.rows.map(r => ({ t: r[0], m: mi >= 0 ? r[mi] : '', p: money(r[pi]) })).filter(l => l.p);
  if (!listings.length) return null;
  const b = /Budget:\s*\$(\d+)k\s*[–-]\s*\$?(\d+)k/i.exec(body);
  const budget = b ? [+b[1] * 1000, +b[2] * 1000] : null;
  const gs = secs.find(s => /savings target/i.test(s.title));
  const goal = gs ? money(gs.lines.join(' ')) : null;
  const st = tables.find(t => t.header.some(h => /running total/i.test(h)));
  const saved = st && st.rows.length ? money(st.rows[st.rows.length - 1][st.header.findIndex(h => /running total/i.test(h))]) : null;
  const pulled = /pulled (\d{4}-\d{2}-\d{2})/i.exec(body);
  const prices = listings.map(l => l.p).concat(budget || []);
  return {
    listings, budget, goal, saved, pulled: pulled ? pulled[1] : null,
    axis: [Math.floor((Math.min(...prices) - 3000) / 5000) * 5000, Math.ceil((Math.max(...prices) + 3000) / 5000) * 5000]
  };
}

// A numbered or checkbox list of steps, with the step that has a stop condition flagged as the gate.
function parseSteps(secs) {
  const s = secs.find(x => /steps/i.test(x.title) && listItems(x.lines).filter(i => i.checked !== null).length >= 2);
  if (!s) return null;
  const steps = listItems(s.lines).filter(i => i.checked !== null).map(i => ({ t: i.t, c: i.checked }));
  const gate = steps.findIndex(x => /probe|inspect|check for/i.test(x.t)) + 1;
  const stop = secs.find(x => /stop condition|get a pro/i.test(x.title));
  let note = '';
  if (stop) {
    const lead = clean(stop.lines.find(l => l.trim() && !/^[-*]/.test(l.trim())) || '');
    note = trunc((lead + ' ' + listItems(stop.lines).map(i => i.t).join('; ')).trim(), 200);
  }
  return { steps, gate, note };
}

// Groups under a "Todo" heading (Immediate, Next, Backlog...).
function parseTodoGroups(secs) {
  const i = secs.findIndex(s => /^to-?do/i.test(s.title));
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < secs.length && secs[k].level > secs[i].level; k++) {
    const items = listItems(secs[k].lines).filter(x => x.checked !== null).map(x => ({ t: x.t, c: x.checked }));
    if (items.length) out.push({ title: secs[k].title, items });
  }
  return out;
}

// The smallest next move: first unchecked item under a "next"-style heading, else the first unchecked anywhere.
function pickLeverItem(secs) {
  const next = /immediate|next action|^next|to-?do|steps/i;
  for (const s of secs) {
    if (!next.test(s.title)) continue;
    const it = listItems(s.lines).find(x => x.checked === false || (x.checked === null && /next action/i.test(s.title)));
    if (it) return it;
  }
  for (const s of secs) {
    const it = listItems(s.lines).find(x => x.checked === false);
    if (it) return it;
  }
  return null;
}
function pickLever(secs) {
  const it = pickLeverItem(secs);
  return it ? trunc(it.t, 150) : '';
}

// ---- editing: each function takes a note's text and returns the new text, or null when it cannot find its target ----

// Same comparison listItems uses to build an item's text, plus the Kanban "(details)" link the board parser drops.
const sameItem = (raw, itemText) => clean(raw).replace(/\s*\(details\)\s*$/i, '') === itemText;

// First unchecked top-level item whose text matches: { start, end (exclusive), raw }. Fenced code is skipped.
function findOpenItem(lines, itemText) {
  let fence = false, cur = null;
  const done = () => cur && sameItem(cur.raw, itemText) ? cur : null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (/^\s*```/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(?:- |\d+[.)] )\[ \] (.*)$/.exec(line);
    if (m) { const hit = done(); if (hit) return hit; cur = { start: i, end: i + 1, raw: m[1] }; continue; }
    if (/^(?:- |\d+[.)] )/.test(line)) { const hit = done(); if (hit) return hit; cur = null; continue; }
    if (cur && /^\s{2,}[^\s-]/.test(line)) { cur.raw += ' ' + line.trim(); cur.end = i + 1; continue; }
    if (!/^\s/.test(line) || line.trim() === '') { const hit = done(); if (hit) return hit; cur = null; }
  }
  return done();
}

function checkOffItem(text, itemText) {
  const lines = text.split('\n'), it = findOpenItem(lines, itemText);
  if (!it) return null;
  lines[it.start] = lines[it.start].replace('[ ]', '[x]');
  return lines.join('\n');
}

// Kanban: take the card out of its lane and put it, checked, at the end of the first lane named done/complete/archive.
// A board without such a lane just gets the card checked in place.
function completeBoardCard(text, itemText) {
  const lines = text.split('\n'), it = findOpenItem(lines, itemText);
  if (!it) return null;
  const card = lines.splice(it.start, it.end - it.start);
  card[0] = card[0].replace('[ ]', '[x]');
  const lane = lines.findIndex(l => /^## /.test(l) && /done|complete|archive/i.test(l));
  if (lane < 0) { lines.splice(it.start, 0, ...card); return lines.join('\n'); }
  let end = lines.findIndex((l, i) => i > lane && /^(## |%% )/.test(l));
  if (end < 0) end = lines.length;
  while (end - 1 > lane && lines[end - 1].trim() === '') end--;
  lines.splice(end, 0, ...(end === lane + 1 ? [''] : []), ...card);
  return lines.join('\n');
}

// A meeting for the session log, in the shape parseLog reads. Fields are single lines; open items are separated by semicolons.
function formatMeetingEntry(m) {
  const one = s => String(s || '').replace(/\s+/g, ' ').trim();
  const open = String(m.open || '').split(';').map(one).filter(Boolean);
  const lines = [`**${m.date} (meeting)** — ${one(m.title)}`];
  if (one(m.with)) lines.push(`- With: ${one(m.with)}`);
  if (one(m.outcome)) lines.push(`- Outcome: ${one(m.outcome)}`);
  if (open.length) lines.push(`- Open: ${open.join('; ')}`);
  return lines.join('\n') + '\n---\n';
}

function newEffortReadme(name, today) {
  return `# ${name}\n\n**Status:** active — just started\n**Started:** ${today}\n\n## Overview\n\nOne or two sentences on what this effort is and why it exists.\n\n## Todo List\n\n### Immediate\n\n- [ ] Write down the first move\n`;
}

function parseProposal(name, text) {
  const { fm, body } = splitFrontmatter(text);
  const h = /^#\s+(.+)$/m.exec(body);
  return { file: name, status: (fm.status || '').toLowerCase(), to: fm['proposed-to'] || '', topic: clean(fm.topic || (h ? h[1] : name.replace(/\.md$/, ''))), session: fm.session || '' };
}

// Session log: entries start with a bold date label, e.g. **2026-10-15/16** — Title
function parseLog(text) {
  const entries = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\*\*(\d{4}-\d{2}-\d{2}[^*]*)\*\*\s*(?:[—–-]+\s*(.*))?$/.exec(line);
    if (m) {
      cur = { label: m[1].trim(), title: clean(m[2] || ''), open: [] };
      entries.push(cur);
    } else if (cur) {
      const o = /^-\s*Open:\s*(.*)$/.exec(line);
      if (o) cur.open.push(...o[1].split(/;\s+/).map(x => clean(x).replace(/\.$/, '')).filter(Boolean));
    }
  }
  return entries;
}

function formatDateLabel(label) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:\/(\d{2}))?/.exec(label);
  if (!m) return label;
  const mon = MONTHS[+m[2] - 1];
  return m[4] ? `${+m[3]}–${+m[4]} ${mon}` : `${+m[3]} ${mon}`;
}

function formatIso(iso) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : iso;
}

// Rewrite (or add) the status line in a note's frontmatter without touching anything else.
function setFrontmatterStatus(text, value) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return `---\nstatus: ${value}\n---\n` + text;
  const block = m[1];
  const next = /^status:.*$/m.test(block) ? block.replace(/^status:.*$/m, `status: ${value}`) : block + `\nstatus: ${value}`;
  return text.slice(0, 4) + next + text.slice(4 + block.length);
}

function dayNumber(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

function daysBetween(fromIso, toIso) {
  return dayNumber(toIso) - dayNumber(fromIso);
}

// Count dates per week for the last n weeks, weeks starting Monday, newest last.
function weekBuckets(dates, todayIso, n) {
  const t = dayNumber(todayIso);
  const dow = (t + 3) % 7; // 1970-01-01 was a Thursday; 0 = Monday
  const start = t - dow - (n - 1) * 7;
  const out = new Array(n).fill(0);
  for (const d of dates) {
    const k = Math.floor((dayNumber(d) - start) / 7);
    if (k >= 0 && k < n) out[k]++;
  }
  return out;
}

module.exports = {
  clean, trunc, splitFrontmatter, sections, listItems, parseStatus, isKanban, parseKanban, parseTables, money,
  parsePrices, parseSteps, parseTodoGroups, pickLever, pickLeverItem, checkOffItem, completeBoardCard, formatMeetingEntry, newEffortReadme, parseProposal, parseLog, formatDateLabel, formatIso,
  setFrontmatterStatus, daysBetween, weekBuckets
};
