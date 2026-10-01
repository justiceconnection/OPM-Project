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

const hd = report.pages.find(p => p.page === 'hiring-and-departures');

test('the data pages read web/data and use no unsigned key; the stubs do not read data', () => {
  assert.equal(hd.file, 'hiring-and-departures.html');
  assert.equal(hd.readsData, true);
  assert.deepEqual(hd.unsigned, []);
  assert.ok(hd.keys.some(k => k.ref === 'hiring-and-departures:chart.rates.series.quit'), 'the rate series labels are seen');
  assert.ok(hd.keys.some(k => k.ref === 'series:sep_rif'));
  assert.equal(ws.file, 'index.html');
  assert.equal(ws.readsData, true);
  assert.deepEqual(ws.dataFiles, ['data/doj_core.json', 'data/doj_core.meta.json', 'data/doj_core_series.meta.json']); // the series files are found through that meta
  assert.deepEqual(ws.unsigned, []);
  assert.deepEqual(ws.exempt, ['shell:site.draftNotice']);
  const wl = report.pages.find(p => p.page === 'who-is-leaving');
  assert.equal(wl.readsData, true);
  assert.deepEqual(wl.unsigned, []);
  assert.ok(wl.dataFiles.includes('data/doj_leaving.meta.json'));
  const cc = report.pages.find(p => p.page === 'components-compared');
  assert.equal(cc.readsData, true);
  assert.deepEqual(cc.unsigned, []);
  const rd = report.pages.find(p => p.page === 'reading-the-data');
  assert.equal(rd.readsData, false, 'Reading the data reads no data');
  assert.deepEqual(rd.unsigned, []);
  const lu = report.pages.find(p => p.page === 'workforce-lookup');
  assert.equal(lu.readsData, true, 'the Look-Up reads data/lookup');
  assert.deepEqual(lu.dataFiles, ['data/lookup.meta.json']);
  assert.deepEqual(lu.unsigned, []);
  assert.deepEqual(report.pages.filter(x => x !== ws && x !== hd && x !== wl && x !== cc && x !== rd && x !== lu), [], 'every page is built');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'copy-audit.js'), '--check']); // exits 0
});

test('directives: uses, exempt, data-copy, conditional; dynamic lookups are caught', () => {
  const s = A.scanScript("x(copy.t('shell:a')); copy.raw('page:b', 1); copy.t(id + ':c'); copy.t('components:' + e); copy.peek('shell:z');\n" +
    '// copy-audit: components:* pages:page.title\n// copy-audit: exempt shell:d\n// copy-audit: data-copy\n// copy-audit: if-nonempty shell:e then shell:f shell:e');
  assert.deepEqual(s.literal, ['shell:a', 'page:b']);
  assert.equal(s.dynamic.length, 2);
  assert.equal(s.undeclared.length, 2); // no directive on or just above the calls' line
  const ok = A.scanScript("// copy-audit: components:*\nx(copy.t('components:' + e));\ny(copy.t(k)); // copy-audit: shell:a");
  assert.deepEqual(ok.undeclared, []);
  const far = A.scanScript("// copy-audit: components:*\n\n\nx(copy.t('components:' + e));");
  assert.equal(far.undeclared.length, 1, 'a directive three lines up does not count');
  assert.deepEqual(s.directives, [
    { kind: 'use', refs: ['components:*', 'pages:page.title'] }, { kind: 'exempt', refs: ['shell:d'] }, { kind: 'data-copy' },
    { kind: 'if-nonempty', cond: 'shell:e', refs: ['shell:f', 'shell:e'] }]);
  // empty presets: the conditional keys are not counted
  assert.equal(ws.keys.some(k => k.ref.startsWith('shell:ctl.range.presets')), false);
});

test('sources hash: a stamp bump alone keeps it; a real HTML, script or copy change moves it', () => {
  const os = require('os');
  const S = require('../tools/stamp-lib.js');
  const WEB = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opm-hash-'));
  const copyIn = rel => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.copyFileSync(path.join(WEB, rel), path.join(tmp, rel)); };
  ['index.html', 'copy.json'].forEach(copyIn);
  ws.scripts.filter(s => !s.includes('/vendor/')).forEach(copyIn);
  const h0 = A.sourcesHash('index.html', tmp);
  assert.equal(h0, A.sourcesHash('index.html'), 'the temp copy hashes like web/');
  // a stamp bump rewrites every ?v= and the opm-build meta: same hash
  const html = fs.readFileSync(path.join(tmp, 'index.html'), 'utf8');
  const bumped = S.stampHtml(html, '29991231-235959');
  assert.notEqual(bumped, html);
  fs.writeFileSync(path.join(tmp, 'index.html'), bumped);
  assert.equal(A.sourcesHash('index.html', tmp), h0, 'a stamp bump alone must not change the hash');
  // a real HTML change: different hash
  fs.writeFileSync(path.join(tmp, 'index.html'), bumped.replace('<div id="page-body"></div>', '<div id="page-body"></div><div id="x"></div>'));
  const h1 = A.sourcesHash('index.html', tmp);
  assert.notEqual(h1, h0);
  // a real script change: different hash
  const pageJs = path.join(tmp, 'assets/js/pages/workforce-size.js');
  fs.appendFileSync(pageJs, '\n// changed\n');
  assert.notEqual(A.sourcesHash('index.html', tmp), h1);
  // a copy change: different hash
  const h2 = A.sourcesHash('index.html', tmp);
  fs.appendFileSync(path.join(tmp, 'copy.json'), ' ');
  assert.notEqual(A.sourcesHash('index.html', tmp), h2);
  assert.equal(A.withoutStamp('a.js?v=20260930-170948"'), 'a.js?v="');
});

/* The static audit must agree with what each data page actually used in the browser (smoke run). */
for (const [pageId, file] of [['workforce-size', 'index.html'], ['hiring-and-departures', 'hiring-and-departures.html'], ['who-is-leaving', 'who-is-leaving.html'], ['components-compared', 'components-compared.html'], ['reading-the-data', 'reading-the-data.html'], ['workforce-lookup', 'workforce-lookup.html']]) {
  const RUNTIME = path.join(__dirname, 'runtime-copy-' + pageId + '.json');
  test('audit agrees with the runtime list the smoke test recorded for ' + pageId, () => {
    assert.ok(fs.existsSync(RUNTIME), path.basename(RUNTIME) + ' is missing; run node web/tests/smoke.mjs first');
    const rt = JSON.parse(fs.readFileSync(RUNTIME, 'utf8'));
    assert.equal(rt.sourcesHash, A.sourcesHash(file), 'the runtime list is stale: copy.json or a script of ' + file + ' changed; rerun node web/tests/smoke.mjs');
    const staticRefs = report.pages.find(p => p.page === pageId).keys.map(k => k.ref);
    assert.deepEqual(staticRefs.filter(r => !rt.used.includes(r)), [], 'keys the audit lists but the page never used');
    assert.deepEqual(rt.used.filter(r => !staticRefs.includes(r)), [], 'keys the page used that the audit missed');
  });
}
