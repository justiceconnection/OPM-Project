'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assets/js/controls/grain.js');
const R = require('../assets/js/controls/range.js');
const M = require('../assets/js/controls/rate-method.js');

const bounds = { start: '2011-10', end: '2026-07' };

test('grain control: three options, fiscal year default (D-029), unknown values fall back', () => {
  assert.equal(G.DEFAULT, 'fy');
  assert.deepEqual(G.OPTIONS, ['fy', 'quarter', 'month']); // Yearly, Quarterly, Monthly (D-033)
  assert.equal(G.normalize('fy'), 'fy');
  assert.equal(G.normalize('week'), G.DEFAULT);
});

test('grain control: arrow keys wrap, Home and End jump, other keys do nothing', () => {
  assert.equal(G.step('fy', 'ArrowRight'), 'quarter');
  assert.equal(G.step('month', 'ArrowRight'), 'fy');
  assert.equal(G.step('fy', 'ArrowLeft'), 'month');
  assert.equal(G.step('quarter', 'Home'), 'fy');
  assert.equal(G.step('fy', 'End'), 'month');
  assert.equal(G.step('month', 'a'), null);
  // a page may offer fewer options (Who is leaving: Yearly and Last 12 months)
  assert.equal(G.step('fy', 'ArrowRight', ['fy', 't12']), 't12');
  assert.equal(G.step('t12', 'ArrowRight', ['fy', 't12']), 'fy');
  assert.equal(G.step('t12', 'Home', ['fy', 't12']), 'fy');
});

test('range control: default is the full range from Oct 2011', () => {
  assert.deepEqual(R.defaultRange(bounds), { start: '2011-10', end: '2026-07' });
});

test('range control: the administration presets (D-065) are valid; malformed presets are ignored', () => {
  const copy = require('../copy.json');
  assert.equal('ctl.range.presets' in copy.shell, false, 'the old copy hook is gone; presets are built from OPM.admin');
  const A = require('../assets/js/admin.js');
  const names = { obama2: 'Obama II', trump1: 'Trump I', biden: 'Biden', trump2: 'Trump II', all: 'All' };
  const ps = A.presets(names, bounds);
  assert.equal(R.validPresets(ps).length, 5);
  assert.deepEqual(['obama2', 'trump1', 'biden', 'trump2', 'all'].map(id => R.presetRange(ps, id, bounds)), [
    { start: '2013-01', end: '2016-12' }, { start: '2017-01', end: '2020-12' }, { start: '2021-01', end: '2024-12' },
    { start: '2025-01', end: '2026-07' }, { start: '2011-10', end: '2026-07' }]);
  assert.equal(R.matchPreset(ps, { start: '2021-01', end: '2024-12' }, bounds), 'biden');
  assert.equal(R.matchPreset(ps, { start: '2021-02', end: '2024-12' }, bounds), null);
  assert.deepEqual(R.validPresets([]), []);
  assert.deepEqual(R.validPresets(undefined), []);
  const list = [
    { id: 'a', label: 'A', start: '2017-01', end: '2021-01' },
    { id: 'b', label: 'B', start: '2021-01', end: null },
    { id: 'bad1', label: 'X', start: '2021-13', end: null },
    { id: 'bad2', label: 'Y', start: '2021-05', end: '2021-01' },
    { label: 'no id', start: '2021-01', end: null }
  ];
  assert.deepEqual(R.validPresets(list).map(p => p.id), ['a', 'b']);
  assert.deepEqual(R.presetRange(list, 'a', bounds), { start: '2017-01', end: '2021-01' });
  assert.deepEqual(R.presetRange(list, 'b', bounds), { start: '2021-01', end: '2026-07' });
  assert.equal(R.presetRange(list, 'bad1', bounds), null);
  assert.equal(R.matchPreset(list, { start: '2021-01', end: '2026-07' }, bounds), 'b');
  assert.equal(R.matchPreset(list, bounds, bounds), null);
});

test('rate method hook: three D-019 methods, trailing 12 months by default', () => {
  assert.deepEqual(M.ids(), ['a', 'b', 'c']);
  assert.equal(M.DEFAULT, 'a');
  assert.equal(M.normalize('nope'), 'a');
  assert.ok(M.availableAt('a', 'month'));
  assert.ok(!M.availableAt('b', 'month'));
  assert.ok(!M.availableAt('b', 'quarter'));
  assert.ok(M.availableAt('b', 'fy'));
  assert.ok(M.availableAt('c', 'quarter'));
});
