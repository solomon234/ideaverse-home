'use strict';
// Reads the vault through a small io interface and returns everything the dashboard shows.
// io: list(dir) -> {files, folders}, read(path), exists(path), mtimeIso(path), gitDates(path) -> ISO dates, newest first.

const P = require('./parse');

const DEFAULT_SETTINGS = {
  rootFolder: '', // folder that holds Efforts, AIOS, Atlas and Calendar; empty means the vault root
  openOnStartup: false,
  staleDays: 60,
  weeks: 14,
  // Per-effort overrides keyed by the effort's folder name: { lever: 'text', art: { kind: 'services', ... } }.
  // Pictures that cannot be read from a note (a services map, say) are described here.
  efforts: {}
};

const ARCHIVE = 'Archived'; // Efforts/Archived holds efforts that were put away
const base = p => p.split('/').pop();
const join = (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/');

async function walk(io, dir) {
  const out = [];
  let l;
  try { l = await io.list(dir); } catch (e) { return out; }
  out.push(...l.files);
  for (const f of l.folders) out.push(...await walk(io, f));
  return out;
}

async function readSafe(io, p) {
  try { return await io.read(p); } catch (e) { return ''; }
}

function firstParagraph(body, secs) {
  const ov = secs.find(s => /^overview$/i.test(s.title)) || secs.find(s => s.level > 0 && !/^status$/i.test(s.title) && s.lines.some(l => l.trim() && !/^[-*|>]/.test(l.trim()))) || secs[0];
  const lines = [];
  for (const l of ov.lines) {
    if (!l.trim()) { if (lines.length) break; continue; }
    if (/^[-*|>#]/.test(l.trim())) { if (lines.length) break; continue; }
    lines.push(l.trim());
  }
  return P.trunc(P.clean(lines.join(' ')), 260);
}

async function collectEffort(io, folder, cfg, S, today) {
  const name = base(folder), readmePath = join(folder, 'README.md');
  if (!await io.exists(readmePath)) return null;
  const text = await readSafe(io, readmePath);
  const { fm, body } = P.splitFrontmatter(text);
  const secs = P.sections(body);
  const st = P.parseStatus(fm, body, secs);
  const ov = (S.efforts && S.efforts[name]) || {};

  // other notes in the folder: a kanban board gives the richest picture
  const listing = await io.list(folder);
  let kanban = null;
  for (const f of listing.files) {
    if (!/\.md$/.test(f) || base(f) === 'README.md') continue;
    const t = await readSafe(io, f);
    if (P.isKanban(t)) { kanban = { path: f, cards: P.parseKanban(t) }; break; }
  }

  let art = null, facts = [];
  const todo = P.parseTodoGroups(secs), steps = P.parseSteps(secs), prices = P.parsePrices(body, secs);
  if (ov.art) art = ov.art;
  else if (kanban && kanban.cards.length) art = { kind: 'kanban', cards: kanban.cards, path: kanban.path };
  else if (prices) art = Object.assign({ kind: 'prices' }, prices);
  else if (steps) art = Object.assign({ kind: 'ladder' }, steps);
  else if (todo.length) art = { kind: 'pipeline', groups: todo };
  else art = { kind: 'outline', headings: secs.filter(s => s.level >= 2).map(s => s.title).slice(0, 8) };

  if (art.kind === 'kanban') { const o = art.cards.filter(c => !c.d).length; facts.push(`Board: ${o} open, ${art.cards.length - o} done`); }
  if (art.kind === 'prices' && art.saved != null && art.goal) facts.push(`Saved ${Math.round(art.saved / art.goal * 100)}% of the goal`);
  if (art.kind === 'pipeline') { const all = art.groups.flatMap(g => g.items); facts.push(`${all.filter(i => !i.c).length} open of ${all.length} todo items`); }
  if (art.kind === 'ladder') facts.push(`${art.steps.filter(s => s.c).length} of ${art.steps.length} steps done`);

  // The lever, and where it comes from so it can be ticked off. A lever set in settings has no source.
  let lever = '', leverRef = null;
  if (ov.lever) lever = ov.lever;
  else {
    const card = kanban && kanban.cards.find(c => !c.d), pick = P.pickLeverItem(secs);
    if (card) { lever = P.trunc(card.t, 150); leverRef = { kind: 'board', path: kanban.path, text: card.t }; }
    else if (pick) { lever = P.trunc(pick.t, 150); if (pick.checked === false) leverRef = { kind: 'todo', path: readmePath, text: pick.t }; }
  }

  let dates = [];
  try { dates = (await io.gitDates(folder)) || []; } catch (e) { dates = []; }
  const mtime = await io.mtimeIso(readmePath);
  const last = dates[0] || mtime;
  const weeks = dates.length ? P.weekBuckets(dates, today, S.weeks) : new Array(S.weeks).fill(0);

  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, short: ov.short || (name.length > 18 ? name.split(/\s+/).slice(0, 2).join(' ') : name),
    folder, path: readmePath, boardPath: kanban ? kanban.path : null,
    status: st.label, tone: st.tone, lever, leverRef, summary: firstParagraph(body, secs), facts,
    last, daysAgo: P.daysBetween(last, today), weeks, art,
    todoOpen: todo.filter(g => /immediate/i.test(g.title)).flatMap(g => g.items.filter(i => !i.c).map(i => i.t))
  };
}

async function collect(io, settings, today) {
  const S = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const R = S.rootFolder ? S.rootFolder.replace(/\/+$/, '') : '';
  const out = { today, generatedAt: new Date().toISOString(), root: R };

  // efforts, most recently changed first
  const ef = await io.list(join(R, 'Efforts')).catch(() => ({ files: [], folders: [] }));
  const efforts = [];
  for (const f of ef.folders) {
    if (base(f) === ARCHIVE) continue;
    const e = await collectEffort(io, f, null, S, today);
    if (e) efforts.push(e);
  }
  efforts.sort((a, b) => a.daysAgo - b.daysAgo);
  out.efforts = efforts;

  // archived efforts: folders under Efforts/Archived that still have a README
  out.archived = [];
  const ar = await io.list(join(R, 'Efforts', ARCHIVE)).catch(() => ({ folders: [] }));
  for (const f of ar.folders) {
    const readme = join(f, 'README.md');
    if (await io.exists(readme)) out.archived.push({ name: base(f), folder: f, path: readme, last: await io.mtimeIso(readme) });
  }

  // proposals
  const pdir = join(R, 'AIOS/Proposals');
  const pl = await io.list(pdir).catch(() => ({ files: [], folders: [] }));
  const props = [];
  for (const f of pl.files.filter(x => /\.md$/.test(x))) props.push(Object.assign(P.parseProposal(base(f), await readSafe(io, f)), { path: f }));
  const count = s => props.filter(p => p.status === s).length;
  out.proposals = {
    tray: props.filter(p => p.status === 'pending' || p.status === 'draft').sort((a, b) => (a.session < b.session ? 1 : -1)),
    counts: { pending: count('pending'), draft: count('draft'), promoted: count('promoted'), dismissed: count('dismissed'), none: props.filter(p => !p.status).length },
    files: (await walk(io, pdir)).filter(x => /\.md$/.test(x)).length
  };

  // session logs, newest first
  const ldir = join(R, 'AIOS/Logs');
  const logs = (await io.list(ldir).catch(() => ({ files: [] }))).files.filter(f => /log-\d{4}-\d{2}\.md$/.test(f)).sort().reverse();
  const sessions = [], openItems = [];
  const up = s => s.charAt(0).toUpperCase() + s.slice(1);
  for (const lf of logs.slice(0, 2)) {
    const entries = P.parseLog(await readSafe(io, lf)).reverse();
    for (const en of entries) {
      sessions.push({ date: P.formatDateLabel(en.label), title: P.trunc(en.title || 'Session', 90), path: lf });
      if (en.open.length && openItems.length < 4) {
        for (const o of en.open) if (openItems.length < 4 && !openItems.some(x => x.title === up(P.trunc(o, 110)))) openItems.push({ title: up(P.trunc(o, 110)), why: 'From the log, ' + P.formatDateLabel(en.label) + ' (may already be done)', path: lf, effort: (efforts.find(e => o.toLowerCase().includes(e.name.toLowerCase())) || {}).name || '' });
      }
    }
  }
  out.sessions = sessions.slice(0, 10);

  // things that need him: unchecked Immediate todos from effort notes (structured), then open items from the log (free text)
  const needs = [];
  for (const e of efforts) for (const t of e.todoOpen.slice(0, 2)) if (needs.length < 6) needs.push({ title: up(P.trunc(t, 110)), why: 'Immediate todo in ' + e.name, path: e.path, effort: e.name });
  for (const o of openItems) if (needs.length < 10) needs.push(o);
  out.needs = needs;

  // layers
  const atlasFiles = (await walk(io, join(R, 'Atlas'))).filter(f => /\.md$/.test(f) && !/^(README|Library)\.md$/.test(base(f)));
  const calFiles = (await walk(io, join(R, 'Calendar'))).filter(f => /\/\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  out.layers = {
    atlas: { count: atlasFiles.length, waiting: out.proposals.tray.filter(p => /^Atlas\//.test(p.to)) },
    calendar: { count: calFiles.length, recent: calFiles.slice(0, 8).map(f => ({ path: f, date: base(f).replace('.md', '') })) },
    efforts: { count: efforts.length },
    aios: { toDecide: out.proposals.tray.length, files: out.proposals.files }
  };
  return out;
}

module.exports = { collect, DEFAULT_SETTINGS, ARCHIVE };
