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
      completeLever: ref => plugin.completeLever(ref),
      addTodo: (target, text) => plugin.addTodo(target, text),
      capture: text => plugin.capture(text),
      createEffort: name => plugin.createEffort(name),
      logMeeting: m => plugin.logMeeting(m),
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

  async ensureFolder(dir) {
    let at = '';
    for (const part of dir.split('/').filter(Boolean)) {
      at = at ? `${at}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(at)) await this.app.vault.createFolder(at);
    }
  }

  underRoot(rel) { const r = (this.settings.rootFolder || '').replace(/\/+$/, ''); return r ? `${r}/${rel}` : rel; }

  // Ticks off the lever in its source note (or moves its Kanban card to the done lane). The Notice offers Undo,
  // which puts the note back only if nothing else has changed it since.
  async completeLever(ref) {
    const f = ref && this.app.vault.getAbstractFileByPath(ref.path);
    if (!(f instanceof TFile)) { new Notice('Ideaverse home: the note for this lever no longer exists.'); return false; }
    let before = null, after = null;
    await this.app.vault.process(f, text => {
      const next = ref.kind === 'board' ? P.completeBoardCard(text, ref.text) : P.checkOffItem(text, ref.text);
      if (next === null) return text;
      before = text; after = next; return next;
    });
    if (after === null) { new Notice('Ideaverse home: could not find that item in the note. It may have been edited.'); return false; }
    const frag = createFragment();
    frag.createSpan({ text: `Done: ${P.trunc(ref.text, 70)} ` });
    const undo = frag.createEl('button', { text: 'Undo' });
    const note = new Notice(frag, 10000);
    undo.addEventListener('click', async () => {
      note.hide();
      let restored = false;
      await this.app.vault.process(f, text => { if (text === after) { restored = true; return before; } return text; });
      new Notice(restored ? 'Undone.' : 'Ideaverse home: the note changed since, so it was left alone.');
      this.refresh();
    });
    await this.refresh();
    return true;
  }

  // Adds a todo to the note named by an effort's todoTarget. Only adds a line; nothing existing is rewritten.
  async addTodo(target, text) {
    try {
      const f = target && this.app.vault.getAbstractFileByPath(target.path);
      if (!(f instanceof TFile)) throw new Error('The note no longer exists.');
      let done = false;
      await this.app.vault.process(f, t => {
        const next = target.kind === 'board' ? P.addBoardCard(t, text) : P.addTodoItem(t, text);
        if (next === null) return t;
        done = true; return next;
      });
      if (!done) throw new Error('Nothing to add, or no lane to add it to.');
      new Notice(`Added to ${target.label}`);
      await this.refresh();
      return true;
    } catch (e) {
      new Notice(`Ideaverse home: could not add the todo. ${e.message}`);
      return false;
    }
  }

  // Appends a line to today's scratch note (AIOS/Scratch/scratch-YYYY-MM-DD.md), creating it if needed.
  async capture(text) {
    try {
      const d = new Date(), time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, day = localIso();
      const path = this.underRoot(`AIOS/Scratch/scratch-${day}.md`), f = this.app.vault.getAbstractFileByPath(path);
      if (P.appendCapture('', time, text) === null) throw new Error('Write something to capture.');
      if (f instanceof TFile) await this.app.vault.process(f, t => P.appendCapture(t, time, text));
      else {
        await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
        await this.app.vault.create(path, `# Scratch ${day}\n\n` + P.appendCapture('', time, text));
      }
      new Notice(`Captured in ${path.split('/').pop()}`);
      return true;
    } catch (e) {
      new Notice(`Ideaverse home: could not capture. ${e.message}`);
      return false;
    }
  }

  // Creates Efforts/<name>/README.md from a small template. Resolves to the new folder, or '' if nothing was created.
  async createEffort(name) {
    name = String(name || '').trim();
    try {
      if (!name) throw new Error('Give the effort a name.');
      if (/[\\/:*?"<>|#^[\]]/.test(name) || /^\./.test(name)) throw new Error('Names cannot contain \\ / : * ? " < > | # ^ [ ] or start with a dot.');
      if (name.toLowerCase() === ARCHIVE.toLowerCase()) throw new Error(`"${ARCHIVE}" is where archived efforts go.`);
      const folder = this.underRoot(`Efforts/${name}`);
      const clash = [folder, this.underRoot(`Efforts/${ARCHIVE}/${name}`)].find(p => this.app.vault.getAbstractFileByPath(p));
      if (clash) throw new Error(`${clash} already exists.`);
      if (!this.app.vault.getAbstractFileByPath(this.underRoot('Efforts'))) await this.app.vault.createFolder(this.underRoot('Efforts'));
      await this.app.vault.createFolder(folder);
      await this.app.vault.create(`${folder}/README.md`, P.newEffortReadme(name, localIso()));
      new Notice(`Created ${folder}`);
      await this.refresh();
      return folder;
    } catch (e) {
      new Notice(`Ideaverse home: could not create the effort. ${e.message}`);
      return '';
    }
  }

  // Appends a meeting to that month's session log (AIOS/Logs/log-YYYY-MM.md), creating the file if needed. Never rewrites earlier text.
  async logMeeting(m) {
    try {
      if (!String(m.title || '').trim()) throw new Error('Give the meeting a title.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw new Error('Pick a date.');
      const month = m.date.slice(0, 7);
      const path = this.underRoot(this.settings.logLayout === 'day' ? `AIOS/Logs/${month}/log-${m.date}.md` : `AIOS/Logs/log-${month}.md`), entry = P.formatMeetingEntry(m);
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile) await this.app.vault.process(f, text => text.replace(/\s*$/, '') + '\n\n' + entry);
      else {
        await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
        await this.app.vault.create(path, entry);
      }
      new Notice(`Logged "${m.title.trim()}" in ${path.split('/').pop()}`);
      await this.refresh();
      return true;
    } catch (e) {
      new Notice(`Ideaverse home: could not log the meeting. ${e.message}`);
      return false;
    }
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
    new Setting(el).setName('Session log files').setDesc('Where + Meeting writes. Both layouts are always read.')
      .addDropdown(d => d.addOption('month', 'One file per month (AIOS/Logs/log-YYYY-MM.md)').addOption('day', 'One file per day (AIOS/Logs/YYYY-MM/log-YYYY-MM-DD.md)').setValue(s.logLayout).onChange(async v => { s.logLayout = v; await save(); }));
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
