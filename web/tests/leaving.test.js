'use strict';
/* Who is leaving logic against the staged cubes (warehouse/cubes, read only): the per-entity
   doj_leaving files and doj_core. Expected values come from plain loops over the raw arrays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LV = require('../assets/js/leaving.js');
const D = require('../assets/js/data.js');

const CUBES = path.join(__dirname, '..', '..', 'warehouse', 'cubes');
const lmeta = JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_leaving.meta.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_core.json'), 'utf8'));
const coreMeta = JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_core.meta.json'), 'utf8'));
const coreRows = D.fromCube(core);
function entityFile(e) { return JSON.parse(fs.readFileSync(path.join(CUBES, lmeta.files[e].path), 'utf8')); }
const cache = {};
function rowsOf(e) { return cache[e] || (cache[e] = D.fromCube(entityFile(e))); }
function raw(e, g, p, d) {
  const f = entityFile(e), c = n => f.columns.indexOf(n);
  return f.rows.filter(r => r[c('grain')] === g && r[c('period')] === p && r[c('dimension')] === d).map(r => Object.fromEntries(f.columns.map((n, i) => [n, r[i]])))
    .sort((a, b) => a.value_order - b.value_order);
}

test('the meta lists one file per entity, and each file is that entity with the recorded rows and hash', () => {
  assert.deepEqual(Object.keys(lmeta.files).sort(), [...lmeta.entities].sort());
  for (const e of lmeta.entities) {
    const p = path.join(CUBES, lmeta.files[e].path);
    const f = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.equal(f.entity, e);
    assert.equal(f.rows.length, lmeta.files[e].rows, e + ' rows');
    assert.ok(f.rows.every(r => r[f.columns.indexOf('entity')] === e), e + ' holds only its own rows');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), lmeta.files[e].sha256, e + ' sha256');
  }
});

test('FY2025 DOJ: 30 years or more 40.51% with 2,615 left; attorneys 25.26% with 3,106 left', () => {
  const los = LV.snapshot(rowsOf('DOJ'), 'fy', 'FY2025', 'los');
  const g30 = los.groups.find(g => g.value === '30plus');
  assert.equal(g30.departures, 2615);
  assert.equal((g30.rate * 100).toFixed(2), '40.51');
  const occ = LV.snapshot(rowsOf('DOJ'), 'fy', 'FY2025', 'occupation');
  assert.deepEqual(occ.groups.map(g => g.value), ['0905', '1811', '0007', 'other']); // D-043
  assert.equal(occ.groups[0].departures, 3106);
  assert.equal((occ.groups[0].rate * 100).toFixed(2), '25.26');
  assert.equal(los.unknown, 39);
  assert.equal(los.groups.length, 7);
  // every group equals the raw row, and its prior is the FY2024 row
  const now = raw('DOJ', 'fy', 'FY2025', 'los').filter(r => !r.is_unknown), before = raw('DOJ', 'fy', 'FY2024', 'los');
  los.groups.forEach((g, i) => {
    assert.equal(g.rate, now[i].rate_num / now[i].rate_den);
    const b = before.find(r => r.value === g.value);
    assert.equal(g.prior.rate, b.rate_num / b.rate_den);
    assert.equal(g.prior.departures, b.departures);
  });
});

test('departures: each dimension partitions the total, and it equals doj_core', () => {
  for (const [e, g, p] of [['DOJ', 'fy', 'FY2025'], ['DOJ', 't12', '2026-07'], ['DJ14', 't12', '2026-04'], ['DJ02', 'fy', 'FY2026']]) {
    const total = LV.departures(rowsOf(e), g, p);
    for (const d of ['los', 'age', 'supervisory', 'occupation']) {
      assert.equal(raw(e, g, p, d).reduce((a, r) => a + r.departures, 0), total, [e, g, p, d].join(' '));
    }
    const y = LV.yearsLost(coreRows, e, g, p, coreMeta);
    assert.equal(y.departures, total, e + ' ' + p + ' matches doj_core departures');
  }
});

test('years lost: the FY row, or the 12 month rows summed; average and coverage are ratios of sums', () => {
  const c = n => core.columns.indexOf(n);
  const fy = core.rows.find(r => r[c('entity')] === 'DOJ' && r[c('grain')] === 'fy' && r[c('period')] === 'FY2025');
  const y = LV.yearsLost(coreRows, 'DOJ', 'fy', 'FY2025', coreMeta);
  assert.equal(y.lost, fy[c('years_of_service_lost')]);
  assert.equal(y.average, fy[c('years_of_service_lost')] / fy[c('yos_known')]);
  assert.equal(y.coverage, fy[c('yos_known')] / fy[c('departures')]);
  const months = core.rows.filter(r => r[c('entity')] === 'DOJ' && r[c('grain')] === 'month' && r[c('period')] >= '2025-08' && r[c('period')] <= '2026-07');
  assert.equal(months.length, 12);
  const s = n => months.reduce((a, r) => a + r[c(n)], 0);
  const t = LV.yearsLost(coreRows, 'DOJ', 't12', '2026-07', coreMeta);
  assert.equal(t.lost, s('years_of_service_lost'));
  assert.equal(t.known, s('yos_known'));
  assert.equal(t.average, s('years_of_service_lost') / s('yos_known'));
  assert.equal(t.coverage, s('yos_known') / s('departures'));
});

test('Community Relations Service: not applicable groups have no rate; small bases are flagged as the cube flags them', () => {
  const occ = LV.snapshot(rowsOf('DJ14'), 't12', '2026-04', 'occupation');
  assert.deepEqual(occ.groups.map(g => [g.value, g.na, g.rate === null]), [['0905', false, false], ['1811', true, true], ['0007', true, true], ['other', false, false]]);
  assert.equal(occ.groups[0].smallBase, true);
  assert.equal(occ.groups[3].smallBase, true);
  for (const d of ['los', 'age', 'supervisory', 'occupation']) {
    const snap = LV.snapshot(rowsOf('DJ14'), 't12', '2026-04', d);
    const rs = raw('DJ14', 't12', '2026-04', d).filter(r => !r.is_unknown);
    assert.deepEqual(snap.groups.map(g => g.smallBase), rs.map(r => r.rate_small_base === true), d);
    assert.deepEqual(snap.groups.map(g => g.na), rs.map(r => r.rate_not_applicable === true), d);
  }
});

test('periods, the year-earlier period and the trend', () => {
  const doj = rowsOf('DOJ');
  const t12 = LV.periodsOf(doj, 't12'), fy = LV.periodsOf(doj, 'fy');
  assert.equal(t12[0], '2012-09');
  assert.equal(t12.at(-1), '2026-07');
  assert.equal(t12.length, 167);
  assert.deepEqual([fy[0], fy.at(-1), fy.length], ['FY2012', 'FY2026', 15]);
  assert.equal(LV.periodsOf(rowsOf('DJ14'), 't12').at(-1), '2026-04');
  assert.equal(LV.priorPeriod('fy', 'FY2025'), 'FY2024');
  assert.equal(LV.priorPeriod('t12', '2026-07'), '2025-07');
  const tr = LV.trend(doj, 'fy', 'los');
  assert.equal(tr.periods.length, 15);
  assert.equal(tr.series.length, 7);
  const i = tr.periods.indexOf('FY2025'), r30 = raw('DOJ', 'fy', 'FY2025', 'los').find(r => r.value === '30plus');
  assert.equal(tr.series.find(s => s.value === '30plus').rates[i], r30.rate_num / r30.rate_den);
  assert.equal(tr.flags.at(-1).partial, true);
  assert.equal(LV.trend(doj, 't12', 'age').series.length, 10);
  // not applicable is a gap in the trend
  const occ14 = LV.trend(rowsOf('DJ14'), 't12', 'occupation');
  const s1811 = occ14.series.find(s => s.value === '1811');
  assert.ok(s1811.na.some(Boolean) && s1811.na.every((na, j) => !na || s1811.rates[j] === null));
});

test('group labels name each value with its signed key', () => {
  assert.deepEqual(LV.groupLabel('los', '30plus'), { ref: 'page:group.los.30plus' });
  assert.deepEqual(LV.groupLabel('age', '25_29'), { ref: 'page:group.age.range', vars: { lo: '25', hi: '29' } });
  assert.deepEqual(LV.groupLabel('age', '65plus'), { ref: 'page:group.age.65plus' });
  assert.deepEqual(LV.groupLabel('supervisory', 'other'), { ref: 'page:group.sup.other' });
  assert.deepEqual(LV.groupLabel('occupation', '0905'), { ref: 'page:group.occ.0905' });
  assert.throws(() => LV.groupLabel('age', 'x'), /unexpected age value/);
});
