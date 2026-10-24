'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/parse');

test('frontmatter ignores comment lines and strips quotes', () => {
  const { fm, body } = P.splitFrontmatter('---\nproposed-to: Efforts/\n# a comment\ntopic: "Trip"\nstatus: pending\n---\n# Title\nbody');
  assert.deepStrictEqual(fm, { 'proposed-to': 'Efforts/', topic: 'Trip', status: 'pending' });
  assert.strictEqual(body, '# Title\nbody');
  assert.deepStrictEqual(P.splitFrontmatter('no frontmatter').fm, {});
});

test('list items: checkboxes, numbered steps, wrapped lines, plain bullets', () => {
  const lines = ['- [ ] Decide whether to add a secondary DNS', '      lease, so DNS is lost', '- [x] Done thing', '1. [ ] Clear pavers', '2. [x] Chisel', '- plain bullet', '  - nested ignored', ''];
  const items = P.listItems(lines);
  assert.deepStrictEqual(items.map(i => i.checked), [false, true, false, true, null]);
  assert.strictEqual(items[0].t, 'Decide whether to add a secondary DNS lease, so DNS is lost');
});

test('clean strips wikilinks, links and emphasis', () => {
  assert.strictEqual(P.clean('See [[a#b|(details)]] and [[plain]] and [x](http://y) **bold** `code`'), 'See (details) and plain and x bold code');
});

test('status: bold line, status section, frontmatter, tone', () => {
  const a = '**Status:** Active — MVP is live and self-hosted, with a very long explanation that goes on';
  assert.deepStrictEqual(pick(P.parseStatus({}, a, P.sections(a))), { label: 'Active', tone: 'active' });
  const b = '**Status:** active — savings phase';
  assert.deepStrictEqual(pick(P.parseStatus({}, b, P.sections(b))), { label: 'Active · savings phase', tone: 'active' });
  const c = '# T\n\n## Status\nPhase 1 (surface repair) — not started\n';
  assert.deepStrictEqual(pick(P.parseStatus({ status: 'active' }, c, P.sections(c))), { label: 'Phase 1 (surface repair) · not started', tone: 'idle' });
  const d = '**Status:** Demo phase — prototype complete, pending client review';
  assert.strictEqual(P.parseStatus({}, d, P.sections(d)).tone, 'wait');
  assert.strictEqual(P.parseStatus({ status: 'paused' }, '# x', P.sections('# x')).tone, 'idle');
  assert.strictEqual(P.parseStatus({}, '# x', P.sections('# x')).label, 'Active');
  function pick(s) { return { label: s.label, tone: s.tone }; }
});

test('kanban: lanes decide done, details links are stripped', () => {
  const text = '---\n\nkanban-plugin: board\n\n---\n\n## new\n\n- [ ] Verify it [[backlog#^x|(details)]]\n\n## done\n\n- [x] Shipped [[backlog#^y|(details)]]\n- [ ] Also in the done lane\n\n%% kanban:settings\n```\n{}\n```\n%%';
  assert.ok(P.isKanban(text));
  const cards = P.parseKanban(text);
  assert.deepStrictEqual(cards.map(c => [c.t, c.d]), [['Verify it', false], ['Shipped', true], ['Also in the done lane', true]]);
  assert.ok(!P.isKanban('# just a note'));
});

test('prices: listings, budget, goal and saved from tables', () => {
  const body = 'Buy a car. Budget: $20k–$28k.\n\n## Savings target\n\n**$5,000** covers it.\n\n| Date | Pay Period # | Contribution | Running Total |\n|---|---|---|---|\n| 2026-08-24 | 1 | $100 | $100 |\n| 2026-08-31 | 3 | $300 | $500 |\n\n## Sample listings (pulled 2026-08-24, will go stale)\n\n| Year/Trim | Mileage | Price | Source |\n|---|---|---|---|\n| 2022 Wagon | 83,929 mi | $19,793 | X |\n| 2024 Wagon | 15,162 mi | $27,682 | X |\n';
  const t = P.parsePrices(body, P.sections(body));
  assert.deepStrictEqual(t.listings.map(l => l.p), [19793, 27682]);
  assert.deepStrictEqual(t.budget, [20000, 28000]);
  assert.strictEqual(t.goal, 5000);
  assert.strictEqual(t.saved, 500);
  assert.strictEqual(t.pulled, '2026-08-24');
  assert.deepStrictEqual(t.axis, [15000, 35000]);
  assert.strictEqual(P.parsePrices('# nothing', P.sections('# nothing')), null);
});

test('steps: gate is the probe step, stop note is read from the stop section', () => {
  const body = '## Stop Conditions — Get a Pro\n\nStop work and consult an engineer if:\n- Probe goes deeper than half an inch\n- Diagonal cracks\n\n## Repair Steps (Phase 1)\n\n1. [ ] Clear pavers\n2. [ ] Wire brush\n3. [ ] Probe with screwdriver\n4. [x] Pack cement\n';
  const s = P.parseSteps(P.sections(body));
  assert.strictEqual(s.steps.length, 4);
  assert.strictEqual(s.gate, 3);
  assert.ok(/Stop work/.test(s.note) && /Diagonal cracks/.test(s.note));
  assert.strictEqual(P.parseSteps(P.sections('# none')), null);
});

test('todo groups and lever', () => {
  const body = '## Todo List\n\n### Immediate\n- [x] done\n- [ ] Host the demo\n\n### Next\n- [ ] Later\n\n## Notes\n- [ ] not a todo\n';
  const secs = P.sections(body);
  const g = P.parseTodoGroups(secs);
  assert.deepStrictEqual(g.map(x => [x.title, x.items.length]), [['Immediate', 2], ['Next', 1]]);
  assert.strictEqual(P.pickLever(secs), 'Host the demo');
  assert.strictEqual(P.pickLever(P.sections('# x\n- [ ] first unchecked anywhere')), 'first unchecked anywhere');
  assert.strictEqual(P.pickLever(P.sections('# nothing')), '');
});

test('proposal frontmatter, with and without a status', () => {
  const p = P.parseProposal('proposal-x.md', '---\nproposed-to: Atlas/x.md\ntopic: Home Lab\nstatus: Pending\nsession: 2026-06-27\n---\n# Home Lab');
  assert.deepStrictEqual([p.status, p.to, p.topic, p.session], ['pending', 'Atlas/x.md', 'Home Lab', '2026-06-27']);
  assert.strictEqual(P.parseProposal('proposal-y.md', '# Plan\nbody').status, '');
  assert.strictEqual(P.parseProposal('proposal-y.md', '# Plan\nbody').topic, 'Plan');
});

test('log entries, open items, date labels', () => {
  const text = '**2026-10-15/16** — Project X: ship\n- Discussed: x\n- Open: set the build command; watch usage for a day.\n---\n\n**2026-10-04 (later)** — Project Y\n- Built: y\n\n**2026-10-03**\n- Open: one thing\n';
  const e = P.parseLog(text);
  assert.strictEqual(e.length, 3);
  assert.strictEqual(e[0].title, 'Project X: ship');
  assert.deepStrictEqual(e[0].open, ['set the build command', 'watch usage for a day']);
  assert.deepStrictEqual(e[2].open, ['one thing']);
  assert.strictEqual(P.formatDateLabel('2026-10-15/16'), '15–16 Oct');
  assert.strictEqual(P.formatDateLabel('2026-10-04 (later)'), '4 Oct');
  assert.strictEqual(P.formatIso('2026-06-25'), '25 Jun');
});

test('setFrontmatterStatus rewrites only the status line', () => {
  const src = '---\nproposed-to: Efforts/\n# keep this comment\nstatus: pending\nsession: 1\n---\n# Body\nstatus: not frontmatter\n';
  assert.strictEqual(P.setFrontmatterStatus(src, 'promoted'), src.replace('status: pending', 'status: promoted'));
  assert.strictEqual(P.setFrontmatterStatus('---\nsession: 1\n---\nx', 'draft'), '---\nsession: 1\nstatus: draft\n---\nx');
  assert.strictEqual(P.setFrontmatterStatus('# no fm', 'draft'), '---\nstatus: draft\n---\n# no fm');
  assert.strictEqual(P.setFrontmatterStatus(P.setFrontmatterStatus(src, 'dismissed'), 'pending'), src);
});

test('date math and weekly buckets', () => {
  assert.strictEqual(P.daysBetween('2026-06-25', '2026-10-23'), 120);
  // 2026-10-23 is a Friday; its Monday is 2026-10-19. Last bucket = that week.
  const w = P.weekBuckets(['2026-10-22', '2026-10-19', '2026-10-18', '2026-10-12', '2026-07-01'], '2026-10-23', 14);
  assert.strictEqual(w.length, 14);
  assert.strictEqual(w[13], 2);
  assert.strictEqual(w[12], 2);
  assert.strictEqual(w.reduce((a, b) => a + b, 0), 4); // 2026-07-01 is before the window
});

test('checkOffItem ticks the matching open item, including wrapped ones, and skips code fences', () => {
  const note = '# x\n```\n- [ ] Ship it\n```\n- [ ] Plan\n- [ ] Ship it\n  and wrap\n- [x] Ship it';
  assert.strictEqual(P.checkOffItem(note, 'Ship it and wrap'), '# x\n```\n- [ ] Ship it\n```\n- [ ] Plan\n- [x] Ship it\n  and wrap\n- [x] Ship it');
  assert.strictEqual(P.checkOffItem(note, 'Plan').includes('- [x] Plan'), true);
  assert.strictEqual(P.checkOffItem(note, 'Missing'), null);
});

test('completeBoardCard moves the card to the done lane, checked', () => {
  const board = '---\n\nkanban-plugin: board\n\n---\n\n## new\n\n- [ ] One [[a#^b|(details)]]\n- [ ] Two\n\n\n## in progress\n\n\n## done\n\n- [x] Old\n\n\n%% kanban:settings\n```\n{}\n```\n%%';
  const out = P.completeBoardCard(board, 'One');
  assert.ok(out.includes('## new\n\n- [ ] Two\n'));
  assert.ok(out.includes('## done\n\n- [x] Old\n- [x] One [[a#^b|(details)]]\n'));
  assert.deepStrictEqual(P.parseKanban(out).map(c => [c.t, c.d]), [['Two', false], ['Old', true], ['One', true]]);
  const empty = P.completeBoardCard('## new\n\n- [ ] One\n\n## done\n\n\n%% kanban:settings\n%%', 'One');
  assert.ok(empty.includes('## done\n\n- [x] One\n'));
  assert.strictEqual(P.completeBoardCard('## todo\n- [ ] One', 'One'), '## todo\n- [x] One');
});

test('formatMeetingEntry is read back by parseLog, with its open items', () => {
  const e = P.formatMeetingEntry({ date: '2026-10-23', title: 'Partner sync', with: ' Sam,  Lee ', outcome: 'Agreed\nthe pilot', open: 'Send plan; ; Book Jetson backup' });
  assert.strictEqual(e, '**2026-10-23 (meeting)** — Partner sync\n- With: Sam, Lee\n- Outcome: Agreed the pilot\n- Open: Send plan; Book Jetson backup\n---\n');
  const [en] = P.parseLog(e);
  assert.deepStrictEqual([en.title, en.open], ['Partner sync', ['Send plan', 'Book Jetson backup']]);
});

test('a new effort README reads back as an effort with a lever', () => {
  const { fm, body } = P.splitFrontmatter(P.newEffortReadme('Kitchen', '2026-10-23'));
  const secs = P.sections(body);
  assert.strictEqual(P.parseStatus(fm, body, secs).tone, 'active');
  assert.strictEqual(P.pickLever(secs), 'Write down the first move');
});

test('addTodoItem appends to the Immediate list, or adds one', () => {
  const note = '# x\n\n## Todo List\n\n### Immediate\n\n- [ ] One\n- [x] Two\n\n### Later\n\n- [ ] Three\n';
  assert.strictEqual(P.addTodoItem(note, '  Four\n'), '# x\n\n## Todo List\n\n### Immediate\n\n- [ ] One\n- [x] Two\n- [ ] Four\n\n### Later\n\n- [ ] Three\n');
  assert.strictEqual(P.addTodoItem('# x\n### Immediate\n', 'A'), '# x\n### Immediate\n\n- [ ] A\n');
  assert.strictEqual(P.addTodoItem('# x\n\ntext\n', 'A'), '# x\n\ntext\n\n## Todo List\n\n### Immediate\n\n- [ ] A\n');
  assert.strictEqual(P.addTodoItem('# x', '   '), null);
  assert.strictEqual(P.pickLever(P.sections(P.addTodoItem('# x\n', 'A'))), 'A');
});

test('addBoardCard goes to the first lane that is not done, and the board still parses', () => {
  const board = '---\n\nkanban-plugin: board\n\n---\n\n## new\n\n- [ ] One\n\n\n## done\n\n\n%% kanban:settings\n%%';
  const out = P.addBoardCard(board, 'Two');
  assert.ok(out.includes('## new\n\n- [ ] One\n- [ ] Two\n\n\n## done'));
  assert.deepStrictEqual(P.parseKanban(out).map(c => c.t), ['One', 'Two']);
  assert.deepStrictEqual(P.kanbanLanes(board), [{ title: 'new', done: false }, { title: 'done', done: true }]);
  assert.strictEqual(P.addBoardCard('## done\n', 'x'), null);
});

test('appendCapture reuses a trailing Quick capture section only', () => {
  const first = P.appendCapture('# Scratch\n', '09:05', 'a\nthought');
  assert.strictEqual(first, '# Scratch\n\n## Quick capture\n\n- 09:05 — a thought\n');
  assert.strictEqual(P.appendCapture(first, '09:10', 'b'), first + '- 09:10 — b\n');
  assert.ok(P.appendCapture(first + '\n## Other\n', '09:11', 'c').endsWith('## Other\n\n## Quick capture\n\n- 09:11 — c\n'));
  assert.strictEqual(P.appendCapture('', '09:00', ' '), null);
});

test('addDays crosses month and year ends', () => {
  assert.strictEqual(P.addDays('2026-10-23', 1), '2026-10-24');
  assert.strictEqual(P.addDays('2026-10-30', 7), '2026-11-06');
  assert.strictEqual(P.addDays('2026-12-31', 1), '2027-01-01');
});

test('setEffortStatus changes the word and keeps the note after the dash', () => {
  assert.strictEqual(P.setEffortStatus('# X\n\n**Status:** active — savings phase\n**Started:** 1', 'paused'), '# X\n\n**Status:** paused — savings phase\n**Started:** 1');
  assert.strictEqual(P.setEffortStatus('# X\n\n## Status\n\nActive, going\n\n## B', 'waiting'), '# X\n\n## Status\n\nwaiting\n\n## B');
  assert.strictEqual(P.setEffortStatus('---\nstatus: active\n---\n# X', 'paused'), '---\nstatus: paused\n---\n# X');
  assert.strictEqual(P.setEffortStatus('# X\n\ntext', 'paused'), '# X\n\n**Status:** paused\n\ntext');
  for (const [word, tone] of [['active', 'active'], ['waiting', 'wait'], ['paused', 'idle'], ['not started', 'idle']]) {
    const t = P.setEffortStatus('# X\n\n**Status:** active — fine\n', word), { fm, body } = P.splitFrontmatter(t);
    assert.strictEqual(P.parseStatus(fm, body, P.sections(body)).tone, tone, word);
  }
});

test('leverCandidates lists next-style items first, each once', () => {
  assert.deepStrictEqual(P.leverCandidates(P.sections('# x\n## Later\n- [ ] z\n## Todo\n- [ ] a\n- [x] b\n- [ ] c')).map(i => i.t), ['a', 'c', 'z']);
});

test('dailyNoteFrom fills the date into the template, or makes a small note', () => {
  assert.strictEqual(P.dailyNoteFrom('---\ndate: YYYY-MM-DD\n---\n# YYYY-MM-DD\n', '2026-10-24'), '---\ndate: 2026-10-24\n---\n# 2026-10-24\n');
  assert.ok(P.dailyNoteFrom('  ', '2026-10-24').includes('# 2026-10-24'));
});
