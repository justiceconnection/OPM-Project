'use strict';
/* Components compared logic against the promoted cube (web/data/doj_core.json, read only).
   Expected values come from plain loops over the raw arrays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const CC = require('../assets/js/compare.js');
const D = require('../assets/js/data.js');

const DATA = path.join(__dirname, '..', 'data');
const cube = JSON.parse(fs.readFileSync(path.join(DATA, 'doj_core.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'doj_core.meta.json'), 'utf8'));
const rows = D.fromCube(cube);
const ci = n => cube.columns.indexOf(n);
const raw = (e, g, p) => cube.rows.find(r => r[ci('entity')] === e && r[ci('grain')] === g && r[ci('period')] === p);

test('FY2025 DOJ departure rate under method A: 12.83% on the Jul 2026 data, 12.82% on Aug 2026', () => {
  const t = CC.tableRow(rows, CC.rowFor(rows, 'DOJ', 'fy', 'FY2025'), 'a');
  const r = raw('DOJ', 'fy', 'FY2025');
  assert.equal(t.attrition, r[ci('attrition_a_num')] / r[ci('rate_a_den')]);
  // this file reads the promoted cube, so the pin follows the promoted release (L-145: 14,806 / 115,502.3333 on the Aug 2026 data). A new release needs its own entry.
  assert.equal((t.attrition * 100).toFixed(2), { '2026-07': '12.83', '2026-08': '12.82' }[meta.range.last_month], 'promoted data through ' + meta.range.last_month);
});

test('FBI FY2025 row: every column equals the cube; change percent over the FY2024 headcount', () => {
  for (const m of ['a', 'b', 'c']) {
    const t = CC.tableRow(rows, CC.rowFor(rows, 'DJ02', 'fy', 'FY2025'), m);
    const r = raw('DJ02', 'fy', 'FY2025'), prev = raw('DJ02', 'fy', 'FY2024');
    assert.equal(t.employees, r[ci('headcount')]);
    assert.equal(t.change, r[ci('headcount_change')]);
    assert.equal(t.changePct, r[ci('headcount_change')] / prev[ci('headcount')]);
    assert.equal(t.hires, r[ci('hires')]);
    assert.equal(t.departures, r[ci('departures')]);
    for (const k of ['attrition', 'quit', 'retirement']) assert.equal(t[k], r[ci(k + '_' + m + '_num')] / r[ci('rate_' + m + '_den')], m + ' ' + k);
  }
  // the first period has no change and no percent
  const first = CC.tableRow(rows, CC.rowFor(rows, 'DJ02', 'fy', 'FY2012'), 'a');
  assert.equal(first.change, null);
  assert.equal(first.changePct, null);
});

test('components (D-089): all 12 in every period; Community Relations Service labeled ended at its last month with employees, present at 0 after it', () => {
  const fy25 = CC.components(rows, meta, 'fy', 'FY2025');
  assert.equal(fy25.length, 12);
  assert.equal(fy25[0].entity, 'DJ02'); // largest latest employee count first
  const crs = fy25.find(c => c.entity === 'DJ14');
  assert.equal(crs.ended, true, 'last reported with employees in April 2026 (meta entity_last_employment_month)');
  assert.equal(crs.endMonth, meta.entity_last_employment_month.DJ14);
  assert.equal(crs.endMonth, '2026-04');
  assert.equal(meta.entity_last_month.DJ14, meta.range.last_month, 'its rows run to the latest month');
  for (const p of ['2026-04', '2026-05', '2026-07']) assert.equal(CC.components(rows, meta, 'month', p).length, 12, p);
  const jul = CC.components(rows, meta, 'month', '2026-07').find(c => c.entity === 'DJ14');
  const t = CC.tableRow(rows, jul.row, 'a');
  assert.equal(t.employees, 0, 'D-089: 0 employees in July 2026');
  assert.equal(t.hires, 0); assert.equal(t.departures, 0);
  assert.equal(CC.components(rows, meta, 'month', '2026-04').find(c => c.entity === 'DJ14').row.headcount, 9);
  assert.equal(CC.tableRow(rows, CC.rowFor(rows, 'DJ14', 'month', '2026-05'), 'c').attrition, null, 'no one on board: the rate is empty (D-027), never 0 or NaN');
  assert.ok(CC.components(rows, meta, 'fy', 'FY2026').some(c => c.entity === 'DJ14'));
  assert.deepEqual(CC.periods(rows, 'fy').slice(0, 2), ['FY2026', 'FY2025']); // latest first
});

test('sorting: descending first, ascending second, empty values last', () => {
  const list = [{ entity: 'A', cells: { hires: 5 } }, { entity: 'B', cells: { hires: null } }, { entity: 'C', cells: { hires: 9 } }];
  const name = e => ({ A: 'Alpha', B: 'Bravo', C: 'Charlie' })[e];
  assert.deepEqual(CC.sortRows(list, 'hires', 'desc', name).map(x => x.entity), ['C', 'A', 'B']);
  assert.deepEqual(CC.sortRows(list, 'hires', 'asc', name).map(x => x.entity), ['A', 'C', 'B']);
  assert.deepEqual(CC.sortRows(list, 'component', 'desc', name).map(x => x.entity), ['C', 'B', 'A']);
});

test('growth: headcount over the start-year-end headcount, from the start year; CRS runs to Jul 2026 at 0 (D-089), never NaN or Infinity', () => {
  const g = CC.growth(rows, 'DOJ', 'fy', 'FY2012');
  assert.equal(g.values[0], 1);
  assert.equal(g.values.at(-1), raw('DOJ', 'fy', 'FY2026')[ci('headcount')] / raw('DOJ', 'fy', 'FY2012')[ci('headcount')]);
  const g20 = CC.growth(rows, 'DJ02', 'fy', 'FY2020');
  assert.equal(g20.rows[0].period, 'FY2020');
  assert.equal(g20.values[0], 1);
  const m = CC.growth(rows, 'DJ14', 'month', 'FY2015');
  assert.equal(m.rows[0].period, '2014-10');
  assert.equal(m.rows.at(-1).period, meta.range.last_month);
  const iApr = m.rows.findIndex(r => r.period === '2026-04');
  assert.equal(m.values[iApr], raw('DJ14', 'month', '2026-04')[ci('headcount')] / raw('DJ14', 'fy', 'FY2015')[ci('headcount')]);
  assert.deepEqual(m.values.slice(iApr + 1), m.values.slice(iApr + 1).map(() => 0), 'May 2026 on: 0, a real zero');
  assert.equal(m.values[m.rows.findIndex(r => r.period === '2026-01')], 0, 'January 2026 (missing from the OPM file): 0');
  // every start year the page offers: each value a finite number or null (a zero base gives null, never Infinity)
  for (const e of meta.entities) for (const fy of CC.periods(rows, 'fy').filter(p => p !== 'FY2026')) for (const gr of ['fy', 'quarter', 'month']) {
    assert.ok(CC.growth(rows, e, gr, fy).values.every(v => v === null || Number.isFinite(v)), e + ' ' + fy + ' ' + gr);
  }
  const zeroBase = CC.growth(rows.map(r => r.entity === 'DJ14' && r.grain === 'fy' && r.period === 'FY2015' ? Object.assign({}, r, { headcount: 0 }) : r), 'DJ14', 'month', 'FY2015');
  assert.ok(zeroBase.values.every(v => v === null), 'a base of 0 gives no line, not Infinity');
});

test('reason shares: each reason over departures, summing to 1; no departures is flagged, not zero', () => {
  const s = CC.reasonShares(CC.rowFor(rows, 'DOJ', 'fy', 'FY2025'));
  const r = raw('DOJ', 'fy', 'FY2025');
  CC.CHART_REASONS.forEach((c, i) => assert.equal(s.shares[i], r[ci(c)] / r[ci('departures')])); // seven reasons, DRP first (D-080)
  assert.ok(Math.abs(s.shares.reduce((a, v) => a + v, 0) - 1) < 1e-12);
  const zero = cube.rows.find(x => x[ci('entity')] === 'DJ14' && x[ci('grain')] === 'month' && x[ci('departures')] === 0);
  const z = CC.reasonShares(CC.rowFor(rows, 'DJ14', 'month', zero[ci('period')]));
  assert.equal(z.none, true);
  assert.ok(z.shares.every(v => v === null));
});
