'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeSessions, encodeDir } = require('../src/ccsessions');
const K = require('../src/claude');

const user = (text, cwd) => JSON.stringify({ type: 'user', cwd, message: { role: 'user', content: text } });

function makeProjects(vault, sessions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-projects-'));
  for (const [folder, id, lines, mtime] of sessions) {
    const d = path.join(dir, encodeDir(folder));
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, id + '.jsonl');
    fs.writeFileSync(f, lines.join('\n') + '\n');
    fs.utimesSync(f, mtime, mtime);
  }
  return dir;
}

test('lists sessions started in the vault or inside it, newest first, with a title', async () => {
  const vault = '/Users/x/my-vault';
  const projects = makeProjects(vault, [
    [vault + '/Efforts/Career', 'aaaaaaaa-0000-4000-8000-000000000001', [user('look into my site', vault + '/Efforts/Career'), JSON.stringify({ type: 'ai-title', aiTitle: 'Career notes' }), JSON.stringify({ type: 'custom-title', customTitle: 'Review the site' })], 2000],
    [vault, 'aaaaaaaa-0000-4000-8000-000000000002', [user('<command-name>/clear</command-name>', vault), user('fix the plugin\nplease', vault)], 3000],
    [vault + '-other', 'aaaaaaaa-0000-4000-8000-000000000003', [user('not mine', vault + '-other')], 4000]
  ]);
  const got = await claudeSessions(vault, { projectsDir: projects });
  assert.deepStrictEqual(got.map(s => [s.id.slice(-1), s.title, s.folder]), [['2', 'fix the plugin', ''], ['1', 'Review the site', 'Efforts/Career']]);
});

test('a session with no real prompt (a /clear stub) is skipped, and a missing projects folder is empty', async () => {
  const vault = '/Users/x/v';
  const projects = makeProjects(vault, [[vault, 'aaaaaaaa-0000-4000-8000-000000000004', [user('<command-name>/clear</command-name>', vault)], 1000]]);
  assert.deepStrictEqual(await claudeSessions(vault, { projectsDir: projects }), []);
  assert.deepStrictEqual(await claudeSessions(vault, { projectsDir: '/nonexistent/x' }), []);
});

test('the title is found in the tail of a file bigger than the window', async () => {
  const vault = '/Users/x/big';
  const filler = Array.from({ length: 3000 }, () => JSON.stringify({ type: 'assistant', message: { content: 'x'.repeat(100) } }));
  const projects = makeProjects(vault, [[vault, 'aaaaaaaa-0000-4000-8000-000000000005', [user('first words', vault), ...filler, JSON.stringify({ type: 'ai-title', aiTitle: 'Late title' })], 1000]]);
  assert.strictEqual((await claudeSessions(vault, { projectsDir: projects }))[0].title, 'Late title');
});

test('resumeScript only accepts a real session id', () => {
  assert.strictEqual(K.resumeScript('/bin/claude', '/v', "x'; rm -rf ~"), null);
  assert.match(K.resumeScript('/bin/claude', '/v', 'aaaaaaaa-0000-4000-8000-000000000005'), /--resume/);
});

test('a running session is flagged from the registry; a dead pid or a session outside the vault is not', async () => {
  const vault = '/Users/x/live';
  const projects = makeProjects(vault, [
    [vault, 'aaaaaaaa-0000-4000-8000-000000000006', [user('running one', vault)], 3000],
    [vault, 'aaaaaaaa-0000-4000-8000-000000000007', [user('crashed one', vault)], 2000],
    [vault, 'aaaaaaaa-0000-4000-8000-000000000008', [user('elsewhere', vault)], 1000]
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-sessions-'));
  const reg = (pid, sessionId, cwd, status) => fs.writeFileSync(path.join(dir, pid + '.json'), JSON.stringify({ pid, sessionId, cwd, status, name: 'Named run', nameSource: 'user' }));
  reg(process.pid, 'aaaaaaaa-0000-4000-8000-000000000006', vault, 'busy');
  reg(2147483000, 'aaaaaaaa-0000-4000-8000-000000000007', vault, 'busy');
  reg(process.pid + 1000000, 'aaaaaaaa-0000-4000-8000-000000000008', '/Users/y/other', 'idle');
  const got = await claudeSessions(vault, { projectsDir: projects, sessionsDir: dir, limit: 1 });
  assert.deepStrictEqual(got.map(s => [s.id.slice(-1), s.active, s.title]), [['6', 'busy', 'Named run']]);
  const all = await claudeSessions(vault, { projectsDir: projects, sessionsDir: dir });
  assert.deepStrictEqual(all.map(s => [s.id.slice(-1), s.active]), [['6', 'busy'], ['7', ''], ['8', '']]);
});
