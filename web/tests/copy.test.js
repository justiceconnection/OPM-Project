'use strict';
/* Copy discipline: every visible string lives in copy.json, which says it is unsigned. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../tools/stamp-lib.js');

const WEB = path.join(__dirname, '..');
const copy = JSON.parse(fs.readFileSync(path.join(WEB, 'copy.json'), 'utf8'));
const htmlFiles = S.servedFiles().filter(f => f.endsWith('.html'));
const get = (p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), copy);

test('copy.json is marked unsigned', () => {
  assert.equal(copy._signed, false);
  assert.match(copy._status, /UNSIGNED/);
});

test('the six planned pages exist, each with a working title', () => {
  const src = fs.readFileSync(path.join(WEB, 'assets/js/shell.js'), 'utf8');
  const pages = [...src.matchAll(/\{ id: '([a-z-]+)', href: '([a-z-]+\.html)' \}/g)].map(m => [m[1], m[2]]);
  assert.equal(pages.length, 6);
  for (const [id, href] of pages) {
    assert.ok(fs.existsSync(path.join(WEB, href)), href);
    assert.equal(typeof get('pages.' + id + '.title'), 'string', id);
    assert.match(fs.readFileSync(path.join(WEB, href), 'utf8'), new RegExp('data-page="' + id + '"'));
  }
  assert.deepEqual(Object.values(copy.pages).map(p => p.title),
    ['Workforce size', 'Hiring and departures', 'Who is leaving', 'Components compared', 'Workforce Look-Up', 'Reading the data']);
});

test('HTML carries no visible text of its own; every data-copy key resolves', () => {
  for (const f of htmlFiles) {
    const html = fs.readFileSync(path.join(WEB, f), 'utf8');
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<[^>]+>/g, '').trim();
    assert.equal(visible, '', f + ' has literal text: ' + visible.slice(0, 80));
    for (const m of html.matchAll(/data-copy="([^"]+)"/g)) assert.equal(typeof get(m[1]), 'string', f + ' ' + m[1]);
  }
});

test('copy paths used by scripts resolve', () => {
  const keys = ['site.publisher', 'site.documentTitle', 'site.draftNotice', 'nav.label', 'footer.source', 'footer.build',
    'controls.label', 'controls.grain.label', 'controls.range.from', 'controls.range.to', 'controls.range.presetsLabel',
    'controls.rateMethod.label', 'chart.exportSvg', 'chart.legendLabel', 'chart.fixtureBadge', 'chart.noRateAtGrain',
    'demo.title', 'demo.series.attrition', 'demo.series.quit', 'periods.month', 'periods.fiscalQuarter', 'periods.fiscalYear'];
  for (const k of keys) assert.equal(typeof get(k), 'string', k);
  for (const g of ['month', 'quarter', 'fy']) assert.equal(typeof copy.controls.grain.options[g], 'string');
  for (const m of ['a', 'b', 'c']) assert.equal(typeof copy.controls.rateMethod.options[m], 'string');
  assert.equal(copy.periods.months.length, 12);
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
