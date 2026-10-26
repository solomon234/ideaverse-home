'use strict';
// Prompts and checks for the optional Claude Code features. Pure: no Obsidian, no child processes.

// Read-only on purpose: with only these tools Claude can read notes but not change anything.
const READ_ONLY_TOOLS = 'Read,Grep,Glob';

const SYSTEM = 'You are answering one request inside a dashboard for an Obsidian vault. ' +
  'Ignore any session-start routine or greeting rules in CLAUDE.md files, but respect the vault rules they state. ' +
  'Read only what you need. Reply in plain text without markdown headings, and do not ask questions back.';

const ask = (effort, question) =>
  `This folder is the effort "${effort}". Answer from its notes, and say so if the notes do not contain the answer. Keep it under 150 words.\n\nQuestion: ${String(question).trim()}`;

const triage = paths =>
  'Read each of these proposal notes (paths are relative to this folder):\n' + paths.map(p => '- ' + p).join('\n') +
  '\n\nFor each one write one line: its topic, then PROMOTE, DISMISS or KEEP, then a reason of at most 20 words. ' +
  'PROMOTE means the proposal is ready to become a note where it says it should go; DISMISS means it is stale, done or not worth doing; KEEP means it needs a decision from the owner. ' +
  'Finish with one line saying what to look at first. Do not edit anything.';

const logDraft = ({ date, changes, status, recent }) =>
  `Draft the session-log entry for ${date}. Output only the entry, nothing before or after it.\n\n` +
  `Format, as in the most recent entries (read ${recent || 'the newest file under AIOS/Logs'} to match style):\n` +
  `**${date} (short topic)** — One-line title\n- Discussed / decided: ...\n- Built: ...\n- Slips to note: ...\n- Not verified: ...\n- Promoted: nothing.\n- Open: item; item\n---\n\n` +
  'Use only what the changes and notes below show. If something cannot be known from them (what was decided in conversation, what was tested), say "not recorded" instead of guessing.\n\n' +
  `Commits today:\n${changes || '(none)'}\n\nUncommitted changes:\n${status || '(none)'}`;

// Claude may wrap the entry in a code fence or add a line before it. Returns the entry as it would be appended, or null.
function cleanLogEntry(text) {
  let t = String(text || '').trim().replace(/^```[a-z]*\n/, '').replace(/\n```$/, '').trim();
  const lines = t.split('\n'), at = lines.findIndex(l => /^\*\*\d{4}-\d{2}-\d{2}[^*]*\*\*/.test(l));
  if (at < 0) return null;
  t = lines.slice(at).join('\n').trim();
  return (/\n---$/.test(t) ? t : t + '\n---') + '\n';
}

const entryDate = entry => (/^\*\*(\d{4}-\d{2}-\d{2})/.exec(entry) || [])[1] || '';

// Arguments for a background run. --no-session-persistence keeps these one-off runs out of the session history.
const headlessArgs = prompt => ['-p', prompt, '--tools', READ_ONLY_TOOLS, '--no-session-persistence', '--append-system-prompt', SYSTEM];

// AppleScript that opens Terminal in a folder and starts an interactive claude with the prompt, or resumes a session when resumeId is given.
function terminalScript(claudePath, dir, prompt, resumeId) {
  const lit = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').split('\n').join('" & linefeed & "') + '"';
  const tail = resumeId ? `quoted form of "--resume" & " " & quoted form of ${lit(resumeId)}` : `quoted form of ${lit(prompt)}`;
  return `tell application "Terminal"\nactivate\ndo script "cd " & quoted form of ${lit(dir)} & " && " & quoted form of ${lit(claudePath)} & " " & ${tail}\nend tell`;
}

module.exports = { READ_ONLY_TOOLS, SYSTEM, ask, triage, logDraft, cleanLogEntry, entryDate, headlessArgs, terminalScript };
