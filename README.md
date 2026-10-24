# Ideaverse Home

An Obsidian plugin that gives a vault a home screen: **one effort per screen**, with arrows to move between them.

Each screen shows:

- the effort's **status**, read from its note;
- **the lever**: the smallest next move, taken from the first unchecked item under an "Immediate", "Next" or "Steps" heading (or the first open card on a Kanban board);
- a **weekly activity strip** from the git history of the effort's folder;
- a **picture drawn from the note itself**: a Kanban board as a grid of squares, a price table as a chart against a budget, a numbered steps list with its stop condition, or a todo list. Anything that cannot be read from a note, such as a map of services, can be described in settings.

The lever has **Mark done** and **Not this one** buttons, the status pill is a menu, and efforts can be moved earlier or later. The Calendar window is a month grid of your daily and meeting notes, and the Atlas window lists and filters its notes. The lever has a **Mark done** button. **+ Effort** and **+ Meeting** in the top bar (or `Cmd/Ctrl+K`) create an effort or log a meeting. Each effort can be **archived** (two clicks, under *About this effort*); archived efforts are listed in the command bar's *Archived efforts* view, where they can be restored.

A dock at the bottom opens **Atlas**, **Calendar**, a **proposals tray** and **recent sessions**. `Cmd/Ctrl+K` opens a command bar. An effort with no change for 60 days dims.

It is opinionated: it assumes a vault laid out like this, and shows a "No efforts found" screen if it does not find one.

```
<root>/
  Efforts/<name>/README.md      one folder per effort; the note holds status and todo lists
  Efforts/<name>/*.md           an optional Kanban board (obsidian-kanban format) is picked up automatically
  AIOS/Proposals/*.md           frontmatter: status (pending, draft, promoted, dismissed), proposed-to, topic, session
  AIOS/Logs/log-YYYY-MM.md      entries start with **YYYY-MM-DD** - Title; a "- Open:" line lists what is still open
  AIOS/Logs/YYYY-MM/log-YYYY-MM-DD.md   the same entries, one file per day; both layouts are read
  Atlas/   Calendar/            counted; Calendar reads YYYY-MM-DD.md daily notes
```

`<root>` is the plugin's **Root folder** setting (empty means the vault root).

## What it reads, writes and runs

- **Reads** markdown notes under the root folder. Nothing leaves your machine; there are no network calls.
- **Writes** only when you press a button, and only these things:
  - the `status:` line in a proposal's frontmatter (*Mark promoted* or *Dismiss* in the tray, with Undo);
  - the location of an effort's folder (*Archive effort* moves it to `Efforts/Archived/<name>`; *Restore* in the *Archived efforts* view moves it back, using Obsidian's own rename so links keep working);
  - *Mark done* on the lever: ticks the item in its note (`- [ ]` to `- [x]`), or moves a Kanban card to the board's done lane, with Undo;
  - *+ Effort*: creates `Efforts/<name>/README.md` from a small template;
  - the add-a-todo box on an effort's screen: adds one `- [ ]` line to the end of the note's Immediate list (or a card to the first open lane of its Kanban board); if the note has no Immediate list, a `## Todo List` / `### Immediate` is added at the end. The line under the box says which;
  - the status pill on an effort: changes the word in the README's `**Status:**` line (Active, Waiting, Paused, Not started), keeping any note after the dash, with Undo;
  - *Create daily note* in the Calendar window: creates `Calendar/YYYY-MM-DD.md` from `Calendar/templates/daily-note.md` if it exists, and never overwrites an existing note;
  - *Not this one* on the lever, *Move earlier / later* and the pinned order: kept in the plugin's own settings, not in any note;
  - *Snooze* on a "Needs you" item: hides it for a day, a week or until you un-snooze it. Stored in the plugin's own settings file (`data.json`), not in any note;
  - *+ Capture*: appends a timestamped bullet under a `## Quick capture` heading in today's `AIOS/Scratch/scratch-YYYY-MM-DD.md` (created if needed);
  - *+ Meeting*: appends one entry to the end of that month's `AIOS/Logs/log-YYYY-MM.md`, or, with the *Session log files* setting on "per day", to `AIOS/Logs/YYYY-MM/log-YYYY-MM-DD.md` (creating the file if needed) in the form `**date (meeting)** — Title`, with optional `With`, `Outcome` and `Open` lines.

  It never deletes notes and never rewrites earlier text.
- **Runs** `claude` (only if you turn the Claude Code setting on) and `git log` (through Node's `child_process`) on each effort folder to build the activity strip. If git is not installed, or the vault is not a git repository, the strip is empty and everything else works. This is why the plugin is desktop-only.

## Claude Code (optional, off by default)

With the `claude` command installed, three things appear: an **Ask Claude** box on each effort, **Ask Claude to triage these** in the proposals tray, and **Draft today's log entry** under Recently (also in `Cmd/Ctrl+K`). Pick how it runs in settings:

- **Open in Terminal** (macOS): starts an ordinary interactive `claude` session in the right folder with the prompt filled in. Claude asks before it changes anything, as usual.
- **Run in the background**: runs `claude -p` with only the `Read`, `Grep` and `Glob` tools, so it can read your notes but cannot change them or run commands, and shows the answer in a panel with a Cancel button. A drafted log entry is added only when you press *Add to today's log*, and only if it has the log's shape.

It uses whatever login Claude Code has (your subscription), unless `ANTHROPIC_API_KEY` is set where Obsidian starts, in which case `claude -p` uses that key. Nothing is sent anywhere by the plugin itself; the notes Claude reads go to Anthropic as with any Claude Code session.

## Install

**With BRAT:** install the BRAT plugin, choose *Add beta plugin*, and paste this repository's URL.

**By hand:** download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/ideaverse-home/`, reload Obsidian, and enable *Ideaverse Home* under Community plugins. Open it from the ribbon icon or the command *Open Ideaverse home*.

## Settings

Root folder, open on startup, the number of days before an effort dims, and a JSON box of per-effort overrides keyed by folder name:

```json
{
  "Homelab": {
    "lever": "Decide on a fallback DNS server.",
    "art": {
      "kind": "services", "hub": "Server", "base": "NAS mount",
      "nodes": ["Git", "Runner", "DNS", "Media"], "risk": "DNS", "riskNote": "No fallback if the server is down."
    }
  }
}
```

## Limits

Desktop only (macOS tested; Windows and Linux untested). Tested on one vault. The interface is dark whatever your theme. Early software: expect rough edges, and open an issue.

## Development

```
npm install
npm run build                                  # dist/main.js, manifest.json, styles.css
npm test                                       # parsers, collector, and a smoke test of the built bundle
VAULT=/path/to/vault npm run install-vault     # copy dist/ into the vault's plugins folder
VAULT=/path/to/vault npm run dev               # browser harness on :8766, read-only
```

Source layout: `src/parse.js` (markdown to data), `src/collect.js` (reads the vault through a small io interface), `src/ui.js` (the dashboard), `src/main.js` (Obsidian glue).

To release: bump `version` in `manifest.json` and `versions.json`, commit, then push a tag with the same number (for example `0.1.1`). The workflow builds and attaches the files.

## License

MIT
