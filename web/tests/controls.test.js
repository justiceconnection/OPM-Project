'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assets/js/controls/grain.js');
const R = require('../assets/js/controls/range.js');
const M = require('../assets/js/controls/rate-method.js');

const bounds = { start: '2011-10', end: '2026-07' };

test('grain control: three options, month default, unknown values fall back', () => {
  assert.deepEqual(G.OPTIONS, ['month', 'quarter', 'fy']);
  assert.equal(G.normalize('fy'), 'fy');
  assert.equal(G.normalize('week'), G.DEFAULT);
});

test('grain control: arrow keys wrap, Home and End jump, other keys do nothing', () => {
  assert.equal(G.step('month', 'ArrowRight'), 'quarter');
  assert.equal(G.step('fy', 'ArrowRight'), 'month');
  assert.equal(G.step('month', 'ArrowLeft'), 'fy');
  assert.equal(G.step('quarter', 'Home'), 'month');
  assert.equal(G.step('month', 'End'), 'fy');
  assert.equal(G.step('month', 'a'), null);
});

test('range control: default is the full range from Oct 2011', () => {
  assert.deepEqual(R.defaultRange(bounds), { start: '2011-10', end: '2026-07' });
});

test('range control: the preset hook ships empty and ignores malformed presets', () => {
  const copy = require('../copy.json');
  assert.deepEqual(copy.controls.range.presets, []);
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
