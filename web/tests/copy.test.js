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
const SHARED_HD = ['ctl.rate', 'ctl.rate.a', 'ctl.rate.b', 'ctl.rate.c', 'ctl.rate.help.a', 'ctl.rate.help.b', 'ctl.rate.help.c', 'chart.noRateAtGrain',
  'flag.smallBase', 'flag.ytd']; // D-040
const SHARED_WL = []; // Who is leaving spec, D-044: its new keys all live on the page
const SHARED_CC = []; // Components compared spec, D-047: likewise

/* A spec's copy table: | key | text | rows under "## 4. Copy". Read only. */
function specCopy(file = 'workforce-size.md') {
  const md = fs.readFileSync(path.join(REPO, 'docs', 'pages', file), 'utf8');
  const sec = md.split(/^## \d\. Copy.*$/m)[1].split(/^## /m)[0];
  const out = {};
  for (const line of sec.split('\n')) {
    const m = /^\| ([a-zA-Z0-9._]+) \| (.+) \|$/.exec(line.trim());
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

test('the Who is leaving spec copy is present word for word and signed', () => {
  checkSpec('who-is-leaving.md', 'who-is-leaving', SHARED_WL, 38);
  assert.equal(copy.pages['who-is-leaving']['page.title'], 'Who is leaving');
});

test('the Components compared spec copy is present word for word and signed', () => {
  checkSpec('components-compared.md', 'components-compared', SHARED_CC, 23);
  assert.equal(copy.pages['components-compared']['page.title'], 'Components compared');
});

test('the Reading the data spec copy is present word for word and signed; the reasons row is split exactly', () => {
  const spec = specCopy('reading-the-data.md');
  assert.equal(Object.keys(spec).length, 37);
  const page = copy.pages['reading-the-data'];
  for (const [k, text] of Object.entries(spec)) {
    if (k === 'rates.reasons') continue;
    assert.equal(page[k], text, 'text of ' + k);
    assert.equal(page._status[k], 'signed', 'status of ' + k);
  }
  // "table: Transfer out (…); Quit; …" = the signed series labels, and the descriptions in parentheses
  const items = spec['rates.reasons'].replace(/^table: /, '').replace(/\.$/, '').split('; ');
  const cols = ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];
  assert.equal(items.length, 6);
  items.forEach((it, i) => {
    const m = /^(.*?)(?: \((.*)\))?$/.exec(it);
    assert.equal(copy.series[cols[i]], m[1], 'label ' + cols[i]);
    const key = 'rates.reasons.' + cols[i];
    if (m[2]) { assert.equal(page[key], m[2], key); assert.equal(page._status[key], 'signed', key); }
    else assert.equal(key in page, false, key + ' has no description');
  });
  assert.equal(copy.pages['reading-the-data']['page.title'], 'Reading the data');
});

test('Reading the data: four anchors, and Workforce size links to #known-gaps', () => {
  const src = fs.readFileSync(path.join(WEB, 'assets/js/pages/reading-the-data.js'), 'utf8');
  for (const id of ['source', 'counting', 'rates', 'known-gaps']) assert.match(src, new RegExp("section\\('" + id + "'"), id);
  assert.match(fs.readFileSync(path.join(WEB, 'assets/js/pages/workforce-size.js'), 'utf8'), /BREAK_HREF = 'reading-the-data\.html#known-gaps'/);
});

test('the Workforce Look-Up spec copy is present word for word and signed', () => {
  checkSpec('workforce-lookup.md', 'workforce-lookup', [], 51);
  assert.equal(copy.pages['workforce-lookup']['page.title'], 'Workforce Look-Up');
});

test('the job series addendum: its keys in shell and the 15 names in series_names, word for word and signed (D-063)', () => {
  const spec = specCopy('job-series-filter.md');
  const keys = Object.keys(spec).filter(k => !/^\d{4}$/.test(k) && k !== 'Code'), codes = Object.keys(spec).filter(k => /^\d{4}$/.test(k)); // 'Code' is the names table's header
  assert.deepEqual(keys, ['ctl.series', 'ctl.series.all', 'ctl.series.other', 'series.none', 'series.ytdOnly', 'series.growthNoBase']);
  assert.equal(copy.shell['series.ytdOnly'], 'Breakdowns by job series are available by fiscal year or by administration.', 'series.ytdOnly as re-signed in D-070');
  for (const k of keys) { assert.equal(copy.shell[k], spec[k], k); assert.equal(copy.shell._status[k], 'signed', k); }
  // object keys such as '1801' sort first in JavaScript, so the order is read from the spec text itself
  const md = fs.readFileSync(path.join(REPO, 'docs', 'pages', 'job-series-filter.md'), 'utf8');
  const order = [...md.matchAll(/^\| (\d{4}) \| /gm)].map(m => m[1]);
  assert.deepEqual(order, require('../assets/js/series.js').CODES, 'the names in D-062 order (the control uses series.js CODES)');
  assert.deepEqual(Object.keys(copy.series_names).filter(k => k !== '_status').sort(), [...codes].sort());
  for (const c of codes) { assert.equal(copy.series_names[c], spec[c], c); assert.equal(copy.series_names._status[c], 'signed', c); }
  // the first three match the signed Who is leaving occupation names (D-044)
  assert.equal(copy.series_names['0905'], copy.pages['who-is-leaving']['group.occ.0905']);
  assert.equal(copy.series_names['1811'], copy.pages['who-is-leaving']['group.occ.1811']);
  assert.equal(copy.series_names['0007'], copy.pages['who-is-leaving']['group.occ.0007']);
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

test('the administrations addendum: its keys word for word and signed, in shell except ctl.view.admin (D-068); the old preset hook is gone', () => {
  const spec = specCopy('administrations.md');
  assert.equal(Object.keys(spec).length, 23);
  for (const [k, text] of Object.entries(spec)) {
    const sec = k === 'ctl.view.admin' ? copy.pages['who-is-leaving'] : copy.shell;
    assert.equal(sec[k], text, 'text of ' + k);
    assert.equal(sec._status[k], 'signed', 'status of ' + k);
  }
  for (const k of ['ctl.range.presets', 'ctl.range.presetsLabel']) assert.equal(k in copy.shell, false, k + ' is removed (ctl.presets.label replaces it)');
});

test('these stay unsigned until signed', () => {
  const still = ['site.draftNotice', 'stub.body'];
  for (const k of still) assert.equal(copy.shell._status[k], 'unsigned', k);
});

const SHELL_D035 = ['site.documentTitle', 'nav.label', 'controls.label', 'chart.exportSvg', 'chart.legendLabel'];
test('D-035 keys are signed; the fixture badge key is gone', () => {
  for (const k of SHELL_D035) assert.equal(copy.shell._status[k], 'signed', k);
  assert.equal('chart.fixtureBadge' in copy.shell, false);
});

test('nothing else is signed', () => {
  const ws = specCopy('workforce-size.md'), hd = specCopy('hiring-and-departures.md'), wl = specCopy('who-is-leaving.md'), cc = specCopy('components-compared.md'), rd = specCopy('reading-the-data.md'), lu = specCopy('workforce-lookup.md'), js = specCopy('job-series-filter.md'), ad = specCopy('administrations.md'), rdz = specCopy('redesign.md');
  for (const [name, sec] of sections()) {
    for (const [k, st] of Object.entries(sec._status)) {
      if (st !== 'signed') continue;
      const ok = name === 'components' || name === 'series' || (name === 'series_names' && k in js) || (name === 'shell' && k in js && !/^\d{4}$/.test(k)) || (name === 'shell' && k in ad && k !== 'ctl.view.admin') || (name === 'shell' && (k in rdz || k in D074)) || (name === 'who-is-leaving' && k === 'ctl.view.admin') ||
        (name === 'workforce-size' && k in ws) || (name === 'hiring-and-departures' && k in hd) || (name === 'who-is-leaving' && k in wl) || (name === 'components-compared' && k in cc) || (name === 'workforce-lookup' && k in lu) || (name === 'reading-the-data' && ((k in rd && k !== 'rates.reasons') || /^rates\.reasons\.sep_(transfer_out|retirement|rif)$/.test(k))) ||
        (name === 'shell' && (k in GRAIN_D033 || SHELL_D034.includes(k) || SHELL_D035.includes(k) || SHARED_WS.includes(k) || SHARED_HD.includes(k))) ||
        (TITLES_D034.includes(name) && k === 'page.title');
      assert.ok(ok, name + ':' + k + ' is signed without a signature');
    }
  }
});

test('navigation (redesign, D-072): three main pages and two secondary links; the old pages live on as history-*.html; the old addresses open the new pages', () => {
  const src = fs.readFileSync(path.join(WEB, 'assets/js/shell.js'), 'utf8');
  const nav = [...src.matchAll(/\{ id: '([a-z-]+)', href: '([a-z-]+\.html)', nav: '(shell:nav\.[a-z]+)'( , secondary: true)?/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepEqual(nav, [['overview', 'index.html', 'shell:nav.overview'], ['departures', 'departures.html', 'shell:nav.departures'], ['components-view', 'components.html', 'shell:nav.components'],
    ['workforce-lookup', 'workforce-lookup.html', 'shell:nav.lookup'], ['reading-the-data', 'reading-the-data.html', 'shell:nav.reading']]);
  assert.equal((src.match(/secondary: true/g) || []).length, 2, 'Look-Up and Reading the data are the secondary links');
  for (const [id, href, ref] of nav) {
    const html = fs.readFileSync(path.join(WEB, href), 'utf8');
    assert.match(html, new RegExp('data-page="' + id + '"'), href);
    const h1 = /<h1 data-copy="([^"]+)"/.exec(html)[1];
    if (['overview', 'departures', 'components-view'].includes(id)) assert.equal(h1, ref, href + ' h1 is its signed nav name');
    else assert.equal(h1, 'page:page.title', href);
  }
  // the old pages, unchanged, under new names (each keeps its page id and copy section)
  for (const [file, id] of [['history-workforce-size.html', 'workforce-size'], ['history-hiring-and-departures.html', 'hiring-and-departures'], ['history-who-is-leaving.html', 'who-is-leaving'], ['history-components-compared.html', 'components-compared']]) {
    assert.match(fs.readFileSync(path.join(WEB, file), 'utf8'), new RegExp('<body data-page="' + id + '">'), file);
    assert.equal(copy.pages[id]._status['page.title'], 'signed', id);
  }
  // the old addresses: no text, one script that opens the new page
  for (const [file, target] of [['hiring-and-departures.html', 'departures.html'], ['who-is-leaving.html', 'departures.html'], ['components-compared.html', 'components.html']]) {
    const html = fs.readFileSync(path.join(WEB, file), 'utf8');
    assert.match(html, new RegExp('<body data-moved="' + file.replace('.html', '') + '">'), file);
    assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]), ['assets/js/moved-redirect.js'], file);
    assert.ok(!/http-equiv/i.test(html), file + ': no meta refresh');
  }
  const redirect = fs.readFileSync(path.join(WEB, 'assets/js/moved-redirect.js'), 'utf8');
  assert.match(redirect, /'hiring-and-departures': 'departures\.html', 'who-is-leaving': 'departures\.html', 'components-compared': 'components\.html'/);
  assert.match(redirect, /location\.replace\(/);
  assert.deepEqual(Object.values(copy.pages).map(p => p['page.title']),
    ['Workforce size', 'Hiring and departures', 'Who is leaving', 'Components compared', 'Workforce Look-Up', 'Reading the data']);
});

const D074 = { 'dep.who.unknownAdmin': '{admin}: {count} departures with unknown {dimension} are counted in the total but not shown as a group.',
  'dep.who.coverageAdmin': '{admin}: based on {pct} of departures with a known length of service.',
  // D-076
  'dep.who.unknownAdmin1': '{admin}: 1 departure with unknown {dimension} is counted in the total but not shown as a group.',
  'comp.minis.crsNote': 'Community Relations Service, a very small office, is shown on its own scale.' };
test('D-074 and D-076: the per-administration notes (plural and singular) and the CRS scale note are in shell word for word and signed', () => {
  for (const [k, text] of Object.entries(D074)) { assert.equal(copy.shell[k], text, k); assert.equal(copy.shell._status[k], 'signed', k); }
});

test('the redesign spec copy (section 7, D-072) is in shell word for word and signed', () => {
  const spec = specCopy('redesign.md');
  // the expected set is the spec table itself (D-072, plus the rows D-074 to D-076 added), so no count is hard-coded
  assert.ok(Object.keys(spec).length > 0, 'redesign.md section 7 has a copy table');
  for (const k of Object.keys(D074)) assert.ok(k in spec, k + ' is in the spec table');
  for (const [k, text] of Object.entries(spec)) {
    assert.equal(copy.shell[k], text, 'text of ' + k);
    assert.equal(copy.shell._status[k], 'signed', 'status of ' + k);
  }
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
  const byPage = { 'workforce-size': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/page-controls.js', 'assets/js/admin-panel-flows.js', 'assets/js/admin-panel.js', 'assets/js/pages/workforce-size.js'],
    'hiring-and-departures': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/page-controls.js', 'assets/js/admin-panel-flows.js', 'assets/js/admin-panel.js', 'assets/js/pages/hiring-and-departures.js'],
    'who-is-leaving': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/admin-panel.js', 'assets/js/pages/who-is-leaving.js'],
    'components-compared': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/admin-panel-flows.js', 'assets/js/admin-panel.js', 'assets/js/pages/components-compared.js'],
    'overview': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/main-kit.js', 'assets/js/pages/overview.js'],
    'departures': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/main-kit.js', 'assets/js/moved.js', 'assets/js/pages/departures.js'],
    'components-view': ['assets/js/shell.js', 'assets/js/chart-frame.js', 'assets/js/page-kit.js', 'assets/js/page-charts.js', 'assets/js/component-bar.js', 'assets/js/main-kit.js', 'assets/js/moved.js', 'assets/js/pages/components-view.js'],
    'workforce-lookup': ['assets/js/shell.js', 'assets/js/page-kit.js', 'assets/js/pages/workforce-lookup.js'] };
  for (const [pageId, files] of Object.entries(byPage)) {
    const acc = C.createCopy(copy, pageId);
    for (const f of files) {
      const src = fs.readFileSync(path.join(WEB, f), 'utf8');
      for (const m of src.matchAll(/copy\.(?:t|raw)\('((?:shell|page|components|series|series_names|components-compared|workforce-size|hiring-and-departures|who-is-leaving):[^']+)'\s*[,)]/g)) assert.doesNotThrow(() => acc.raw(m[1]), pageId + ' ' + f + ' ' + m[1]);
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

test('peek reads without marking used', () => {
  const acc = C.createCopy(copy, 'workforce-size');
  assert.equal(acc.peek('shell:ctl.presets.label'), 'Administration');
  assert.deepEqual(acc.used(), []);
  assert.deepEqual(acc.unsignedUsed(), []);
  // the presets' label is the signed ctl.presets.label (page-controls.js); the windows come from OPM.admin
  const src = fs.readFileSync(path.join(WEB, 'assets/js/page-controls.js'), 'utf8');
  assert.match(src, /presetsLabel: copy\.t\('shell:ctl\.presets\.label'\)/);
  assert.match(src, /presets: OPM\.admin\.presets\(names, bounds\)/);
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
