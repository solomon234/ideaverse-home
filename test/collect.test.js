'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collect } = require('../src/collect');
const { nodeIO } = require('../src/nodeio');

function makeVault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-vault-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

test('an empty vault does not throw and returns empty lists', async () => {
  const root = makeVault({ 'readme.md': 'x' });
  const d = await collect(nodeIO(root), { rootFolder: '' }, '2026-10-23');
  assert.deepStrictEqual([d.efforts.length, d.needs.length, d.sessions.length, d.proposals.tray.length], [0, 0, 0, 0]);
  assert.strictEqual(d.layers.atlas.count, 0);
});

test('a small vault: efforts, proposals, logs, layers', async () => {
  const root = makeVault({
    'V/Efforts/Alpha/README.md': '# Alpha\n\n**Status:** Active — going\n\n## Todo List\n\n### Immediate\n- [ ] Ship it\n- [x] Plan it\n',
    'V/Efforts/Beta/README.md': '# Beta\n\n## Overview\n\nA second thing.\n',
    'V/Efforts/Beta/board.md': '---\n\nkanban-plugin: board\n\n---\n\n## todo\n\n- [ ] One\n\n## done\n\n- [x] Two\n',
    'V/Efforts/NoReadme/other.md': 'x',
    'V/AIOS/Proposals/proposal-a.md': '---\nproposed-to: Atlas/a.md\ntopic: A\nstatus: pending\nsession: 2026-06-01\n---\n',
    'V/AIOS/Proposals/proposal-b.md': '---\nstatus: promoted\n---\n# B',
    'V/AIOS/Proposals/proposal-c.md': '# C with no status',
    'V/AIOS/Proposals/sub/notes.md': 'x',
    'V/AIOS/Logs/log-2026-10.md': '**2026-10-01** — First\n- Open: do a; do b\n\n**2026-10-02** — Second\n- Open: do c\n',
    'V/Atlas/README.md': 'r', 'V/Atlas/Maps/Library.md': 'l', 'V/Atlas/Concept.md': 'c',
    'V/Calendar/2026-10-08.md': 'd', 'V/Calendar/README.md': 'r'
  });
  const d = await collect(nodeIO(root), { rootFolder: 'V' }, '2026-10-23');
  assert.deepStrictEqual(d.efforts.map(e => e.name).sort(), ['Alpha', 'Beta']);
  const a = d.efforts.find(e => e.name === 'Alpha'), b = d.efforts.find(e => e.name === 'Beta');
  assert.strictEqual(a.lever, 'Ship it');
  assert.strictEqual(a.art.kind, 'pipeline');
  assert.strictEqual(b.art.kind, 'kanban');
  assert.strictEqual(b.lever, 'One');
  assert.strictEqual(b.boardPath, 'V/Efforts/Beta/board.md');
  assert.deepStrictEqual(d.proposals.counts, { pending: 1, draft: 0, promoted: 1, dismissed: 0, none: 1 });
  assert.strictEqual(d.proposals.files, 4);
  assert.strictEqual(d.layers.aios.toDecide, 1);
  assert.strictEqual(d.layers.atlas.count, 1);
  assert.strictEqual(d.layers.atlas.waiting.length, 1);
  assert.strictEqual(d.layers.calendar.count, 1);
  assert.deepStrictEqual(d.sessions.map(s => s.title), ['Second', 'First']);
  // structured todos come before free-text log items
  assert.strictEqual(d.needs[0].title, 'Ship it');
  assert.deepStrictEqual(d.needs.slice(1).map(n => n.title), ['Do c', 'Do a', 'Do b']);
});

test('overrides win over what the note says', async () => {
  const root = makeVault({ 'Efforts/X/README.md': '# X\n- [ ] auto lever\n' });
  const d = await collect(nodeIO(root), { rootFolder: '', efforts: { X: { lever: 'Mine', art: { kind: 'outline', headings: ['h'] } } } }, '2026-10-23');
  assert.strictEqual(d.efforts[0].lever, 'Mine');
  assert.strictEqual(d.efforts[0].art.kind, 'outline');
});

// Optional: point VAULT at a real vault to check that every effort parses into something drawable.
const REAL = process.env.VAULT;
test('real vault: structure holds together', { skip: !REAL && 'set VAULT to run' }, async () => {
  const d = await collect(nodeIO(REAL), { rootFolder: process.env.ROOT || '' }, new Date().toISOString().slice(0, 10));
  for (const e of d.efforts) {
    assert.ok(e.status && e.art && e.art.kind, e.name);
    assert.strictEqual(e.weeks.length, 14, e.name);
    if (e.art.kind === 'kanban') assert.ok(e.art.cards.length > 0, e.name);
  }
  assert.strictEqual(d.layers.aios.toDecide, d.proposals.counts.pending + d.proposals.counts.draft);
});

test('Efforts/Archived is not an effort, and its efforts are listed as archived', async () => {
  const root = makeVault({
    'Efforts/Live/README.md': '# Live\n',
    'Efforts/Archived/Old/README.md': '# Old\n',
    'Efforts/Archived/Empty/notes.md': 'x'
  });
  const d = await collect(nodeIO(root), { rootFolder: '' }, '2026-10-23');
  assert.deepStrictEqual(d.efforts.map(e => e.name), ['Live']);
  assert.strictEqual(d.efforts[0].folder, 'Efforts/Live');
  assert.deepStrictEqual(d.archived.map(a => [a.name, a.folder]), [['Old', 'Efforts/Archived/Old']]);
});

test('the lever carries its source, except when set in settings', async () => {
  const root = makeVault({
    'Efforts/A/README.md': '# A\n## Todo List\n### Immediate\n- [ ] Do a\n',
    'Efforts/B/README.md': '# B\n',
    'Efforts/B/board.md': '---\n\nkanban-plugin: board\n\n---\n\n## new\n\n- [ ] Card [[x#^y|(details)]]\n\n## done\n',
    'Efforts/C/README.md': '# C\n- [ ] c\n'
  });
  const d = await collect(nodeIO(root), { rootFolder: '', efforts: { C: { lever: 'Mine' } } }, '2026-10-23');
  const by = n => d.efforts.find(e => e.name === n);
  assert.deepStrictEqual(by('A').leverRef, { kind: 'todo', path: 'Efforts/A/README.md', text: 'Do a' });
  assert.deepStrictEqual(by('B').leverRef, { kind: 'board', path: 'Efforts/B/board.md', text: 'Card' });
  assert.strictEqual(by('C').leverRef, null);
});

test('the todo target is the board\'s first open lane, else the README Immediate list', async () => {
  const root = makeVault({
    'Efforts/A/README.md': '# A\n## Todo List\n### Immediate\n- [ ] Do a\n',
    'Efforts/B/README.md': '# B\n',
    'Efforts/B/board.md': '---\n\nkanban-plugin: board\n\n---\n\n## backlog\n\n## done\n',
    'Efforts/C/README.md': '# C\n'
  });
  const d = await collect(nodeIO(root), { rootFolder: '' }, '2026-10-23');
  const by = n => d.efforts.find(e => e.name === n).todoTarget;
  assert.deepStrictEqual(by('A'), { kind: 'todo', path: 'Efforts/A/README.md', label: 'Immediate in the README' });
  assert.deepStrictEqual([by('B').kind, by('B').path], ['board', 'Efforts/B/board.md']);
  assert.strictEqual(by('C').label, 'a new Immediate list in the README');
});

test('session logs: day files in monthly folders come first, then monthly files', async () => {
  const root = makeVault({
    'Efforts/A/README.md': '# A\n',
    'AIOS/Logs/log-2026-10.md': '**2026-10-01** — Old month\n- Open: old thing\n',
    'AIOS/Logs/2026-10/log-2026-10-24.md': '**2026-10-24** — Morning\n---\n**2026-10-24** — Evening\n- Open: new thing\n---\n',
    'AIOS/Logs/2026-10/log-2026-10-25.md': '**2026-10-25 (meeting)** — Sync\n---\n',
    'AIOS/Logs/2026-10/notes.md': 'not a log'
  });
  const d = await collect(nodeIO(root), { rootFolder: '' }, '2026-10-26');
  assert.deepStrictEqual(d.sessions.map(s => s.title), ['Sync', 'Evening', 'Morning', 'Old month']);
  assert.deepStrictEqual(d.needs.map(n => n.title), ['New thing', 'Old thing']);
});

test('snoozed needs are hidden until their date, listed separately, and replaced by the next item', async () => {
  const root = makeVault({
    'Efforts/A/README.md': '# A\n## Todo List\n### Immediate\n- [ ] One\n- [ ] Two\n- [ ] Three\n',
    'AIOS/Logs/log-2026-10.md': '**2026-10-01** — T\n- Open: log a; log b\n'
  });
  const run = snoozed => collect(nodeIO(root), { rootFolder: '', snoozed }, '2026-10-23');
  const base = await run({});
  assert.deepStrictEqual(base.needs.map(n => n.title), ['One', 'Two', 'Log a', 'Log b']);
  assert.deepStrictEqual(base.snoozed, []);
  const one = base.needs[0].key, logA = base.needs[2].key;
  assert.strictEqual(one, 'Efforts/A/README.md::One');

  const d = await run({ [one]: '2026-10-24', [logA]: 'forever', 'gone::x': '2026-10-01' });
  assert.deepStrictEqual(d.needs.map(n => n.title), ['Two', 'Three', 'Log b'], 'snoozed items leave, the next one steps up');
  assert.deepStrictEqual(d.snoozed.map(n => [n.title, n.until]), [['One', '2026-10-24'], ['Log a', 'forever']]);

  const later = await collect(nodeIO(root), { rootFolder: '', snoozed: { [one]: '2026-10-24' } }, '2026-10-24');
  assert.strictEqual(later.needs[0].title, 'One', 'a day snooze ends on its date');
});

test('skipping sets the lever aside until its date; all skipped shows the first again', async () => {
  const root = makeVault({ 'Efforts/A/README.md': '# A\n## Todo List\n### Immediate\n- [ ] One\n- [ ] Two\n- [ ] Three\n' });
  const run = (skipped, day = '2026-10-23') => collect(nodeIO(root), { rootFolder: '', skipped }, day).then(d => d.efforts[0]);
  const a = await run({});
  assert.deepStrictEqual([a.lever, a.canSkip, a.skipped, a.leverKey], ['One', true, 0, 'Efforts/A/README.md::One']);
  const b = await run({ 'Efforts/A/README.md::One': '2026-10-30' });
  assert.deepStrictEqual([b.lever, b.canSkip, b.skipped], ['Two', true, 1]);
  assert.strictEqual((await run({ 'Efforts/A/README.md::One': '2026-10-30' }, '2026-10-30')).lever, 'One', 'a skip ends on its date');
  const all = await run({ 'Efforts/A/README.md::One': '2026-10-30', 'Efforts/A/README.md::Two': '2026-10-30', 'Efforts/A/README.md::Three': '2026-10-30' });
  assert.deepStrictEqual([all.lever, all.canSkip, all.skipped], ['One', false, 3]);
});

test('order puts chosen efforts first, then the rest by recency; calendar days and atlas notes are listed', async () => {
  const root = makeVault({
    'Efforts/A/README.md': '# A\n', 'Efforts/B/README.md': '# B\n', 'Efforts/C/README.md': '# C\n',
    'Calendar/2026-10-18.md': 'd', 'Calendar/2026-10-18-meeting.md': 'm', 'Calendar/templates/daily-note.md': 't', 'Calendar/README.md': 'r',
    'Atlas/Concept.md': 'c', 'Atlas/Maps/Library.md': 'l', 'Atlas/Ideas/Deep/Thing.md': 't', 'Atlas/README.md': 'r'
  });
  const d = await collect(nodeIO(root), { rootFolder: '', order: ['C', 'A'] }, '2026-10-23');
  assert.deepStrictEqual(d.efforts.map(e => [e.name, e.pinned]), [['C', true], ['A', true], ['B', false]]);
  assert.deepStrictEqual(Object.keys(d.layers.calendar.days), ['2026-10-18']);
  assert.deepStrictEqual(d.layers.calendar.days['2026-10-18'].map(n => [n.name, n.daily]), [['2026-10-18', true], ['2026-10-18-meeting', false]]);
  assert.deepStrictEqual(d.layers.atlas.notes.map(n => [n.name, n.folder]), [['Concept', ''], ['Thing', 'Ideas/Deep']]);
});
