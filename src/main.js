'use strict';
// Obsidian glue: registers the view, reads the vault into the io interface, keeps the dashboard live.
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, TFolder } = require('obsidian');
const { collect, DEFAULT_SETTINGS, ARCHIVE } = require('./collect');
const { mount } = require('./ui');
const P = require('./parse');
const K = require('./claude');

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
      setStatus: (path, word) => plugin.setEffortStatus(path, word),
      skipLever: key => plugin.skipLever(key),
      clearSkips: folder => plugin.clearSkips(folder),
      setOrder: names => plugin.setOrder(names),
      createDailyNote: date => plugin.createDailyNote(date),
      snooze: (key, how) => plugin.snooze(key, how),
      unsnooze: key => plugin.unsnooze(key),
      claudeRun: (kind, payload) => plugin.claudeRun(kind, payload),
      claudeCancel: () => plugin.claudeCancel(),
      appendLog: text => plugin.appendLog(text),
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
      data.claudeMode = this.settings.claudeMode;
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

  // Runs transform(text) on a note and offers Undo in a Notice. transform returns the new text, or null if it cannot apply.
  // Undo puts the note back only if nothing else has changed it since. Resolves to true if the note was changed.
  async editWithUndo(f, transform, message, failMessage) {
    let before = null, after = null;
    await this.app.vault.process(f, text => {
      const next = transform(text);
      if (next === null || next === text) return text;
      before = text; after = next; return next;
    });
    if (after === null) { new Notice(failMessage); return false; }
    const frag = createFragment();
    frag.createSpan({ text: message + ' ' });
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

  // Ticks off the lever in its source note (or moves its Kanban card to the done lane).
  async completeLever(ref) {
    const f = ref && this.app.vault.getAbstractFileByPath(ref.path);
    if (!(f instanceof TFile)) { new Notice('Ideaverse home: the note for this lever no longer exists.'); return false; }
    return this.editWithUndo(f, t => (ref.kind === 'board' ? P.completeBoardCard(t, ref.text) : P.checkOffItem(t, ref.text)),
      `Done: ${P.trunc(ref.text, 70)}`, 'Ideaverse home: could not find that item in the note. It may have been edited.');
  }

  // Changes the status word on an effort's README, keeping any note after the dash.
  async setEffortStatus(path, word) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice('Ideaverse home: that note no longer exists.'); return false; }
    return this.editWithUndo(f, t => P.setEffortStatus(t, word), `Status set to ${word}.`, 'Ideaverse home: the status was already that.');
  }

  // "Not this one": set the lever aside for a week. Kept in settings, not in a note.
  async skipLever(key) {
    const today = localIso(), kept = {};
    for (const [k, v] of Object.entries(this.settings.skipped || {})) if (v > today) kept[k] = v;
    kept[key] = P.addDays(today, 7);
    this.settings.skipped = kept;
    await this.saveSettings();
    await this.refresh();
    return true;
  }

  async clearSkips(folder) {
    const kept = {};
    for (const [k, v] of Object.entries(this.settings.skipped || {})) if (!k.startsWith(folder + '/')) kept[k] = v;
    this.settings.skipped = kept;
    await this.saveSettings();
    await this.refresh();
    return true;
  }

  // names: effort folder names in the order to show them; an empty list goes back to most recently changed first.
  async setOrder(names) {
    this.settings.order = names;
    await this.saveSettings();
    await this.refresh();
    return true;
  }

  // Creates Calendar/<date>.md from Calendar/templates/daily-note.md if there is one. Resolves to the note's path ('' on failure).
  async createDailyNote(date) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Pick a date.');
      const path = this.underRoot(`Calendar/${date}.md`);
      if (this.app.vault.getAbstractFileByPath(path)) return path;
      const tpl = this.app.vault.getAbstractFileByPath(this.underRoot('Calendar/templates/daily-note.md'));
      const text = P.dailyNoteFrom(tpl instanceof TFile ? await this.app.vault.read(tpl) : '', date);
      await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
      await this.app.vault.create(path, text);
      new Notice(`Created ${path.split('/').pop()}`);
      await this.refresh();
      return path;
    } catch (e) {
      new Notice(`Ideaverse home: could not create the daily note. ${e.message}`);
      return '';
    }
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

  // Appends an entry to the end of that date's session log (a day file or the month's file, by setting), creating it if needed.
  // Never rewrites earlier text. Resolves to the file name written.
  async appendLogEntry(date, entry) {
    const month = date.slice(0, 7);
    const path = this.underRoot(this.settings.logLayout === 'day' ? `AIOS/Logs/${month}/log-${date}.md` : `AIOS/Logs/log-${month}.md`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.vault.process(f, text => text.replace(/\s*$/, '') + '\n\n' + entry);
    else {
      await this.ensureFolder(path.split('/').slice(0, -1).join('/'));
      await this.app.vault.create(path, entry);
    }
    return path.split('/').pop();
  }

  async logMeeting(m) {
    try {
      if (!String(m.title || '').trim()) throw new Error('Give the meeting a title.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) throw new Error('Pick a date.');
      const file = await this.appendLogEntry(m.date, P.formatMeetingEntry(m));
      new Notice(`Logged "${m.title.trim()}" in ${file}`);
      await this.refresh();
      return true;
    } catch (e) {
      new Notice(`Ideaverse home: could not log the meeting. ${e.message}`);
      return false;
    }
  }

  // Hides a "Needs you" item for a day, a week or for good. Kept in the plugin's settings, never in a note.
  async snooze(key, how) {
    const today = localIso(), until = how === 'forever' ? 'forever' : P.addDays(today, how === 'week' ? 7 : 1);
    const kept = {};
    for (const [k, v] of Object.entries(this.settings.snoozed || {})) if (v === 'forever' || v > today) kept[k] = v; // drops expired ones
    kept[key] = until;
    this.settings.snoozed = kept;
    await this.saveSettings();
    await this.refresh();
    return true;
  }

  async unsnooze(key) {
    const kept = Object.assign({}, this.settings.snoozed);
    delete kept[key];
    this.settings.snoozed = kept;
    await this.saveSettings();
    await this.refresh();
    return true;
  }

  // Adds a drafted entry (from "Draft today's log entry") after checking it has the log's shape.
  async appendLog(text) {
    try {
      const entry = K.cleanLogEntry(text), date = K.entryDate(entry || '');
      if (!entry || !date) throw new Error('The draft is not in the log format.');
      const file = await this.appendLogEntry(date, entry);
      new Notice(`Added to ${file}`);
      await this.refresh();
      return true;
    } catch (e) {
      new Notice(`Ideaverse home: could not add the entry. ${e.message}`);
      return false;
    }
  }

  // ---- Claude Code (optional). Background runs are read-only; Terminal runs are an ordinary interactive session. ----
  baseAbs() { const a = this.app.vault.adapter; return typeof a.getBasePath === 'function' ? a.getBasePath() : null; }

  // The root folder on disk (where Efforts, AIOS and the vault's CLAUDE.md live); Claude runs from here or from an effort folder.
  rootAbs() {
    const base = this.baseAbs(), root = (this.settings.rootFolder || '').replace(/\/+$/, '');
    return base ? (root ? `${base}/${root}` : base) : null;
  }

  claudeBinary() {
    const fs = require('fs'), home = require('os').homedir();
    if (this.settings.claudePath) return fs.existsSync(this.settings.claudePath) ? this.settings.claudePath : null;
    return ['/opt/homebrew/bin/claude', '/usr/local/bin/claude', `${home}/.local/bin/claude`, `${home}/.claude/local/claude`].find(p => fs.existsSync(p)) || null;
  }

  // Today's commits and uncommitted files, as plain text for the log draft. Empty if git is not available.
  gitText(args) {
    return new Promise(res => {
      const root = this.rootAbs();
      if (!root) return res('');
      try { require('child_process').execFile('git', ['-C', root, ...args], { maxBuffer: 4e6 }, (err, out) => res(err ? '' : out.trim().slice(0, 5000))); } catch (e) { res(''); }
    });
  }

  async claudeTask(kind, p) {
    const root = this.rootAbs();
    if (!root) throw new Error('This vault is not on disk, so Claude cannot read it.');
    if (kind === 'ask') {
      if (!String(p.question || '').trim()) throw new Error('Type a question first.');
      return { cwd: `${this.baseAbs()}/${p.folder}`, prompt: K.ask(p.name, p.question), title: `Ask about ${p.name}` };
    }
    if (kind === 'triage') {
      const prefix = (this.settings.rootFolder || '').replace(/\/+$/, ''), strip = x => (prefix && x.startsWith(prefix + '/') ? x.slice(prefix.length + 1) : x);
      if (!p.paths.length) throw new Error('No proposals are waiting.');
      return { cwd: root, prompt: K.triage(p.paths.map(strip)), title: 'Proposal triage' };
    }
    if (kind === 'log') {
      const date = localIso(), since = `${date}T00:00:00`;
      const changes = await this.gitText(['log', `--since=${since}`, '--format=%h %s', '--name-status']);
      const status = await this.gitText(['status', '--short', '--', '.']);
      return { cwd: root, prompt: K.logDraft({ date, changes, status }), title: `Draft log entry for ${date}`, draft: true };
    }
    throw new Error('Unknown request: ' + kind);
  }

  // Resolves to { ok, text, error, mode, draft }. Never throws.
  async claudeRun(kind, payload) {
    const mode = this.settings.claudeMode;
    try {
      if (mode === 'off') throw new Error('Claude is switched off in the plugin settings.');
      const bin = this.claudeBinary();
      if (!bin) throw new Error('Could not find the claude command. Set its path under Settings, Ideaverse Home.');
      const task = await this.claudeTask(kind, payload);
      if (mode === 'terminal') return await this.openInTerminal(bin, task);
      return await this.runHeadless(bin, task);
    } catch (e) {
      return { ok: false, error: e.message, mode };
    }
  }

  openInTerminal(bin, task) {
    return new Promise((resolve, reject) => {
      const cmd = `cd '${task.cwd.replace(/'/g, "'\\''")}' && '${bin}' '${task.prompt.replace(/'/g, "'\\''")}'`;
      if (process.platform !== 'darwin') {
        navigator.clipboard.writeText(cmd).then(() => resolve({ ok: true, mode: 'terminal', text: 'Terminal launch is macOS only here. The command is on your clipboard: paste it into a terminal.' }), reject);
        return;
      }
      require('child_process').execFile('osascript', ['-e', K.terminalScript(bin, task.cwd, task.prompt)], err =>
        err ? reject(new Error('Could not open Terminal. ' + err.message)) : resolve({ ok: true, mode: 'terminal', text: 'Opened in Terminal. Claude asks before it changes anything there.' }));
    });
  }

  runHeadless(bin, task) {
    return new Promise(resolve => {
      const home = require('os').homedir();
      const env = Object.assign({}, process.env, { PATH: [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.local/bin`].filter(Boolean).join(':') });
      const child = require('child_process').spawn(bin, K.headlessArgs(task.prompt), { cwd: task.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
      this.claudeProc = child;
      let out = '', err = '', done = false;
      const finish = r => { if (done) return; done = true; clearTimeout(timer); if (this.claudeProc === child) this.claudeProc = null; resolve(Object.assign({ mode: 'background', draft: !!task.draft }, r)); };
      const timer = setTimeout(() => { child.kill(); finish({ ok: false, error: 'Claude took longer than 4 minutes, so it was stopped.' }); }, 240000);
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { err += d; });
      child.on('error', e => finish({ ok: false, error: 'Could not start claude. ' + e.message }));
      child.on('close', (code, signal) => {
        if (signal) return finish({ ok: false, error: 'Stopped.', cancelled: true });
        if (code !== 0) return finish({ ok: false, error: (err.trim() || `claude exited with code ${code}`).slice(0, 600) });
        finish({ ok: true, text: out.trim() || '(no answer)' });
      });
    });
  }

  claudeCancel() { if (this.claudeProc) this.claudeProc.kill(); }

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
    new Setting(el).setName('Claude Code').setDesc('Adds Ask, proposal triage and a log draft. Terminal opens an interactive session that asks before changing anything. Background runs claude -p read-only (it can read your notes, not change them) and shows the answer here; it uses your Claude Code login, or your API key if ANTHROPIC_API_KEY is set where Obsidian starts.')
      .addDropdown(d => d.addOption('off', 'Off').addOption('terminal', 'Open in Terminal').addOption('background', 'Run in the background').setValue(s.claudeMode).onChange(async v => { s.claudeMode = v; await save(); }));
    new Setting(el).setName('Path to claude').setDesc('Leave empty to look in /opt/homebrew/bin, /usr/local/bin and ~/.local/bin.')
      .addText(t => t.setPlaceholder('/opt/homebrew/bin/claude').setValue(s.claudePath).onChange(async v => { s.claudePath = v.trim(); await save(); }));
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
