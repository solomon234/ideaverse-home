'use strict';
// Claude Code's own session transcripts (~/.claude/projects/<encoded cwd>/<id>.jsonl) for sessions started in this vault.
// Desktop only (reads outside the vault). Only the head and tail of each file are read: transcripts run to many megabytes.
const fs = require('fs');
const path = require('path');

const CHUNK = 96 * 1024;

const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Claude Code names a project folder after the working directory with every non-alphanumeric character turned into '-'.
const encodeDir = dir => dir.replace(/[^a-zA-Z0-9]/g, '-');

async function readChunk(fh, start, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, start);
  return buf.toString('utf8', 0, bytesRead);
}

// A prompt typed by the person, not one the harness injected (command output, system reminders, skill bodies).
function promptText(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return '';
  const c = rec.message && rec.message.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find(x => x && x.type === 'text') || {}).text : '';
  const t = String(text || '').trim();
  return !t || t.startsWith('<') || t.startsWith('[Image') || t.startsWith('Base directory for this skill') ? '' : t;
}

const lines = text => text.split('\n').filter(l => l.startsWith('{')).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);

// Returns null for a file with no real prompt in it (a /clear stub, an aborted start).
async function readSession(file, stat) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const head = lines(await readChunk(fh, 0, Math.min(CHUNK, stat.size)));
    // the first line of a window into the middle of a file may be cut in half; JSON.parse drops it
    const tail = stat.size > CHUNK ? lines(await readChunk(fh, Math.max(0, stat.size - CHUNK), CHUNK)) : head;
    const first = head.map(promptText).find(Boolean);
    if (!first) return null;
    const last = key => [...tail].reverse().find(r => r[key]);
    const title = (last('customTitle') || {}).customTitle || (last('aiTitle') || {}).aiTitle || first.split('\n')[0];
    const cwd = (head.find(r => r.type === 'user' && r.cwd) || {}).cwd || '';
    return { id: path.basename(file, '.jsonl'), title: title.replace(/\s+/g, ' ').trim(), cwd };
  } finally {
    await fh.close();
  }
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Sessions running right now: Claude Code keeps ~/.claude/sessions/<pid>.json while a session is open. A crashed one can leave its file behind, so the process must be alive.
async function activeSessions(vaultBase, sessionsDir) {
  sessionsDir = sessionsDir || path.join(require('os').homedir(), '.claude', 'sessions');
  let names;
  try { names = (await fs.promises.readdir(sessionsDir)).filter(n => /^\d+\.json$/.test(n)); } catch (e) { return new Map(); }
  const base = vaultBase.replace(/\/+$/, ''), out = new Map();
  for (const n of names) {
    let r;
    try { r = JSON.parse(await fs.promises.readFile(path.join(sessionsDir, n), 'utf8')); } catch (e) { continue; }
    if (!r || !r.sessionId || !Number.isInteger(r.pid) || !alive(r.pid)) continue;
    if (!(r.cwd === base || String(r.cwd).startsWith(base + '/'))) continue;
    // an auto-derived name like ideaverse-1c is worse than the transcript's title, so only a name the person chose is used
    out.set(r.sessionId, { pid: r.pid, status: r.status === 'busy' ? 'busy' : 'idle', name: r.nameSource === 'user' ? String(r.name || '') : '', cwd: r.cwd });
  }
  return out;
}

// The newest `limit` sessions whose working directory is the vault or somewhere inside it.
async function claudeSessions(vaultBase, { projectsDir, sessionsDir, limit = 12 } = {}) {
  if (!vaultBase) return [];
  const live = await activeSessions(vaultBase, sessionsDir);
  projectsDir = projectsDir || path.join(require('os').homedir(), '.claude', 'projects');
  const prefix = encodeDir(vaultBase.replace(/\/+$/, ''));
  let dirs;
  try { dirs = await fs.promises.readdir(projectsDir); } catch (e) { return []; }
  const found = [];
  for (const d of dirs.filter(d => d === prefix || d.startsWith(prefix + '-'))) {
    let names;
    try { names = (await fs.promises.readdir(path.join(projectsDir, d))).filter(n => n.endsWith('.jsonl')); } catch (e) { continue; }
    for (const n of names) {
      try { found.push({ file: path.join(projectsDir, d, n), stat: await fs.promises.stat(path.join(projectsDir, d, n)) }); } catch (e) { /* file vanished */ }
    }
  }
  found.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  const out = [];
  for (const f of found) {
    const id = path.basename(f.file, '.jsonl');
    if (out.length >= limit && !live.has(id)) continue; // a running session is listed even when it is older than the rest
    let s;
    try { s = await readSession(f.file, f.stat); } catch (e) { continue; }
    if (!s) continue;
    const inside = s.cwd === vaultBase || s.cwd.startsWith(vaultBase.replace(/\/+$/, '') + '/');
    if (s.cwd && !inside) continue; // a sibling folder whose name merely starts the same
    const rel = inside ? s.cwd.slice(vaultBase.length).replace(/^\/+/, '') : '';
    const run = live.get(s.id);
    out.push({
      id: s.id,
      title: (run && run.name) || s.title,
      active: run ? run.status : '',
      pid: run ? run.pid : 0,
      cwd: s.cwd,
      folder: rel,
      mtime: f.stat.mtimeMs,
      iso: localDate(f.stat.mtimeMs)
    });
  }
  return out;
}

module.exports = { claudeSessions, activeSessions, encodeDir, promptText };
