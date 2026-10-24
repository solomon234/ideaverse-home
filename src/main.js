'use strict';
// Obsidian glue: registers the view, reads the vault into the io interface, keeps the dashboard live.
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, TFolder } = require('obsidian');
const { collect, DEFAULT_SETTINGS, ARCHIVE } = require('./collect');
const { mount } = require('./ui');
const P = require('./parse');

const VIEW = 'ideaverse-home';

const localIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function obsidianIO(app) {
  const a = app.vault.adapter;
  const base = typeof a.getBasePath === 'function' ? a.getBasePath() : null;
  const visible = p => !p.split('/').pop().startsWith('.');
  return {
    async list(dir) { const l = await a.list(dir || '/'); return { files: l.files.filter(visible), folders: l.folders.filter(visible) }; },
    read: p => a.read(p),
    exists: p => a.exists(p),
    async mtimeIso(p) { const s = await a.stat(p); return s ? new Date(s.mtime).toISOString().slice(0, 10) : '1970-01-01'; },
    // git history of a folder gives the activity strip; without git (or on mobile) the strip is simply empty
    gitDates(p) {
      return new Promise(res => {
        if (!base) return res([]);
        try {
          require('child_process').execFile('git', ['-C', base, 'log', '--format=%cs', '--', p], { maxBuffer: 8e6 }, (err, out) => res(err ? [] : out.split('\n').filter(Boolean)));
        } catch (e) { res([]); }
      });
    }
  };
}

class HomeView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.ui = null; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Ideaverse'; }
  getIcon() { return 'layout-dashboard'; }
  async onOpen() {
    const plugin = this.plugin;
    this.ui = mount(this.contentEl, {
      open: path => plugin.openPath(path),
      setProposalStatus: (path, status) => plugin.setProposalStatus(path, status),
      archiveEffort: folder => plugin.moveEffort(folder, true),
      restoreEffort: folder => plugin.moveEffort(folder, false)
    });
    await plugin.refresh();
    this.ui.focus();
  }
  async onClose() { if (this.ui) this.ui.destroy(); this.ui = null; }
}

module.exports = class IdeaverseHome extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW, leaf => new HomeView(leaf, this));
    this.addRibbonIcon('layout-dashboard', 'Open Ideaverse home', () => this.activate());
    this.addCommand({ id: 'open-ideaverse-home', name: 'Open Ideaverse home', callback: () => this.activate() });
    this.addSettingTab(new HomeSettings(this.app, this));

    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => this.refresh(), 2500); };
    for (const ev of ['modify', 'create', 'delete', 'rename']) this.registerEvent(this.app.vault.on(ev, later));
    this.register(() => clearTimeout(timer));
    this.registerInterval(window.setInterval(() => this.refresh(), 10 * 60 * 1000)); // keeps "days ago" honest overnight

    if (this.settings.openOnStartup) this.app.workspace.onLayoutReady(() => this.activate());
  }

  async loadSettings() {
    const saved = (await this.loadData()) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved, { efforts: Object.assign({}, DEFAULT_SETTINGS.efforts, saved.efforts) });
  }
  async saveSettings() { await this.saveData(this.settings); }

  views() { return this.app.workspace.getLeavesOfType(VIEW).map(l => l.view).filter(v => v && v.ui); }

  async activate() {
    const existing = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (existing) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refresh() {
    const open = this.views();
    if (!open.length) return;
    try {
      const data = await collect(obsidianIO(this.app), this.settings, localIso());
      data.staleDays = this.settings.staleDays;
      for (const v of open) v.ui.update(data);
    } catch (e) {
      console.error('[ideaverse-home] could not read the vault', e);
      new Notice('Ideaverse home: could not read the vault. See the console.');
    }
  }

  openPath(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) this.app.workspace.getLeaf('tab').openFile(f);
    else new Notice(`Ideaverse home: ${path} no longer exists.`);
  }

  // Only the status line in the proposal's frontmatter changes. Resolves to the previous status so the UI can offer undo.
  async setProposalStatus(path, status) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error('Proposal not found: ' + path);
    let prev = '';
    await this.app.vault.process(f, text => { prev = (P.splitFrontmatter(text).fm.status || '').toLowerCase(); return P.setFrontmatterStatus(text, status); });
    return prev;
  }

  // Archiving moves the effort's whole folder to Efforts/Archived/<name>; restoring moves it back to Efforts/<name>.
  // fileManager.renameFile keeps links to the moved notes working. Resolves to true when the move happened.
  async moveEffort(folder, archive) {
    const src = this.app.vault.getAbstractFileByPath(folder);
    const name = folder.split('/').pop(), efforts = folder.split('/').slice(0, -(archive ? 1 : 2)).join('/');
    const dest = archive ? `${efforts}/${ARCHIVE}/${name}` : `${efforts}/${name}`;
    try {
      if (!(src instanceof TFolder)) throw new Error(`${folder} is not a folder`);
      if (this.app.vault.getAbstractFileByPath(dest)) throw new Error(`${dest} already exists`);
      const parent = dest.split('/').slice(0, -1).join('/');
      if (!this.app.vault.getAbstractFileByPath(parent)) await this.app.vault.createFolder(parent);
      await this.app.fileManager.renameFile(src, dest);
    } catch (e) {
      new Notice(`Ideaverse home: could not ${archive ? 'archive' : 'restore'} ${name}. ${e.message}`);
      return false;
    }
    new Notice(archive ? `Archived ${name} to ${dest}` : `Restored ${name} to ${dest}`);
    await this.refresh();
    return true;
  }
};

class HomeSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl: el } = this, s = this.plugin.settings, save = async () => { await this.plugin.saveSettings(); this.plugin.refresh(); };
    el.empty();
    new Setting(el).setName('Root folder').setDesc('Folder in the vault that holds Efforts, AIOS, Atlas and Calendar. Leave empty if they are at the vault root.')
      .addText(t => t.setValue(s.rootFolder).onChange(async v => { s.rootFolder = v.trim(); await save(); }));
    new Setting(el).setName('Open on startup').setDesc('Open the dashboard when Obsidian starts.')
      .addToggle(t => t.setValue(s.openOnStartup).onChange(async v => { s.openOnStartup = v; await save(); }));
    new Setting(el).setName('Dim an effort after (days)').setDesc('Efforts with no change for this long fade on their screen.')
      .addText(t => t.setValue(String(s.staleDays)).onChange(async v => { const n = parseInt(v, 10); if (n > 0) { s.staleDays = n; await save(); } }));
    new Setting(el).setName('Per-effort overrides').setDesc('JSON keyed by effort folder name. Supports "lever" (text) and "art" (a picture that cannot be read from a note, for example a map of services).')
      .addTextArea(t => {
        t.inputEl.rows = 12; t.inputEl.style.width = '100%'; t.inputEl.style.fontFamily = 'var(--font-monospace)';
        t.setValue(JSON.stringify(s.efforts, null, 2)).onChange(async v => {
          try { s.efforts = JSON.parse(v); t.inputEl.style.borderColor = ''; await save(); } catch (e) { t.inputEl.style.borderColor = 'var(--text-error)'; }
        });
      });
  }
}
