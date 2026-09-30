'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const A = require('../tools/copy-audit.js');

const report = A.audit();
const ws = report.pages.find(p => p.page === 'workforce-size');

test('format is stable: opm-copy-audit/1, pages by file, keys by ref, every field present', () => {
  assert.equal(report.format, 'opm-copy-audit/1');
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.pages.map(p => p.file), [...report.pages.map(p => p.file)].sort());
  for (const p of report.pages) {
    assert.deepEqual(Object.keys(p), ['file', 'page', 'readsData', 'dataFiles', 'scripts', 'keys', 'unsigned', 'exempt', 'errors']);
    assert.deepEqual(p.keys.map(k => k.ref), [...p.keys.map(k => k.ref)].sort());
    assert.deepEqual(p.errors, [], p.file);
  }
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'copy-audit.js'), '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), report);
});

test('Workforce size reads web/data and uses no unsigned key; the stubs do not read data', () => {
  assert.equal(ws.file, 'index.html');
  assert.equal(ws.readsData, true);
  assert.deepEqual(ws.dataFiles, ['data/doj_core.json', 'data/doj_core.meta.json']);
  assert.deepEqual(ws.unsigned, []);
  assert.deepEqual(ws.exempt, ['shell:site.draftNotice']);
  for (const p of report.pages.filter(x => x !== ws)) {
    assert.equal(p.readsData, false, p.file);
    assert.deepEqual(p.unsigned, ['shell:stub.body'], p.file);
  }
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'copy-audit.js'), '--check']); // exits 0
});

test('directives: uses, exempt, data-copy, conditional; dynamic lookups are caught', () => {
  const s = A.scanScript("x(copy.t('shell:a')); copy.raw('page:b', 1); copy.t(id + ':c'); copy.t('components:' + e); copy.peek('shell:z');\n" +
    '// copy-audit: components:* pages:page.title\n// copy-audit: exempt shell:d\n// copy-audit: data-copy\n// copy-audit: if-nonempty shell:e then shell:f shell:e');
  assert.deepEqual(s.literal, ['shell:a', 'page:b']);
  assert.equal(s.dynamic.length, 2);
  assert.deepEqual(s.directives, [
    { kind: 'use', refs: ['components:*', 'pages:page.title'] }, { kind: 'exempt', refs: ['shell:d'] }, { kind: 'data-copy' },
    { kind: 'if-nonempty', cond: 'shell:e', refs: ['shell:f', 'shell:e'] }]);
  // empty presets: the conditional keys are not counted
  assert.equal(ws.keys.some(k => k.ref.startsWith('shell:ctl.range.presets')), false);
});

/* The static audit must agree with what the page actually used in the browser (smoke run). */
const RUNTIME = path.join(__dirname, 'runtime-copy-workforce-size.json');
test('audit agrees with the runtime list the smoke test recorded for Workforce size', () => {
  assert.ok(fs.existsSync(RUNTIME), 'web/tests/runtime-copy-workforce-size.json is missing; run node web/tests/smoke.mjs first');
  const rt = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'));
  assert.equal(rt.sourcesHash, A.sourcesHash('index.html'), 'the runtime list is stale: copy.json or a Workforce size script changed; rerun node web/tests/smoke.mjs');
  const staticRefs = ws.keys.map(k => k.ref);
  assert.deepEqual(staticRefs.filter(r => !rt.used.includes(r)), [], 'keys the audit lists but the page never used');
  assert.deepEqual(rt.used.filter(r => !staticRefs.includes(r)), [], 'keys the page used that the audit missed');
});
