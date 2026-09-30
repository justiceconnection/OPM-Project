'use strict';
/* Copy discipline: every visible string lives in copy.json, every key carries a status, and the
   signed strings are exactly the signed ones: the page specs' section 4 tables (D-030, D-040), the
   component names (D-016), the series labels (D-015, D-020) and the shell decisions (D-033 to D-035). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../tools/stamp-lib.js');
const C = require('../assets/js/copy.js');

const WEB = path.join(__dirname, '..');
const REPO = path.join(WEB, '..');
const copy = JSON.parse(fs.readFileSync(path.join(WEB, 'copy.json'), 'utf8'));
const htmlFiles = S.servedFiles().filter(f => f.endsWith('.html'));
const sections = () => Object.entries(copy).filter(([k]) => k !== 'pages' && !k.startsWith('_')).concat(Object.entries(copy.pages));

/* Keys a page spec signs but that live in shell because several pages share them. */
const SHARED_WS = ['flag.provisional', 'ctl.component', 'ctl.component.all'];                    // Workforce size spec, D-030
const SHARED_HD = ['ctl.rate', 'ctl.rate.a', 'ctl.rate.b', 'ctl.rate.c', 'ctl.rate.help.a', 'ctl.rate.help.b', 'ctl.rate.help.c', 'chart.noRateAtGrain']; // D-040

/* A spec's copy table: | key | text | rows under "## 4. Copy". Read only. */
function specCopy(file = 'workforce-size.md') {
  const md = fs.readFileSync(path.join(REPO, 'docs', 'pages', file), 'utf8');
  const sec = md.split(/^## 4\. Copy.*$/m)[1].split(/^## /m)[0];
  const out = {};
  for (const line of sec.split('\n')) {
    const m = /^\| ([a-zA-Z0-9.]+) \| (.+) \|$/.exec(line.trim());
    if (m && m[1] !== 'Key') out[m[1]] = m[2];
  }
  return out;
}

test('every key in every section has a status, and only signed or unsigned', () => {
  for (const [name, sec] of sections()) {
    assert.ok(sec._status, name + ' has no _status map');
    const keys = Object.keys(sec).filter(k => k !== '_status');
    assert.deepEqual(Object.keys(sec._status).sort(), keys.sort(), name + ': _status keys differ from the section keys');
    for (const k of keys) assert.ok(['signed', 'unsigned'].includes(sec._status[k]), name + ':' + k + ' has status ' + sec._status[k]);
  }
});

function checkSpec(file, pageId, shared, count) {
  const spec = specCopy(file);
  assert.equal(Object.keys(spec).length, count, file + ' table size');
  for (const [k, text] of Object.entries(spec)) {
    const sec = shared.includes(k) ? copy.shell : copy.pages[pageId];
    assert.equal(sec[k], text, 'text of ' + k);
    assert.equal(sec._status[k], 'signed', 'status of ' + k);
    if (shared.includes(k)) assert.equal(k in copy.pages[pageId], false, k + ' is shared; it must not be duplicated on the page');
  }
}

test('the Workforce size spec copy is present word for word and signed (shared keys in shell)', () => {
  checkSpec('workforce-size.md', 'workforce-size', SHARED_WS, 20);
});

test('the Hiring and departures spec copy is present word for word and signed (rate keys in shell)', () => {
  checkSpec('hiring-and-departures.md', 'hiring-and-departures', SHARED_HD, 27);
  assert.equal(copy.pages['hiring-and-departures']['page.title'], 'Hiring and departures');
});

test('series labels match the signed tables in docs/metric-spec.md section 4 (D-015, D-020)', () => {
  const md = fs.readFileSync(path.join(REPO, 'docs', 'metric-spec.md'), 'utf8');
  const sec = md.split(/^## 4\. Categories.*$/m)[1].split(/^## /m)[0];
  const signed = {};
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length >= 6 && cells[4] === 'signed') signed[cells[1]] = cells[3];
  }
  const map = { sep_transfer_out: 'Transfer out', sep_quit: 'Quit', sep_retirement: 'Retirement', sep_rif: 'RIF', sep_termination: 'Termination',
    sep_other: 'Other', sep_drp: 'DRP (overlay)', acc_new_hire: 'New hire', acc_transfer_in: 'Transfer in' };
  assert.deepEqual(Object.keys(copy.series).filter(k => k !== '_status').sort(), Object.keys(map).sort());
  for (const [col, series] of Object.entries(map)) {
    assert.equal(copy.series[col], signed[series], col + ' label');
    assert.equal(copy.series._status[col], 'signed', col);
  }
});

test('component display names match the crosswalk and are signed (D-016)', () => {
  const csv = fs.readFileSync(path.join(REPO, 'pipeline', 'crosswalks', 'components.csv'), 'utf8').trim().split('\n').slice(1);
  const names = {};
  for (const line of csv) {
    const cells = line.match(/("([^"]*)"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, ''));
    names[cells[0]] = { name: cells[2], status: cells[3] };
  }
  assert.deepEqual(Object.keys(copy.components).filter(k => k !== '_status').sort(), Object.keys(names).sort());
  for (const [code, v] of Object.entries(names)) {
    assert.equal(copy.components[code], v.name, code);
    assert.equal(v.status, 'signed', code + ' is not signed in the crosswalk');
    assert.equal(copy.components._status[code], 'signed', code);
  }
});

/* D-033, signed dashboard-wide wording for the grain control. */
const GRAIN_D033 = {
  'ctl.grain': 'View', 'ctl.grain.fy': 'Yearly', 'ctl.grain.quarter': 'Quarterly', 'ctl.grain.month': 'Monthly',
  'ctl.grain.note': 'Years run October to September, the federal fiscal year.'
};
test('the grain control wording is D-033 and signed', () => {
  for (const [k, text] of Object.entries(GRAIN_D033)) {
    assert.equal(copy.shell[k], text, k);
    assert.equal(copy.shell._status[k], 'signed', k);
  }
});

/* D-034, more signed shell copy (text unchanged) and every page title. */
const SHELL_D034 = ['site.publisher', 'footer.source', 'footer.build', 'ctl.range.from', 'ctl.range.to', 'period.months', 'period.month',
  'period.quarter', 'period.fy', 'flag.partial.label', 'ctl.component.ended', 'data.unavailable', 'num.none'];
const TITLES_D034 = ['hiring-and-departures', 'who-is-leaving', 'components-compared', 'workforce-lookup', 'reading-the-data'];
test('D-034 keys are signed', () => {
  for (const k of SHELL_D034) assert.equal(copy.shell._status[k], 'signed', k);
  for (const id of TITLES_D034) assert.equal(copy.pages[id]._status['page.title'], 'signed', id);
});

test('these stay unsigned until signed', () => {
  const still = ['site.draftNotice', 'stub.body', 'ctl.range.presetsLabel', 'ctl.range.presets'];
  for (const k of still) assert.equal(copy.shell._status[k], 'unsigned', k);
});

const SHELL_D035 = ['site.documentTitle', 'nav.label', 'controls.label', 'chart.exportSvg', 'chart.legendLabel'];
test('D-035 keys are signed; the fixture badge key is gone', () => {
  for (const k of SHELL_D035) assert.equal(copy.shell._status[k], 'signed', k);
  assert.equal('chart.fixtureBadge' in copy.shell, false);
});

test('nothing else is signed', () => {
  const ws = specCopy('workforce-size.md'), hd = specCopy('hiring-and-departures.md');
  for (const [name, sec] of sections()) {
    for (const [k, st] of Object.entries(sec._status)) {
      if (st !== 'signed') continue;
      const ok = name === 'components' || name === 'series' ||
        (name === 'workforce-size' && k in ws) || (name === 'hiring-and-departures' && k in hd) ||
        (name === 'shell' && (k in GRAIN_D033 || SHELL_D034.includes(k) || SHELL_D035.includes(k) || SHARED_WS.includes(k) || SHARED_HD.includes(k))) ||
        (TITLES_D034.includes(name) && k === 'page.title');
      assert.ok(ok, name + ':' + k + ' is signed without a signature');
    }
  }
});

test('the six planned pages exist, each with a title', () => {
  const src = fs.readFileSync(path.join(WEB, 'assets/js/shell.js'), 'utf8');
  const pages = [...src.matchAll(/\{ id: '([a-z-]+)', href: '([a-z-]+\.html)' \}/g)].map(m => [m[1], m[2]]);
  assert.equal(pages.length, 6);
  for (const [id, href] of pages) {
    assert.ok(fs.existsSync(path.join(WEB, href)), href);
    assert.equal(typeof copy.pages[id]['page.title'], 'string', id);
    assert.match(fs.readFileSync(path.join(WEB, href), 'utf8'), new RegExp('data-page="' + id + '"'));
  }
  assert.deepEqual(Object.values(copy.pages).map(p => p['page.title']),
    ['Workforce size', 'Hiring and departures', 'Who is leaving', 'Components compared', 'Workforce Look-Up', 'Reading the data']);
});

test('HTML carries no visible text of its own; every data-copy ref resolves', () => {
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, '').trim();
    assert.equal(visible, '', f + ' has literal text: ' + visible.slice(0, 80));
    const pageId = (/data-page="([^"]+)"/.exec(html) || [])[1];
    const acc = C.createCopy(copy, pageId);
    for (const m of html.matchAll(/data-copy="([^"]+)"/g)) assert.equal(typeof acc.t(m[1]), 'string', f + ' ' + m[1]);
  }
});

test('every copy ref used in the page scripts resolves', () => {
  const byPage = { 'workforce-size': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/pages/workforce-size.js'],
    'hiring-and-departures': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/pages/hiring-and-departures.js'] };
  for (const [pageId, files] of Object.entries(byPage)) {
    const acc = C.createCopy(copy, pageId);
    for (const f of files) {
      const src = fs.readFileSync(path.join(WEB, f), 'utf8');
      for (const m of src.matchAll(/copy\.(?:t|raw)\('((?:shell|page|components|series):[^']+)'/g)) assert.doesNotThrow(() => acc.raw(m[1]), pageId + ' ' + f + ' ' + m[1]);
    }
  }
});

test('copy accessor: records used keys and reports the unsigned ones', () => {
  const acc = C.createCopy(copy, 'workforce-size');
  assert.equal(acc.t('page:tile.headcount.asof', { month: 'Jul 2026' }), 'As of Jul 2026');
  acc.t('page:tile.headcount');
  assert.deepEqual(acc.unsignedUsed(), []);
  acc.t('shell:ctl.grain');
  assert.deepEqual(acc.unsignedUsed(), []); // signed under D-033
  acc.t('shell:stub.body');
  acc.t('shell:site.draftNotice');
  assert.deepEqual(acc.unsignedUsed(['shell:site.draftNotice']), ['shell:stub.body']);
  assert.throws(() => acc.t('page:nope'), /no page:nope/);
  assert.throws(() => acc.t('no-section'), /needs a section/);
  assert.equal(acc.status('components:DJ02'), 'signed');
  assert.equal(acc.fill('{a} and {b}', { a: 1 }), '1 and {b}'); // a missing var stays visible
});

test('peek reads without marking used; empty presets never count toward the badge', () => {
  const acc = C.createCopy(copy, 'workforce-size');
  assert.deepEqual(acc.peek('shell:ctl.range.presets'), []);
  assert.equal(acc.peek('shell:ctl.range.presetsLabel'), 'Presets');
  assert.deepEqual(acc.used(), []);
  assert.deepEqual(acc.unsignedUsed(), []);
  // the data pages read the preset strings only behind a non-empty check (in the shared page kit)
  const src = fs.readFileSync(path.join(WEB, 'assets/js/page-kit.js'), 'utf8');
  assert.match(src, /var hasPresets = \(copy\.peek\('shell:ctl\.range\.presets'\) \|\| \[\]\)\.length > 0;/);
  assert.match(src, /presetsLabel: hasPresets \? copy\.t\('shell:ctl\.range\.presetsLabel'\) : ''/);
  assert.match(src, /presets: hasPresets \? copy\.raw\('shell:ctl\.range\.presets'\) : \[\]/);
});

test('no em dash anywhere in web/', () => {
  const all = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|css|js|json|md|mjs)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes(String.fromCharCode(0x2014))) all.push(p);
    }
  })(WEB);
  assert.deepEqual(all, []);
});

test('no CDN script: Chart.js is vendored and every script is local', () => {
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) assert.ok(!/^(https?:)?\/\//.test(m[1]), f + ' ' + m[1]);
  }
  assert.match(fs.readFileSync(path.join(WEB, 'assets/vendor/chart.umd.min.js'), 'utf8').slice(0, 400), /Chart\.js v4\./);
});
