'use strict';
// Filesystem-backed io for tests and the dev harness. The Obsidian plugin has its own io in main.js.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function nodeIO(vaultRoot) {
  const abs = p => path.join(vaultRoot, p);
  return {
    async list(dir) {
      const entries = await fs.promises.readdir(abs(dir), { withFileTypes: true });
      const files = [], folders = [];
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        (e.isDirectory() ? folders : files).push(dir ? `${dir}/${e.name}` : e.name);
      }
      return { files: files.sort(), folders: folders.sort() };
    },
    read: p => fs.promises.readFile(abs(p), 'utf8'),
    async exists(p) { try { await fs.promises.access(abs(p)); return true; } catch (e) { return false; } },
    async mtimeIso(p) { try { return (await fs.promises.stat(abs(p))).mtime.toISOString().slice(0, 10); } catch (e) { return '1970-01-01'; } },
    gitDates(p) {
      return new Promise(res => execFile('git', ['-C', vaultRoot, 'log', '--format=%cs', '--', p], { maxBuffer: 8e6 }, (err, out) => res(err ? [] : out.split('\n').filter(Boolean))));
    },
    async write(p, text) { await fs.promises.writeFile(abs(p), text); }
  };
}

module.exports = { nodeIO };
