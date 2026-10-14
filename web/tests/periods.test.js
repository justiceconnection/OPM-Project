'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/periods.js');

test('fiscal year and quarter of a month (FY2025 = Oct 2024 to Sep 2025)', () => {
  assert.equal(P.fiscalYear('2024-10'), 2025);
  assert.equal(P.fiscalYear('2025-09'), 2025);
  assert.equal(P.fiscalYear('2025-10'), 2026);
  assert.deepEqual(['2024-10', '2024-12', '2025-01', '2025-03', '2025-04', '2025-06', '2025-07', '2025-09'].map(P.fiscalQuarter),
    [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('period keys at each grain', () => {
  assert.equal(P.periodKey('2011-10', 'month'), '2011-10');
  assert.equal(P.periodKey('2011-10', 'quarter'), 'FY2012Q1');
  assert.equal(P.periodKey('2012-09', 'quarter'), 'FY2012Q4');
  assert.equal(P.periodKey('2011-10', 'fy'), 'FY2012');
  assert.equal(P.periodKey('2026-07', 'fy'), 'FY2026');
  assert.throws(() => P.periodKey('2026-07', 'fiscal_year'));
  assert.throws(() => P.periodKey('2026-07', 'week'));
  assert.throws(() => P.periodKey('2026-13', 'month'));
});

test('period bounds invert period keys for every month from Oct 2011', () => {
  for (const m of P.listMonths('2011-10', '2026-09')) {
    for (const g of P.GRAINS) {
      const k = P.periodKey(m, g);
      const b = P.periodBounds(k);
      assert.ok(b.start <= m && m <= b.end, `${m} in ${k}`);
      assert.equal(P.grainOf(k), g);
      assert.equal(P.monthsBetween(b.start, b.end), g === 'month' ? 1 : g === 'quarter' ? 3 : 12);
    }
  }
  assert.deepEqual(P.periodBounds('FY2012'), { start: '2011-10', end: '2012-09' });
  assert.deepEqual(P.periodBounds('FY2026Q4'), { start: '2026-07', end: '2026-09' });
  assert.deepEqual(P.periodBounds('FY2026Q2'), { start: '2026-01', end: '2026-03' });
});

test('month arithmetic across year ends', () => {
  assert.equal(P.addMonths('2011-12', 1), '2012-01');
  assert.equal(P.addMonths('2012-01', -1), '2011-12');
  assert.equal(P.addMonths('2026-07', -11), '2025-08');
  assert.equal(P.listMonths('2011-10', '2026-07').length, 178); // the DB's 178 months
});

test('snapRange widens to whole periods', () => {
  const r = { start: '2011-11', end: '2026-07' };
  assert.deepEqual(P.snapRange(r, 'month'), r);
  assert.deepEqual(P.snapRange(r, 'quarter'), { start: '2011-10', end: '2026-09' });
  assert.deepEqual(P.snapRange(r, 'fy'), { start: '2011-10', end: '2026-09' });
});

test('normalizeRange: default, clamp, swap', () => {
  const b = { start: '2011-10', end: '2026-07' };
  assert.deepEqual(P.normalizeRange(null, b), b);
  assert.deepEqual(P.normalizeRange({ start: 'junk', end: undefined }, b), b);
  assert.deepEqual(P.normalizeRange({ start: '2000-01', end: '2030-01' }, b), b);
  assert.deepEqual(P.normalizeRange({ start: '2020-05', end: '2019-02' }, b), { start: '2019-02', end: '2020-05' });
  assert.deepEqual(P.normalizeRange({ start: '2030-01', end: '2031-01' }, b), { start: '2026-07', end: '2026-07' });
});

test('overlaps', () => {
  assert.ok(P.overlaps({ start: '2025-10', end: '2026-09' }, { start: '2026-07', end: '2026-07' }));
  assert.ok(!P.overlaps({ start: '2011-10', end: '2012-09' }, { start: '2012-10', end: '2013-01' }));
});

test('period labels come from the supplied formats', () => {
  const fmt = { months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], month: '{mon} {year}', fiscalQuarter: 'FY{fy} Q{q}', fiscalYear: 'FY{fy}' };
  assert.equal(P.periodLabel('2011-10', fmt), 'Oct 2011');
  assert.equal(P.periodLabel('FY2012Q1', fmt), 'FY2012 Q1');
  assert.equal(P.periodLabel('FY2026', fmt), 'FY2026');
});
