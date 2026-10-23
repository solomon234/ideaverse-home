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
  class Plugin { constructor(app) { this.app = app; this.saved = null; this.events = []; this.cmds = []; this.ribbon = []; this.views = {}; }
    async loadData() { return this.saved; } async saveData(d) { this.saved = d; }
    registerView(t, f) { this.views[t] = f; } addRibbonIcon(i, t, cb) { this.ribbon.push(t); } addCommand(c) { this.cmds.push(c.id); } addSettingTab() {}
    registerEvent(e) { this.events.push(e); } register() {} registerInterval() {} }
  class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = {}; } }
  class TFile { constructor(p) { this.path = p; } }
  const stub = { Plugin, ItemView, TFile, PluginSettingTab: class {}, Setting: class {}, Notice: class { constructor(m) { stub.notices.push(m); } }, notices: [] };
  const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'obsidian' ? stub : orig.call(this, req, ...rest); };
  delete require.cache[DIST];
  const Cls = require(DIST);
  Module._load = orig;
  return { Cls, TFile, stub };
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

  assert.ok(plugin.views['ideaverse-home'], 'view registered');
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
