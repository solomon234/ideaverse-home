'use strict';
// Loads the built dist/main.js with a stubbed Obsidian API and exercises the plugin's glue.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const DIST = path.join(__dirname, '../dist/main.js');

globalThis.window = globalThis.window || { setInterval: () => 0 }; // Obsidian provides window

function loadPlugin() {
  class Plugin { constructor(app) { this.app = app; this.saved = null; this.events = []; this.cmds = []; this.ribbon = []; this.viewFactories = {}; }
    async loadData() { return this.saved; } async saveData(d) { this.saved = d; }
    registerView(t, f) { this.viewFactories[t] = f; } addRibbonIcon(i, t, cb) { this.ribbon.push(t); } addCommand(c) { this.cmds.push(c.id); } addSettingTab() {}
    registerEvent(e) { this.events.push(e); } register() {} registerInterval() {} }
  class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = {}; } }
  class TFile { constructor(p) { this.path = p; } }
  class TFolder { constructor(p) { this.path = p; } }
  const stub = { Plugin, ItemView, TFile, TFolder, PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(m) { stub.notices.push(m); } }, notices: [] };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'obsidian' ? stub : orig.call(this, req, ...rest); };
  delete require.cache[DIST];
  const Cls = require(DIST);
  Module._load = orig;
  return { Cls, TFile, TFolder, stub };
}

test('built bundle exists and loads', { skip: !fs.existsSync(DIST) && 'run npm run build first' }, async () => {
  const { Cls, TFile } = loadPlugin();
  const files = { 'P/a.md': '---\nstatus: pending\n# keep\n---\n# A' };
  const app = {
    vault: {
      on: (ev, fn) => ({ ev, fn }),
      getAbstractFileByPath: p => (files[p] !== undefined ? new TFile(p) : null),
      process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
      adapter: {}
    },
    workspace: { onLayoutReady: fn => fn(), getLeavesOfType: () => [] }
  };
  const plugin = new Cls(app);
  await plugin.onload();

  assert.ok(plugin.viewFactories['ideaverse-home'], 'view registered');
  assert.deepStrictEqual(plugin.cmds, ['open-ideaverse-home']);
  assert.strictEqual(plugin.events.length, 4, 'listens to modify, create, delete, rename');
  assert.strictEqual(plugin.settings.rootFolder, '');
  assert.deepStrictEqual(plugin.settings.efforts, {});

  // proposal status change touches only the status line and reports the previous value
  const prev = await plugin.setProposalStatus('P/a.md', 'promoted');
  assert.strictEqual(prev, 'pending');
  assert.strictEqual(files['P/a.md'], '---\nstatus: promoted\n# keep\n---\n# A');
  const back = await plugin.setProposalStatus('P/a.md', 'pending');
  assert.strictEqual(back, 'promoted');
  assert.strictEqual(files['P/a.md'], '---\nstatus: pending\n# keep\n---\n# A');
  await assert.rejects(() => plugin.setProposalStatus('P/missing.md', 'dismissed'));

  // saved settings win over defaults, and missing keys fall back to them
  plugin.saved = { rootFolder: 'Other', efforts: { Foo: { lever: 'x' } } };
  await plugin.loadSettings();
  assert.strictEqual(plugin.settings.rootFolder, 'Other');
  assert.strictEqual(plugin.settings.staleDays, 60);
  assert.strictEqual(plugin.settings.efforts.Foo.lever, 'x');
});

test('new effort, meeting log and lever completion write what they say they write', { skip: !fs.existsSync(DIST) && 'run npm run build first' }, async () => {
  const { Cls, TFile, TFolder, stub } = loadPlugin();
  globalThis.createFragment = () => ({ createSpan() {}, createEl: () => ({ addEventListener() {} }) });
  const files = { 'V/Efforts/Old/README.md': '# Old\n', 'V/Efforts/A/README.md': '# A\n- [ ] One\n- [ ] Two\n', 'V/AIOS/Logs/log-2026-10.md': '---\n**2026-10-01** — First\n---\n' };
  const folders = new Set(['V', 'V/Efforts', 'V/Efforts/Old', 'V/Efforts/A', 'V/AIOS', 'V/AIOS/Logs']);
  const app = {
    vault: {
      on: () => ({}),
      getAbstractFileByPath: p => (files[p] !== undefined ? new TFile(p) : folders.has(p) ? new TFolder(p) : null),
      process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
      createFolder: async p => { folders.add(p); },
      create: async (p, t) => { files[p] = t; },
      adapter: {}
    },
    workspace: { onLayoutReady: fn => fn(), getLeavesOfType: () => [] }
  };
  const plugin = new Cls(app);
  await plugin.onload();
  plugin.settings.rootFolder = 'V';

  const made = await plugin.createEffort('Kitchen'); assert.strictEqual(made, 'V/Efforts/Kitchen', JSON.stringify(stub.notices));
  assert.ok(files['V/Efforts/Kitchen/README.md'].startsWith('# Kitchen\n'));
  for (const bad of ['', 'Old', 'a/b', 'Archived', 'x#y']) assert.strictEqual(await plugin.createEffort(bad), '', bad);
  assert.strictEqual(Object.keys(files).filter(k => k.includes('Efforts/')).length, 3, 'rejected names created nothing');

  assert.strictEqual(await plugin.logMeeting({ date: '2026-10-23', title: 'Sync', with: 'Sam', outcome: 'ok', open: 'a; b' }), true);
  assert.strictEqual(files['V/AIOS/Logs/log-2026-10.md'], '---\n**2026-10-01** — First\n---\n\n**2026-10-23 (meeting)** — Sync\n- With: Sam\n- Outcome: ok\n- Open: a; b\n---\n');
  assert.strictEqual(await plugin.logMeeting({ date: '2026-11-02', title: 'New month' }), true);
  assert.ok(files['V/AIOS/Logs/log-2026-11.md'].startsWith('**2026-11-02 (meeting)** — New month'));
  plugin.settings.logLayout = 'day';
  assert.strictEqual(await plugin.logMeeting({ date: '2026-12-03', title: 'Day layout' }), true);
  assert.strictEqual(files['V/AIOS/Logs/2026-12/log-2026-12-03.md'], '**2026-12-03 (meeting)** — Day layout\n---\n');
  plugin.settings.logLayout = 'month';
  assert.strictEqual(await plugin.logMeeting({ date: 'nope', title: 'x' }), false);
  assert.strictEqual(await plugin.logMeeting({ date: '2026-10-23', title: '  ' }), false);

  assert.strictEqual(await plugin.completeLever({ kind: 'todo', path: 'V/Efforts/A/README.md', text: 'One' }), true);
  assert.strictEqual(files['V/Efforts/A/README.md'], '# A\n- [x] One\n- [ ] Two\n');
  assert.strictEqual(await plugin.addTodo({ kind: 'todo', path: 'V/Efforts/A/README.md', label: 'x' }, 'Three'), true);
  assert.strictEqual(files['V/Efforts/A/README.md'], '# A\n- [x] One\n- [ ] Two\n\n## Todo List\n\n### Immediate\n\n- [ ] Three\n');
  assert.strictEqual(await plugin.addTodo({ kind: 'todo', path: 'V/Efforts/A/README.md', label: 'x' }, '  '), false);
  assert.strictEqual(await plugin.capture('a thought'), true);
  const scratch = Object.keys(files).find(k => k.startsWith('V/AIOS/Scratch/scratch-'));
  assert.ok(/^# Scratch \d{4}-\d{2}-\d{2}\n\n## Quick capture\n\n- \d\d:\d\d — a thought\n$/.test(files[scratch]));
  assert.strictEqual(await plugin.capture(' '), false);
  assert.strictEqual(await plugin.completeLever({ kind: 'todo', path: 'V/Efforts/A/README.md', text: 'Gone' }), false);
  assert.ok(files['V/Efforts/A/README.md'].includes('- [x] One\n- [ ] Two\n'), 'a missed target leaves the note alone');
});

test('background Claude runs pass read-only arguments, return the answer, and can be switched off', { skip: !fs.existsSync(DIST) && 'run npm run build first' }, async () => {
  const os = require('os');
  const { Cls, TFile, TFolder, stub } = loadPlugin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-claude-'));
  const fake = path.join(dir, 'claude');
  fs.writeFileSync(fake, '#!/bin/sh\nif [ "$FAKE_FAIL" = 1 ]; then echo "not logged in" >&2; exit 1; fi\necho "ARGS: $*"\necho "CWD: $(pwd)"\n');
  fs.chmodSync(fake, 0o755);
  const files = { 'V/Efforts/A/README.md': '# A\n' }, folders = new Set(['V', 'V/Efforts', 'V/Efforts/A']);
  const app = {
    vault: { on: () => ({}), getAbstractFileByPath: p => (files[p] !== undefined ? new TFile(p) : folders.has(p) ? new TFolder(p) : null), process: async () => {}, adapter: { getBasePath: () => dir } },
    workspace: { onLayoutReady: fn => fn(), getLeavesOfType: () => [] }
  };
  fs.mkdirSync(path.join(dir, 'V/Efforts/A'), { recursive: true });
  const plugin = new Cls(app);
  await plugin.onload();
  Object.assign(plugin.settings, { rootFolder: 'V', claudeMode: 'background', claudePath: fake });

  const r = await plugin.claudeRun('ask', { folder: 'V/Efforts/A', name: 'A', question: 'what next?' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(r.text.includes('--tools Read,Grep,Glob'), r.text);
  assert.ok(r.text.includes('what next?'));
  assert.ok(r.text.includes('CWD: ' + fs.realpathSync(path.join(dir, 'V/Efforts/A'))), r.text);

  process.env.FAKE_FAIL = '1';
  const bad = await plugin.claudeRun('triage', { paths: ['V/AIOS/Proposals/a.md'] });
  delete process.env.FAKE_FAIL;
  assert.deepStrictEqual([bad.ok, bad.error], [false, 'not logged in']);

  assert.strictEqual((await plugin.claudeRun('triage', { paths: [] })).ok, false, 'nothing to triage');
  assert.strictEqual((await plugin.claudeRun('ask', { folder: 'V/Efforts/A', name: 'A', question: ' ' })).ok, false);
  plugin.settings.claudePath = path.join(dir, 'missing');
  assert.match((await plugin.claudeRun('ask', { folder: 'V/Efforts/A', name: 'A', question: 'x' })).error, /Could not find the claude command/);
  plugin.settings.claudeMode = 'off';
  assert.match((await plugin.claudeRun('ask', {})).error, /switched off/);
});

test('a drafted log entry is checked before it is added', { skip: !fs.existsSync(DIST) && 'run npm run build first' }, async () => {
  const { Cls, TFile, TFolder } = loadPlugin();
  const files = {}, folders = new Set(['V']);
  const app = {
    vault: { on: () => ({}), getAbstractFileByPath: p => (files[p] !== undefined ? new TFile(p) : folders.has(p) ? new TFolder(p) : null), process: async (f, fn) => { files[f.path] = fn(files[f.path]); }, createFolder: async p => { folders.add(p); }, create: async (p, t) => { files[p] = t; }, adapter: {} },
    workspace: { onLayoutReady: fn => fn(), getLeavesOfType: () => [] }
  };
  const plugin = new Cls(app);
  await plugin.onload();
  Object.assign(plugin.settings, { rootFolder: 'V', logLayout: 'day' });
  assert.strictEqual(await plugin.appendLog('no entry here'), false);
  assert.strictEqual(await plugin.appendLog('Sure!\n**2026-10-23 (x)** — T\n- Built: a'), true);
  assert.strictEqual(files['V/AIOS/Logs/2026-10/log-2026-10-23.md'], '**2026-10-23 (x)** — T\n- Built: a\n---\n');
  assert.strictEqual(Object.keys(files).length, 1);
});

test('snooze stores an expiry in settings only, drops expired ones, and un-snooze removes it', { skip: !fs.existsSync(DIST) && 'run npm run build first' }, async () => {
  const { Cls } = loadPlugin();
  const app = { vault: { on: () => ({}), adapter: {} }, workspace: { onLayoutReady: fn => fn(), getLeavesOfType: () => [] } };
  const plugin = new Cls(app);
  await plugin.onload();
  plugin.settings.snoozed = { old: '2000-01-01', keep: 'forever' };
  await plugin.snooze('a::b', 'week');
  await plugin.snooze('c::d', 'forever');
  assert.deepStrictEqual(Object.keys(plugin.settings.snoozed).sort(), ['a::b', 'c::d', 'keep']);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(plugin.settings.snoozed['a::b']));
  assert.strictEqual(plugin.saved.snoozed['c::d'], 'forever', 'saved to the plugin data file');
  await plugin.unsnooze('c::d');
  assert.strictEqual('c::d' in plugin.settings.snoozed, false);
});
