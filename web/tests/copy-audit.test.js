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
  assert.equal(hd.file, 'history-hiring-and-departures.html'); // the old page, shown inside Departures' Explore full history
  assert.equal(hd.readsData, true);
  assert.deepEqual(hd.unsigned, []);
  assert.ok(hd.keys.some(k => k.ref === 'hiring-and-departures:chart.rates.series.quit'), 'the rate series labels are seen');
  assert.ok(hd.keys.some(k => k.ref === 'series:sep_rif'));
  assert.equal(ws.file, 'history-workforce-size.html');
  assert.equal(ws.readsData, true);
  assert.deepEqual(ws.dataFiles, ['data/doj_admin.meta.json', 'data/doj_core.json', 'data/doj_core.meta.json', 'data/doj_core_series.meta.json']); // the per-entity files are found through the metas
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
  // the three main pages (docs/pages/redesign.md, D-072)
  const ov = report.pages.find(p => p.page === 'overview'), dep = report.pages.find(p => p.page === 'departures'), cv = report.pages.find(p => p.page === 'components-view');
  assert.equal(ov.file, 'index.html'); assert.equal(dep.file, 'departures.html'); assert.equal(cv.file, 'components.html');
  for (const p of [ov, dep, cv]) { assert.equal(p.readsData, true, p.file); assert.deepEqual(p.unsigned, [], p.file); }
  assert.ok(dep.dataFiles.includes('data/doj_leaving.meta.json') && dep.dataFiles.includes('data/doj_leaving_series.meta.json'));
  assert.ok(dep.keys.some(k => k.ref === 'shell:moved.note') && cv.keys.some(k => k.ref === 'shell:moved.note'));
  assert.equal(ov.keys.some(k => k.ref === 'shell:moved.note'), false, 'Overview never shows the moved note');
  // the old addresses: tiny pages that open the new ones; no copy, no data
  const moved = report.pages.filter(p => ['hiring-and-departures.html', 'who-is-leaving.html', 'components-compared.html'].includes(p.file));
  assert.equal(moved.length, 3);
  for (const p of moved) { assert.equal(p.page, null); assert.deepEqual(p.keys, []); assert.equal(p.readsData, false); assert.deepEqual(p.scripts, ['assets/js/moved-redirect.js']); }
  // Appointments (docs/pages/appointments.md, D-086): reads doj_appointments only; no Job series, no Explore full history
  const ap = report.pages.find(p => p.page === 'appointments');
  assert.equal(ap.file, 'appointments.html'); assert.equal(ap.readsData, true); assert.deepEqual(ap.unsigned, []);
  assert.deepEqual(ap.dataFiles, ['data/doj_appointments.meta.json']);
  assert.equal(ap.keys.some(k => /^shell:(ctl\.series|explore\.|moved\.)/.test(k.ref) || k.ref.startsWith('series_names:')), false, 'no Job series, Explore or moved keys');
  assert.deepEqual(report.pages.filter(x => ![ws, hd, wl, cc, rd, lu, ov, dep, cv, ap].concat(moved).includes(x)), [], 'every page is built');
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
  // the old preset hook keys are gone; the presets' label is ctl.presets.label
  assert.equal(ws.keys.some(k => k.ref.startsWith('shell:ctl.range.presets')), false);
  assert.ok(ws.keys.some(k => k.ref === 'shell:ctl.presets.label'));
  // Who is leaving shows the rate and reasons comparisons only: no change or flows keys
  const wl = report.pages.find(p => p.page === 'who-is-leaving');
  assert.equal(wl.keys.some(k => /^shell:compare\.(change|flows)/.test(k.ref)), false);
  assert.ok(ws.keys.some(k => k.ref === 'shell:compare.change.title'));
});

test('sources hash: a stamp bump alone keeps it; a real HTML, script or copy change moves it', () => {
  const os = require('os');
  const S = require('../tools/stamp-lib.js');
  const WEB = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opm-hash-'));
  const copyIn = rel => { fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true }); fs.copyFileSync(path.join(WEB, rel), path.join(tmp, rel)); };
  [ws.file, 'copy.json'].forEach(copyIn);
  ws.scripts.filter(s => !s.includes('/vendor/')).forEach(copyIn);
  const h0 = A.sourcesHash(ws.file, tmp);
  assert.equal(h0, A.sourcesHash(ws.file), 'the temp copy hashes like web/');
  // a stamp bump rewrites every ?v= and the opm-build meta: same hash
  const html = fs.readFileSync(path.join(tmp, ws.file), 'utf8');
  const bumped = S.stampHtml(html, '29991231-235959');
  assert.notEqual(bumped, html);
  fs.writeFileSync(path.join(tmp, ws.file), bumped);
  assert.equal(A.sourcesHash(ws.file, tmp), h0, 'a stamp bump alone must not change the hash');
  // a real HTML change: different hash
  fs.writeFileSync(path.join(tmp, ws.file), bumped.replace('<div id="page-body"></div>', '<div id="page-body"></div><div id="x"></div>'));
  const h1 = A.sourcesHash(ws.file, tmp);
  assert.notEqual(h1, h0);
  // a real script change: different hash
  const pageJs = path.join(tmp, 'assets/js/pages/workforce-size.js');
  fs.appendFileSync(pageJs, '\n// changed\n');
  assert.notEqual(A.sourcesHash(ws.file, tmp), h1);
  // a copy change: different hash
  const h2 = A.sourcesHash(ws.file, tmp);
  fs.appendFileSync(path.join(tmp, 'copy.json'), ' ');
  assert.notEqual(A.sourcesHash(ws.file, tmp), h2);
  assert.equal(A.withoutStamp('a.js?v=20260930-170948"'), 'a.js?v="');
});

/* The static audit must agree with what each data page actually used in the browser (smoke run). */
for (const [pageId, file] of [['overview', 'index.html'], ['departures', 'departures.html'], ['components-view', 'components.html'], ['appointments', 'appointments.html'], ['workforce-size', 'history-workforce-size.html'], ['hiring-and-departures', 'history-hiring-and-departures.html'], ['who-is-leaving', 'history-who-is-leaving.html'], ['components-compared', 'history-components-compared.html'], ['reading-the-data', 'reading-the-data.html'], ['workforce-lookup', 'workforce-lookup.html']]) {
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
