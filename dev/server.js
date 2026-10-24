'use strict';
// Dev harness: serves the dashboard UI in a browser, fed by the real vault. Read-only: opening notes and
// proposal status changes are recorded in memory, never written.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const esbuild = require('esbuild');
const { collect, DEFAULT_SETTINGS } = require('../src/collect');
const { nodeIO } = require('../src/nodeio');

const VAULT = process.env.VAULT;
if (!VAULT) { console.error('Set VAULT=/path/to/your/vault'); process.exit(1); }
const PORT = +process.env.PORT || 8766;

// Use the same settings the plugin has in this vault (its data.json), so the harness matches what Obsidian shows.
const settingsFile = path.join(VAULT, '.obsidian/plugins/ideaverse-home/data.json');
const readSettings = () => {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) { /* no saved settings: defaults */ }
  if (process.env.ROOT !== undefined) saved.rootFolder = process.env.ROOT;
  return Object.assign({}, DEFAULT_SETTINGS, saved, { efforts: Object.assign({}, DEFAULT_SETTINGS.efforts, saved.efforts) });
};
const local = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Network exposure is opt-in: HOST=<lan ip> requires PASSWORD, and TTL_MIN shuts the server down on its own.
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.PASSWORD || '';
if (HOST !== '127.0.0.1' && !PASSWORD) { console.error('Refusing to listen on ' + HOST + ' without PASSWORD.'); process.exit(1); }
const crypto = require('crypto');
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const authorised = req => {
  if (!PASSWORD) return true;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const given = Buffer.from(m[1], 'base64').toString().split(':').slice(1).join(':');
  return crypto.timingSafeEqual(sha(given), sha(PASSWORD));
};

http.createServer(async (req, res) => {
  try {
    if (!authorised(req)) {
      await new Promise(r => setTimeout(r, 800)); // slows down guessing
      res.statusCode = 401; res.setHeader('www-authenticate', 'Basic realm="Ideaverse"'); return res.end('Password required');
    }
    if (req.url === '/') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(path.join(__dirname, 'harness.html'))); }
    if (req.url === '/ui.js') {
      const out = await esbuild.build({ entryPoints: [path.join(__dirname, '../src/ui.js')], bundle: true, write: false, format: 'iife', globalName: 'IdeaverseUI', target: 'es2020' });
      res.setHeader('content-type', 'text/javascript'); return res.end(out.outputFiles[0].text);
    }
    if (req.url === '/styles.css') { res.setHeader('content-type', 'text/css'); return res.end(fs.readFileSync(path.join(__dirname, '../src/styles.css'))); }
    if (req.url === '/api/data') {
      const settings = readSettings();
      const d = await collect(nodeIO(VAULT), settings, local());
      d.staleDays = settings.staleDays;
      d.claudeMode = process.env.CLAUDE_MODE || 'off';
      res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(d));
    }
    res.statusCode = 404; res.end('not found');
  } catch (e) { res.statusCode = 500; res.end(String(e.stack || e)); }
}).listen(PORT, HOST, () => {
  console.log(`harness on http://${HOST}:${PORT}  (vault: ${VAULT}, read-only${PASSWORD ? ', password protected' : ''})`);
  if (process.env.TTL_MIN) setTimeout(() => { console.log('time limit reached, shutting down'); process.exit(0); }, +process.env.TTL_MIN * 60000);
});
