'use strict';
const test = require('node:test');
const assert = require('node:assert');
const K = require('../src/claude');

test('background runs are read-only and leave no session behind', () => {
  const a = K.headlessArgs('hello');
  assert.strictEqual(a[0], '-p');
  assert.strictEqual(a[a.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.ok(a.includes('--no-session-persistence'));
  assert.ok(!a.some(x => /Edit|Write|Bash|bypass|dangerously/i.test(x === 'hello' ? '' : x) && x !== K.SYSTEM), 'no write tools or permission bypass');
});

test('cleanLogEntry accepts a bare or fenced entry and rejects other text', () => {
  const e = '**2026-10-23 (x)** — T\n- Built: a\n---';
  assert.strictEqual(K.cleanLogEntry(e), e + '\n');
  assert.strictEqual(K.cleanLogEntry('Here you go:\n```\n' + e + '\n```'), e + '\n');
  assert.strictEqual(K.cleanLogEntry('**2026-10-23** — T\n- Built: a'), '**2026-10-23** — T\n- Built: a\n---\n');
  assert.strictEqual(K.cleanLogEntry('I could not find anything.'), null);
  assert.strictEqual(K.entryDate(e), '2026-10-23');
});

test('terminalScript quotes the pieces for AppleScript and the shell', () => {
  const s = K.terminalScript('/bin/claude', '/a b/it\'s', 'say "hi"\nthen go');
  assert.ok(s.includes('quoted form of "/a b/it\'s"'));
  assert.ok(s.includes('quoted form of "say \\"hi\\"" & linefeed & "then go"'));
});

test('prompts carry the question, the paths and the date', () => {
  assert.ok(K.ask('Truck Fund', ' next? ').includes('Question: next?'));
  assert.ok(K.triage(['AIOS/Proposals/a.md']).includes('- AIOS/Proposals/a.md'));
  assert.ok(K.logDraft({ date: '2026-10-23', changes: 'abc fix', status: '' }).includes('**2026-10-23 (short topic)**'));
});

