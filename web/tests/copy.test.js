'use strict';
/* Copy discipline: every visible string lives in copy.json, every key carries a status, and the
   signed strings are exactly the signed ones: the Workforce size spec's section 4 (D-030) and
   the component display names (D-016). */
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
const sections = () => [['shell', copy.shell], ['components', copy.components]].concat(Object.entries(copy.pages));

/* The spec's copy table: | key | text | rows under "## 4. Copy". Read only. */
function specCopy() {
  const md = fs.readFileSync(path.join(REPO, 'docs', 'pages', 'workforce-size.md'), 'utf8');
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

test('the Workforce size spec copy is present word for word and signed', () => {
  const spec = specCopy();
  assert.equal(Object.keys(spec).length, 20);
  const page = copy.pages['workforce-size'];
  for (const [k, text] of Object.entries(spec)) {
    assert.equal(page[k], text, 'text of ' + k);
    assert.equal(page._status[k], 'signed', 'status of ' + k);
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

test('these stay unsigned until signed (D-034 and D-035 left them out)', () => {
  const still = ['site.draftNotice', 'stub.body',
    'ctl.rate', 'ctl.rate.a', 'ctl.rate.b', 'ctl.rate.c', 'ctl.range.presetsLabel', 'ctl.range.presets', 'chart.noRateAtGrain'];
  for (const k of still) assert.equal(copy.shell._status[k], 'unsigned', k);
});

const SHELL_D035 = ['site.documentTitle', 'nav.label', 'controls.label', 'chart.exportSvg', 'chart.legendLabel'];
test('D-035 keys are signed; the fixture badge key is gone', () => {
  for (const k of SHELL_D035) assert.equal(copy.shell._status[k], 'signed', k);
  assert.equal('chart.fixtureBadge' in copy.shell, false);
});

test('nothing else is signed', () => {
  const spec = specCopy();
  for (const [name, sec] of sections()) {
    for (const [k, st] of Object.entries(sec._status)) {
      if (st !== 'signed') continue;
      const ok = name === 'components' || (name === 'workforce-size' && k in spec) || (name === 'shell' && (k in GRAIN_D033 || SHELL_D034.includes(k) || SHELL_D035.includes(k))) ||
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
  const files = ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/pages/workforce-size.js'];
  const acc = C.createCopy(copy, 'workforce-size');
  for (const f of files) {
    const src = fs.readFileSync(path.join(WEB, f), 'utf8');
    for (const m of src.matchAll(/copy\.(?:t|raw)\('((?:shell|page|components):[^']+)'/g)) assert.doesNotThrow(() => acc.raw(m[1]), f + ' ' + m[1]);
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
  // the page reads the preset strings only behind a non-empty check
  const src = fs.readFileSync(path.join(WEB, 'assets/js/pages/workforce-size.js'), 'utf8');
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
