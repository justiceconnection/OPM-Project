'use strict';
/* Hiring and departures logic against the real cube (read only): the staged warehouse/cubes when present,
   else the promoted web/data copy; every test skips when neither is there.
   Expected values are computed here with plain loops over the raw arrays, not with the page code. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const HD = require('../assets/js/hiring.js');
const D = require('../assets/js/data.js');

const CUBE = require('./_inputs.js').cubesDir();
const SKIP = !CUBE && 'no doj_core (warehouse/cubes or web/data)';
const cube = CUBE ? JSON.parse(fs.readFileSync(path.join(CUBE, 'doj_core.json'), 'utf8')) : { columns: [], rows: [] };
const meta = CUBE ? JSON.parse(fs.readFileSync(path.join(CUBE, 'doj_core.meta.json'), 'utf8')) : {};
const rows = D.fromCube(cube);

// independent helpers over the raw arrays
const ci = n => cube.columns.indexOf(n);
const raw = (e, g) => cube.rows.filter(r => r[ci('entity')] === e && r[ci('grain')] === g).sort((a, b) => (a[ci('period')] < b[ci('period')] ? -1 : 1));
const get = (r, n) => r[ci(n)];
function expected(e) {
  const m = raw(e, 'month');
  const sum = (list, n) => list.reduce((a, r) => a + get(r, n), 0);
  const last12 = m.slice(-12), prior12 = m.slice(-24, -12), latest = m.at(-1), yearAgo = m.at(-13);
  return {
    hires: sum(last12, 'hires'), hiresPrior: sum(prior12, 'hires'), departures: sum(last12, 'departures'), departuresPrior: sum(prior12, 'departures'),
    rate: get(latest, 'attrition_a_num') / get(latest, 'rate_a_den'), ratePrior: get(yearAgo, 'attrition_a_num') / get(yearAgo, 'rate_a_den'),
    smallBase: get(latest, 'rate_a_small_base') === true, latest: get(latest, 'period'), yearAgo: get(yearAgo, 'period')
  };
}

test('tiles: latest 12 months and the 12 before, for DOJ, OIG and Community Relations Service', { skip: SKIP }, () => {
  for (const e of ['DOJ', 'DJ10', 'DJ14']) {
    const t = HD.tiles(rows, e, meta), x = expected(e);
    assert.equal(t.hires, x.hires, e + ' hires');
    assert.equal(t.hiresPrior, x.hiresPrior, e + ' hires prior');
    assert.equal(t.departures, x.departures, e + ' departures');
    assert.equal(t.departuresPrior, x.departuresPrior, e + ' departures prior');
    assert.equal(t.rate, x.rate, e + ' rate');
    assert.equal(t.ratePrior, x.ratePrior, e + ' rate prior');
    assert.equal(t.smallBase, x.smallBase, e + ' small base');
    assert.equal(t.latest.period, x.latest);
    assert.equal(t.yearAgo.period, x.yearAgo);
  }
  const doj = HD.tiles(rows, 'DOJ', meta);
  assert.equal(doj.latest.period, '2026-07');
  assert.equal(doj.provisional, true); // the latest months are always provisional
  assert.equal(HD.tiles(rows, 'DJ14', meta).latest.period, '2026-04'); // its own last month
});

test('the six reasons sum to departures and the two hire types to hires, in every row', { skip: SKIP }, () => {
  for (const r of cube.rows) {
    assert.equal(HD.REASONS.reduce((a, c) => a + get(r, c), 0), get(r, 'departures'), get(r, 'entity') + ' ' + get(r, 'period'));
    assert.equal(HD.HIRE_TYPES.reduce((a, c) => a + get(r, c), 0), get(r, 'hires'), get(r, 'entity') + ' ' + get(r, 'period'));
  }
  assert.deepEqual(HD.REASONS, ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other']);
});

test('one rate per method at Yearly/DOJ equals the cube numerator over its denominator', { skip: SKIP }, () => {
  const fy = D.selectRows(rows, { entity: 'DOJ', grain: 'fy' });
  const i = fy.findIndex(r => r.period === 'FY2025');
  const r25 = raw('DOJ', 'fy').find(r => get(r, 'period') === 'FY2025');
  for (const m of ['a', 'b', 'c']) {
    const R = HD.rates(fy, m);
    assert.equal(R.attrition.values[i], get(r25, 'attrition_' + m + '_num') / get(r25, 'rate_' + m + '_den'), 'attrition ' + m);
    assert.equal(R.quit.values[i], get(r25, 'quit_' + m + '_num') / get(r25, 'rate_' + m + '_den'), 'quit ' + m);
    assert.equal(R.retirement.values[i], get(r25, 'retirement_' + m + '_num') / get(r25, 'rate_' + m + '_den'), 'retirement ' + m);
  }
});

test('method B: nothing below Yearly; a partial year is year to date (D-023)', { skip: SKIP }, () => {
  const months = D.selectRows(rows, { entity: 'DOJ', grain: 'month' });
  assert.ok(HD.rates(months, 'b').attrition.values.every(v => v === null));
  assert.ok(HD.rates(D.selectRows(rows, { entity: 'DOJ', grain: 'quarter' }), 'b').quit.values.every(v => v === null));
  const fy = D.selectRows(rows, { entity: 'DOJ', grain: 'fy' });
  const ytd = HD.ytdRows(fy, 'b');
  assert.deepEqual(ytd.map(r => r.period), ['FY2026']);
  const r26 = raw('DOJ', 'fy').find(r => get(r, 'period') === 'FY2026');
  assert.equal(HD.rates(fy, 'b').attrition.values.at(-1), get(r26, 'attrition_b_num') / get(r26, 'rate_b_den'));
  assert.equal(get(r26, 'rate_b_months'), 10);
  assert.deepEqual(HD.ytdRows(fy, 'a'), []);
});

test('small base: flagged where the cube flags it (Community Relations Service), never at OIG or DOJ', { skip: SKIP }, () => {
  for (const g of ['month', 'quarter', 'fy']) for (const m of ['a', 'b', 'c']) {
    const picked = D.selectRows(rows, { entity: 'DJ14', grain: g });
    const flags = HD.rates(picked, m).attrition.smallBase;
    const expectedFlags = raw('DJ14', g).map(r => get(r, 'rate_' + m + '_small_base') === true && get(r, 'attrition_' + m + '_num') !== null && get(r, 'rate_' + m + '_den') !== null);
    assert.deepEqual(flags, expectedFlags, 'DJ14 ' + g + ' ' + m);
    for (const e of ['DOJ', 'DJ10']) assert.ok(HD.rates(D.selectRows(rows, { entity: e, grain: g }), m).attrition.smallBase.every(f => !f), e + ' ' + g + ' ' + m);
  }
  assert.ok(HD.rates(D.selectRows(rows, { entity: 'DJ14', grain: 'fy' }), 'a').attrition.smallBase.some(Boolean));
});

test('empty rates (D-027) are gaps, never zero', { skip: SKIP }, () => {
  const m = D.selectRows(rows, { entity: 'DJ14', grain: 'month' });
  const i = m.findIndex(r => r.period === '2026-01');
  assert.equal(m[i].headcount, 0);
  assert.equal(HD.rates(m, 'c').attrition.values[i], null);
  assert.equal(HD.rates(m, 'c').attrition.smallBase[i], false);
});
