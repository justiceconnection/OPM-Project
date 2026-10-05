'use strict';
/* Administrations logic (docs/pages/administrations.md; D-065 to D-068) against the staged doj_admin cube and the
   admin grain of doj_leaving (read only; warehouse/cubes when present, else web/data once promoted; the data tests skip
   when neither has doj_admin). Expected values come from plain loops over the raw arrays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../assets/js/admin.js');
const LV = require('../assets/js/leaving.js');
const D = require('../assets/js/data.js');
const I = require('./_inputs.js');

const CUBES = I.cubesDir();
const SKIP = !(CUBES && fs.existsSync(path.join(CUBES, 'doj_admin.meta.json'))) && 'no doj_admin (warehouse/cubes or web/data)';
const read = f => JSON.parse(fs.readFileSync(path.join(CUBES, f), 'utf8'));
const meta = SKIP ? null : read('doj_admin.meta.json');
const cache = {};
const rowsOf = e => cache[e] || (cache[e] = D.fromCube(read(meta.files[e].path)));

test('the four windows are D-065 and match pipeline/crosswalks/administrations.csv', () => {
  assert.deepEqual(A.IDS, ['obama2', 'trump1', 'biden', 'trump2']);
  assert.deepEqual(A.COMPARE_DEFAULT, ['trump2', 'biden', 'trump1']);
  const csv = path.join(I.REPO, 'pipeline', 'crosswalks', 'administrations.csv');
  if (!fs.existsSync(csv)) return;
  const lines = fs.readFileSync(csv, 'utf8').trim().split('\n'), head = lines[0].split(',');
  const rec = lines.slice(1).map(l => Object.fromEntries(l.split(',').map((v, i) => [head[i], v])));
  assert.deepEqual(rec.map(r => r.id), A.IDS);
  rec.forEach((r, i) => assert.equal(r.first_month, A.LIST[i].first, r.id + ' first month'));
  assert.deepEqual(A.windowOf('trump2', '2026-07'), { first: '2025-01', last: '2026-07', open: true });
  assert.deepEqual(A.windowOf('biden', '2026-07'), { first: '2021-01', last: '2024-12', open: false });
});

test('the meta lists the same administrations, and every entity file', { skip: SKIP }, () => {
  assert.deepEqual(meta.administrations.list.map(a => [a.id, a.first_month]), A.LIST.map(a => [a.id, a.first]));
  meta.administrations.list.filter(a => !a.open).forEach(a => assert.equal(a.last_month, A.byId(a.id).last, a.id));
  assert.deepEqual(Object.keys(meta.files).sort(), [...meta.entities].sort());
});

test('DOJ, first 19 months, the default set: the L-089 figures (pick and divide only)', { skip: SKIP }, () => {
  const rows = rowsOf('DOJ');
  const n = A.months(rows, 'DOJ', 'all', 'trump2');
  assert.equal(A.cap(rows, 'DOJ', 'all', A.COMPARE_DEFAULT), n, 'Trump II caps N at its months so far');
  assert.equal(A.cap(rows, 'DOJ', 'all', ['biden', 'trump1']), 48);
  if (meta.range.last_month !== '2026-07') return; // the figures below are for the data through Jul 2026
  assert.equal(n, 19);
  const want = { trump2: [-10048, '-0.0856', 11343, 20461, '11.67'], biden: [-552, '-0.0047', 15817, 15191, '8.23'], trump1: [-3702, '-0.0314', 9861, 12950, '7.07'] };
  for (const [id, w] of Object.entries(want)) {
    const c = A.cells(A.rowAt(rows, 'DOJ', 'all', id, 19));
    assert.equal(c.change, w[0], id); assert.equal(c.changePct.toFixed(4), w[1], id); assert.equal(c.hires, w[2], id); assert.equal(c.departures, w[3], id);
    assert.equal((c.attrition * 100).toFixed(2), w[4], id);
  }
  assert.equal(A.rowAt(rows, 'DOJ', 'all', 'trump2', 19).provisional, true);
  assert.equal(A.rowAt(rows, 'DOJ', 'all', 'trump2', 16).provisional, false);
});

test('every row: change = headcount_n - headcount_0 as stored; cells and shares are plain ratios of the row', { skip: SKIP }, () => {
  for (const e of meta.entities) {
    for (const r of rowsOf(e)) {
      if (r.headcount_0 !== null && r.headcount_n !== null) assert.equal(r.headcount_change, r.headcount_n - r.headcount_0, e + ' ' + r.administration + ' ' + r.months_in_office);
    }
  }
  const r = A.windowRow(rowsOf('DJ02'), 'DJ02', '1811', 'biden');
  assert.equal(r.months_in_office, r.admin_months);
  const c = A.cells(r);
  assert.equal(c.attrition, r.attrition_num / r.rate_den);
  assert.equal(c.changePct, r.headcount_change / r.headcount_0);
  const s = A.reasonShares(r);
  assert.ok(Math.abs(s.shares.reduce((a, v) => a + v, 0) - 1) < 1e-9, 'the seven chart reasons (D-080) partition departures');
  const l = A.line(rowsOf('DOJ'), 'DOJ', 'all', 'trump2', 19, 'headcount_change');
  assert.equal(l.values.length, 19);
  assert.equal(l.provisional.filter(Boolean).length, 3);
});

test('an entity that ended: Community Relations Service has its Trump II months to Apr 2026 only', { skip: SKIP }, () => {
  const rows = rowsOf('DJ14');
  const n = A.months(rows, 'DJ14', 'all', 'trump2');
  assert.equal(A.windowRow(rows, 'DJ14', 'all', 'trump2').month_n, meta.entity_last_month.DJ14);
  assert.equal(A.cap(rows, 'DJ14', 'all', A.COMPARE_DEFAULT), n);
  assert.equal(A.months(rows, 'DJ14', '1811', 'biden'), 0, 'no criminal investigators at CRS');
  assert.equal(A.cap(rows, 'DJ14', '1811', A.COMPARE_DEFAULT), A.MAX_MONTHS);
  assert.equal(A.noStaff(A.rowAt(rows, 'DJ14', '1811', 'biden', 1)), true);
});

test('doj_leaving admin grain: periods in time order, no year before; departures sum one dimension', { skip: SKIP }, () => {
  const lmeta = read('doj_leaving.meta.json');
  const rows = D.fromCube(read(lmeta.files.DOJ.path));
  if (!rows.some(r => r.grain === 'admin')) return;
  assert.deepEqual(LV.periodsOf(rows, 'admin'), A.IDS);
  const snap = LV.snapshot(rows, 'admin', 'biden', 'los');
  assert.ok(snap.groups.every(g => g.prior === null));
  const raw = rows.filter(r => r.grain === 'admin' && r.period === 'biden' && r.dimension === 'los');
  assert.equal(LV.departures(rows, 'admin', 'biden'), raw.reduce((a, r) => a + r.departures, 0));
  const core = read('doj_core.json'), coreMeta = read('doj_core.meta.json'), coreRows = D.fromCube(core);
  const y = LV.yearsLost(coreRows, 'DOJ', 'admin', 'biden', coreMeta, { first: '2021-01', last: '2024-12' });
  const months = coreRows.filter(r => r.entity === 'DOJ' && r.grain === 'month' && r.period >= '2021-01' && r.period <= '2024-12');
  assert.equal(months.length, 48);
  assert.equal(y.lost, months.reduce((a, r) => a + r.years_of_service_lost, 0));
});
