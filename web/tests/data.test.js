'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../assets/js/data.js');

const row = (grain, period, first, last, extra) => Object.assign({ entity: 'DOJ', grain, period, period_first_month: first, period_last_month: last }, extra);
const rows = [
  row('fy', 'FY2013', '2012-10', '2013-09', { attrition_a_num: 100, rate_a_den: 1000 }),
  row('fy', 'FY2012', '2011-10', '2012-09', { attrition_a_num: null, rate_a_den: null }),
  row('month', '2012-01', '2012-01', '2012-01', { attrition_a_num: 5, rate_a_den: 0 }),
  row('quarter', 'FY2012Q2', '2012-01', '2012-03', { attrition_a_num: 9, rate_a_den: 300, rate_a_small_base: true }),
  row('fy', 'FY2013', '2012-10', '2013-09', { entity: 'DJ02', attrition_a_num: 1, rate_a_den: 10 })
];

test('fromCube turns the columnar file into row objects without touching values', () => {
  const out = D.fromCube({ columns: ['entity', 'grain', 'x'], rows: [['DOJ', 'month', null], ['DJ01', 'fy', 3]] });
  assert.deepEqual(out, [{ entity: 'DOJ', grain: 'month', x: null }, { entity: 'DJ01', grain: 'fy', x: 3 }]);
});

test('selectRows picks one entity and grain, overlapping the range, in time order', () => {
  const fy = D.selectRows(rows, { entity: 'DOJ', grain: 'fy', range: { start: '2011-11', end: '2013-01' } });
  assert.deepEqual(fy.map(r => r.period), ['FY2012', 'FY2013']);
  assert.deepEqual(D.selectRows(rows, { entity: 'DOJ', grain: 'fy', range: { start: '2012-10', end: '2012-12' } }).map(r => r.period), ['FY2013']);
  assert.deepEqual(D.selectRows(rows, { entity: 'DJ02', grain: 'fy' }).map(r => r.entity), ['DJ02']);
  assert.deepEqual(D.selectRows(rows, { grain: 'month' }).map(r => r.period), ['2012-01']);
});

test('a partial period spans only to its last published month', () => {
  const p = [row('fy', 'FY2026', '2025-10', '2026-07', { partial: true })];
  assert.equal(D.selectRows(p, { grain: 'fy', range: { start: '2026-07', end: '2026-07' } }).length, 1);
  assert.equal(D.selectRows(p, { grain: 'fy', range: { start: '2026-08', end: '2026-09' } }).length, 0);
});

test('ratio divides numerator by denominator; null and zero denominators give null', () => {
  assert.equal(D.ratio(rows[0], 'attrition_a_num', 'rate_a_den'), 0.1);
  assert.equal(D.ratio(rows[1], 'attrition_a_num', 'rate_a_den'), null);
  assert.equal(D.ratio(rows[2], 'attrition_a_num', 'rate_a_den'), null);
  assert.equal(D.ratio({}, 'x', 'y'), null);
});

test('rate columns follow the cube: <measure>_<m>_num over rate_<m>_den', () => {
  assert.deepEqual(D.rateColumns('quit', 'b'), { num: 'quit_b_num', den: 'rate_b_den', smallBase: 'rate_b_small_base' });
});

test('rateSeries passes the cube flags through without computing them', () => {
  const s = D.rateSeries([Object.assign({}, rows[3], { partial: true })], 'attrition', 'a');
  assert.deepEqual(s, [{ period: 'FY2012Q2', value: 0.03, smallBase: true, partial: true, provisional: false }]);
});

test('sumColumns sums within a row and never reads null as zero', () => {
  assert.equal(D.sumColumns({ x: 2, y: 3 }, ['x', 'y']), 5);
  assert.equal(D.sumColumns({ x: 2, y: null }, ['x', 'y']), null);
});

test('sumRows and ratioOfSums work within one period and refuse to cross periods', () => {
  const p = [row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ02', n: 3, d: 100 }), row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ03', n: 1, d: 300 })];
  assert.equal(D.sumRows(p, 'n'), 4);
  assert.equal(D.ratioOfSums(p, 'n', 'd'), 0.01); // (3+1)/(100+300), not the mean of 0.03 and 0.0033
  assert.throws(() => D.sumRows([p[0], row('month', '2020-02', '2020-02', '2020-02', { n: 1 })], 'n'), /more than one period/);
  assert.equal(D.sumRows([], 'n'), null);
});

test('sumRows refuses to add the DOJ total to component rows, which would double count', () => {
  const doj = row('month', '2020-01', '2020-01', '2020-01', { headcount: 100 });
  const fbi = row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ02', headcount: 40 });
  const bop = row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ03', headcount: 35 });
  assert.throws(() => D.sumRows([doj, fbi], 'headcount'), /DOJ total cannot be summed with component rows/);
  assert.throws(() => D.sumRows([fbi, bop, doj], 'headcount'), /double count/);
  assert.throws(() => D.ratioOfSums([fbi, doj], 'headcount', 'headcount'), /double count/);
  assert.equal(D.sumRows([fbi, bop], 'headcount'), 75);   // components alone are fine
  assert.equal(D.sumRows([doj], 'headcount'), 100);       // the total alone is fine
});

test('sumRows refuses a row with no entity', () => {
  const a = row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ02', n: 1 });
  const noEntity = { grain: 'month', period: '2020-01', period_first_month: '2020-01', period_last_month: '2020-01', n: 2 };
  assert.throws(() => D.sumRows([a, noEntity], 'n'), /row 1 has no entity/);
  assert.throws(() => D.sumRows([noEntity], 'n'), /row 0 has no entity/);
  assert.throws(() => D.sumRows([Object.assign({}, a, { entity: '' })], 'n'), /no entity/);
});

test('sumRows refuses duplicate (entity, grain, period) rows', () => {
  const a = row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ02', n: 1 });
  assert.throws(() => D.sumRows([a, Object.assign({}, a)], 'n'), /duplicate row for DJ02 month 2020-01/);
  const doj = row('month', '2020-01', '2020-01', '2020-01', { n: 5 });
  assert.throws(() => D.sumRows([doj, Object.assign({}, doj)], 'n'), /duplicate row for DOJ/);
});

test('sumRows checks mixing and duplicates before a null can short-circuit', () => {
  const fbiNull = row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ02', n: null });
  const doj = row('month', '2020-01', '2020-01', '2020-01', { n: 5 });
  assert.throws(() => D.sumRows([fbiNull, doj], 'n'), /double count/);
  assert.throws(() => D.sumRows([fbiNull, Object.assign({}, fbiNull)], 'n'), /duplicate/);
  assert.throws(() => D.sumRows([fbiNull, { grain: 'month', period: '2020-01', n: 1 }], 'n'), /no entity/);
  assert.throws(() => D.sumRows([fbiNull, row('month', '2020-02', '2020-02', '2020-02', { entity: 'DJ03', n: 1 })], 'n'), /more than one period/);
  // a clean set with a null still gives null, never a partial sum
  assert.equal(D.sumRows([fbiNull, row('month', '2020-01', '2020-01', '2020-01', { entity: 'DJ03', n: 4 })], 'n'), null);
});

test('validateRows catches rows whose period fields disagree with the key', () => {
  assert.deepEqual(D.validateRows(rows), []);
  assert.equal(D.validateRows([row('fy', 'FY2012', '2011-09', '2012-09')]).length, 1);
  assert.equal(D.validateRows([row('month', 'FY2012', '2011-10', '2012-09')]).length, 1);
  assert.equal(D.validateRows([row('fy', 'FY2026', '2025-10', '2026-07')]).length, 1);                  // ends early, not partial
  assert.equal(D.validateRows([row('fy', 'FY2026', '2025-10', '2026-07', { partial: true })]).length, 0);
});

test('the fixture is labeled, validates, and has every grain', () => {
  const f = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-fixture', 'FIXTURE_rates_demo.json'), 'utf8'));
  assert.equal(f.FIXTURE, true);
  assert.match(f.notice, /INVENTED/);
  const r = D.fromCube(f);
  assert.deepEqual(D.validateRows(r), []);
  assert.deepEqual(D.monthBounds(r), { start: '2011-10', end: '2026-07' });
  const g = {}; r.forEach(x => { g[x.grain] = (g[x.grain] || 0) + 1; });
  assert.deepEqual(g, { month: 178, quarter: 60, fy: 15 });
  // D-019 B has no value below fy grain; A has none before Sep 2012
  assert.ok(r.filter(x => x.grain !== 'fy').every(x => x.attrition_b_num === null && x.rate_b_den === null));
  assert.equal(r.find(x => x.period === '2012-08').attrition_a_num, null);
  assert.notEqual(r.find(x => x.period === '2012-09').attrition_a_num, null);
});

/* Contract check against the data-engineer's cube, read only. Skipped when it is absent
   (it is not promoted into web/ and is not in git). */
const CUBE = path.join(__dirname, '..', '..', 'warehouse', 'cubes', 'doj_core.json');
test('the data layer reads the doj_core cube as it stands', { skip: !fs.existsSync(CUBE) && 'warehouse/cubes/doj_core.json not present' }, () => {
  const cube = JSON.parse(fs.readFileSync(CUBE, 'utf8'));
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-fixture', 'FIXTURE_rates_demo.json'), 'utf8'));
  const missing = fixture.columns.filter(c => !cube.columns.includes(c));
  assert.deepEqual(missing, [], 'fixture columns the cube lacks');
  const r = D.fromCube(cube);
  assert.deepEqual(D.validateRows(r), []);
  for (const grain of ['month', 'quarter', 'fy']) {
    const picked = D.selectRows(r, { entity: 'DOJ', grain });
    assert.ok(picked.length > 0, grain);
    for (const m of ['a', 'b', 'c']) D.rateSeries(picked, 'attrition', m); // must not throw
  }
});
