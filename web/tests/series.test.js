'use strict';
/* Job series filter against the series cubes (read only): the staged warehouse/cubes when present, else the
   promoted web/data copies; tests that need them skip when neither has them (they are not promoted yet). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SR = require('../assets/js/series.js');
const D = require('../assets/js/data.js');
const LV = require('../assets/js/leaving.js');

const INPUTS = require('./_inputs.js');
const DIR = INPUTS.cubesDir();
const HAVE = DIR && fs.existsSync(path.join(DIR, 'doj_core_series.meta.json')) && fs.existsSync(path.join(DIR, 'doj_leaving_series.meta.json'));
const SKIP = !HAVE && 'no series cubes (warehouse/cubes or web/data)';
const readJson = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const cm = HAVE ? readJson('doj_core_series.meta.json') : null;
const lm = HAVE ? readJson('doj_leaving_series.meta.json') : null;
const cache = {};
const file = (meta, e) => cache[meta.cube + e] || (cache[meta.cube + e] = D.fromCube(readJson(meta.files[e].path)));
const key = r => [r.entity, r.grain, r.period, r.dimension || '', r.value || ''].join('|');

test('the 15 series and "all other" in D-062 order', () => {
  assert.deepEqual(SR.CODES, ['0905', '1811', '0007', '0301', '0132', '0343', '1801', '2210', '0303', '0101', '0950', '0901', '0006', '0201', '7404']);
  assert.deepEqual(SR.GROUPS, SR.CODES.concat(['other']));
  assert.equal(SR.normalize('nope'), 'all');
  assert.equal(SR.normalize('1811'), '1811');
});

test('the cubes list the same groups in the same order', { skip: SKIP }, () => {
  assert.deepEqual(cm.series_groups.groups, SR.GROUPS);
  assert.deepEqual(lm.series_groups.groups, SR.GROUPS);
});

test('series_groups_present names exactly the groups each entity file holds', { skip: SKIP }, () => {
  for (const meta of [cm, lm]) for (const e of meta.entities) {
    const groups = [...new Set(file(meta, e).map(r => r.series_group))].sort();
    assert.deepEqual(groups, [...meta.series_groups_present[e]].sort(), meta.cube + ' ' + e);
    assert.equal(SR.present(meta, e, '0007'), groups.includes('0007'));
  }
  // correctional officers are at BOP only (and in the DOJ total)
  assert.deepEqual(cm.entities.filter(e => SR.present(cm, e, '0007')), ['DOJ', 'DJ03']);
});

test('pick returns that group\'s rows only, with the doj_core columns', { skip: SKIP }, () => {
  const rows = file(cm, 'DJ02');
  const pick = SR.pick(rows, '1811');
  assert.ok(pick.length > 0 && pick.every(r => r.series_group === '1811' && r.entity === 'DJ02'));
  const core = readJson('doj_core.json');
  assert.deepEqual(readJson(cm.files.DJ02.path).columns.filter(c => c !== 'series_group'), core.columns);
});

test('doj_core_series: the 16 groups sum exactly to doj_core for headcount, hires, departures and the categories', { skip: SKIP }, () => {
  const core = D.fromCube(readJson('doj_core.json'));
  const cols = ['headcount', 'hires', 'departures', 'sep_quit', 'sep_retirement', 'sep_transfer_out', 'acc_new_hire', 'net_flow'];
  for (const e of ['DOJ', 'DJ02', 'DJ03', 'DJ14']) {
    const sums = {};
    file(cm, e).forEach(r => { const k = key(r); const s = sums[k] || (sums[k] = {}); cols.forEach(c => { s[c] = (s[c] || 0) + (r[c] || 0); }); });
    const base = core.filter(r => r.entity === e);
    assert.equal(Object.keys(sums).length, base.length, e + ' periods');
    base.forEach(r => cols.forEach(c => assert.equal(sums[key(r)][c], r[c] || 0, e + ' ' + r.grain + ' ' + r.period + ' ' + c)));
  }
});

test('doj_leaving_series: fiscal years only; the 16 groups sum to doj_leaving departures and headcount per value', { skip: SKIP }, () => {
  for (const e of ['DOJ', 'DJ10']) {
    const rows = file(lm, e);
    assert.ok(rows.every(r => r.grain === 'fy'), 'fiscal years only');
    assert.ok(!rows.some(r => r.dimension === 'occupation'), 'no occupation breakdown (it would be one group)');
    assert.deepEqual(LV.periodsOf(rows, 't12'), []); // so a series view is Yearly only
    const sums = {};
    rows.forEach(r => { const k = key(r); const s = sums[k] || (sums[k] = { d: 0, h: 0 }); s.d += r.departures || 0; s.h += r.headcount || 0; });
    const base = D.fromCube(readJson('doj_leaving/' + e + '.json')).filter(r => r.grain === 'fy' && r.dimension !== 'occupation');
    base.forEach(r => { assert.equal(sums[key(r)].d, r.departures, e + ' ' + r.period + ' ' + r.dimension + ' ' + r.value + ' departures'); assert.equal(sums[key(r)].h, r.headcount, 'headcount'); });
  }
});

test('no staff: no row, or no employees and no hires or departures in the period', { skip: SKIP }, () => {
  assert.equal(SR.noStaff(null), true);
  assert.equal(SR.noStaff({ headcount: 0, hires: 0, departures: 0 }), true);
  assert.equal(SR.noStaff({ headcount: 0, hires: 0, departures: 2 }), false); // people left during the period
  assert.equal(SR.noStaff({ headcount: 5, hires: 0, departures: 0 }), false);
  const crs = SR.pick(file(cm, 'DJ14'), '0905').filter(r => r.grain === 'month');
  assert.ok(crs.some(r => SR.noStaff(r)), 'CRS attorneys: months with no one');
  // Components compared: at FY2025 only BOP has correctional officers among the components
  const comps = cm.entities.filter(e => e !== 'DOJ');
  const fy25 = comps.map(e => [e, SR.present(cm, e, '0007') ? SR.pick(file(cm, e), '0007').find(r => r.grain === 'fy' && r.period === 'FY2025') : null]);
  assert.deepEqual(fy25.filter(([, r]) => !SR.noStaff(r)).map(([e]) => e), ['DJ03']);
});
