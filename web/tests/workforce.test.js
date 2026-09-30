'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const W = require('../assets/js/workforce.js');
const D = require('../assets/js/data.js');
const P = require('../assets/js/periods.js');

const meta = { columns: [{ name: 'headcount', kind: 'stock' }, { name: 'headcount_change', kind: 'stock_change' }, { name: 'net_flow', kind: 'flow' }],
  range: { first_month: '2011-10', last_month: '2013-01' }, entities: ['DOJ', 'DJ02', 'DJ14'] };

/* Invented monthly headcounts; headcount_change carried as the cube does (null on the first month). */
function build(entity, series, grainRowsToo) {
  const months = P.listMonths('2011-10', P.addMonths('2011-10', series.length - 1));
  const out = months.map((p, i) => ({ entity, grain: 'month', period: p, period_first_month: p, period_last_month: p, headcount: series[i], headcount_change: i ? series[i] - series[i - 1] : null, provisional: false, partial: false }));
  if (grainRowsToo) {
    const fyKeys = [...new Set(months.map(mm => P.periodKey(mm, 'fy')))];
    let prev = null;
    fyKeys.forEach(k => {
      const b = P.periodBounds(k); const inP = months.filter(mm => mm >= b.start && mm <= b.end); const last = inP.at(-1);
      const hc = series[months.indexOf(last)];
      out.push({ entity, grain: 'fy', period: k, period_first_month: b.start, period_last_month: last, headcount: hc, headcount_change: prev === null ? null : hc - prev, partial: last !== b.end, provisional: false });
      prev = hc;
    });
  }
  return out;
}
const series = [100, 102, 101, 105, 110, 108, 107, 111, 115, 116, 118, 117, 120, 125, 123, 130]; // Oct 2011 .. Jan 2013
const rows = build('DOJ', series, true).concat(build('DJ02', series.map(v => v / 2), true)).concat(build('DJ14', [9, 9, 8, 8], false));

test('component options: DOJ first, then components by display name; an ended one shows its end month', () => {
  const o = W.componentOptions({ entities: ['DOJ', 'DJ14', 'DJ02', 'DJ15'], names: { DJ14: 'Community Relations Service', DJ02: 'FBI', DJ15: 'ATF' },
    entityLastMonth: { DOJ: '2026-07', DJ14: '2026-04', DJ02: '2026-07', DJ15: '2026-07' }, latest: '2026-07', allLabel: 'All',
    endedLabel: (n, mo) => n + ' until ' + mo });
  assert.deepEqual(o, [{ value: 'DOJ', label: 'All' }, { value: 'DJ15', label: 'ATF' }, { value: 'DJ14', label: 'Community Relations Service until 2026-04' }, { value: 'DJ02', label: 'FBI' }]);
});

test('latestMonthRow is the entity\'s own last month', () => {
  assert.equal(W.latestMonthRow(rows, 'DOJ').period, '2013-01');
  assert.equal(W.latestMonthRow(rows, 'DJ14').period, '2012-01');
  assert.equal(W.latestMonthRow(rows, 'NONE'), null);
});

test('change12 telescopes to latest minus the same month a year earlier, over that month\'s headcount', () => {
  const c = W.change12(rows, 'DOJ', meta);
  assert.equal(c.sum, series[15] - series[3]); // Jan 2013 minus Jan 2012: 130 - 105
  assert.equal(c.base.period, '2012-01');
  assert.equal(c.pct, (series[15] - series[3]) / series[3]);
  assert.equal(c.first.period, '2012-02');
  assert.equal(W.change12(rows, 'DJ14', meta), null); // fewer than 13 months
});

test('changeRange with a period before the range: sum over the range, percent over that period\'s headcount', () => {
  const c = W.changeRange(rows, 'DOJ', 'month', { start: '2012-03', end: '2012-06' }, meta);
  assert.equal(c.sum, series[8] - series[4]); // Jun 2012 minus Feb 2012
  assert.equal(c.base.period, '2012-02');
  assert.equal(c.pct, (series[8] - series[4]) / series[4]);
  assert.equal(c.from, null);
  assert.equal(c.first.period, '2012-03');
  assert.equal(c.last.period, '2012-06');
});

test('changeRange from the first period: measured from its end, percent over the first period\'s headcount', () => {
  const c = W.changeRange(rows, 'DOJ', 'month', { start: '2011-10', end: '2013-01' }, meta);
  assert.equal(c.sum, 130 - 100);
  assert.equal(c.pct, (130 - 100) / 100);
  assert.equal(c.from.period, '2011-10');
  assert.equal(c.base, c.from); // the row the firstNote names is the base
  const fy = W.changeRange(rows, 'DOJ', 'fy', { start: '2011-10', end: '2013-01' }, meta);
  assert.equal(fy.from.period, 'FY2012');
  assert.equal(fy.sum, 130 - series[11]); // FY2013 (partial, Jan 2013) minus FY2012 (Sep 2012)
  assert.equal(fy.pct, (130 - series[11]) / series[11]);
  assert.equal(fy.last.partial, true);
  const one = W.changeRange(rows, 'DOJ', 'fy', { start: '2011-10', end: '2012-09' }, meta);
  assert.equal(one.sum, null); // only the first period: no change to show
  assert.equal(one.pct, null);
  assert.equal(W.changeRange(rows, 'DOJ', 'month', { start: '2030-01', end: '2030-02' }, meta), null);
});

test('changeRange never sums across entities or through a gap', () => {
  const gappy = rows.filter(r => !(r.entity === 'DOJ' && r.period === '2012-04'));
  assert.throws(() => W.changeRange(gappy, 'DOJ', 'month', { start: '2012-03', end: '2012-06' }, meta), /not consecutive/);
});

test('break flags: FY2025 and FY2026; FY2025Q4 and FY2026Q1; Sep and Oct 2025', () => {
  const mk = (grain, k) => { const b = P.periodBounds(k); return { grain, period: k, period_first_month: b.start }; };
  assert.deepEqual(W.breakFlags(['FY2024', 'FY2025', 'FY2026'].map(k => mk('fy', k))), [false, true, true]);
  assert.deepEqual(W.breakFlags(['FY2025Q3', 'FY2025Q4', 'FY2026Q1', 'FY2026Q2'].map(k => mk('quarter', k))), [false, true, true, false]);
  assert.deepEqual(W.breakFlags(['2025-08', '2025-09', '2025-10', '2025-11'].map(k => mk('month', k))), [false, true, true, false]);
  assert.deepEqual(W.KNOWN_BREAK_MONTHS, ['2025-09', '2025-10']);
});

test('ranking: current components largest first; one that ended is listed apart', () => {
  const r = W.ranking(rows, meta);
  assert.deepEqual(r.current.map(x => x.entity), ['DJ02']);
  assert.deepEqual(r.ended.map(x => [x.entity, x.headcount, x.row.period]), [['DJ14', 8, '2012-01']]);
});

/* Against the real cube, read only; skipped when it is absent. */
const CUBE = path.join(__dirname, '..', '..', 'warehouse', 'cubes');
test('real doj_core: tiles telescope to headcount differences, and the ranking is right', { skip: !fs.existsSync(path.join(CUBE, 'doj_core.json')) && 'cube not present' }, () => {
  const rs = D.fromCube(JSON.parse(fs.readFileSync(path.join(CUBE, 'doj_core.json'), 'utf8')));
  const mt = JSON.parse(fs.readFileSync(path.join(CUBE, 'doj_core.meta.json'), 'utf8'));
  for (const e of mt.entities) {
    const months = W.entityRows(rs, e, 'month');
    const c = W.change12(rs, e, mt);
    assert.equal(c.sum, months.at(-1).headcount - months.at(-13).headcount, e + ' change12');
    const fy = W.entityRows(rs, e, 'fy');
    const full = W.changeRange(rs, e, 'fy', { start: mt.range.first_month, end: mt.range.last_month }, mt);
    assert.equal(full.sum, fy.at(-1).headcount - fy[0].headcount, e + ' full range');
    assert.equal(full.pct, (fy.at(-1).headcount - fy[0].headcount) / fy[0].headcount, e + ' full range percent');
  }
  const r = W.ranking(rs, mt);
  assert.equal(r.current.length, 11);
  assert.equal(r.current[0].entity, 'DJ02');
  assert.deepEqual(r.ended.map(x => [x.entity, x.row.period, x.headcount]), [['DJ14', '2026-04', 9]]);
});
