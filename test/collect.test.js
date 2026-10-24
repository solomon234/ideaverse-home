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
