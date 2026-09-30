'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../tools/stamp-lib.js');
const { bump } = require('../tools/bump-stamp.js');

test('LIVE: every served file matches the recorded stamp, and every asset URL carries it', () => {
  const problems = S.checkStamp();
  assert.deepEqual(problems, [], problems.join('\n'));
});

function tmpSite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opm-stamp-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'one');
  fs.writeFileSync(path.join(dir, 'assets', 'a.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'tests', 'ignored.js'), 'x');
  fs.writeFileSync(path.join(dir, 'index.html'),
    '<meta name="opm-build" content="0"><link rel="stylesheet" href="assets/a.css?v=0">' +
    '<link rel="stylesheet" href="https://fonts.example/x.css"><a href="other.html">x</a><script src="assets/a.js"></script>');
  return dir;
}

test('bump applies one stamp to every local asset URL and records hashes', () => {
  const dir = tmpSite();
  const r = bump(dir, false, new Date('2026-09-30T12:00:00Z'));
  assert.equal(r.stamp, '20260930-120000');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('assets/a.css?v=20260930-120000'));
  assert.ok(html.includes('assets/a.js?v=20260930-120000'));   // an unstamped URL gets one
  assert.ok(html.includes('https://fonts.example/x.css"'));    // external URLs untouched
  assert.ok(html.includes('href="other.html"'));               // pages untouched
  assert.ok(html.includes('content="20260930-120000"'));
  assert.deepEqual(Object.keys(S.readRecord(dir).files), ['assets/a.css', 'assets/a.js', 'index.html']); // tests/ excluded
  assert.deepEqual(S.checkStamp(dir), []);
});

test('FAILS when a served file changes and the stamp does not', () => {
  const dir = tmpSite();
  bump(dir, false, new Date('2026-09-30T12:00:00Z'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'two');
  const p = S.checkStamp(dir);
  assert.equal(p.length, 1);
  assert.match(p[0], /changed assets\/a.js/);
  // an added served file is caught too
  fs.writeFileSync(path.join(dir, 'assets', 'b.json'), '{}');
  assert.match(S.checkStamp(dir)[0], /added assets\/b.json/);
  // a change outside the served set is not
  const dir2 = tmpSite();
  bump(dir2, false, new Date('2026-09-30T12:00:00Z'));
  fs.writeFileSync(path.join(dir2, 'tests', 'ignored.js'), 'changed');
  assert.deepEqual(S.checkStamp(dir2), []);
});

test('bumping after a change passes again, and stamps only move forward', () => {
  const dir = tmpSite();
  bump(dir, false, new Date('2026-09-30T12:00:00Z'));
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), 'two');
  const r = bump(dir, false, new Date('2026-09-30T12:00:00Z')); // same second
  assert.equal(r.bumped, true);
  assert.ok(r.stamp > '20260930-120000');
  assert.deepEqual(S.checkStamp(dir), []);
  assert.equal(bump(dir, false, new Date('2026-09-30T13:00:00Z')).bumped, false); // nothing changed
});

test('FAILS when an HTML asset URL carries a stale stamp', () => {
  const dir = tmpSite();
  bump(dir, false, new Date('2026-09-30T12:00:00Z'));
  const p = path.join(dir, 'index.html');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('a.js?v=20260930-120000', 'a.js?v=old'));
  S.writeRecord(dir, '20260930-120000', S.hashFiles(dir)); // even with hashes re-recorded
  assert.ok(S.checkStamp(dir).some(x => /a.js\?v=old does not carry/.test(x)));
});
