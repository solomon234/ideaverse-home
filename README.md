# Ideaverse Home

An Obsidian plugin that gives a vault a home screen: **one effort per screen**, with arrows to move between them.

Each screen shows:

- the effort's **status**, read from its note;
- **the lever**: the smallest next move, taken from the first unchecked item under an "Immediate", "Next" or "Steps" heading (or the first open card on a Kanban board);
- a **weekly activity strip** from the git history of the effort's folder;
- a **picture drawn from the note itself**: a Kanban board as a grid of squares, a price table as a chart against a budget, a numbered steps list with its stop condition, or a todo list. Anything that cannot be read from a note, such as a map of services, can be described in settings.

Each effort can be **archived** (two clicks, under *About this effort*); archived efforts are listed in the command bar's *Archived efforts* view, where they can be restored.

A dock at the bottom opens **Atlas**, **Calendar**, a **proposals tray** and **recent sessions**. `Cmd/Ctrl+K` opens a command bar. An effort with no change for 60 days dims.

It is opinionated: it assumes a vault laid out like this, and shows a "No efforts found" screen if it does not find one.

```
<root>/
  Efforts/<name>/README.md      one folder per effort; the note holds status and todo lists
  Efforts/<name>/*.md           an optional Kanban board (obsidian-kanban format) is picked up automatically
  AIOS/Proposals/*.md           frontmatter: status (pending, draft, promoted, dismissed), proposed-to, topic, session
  AIOS/Logs/log-YYYY-MM.md      entries start with **YYYY-MM-DD** - Title; a "- Open:" line lists what is still open
  Atlas/   Calendar/            counted; Calendar reads YYYY-MM-DD.md daily notes
```

`<root>` is the plugin's **Root folder** setting (empty means the vault root).

## What it reads, writes and runs

- **Reads** markdown notes under the root folder. Nothing leaves your machine; there are no network calls.
- **Writes** two things, both only when you press a button: the `status:` line in a proposal's frontmatter (*Mark promoted* or *Dismiss* in the tray, with Undo), and the location of an effort's folder (*Archive effort* moves it to `Efforts/Archived/<name>`, and *Restore* in the *Archived efforts* view moves it back, using Obsidian's own rename so links keep working). It never deletes notes.
- **Runs** `git log` (through Node's `child_process`) on each effort folder to build the activity strip. If git is not installed, or the vault is not a git repository, the strip is empty and everything else works. This is why the plugin is desktop-only.

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
