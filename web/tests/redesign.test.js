'use strict';
/* The redesign's logic (docs/pages/redesign.md; D-071, D-072): months shown at each View, the administrations shown and
   their order, administration shading to the month, the Components rows, and the "first N months" breakdowns (grain
   admin_n) against the staged cubes (warehouse/cubes, else web/data; the data tests skip when neither has them).
   Expected values come from plain loops over the raw arrays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../assets/js/redesign.js');
const S = require('../assets/js/shading.js');
const A = require('../assets/js/admin.js');
const D = require('../assets/js/data.js');
const P = require('../assets/js/periods.js');
const X = require('../assets/js/svg-export.js');
const I = require('./_inputs.js');

const CUBES = I.cubesDir();
const has = f => CUBES && fs.existsSync(path.join(CUBES, f));
const read = f => JSON.parse(fs.readFileSync(path.join(CUBES, f), 'utf8'));
const SKIP_ADMIN = !has('doj_admin.meta.json') && 'no doj_admin';
const rowsOf = (() => { const c = {}; return (cube, e) => c[cube + e] || (c[cube + e] = D.fromCube(read(read(cube + '.meta.json').files[e].path))); })();
const ADMIN_N = has('doj_leaving.meta.json') && rowsOf('doj_leaving', 'DOJ').some(r => r.grain === 'admin_n');
const SKIP_N = !ADMIN_N && 'no admin_n grain in doj_leaving yet';

test('View on a months-in-office chart: every month, every 3rd or every 12th, always with month N', () => {
  assert.deepEqual(R.monthsShown(6, 'month', 4), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(R.monthsShown(48, 'quarter', 19).slice(0, 8), [3, 6, 9, 12, 15, 18, 19, 21]);
  assert.equal(R.monthsShown(48, 'quarter', 19).length, 17);
  assert.deepEqual(R.monthsShown(48, 'fy', 19), [12, 19, 24, 36, 48]);
  assert.deepEqual(R.monthsShown(48, 'fy', 24), [12, 24, 36, 48], 'no duplicate when N is on the step');
  assert.deepEqual(R.monthsShown(16, 'fy', 16), [12, 16]);
});

test('the administrations shown, always in the D-077 order Trump II, Biden, Trump I, Obama II', () => {
  assert.deepEqual(R.COMPARE, ['obama2', 'trump1', 'biden']);
  assert.deepEqual(R.ORDER, ['trump2', 'biden', 'trump1', 'obama2']);
  assert.deepEqual(R.shown(['biden', 'obama2', 'trump1']), ['trump2', 'biden', 'trump1', 'obama2']);
  assert.deepEqual(R.shown(['obama2']), ['trump2', 'obama2']);
  assert.deepEqual(R.shown([]), ['trump2']);
  assert.deepEqual(R.atOrder(['obama2', 'biden', 'trump1']), ['biden', 'trump1', 'obama2']);
  assert.deepEqual(R.atOrder(['obama2']), ['obama2']);
});

test('shading: one band per administration to the month, nothing before Jan 2013, Trump II open to the latest month', () => {
  const months = P.listMonths('2011-10', '2026-07').map(m => ({ first: m, last: m }));
  const b = S.bands(months, '2026-07');
  const at = m => months.findIndex(p => p.first === m) - 0.5;
  assert.deepEqual(b.map(x => x.id), ['obama2', 'trump1', 'biden', 'trump2']);
  assert.deepEqual(b.map(x => x.x0), [at('2013-01'), at('2017-01'), at('2021-01'), at('2025-01')]);
  assert.equal(b[0].x1, b[1].x0); assert.equal(b[3].x1, months.length - 0.5);
  assert.deepEqual(b.map(x => x.strong), [false, false, false, true]);
  // fiscal years: a January boundary is a quarter into its fiscal year; the partial last year ends at its last month
  const fy = [];
  for (let y = 2012; y <= 2025; y++) fy.push({ first: (y - 1) + '-10', last: y + '-09' });
  fy.push({ first: '2025-10', last: '2026-07' });
  const bf = S.bands(fy, '2026-07');
  assert.equal(bf[0].x0, 1 - 0.5 + 3 / 12, 'Jan 2013 is month 4 of FY2013');
  assert.equal(bf[3].x0, 13 - 0.5 + 3 / 12, 'Jan 2025 is month 4 of FY2025');
  assert.equal(bf[3].x1, fy.length - 0.5);
  // quarters: Jan starts Q2, so boundaries fall on quarter edges
  const q = []; for (let m = '2011-10'; m <= '2026-07'; m = P.addMonths(m, 3)) q.push({ first: m, last: P.addMonths(m, 2) < '2026-07' ? P.addMonths(m, 2) : '2026-07' });
  const bq = S.bands(q, '2026-07');
  assert.equal(bq[0].x0, q.findIndex(p => p.first === '2013-01') - 0.5);
  // an axis that starts after Jan 2013 clips the first band; one that ends before 2013 has none
  assert.equal(S.bands(P.listMonths('2014-01', '2014-12').map(m => ({ first: m, last: m })), '2026-07')[0].x0, -0.5);
  assert.deepEqual(S.bands(P.listMonths('2011-10', '2012-12').map(m => ({ first: m, last: m })), '2026-07'), []);
  assert.deepEqual(S.svgFill('rgba(33, 33, 35, 0.09)'), { color: '#212123', opacity: 0.09 });
  assert.deepEqual(S.FILL, { obama2: '--shade-1', trump1: '--shade-2', biden: '--shade-1', trump2: '--shade-strong' });
});

test('SVG export draws bands behind the series, each named, and marker points as squares', () => {
  const svg = X.buildSvg({ width: 300, height: 200, area: { left: 40, top: 10, right: 290, bottom: 180 }, title: 't', colors: { plot: '#eee' },
    series: [{ label: 'a', color: '#000', kind: 'line', points: [{ x: 50, y: 50 }, { x: 60, y: 60 }] }, { label: 'b', color: '#f00', kind: 'line', pointsOnly: true, points: [{ x: 70, y: 70 }] }],
    bands: [{ x0: 50, x1: 120, label: 'Obama II', color: '#212123', opacity: 0.05 }] });
  assert.match(svg, /<g class="opm-svg-band"><rect x="50" y="10" width="70" height="170" fill="#212123" fill-opacity="0.05"\/><text[^>]*>Obama II<\/text><\/g>/);
  assert.ok(svg.indexOf('opm-svg-band') < svg.indexOf('opm-svg-series'), 'bands sit behind the data');
  assert.equal((svg.match(/class="opm-svg-point"/g) || []).length, 1);
});

test('DOJ at month N: tiles and "at this point" are single doj_admin rows (pick and divide)', { skip: SKIP_ADMIN }, () => {
  const rows = rowsOf('doj_admin', 'DOJ');
  const cur = R.current(rows, 'DOJ', 'all');
  assert.equal(cur.n, A.months(rows, 'DOJ', 'all', 'trump2'));
  assert.equal(cur.row.months_in_office, cur.n);
  const at = R.atPoint(rows, 'DOJ', 'all', ['biden'], cur.n)[0];
  assert.equal(at.row.administration, 'biden'); assert.equal(at.row.months_in_office, cur.n);
  if (read('doj_admin.meta.json').range.last_month === '2026-07') {
    const c = A.cells(cur.row);
    assert.deepEqual([c.employees, c.change, c.departures, c.hires, (c.attrition * 100).toFixed(1), (c.changePct * 100).toFixed(1)], [107331, -10048, 20461, 11343, '11.7', '-8.6']);
    assert.deepEqual([A.cells(at.row).change, (A.cells(at.row).changePct * 100).toFixed(1)], [-552, '-0.5']);
  }
  const line = R.lineAt(rows, 'DOJ', 'all', 'trump2', R.monthsShown(48, 'fy', cur.n), 'departures');
  assert.deepEqual(line.values.slice(0, 2), [A.rowAt(rows, 'DOJ', 'all', 'trump2', 12).departures, cur.row.departures]);
  assert.ok(line.values.slice(2).every(v => v === null), 'Trump II has no months past N');
});

test('Components rows: Trump II at the component\'s own N (CRS stops at Apr 2026), the others at that same N', { skip: SKIP_ADMIN }, () => {
  const crs = rowsOf('doj_admin', 'DJ14');
  const r = R.componentRow(crs, 'DJ14', 'all', ['biden', 'trump1']);
  assert.equal(r.n, A.months(crs, 'DJ14', 'all', 'trump2'));
  assert.equal(r.row.month_n, read('doj_admin.meta.json').entity_last_month.DJ14);
  const b = A.rowAt(crs, 'DJ14', 'all', 'biden', r.n);
  assert.equal(r.at.biden, b.headcount_change / b.headcount_0);
  assert.equal(R.componentRow(crs, 'DJ14', '1811', ['biden']).none, true, 'no criminal investigators at CRS');
});

test('Who is leaving, first N months: grain admin_n, N = Trump II\'s months for every administration; groups, Unknown and coverage', { skip: SKIP_N }, () => {
  const rows = rowsOf('doj_leaving', 'DOJ'), n = rows.filter(r => r.grain === 'admin_n')[0].rate_months;
  const ids = ['trump2', 'biden', 'trump1', 'obama2'];
  const p = R.leavingPanel(rows, 'los', ids);
  assert.deepEqual(p.values, ['lt1', '1_4', '5_9', '10_19', '20_24', '25_29', '30plus']);
  for (const id of ids) {
    const raw = rows.filter(r => r.grain === 'admin_n' && r.period === id && r.dimension === 'los' && !r.is_unknown).sort((a, b) => a.value_order - b.value_order);
    assert.deepEqual(p.groups.map(g => g.cells[id].rate), raw.map(r => r.rate_num === null ? null : r.rate_num / r.rate_den), id);
    assert.ok(raw.every(r => r.months_in_period === n || r.months_in_period < n), 'the same N for every administration (fewer only where a component ends)');
  }
  const unk = rows.find(r => r.grain === 'admin_n' && r.period === 'trump2' && r.dimension === 'los' && r.is_unknown);
  assert.equal(p.unknown.trump2, unk.departures);
  assert.equal(p.coverage.trump2, unk.coverage);
  assert.equal(p.provisional, true);
  assert.equal(R.leavingPanel(rows.filter(r => r.grain !== 'admin_n'), 'los', ids).has, false, 'without the grain the panel has nothing (the page says Data not available.)');
});

test('mini charts (D-075): percent change since month 0 is headcount_change / headcount_0 of one row; FBI at N; CRS ends at its own N', { skip: SKIP_ADMIN }, () => {
  const fbi = rowsOf('doj_admin', 'DJ02'), n = A.months(rowsOf('doj_admin', 'DOJ'), 'DOJ', 'all', 'trump2');
  const t2 = R.pctLine(fbi, 'DJ02', 'all', 'trump2', [1, n, n + 1]), bi = R.pctLine(fbi, 'DJ02', 'all', 'biden', [n]);
  const r = A.rowAt(fbi, 'DJ02', 'all', 'trump2', n), b = A.rowAt(fbi, 'DJ02', 'all', 'biden', n);
  assert.equal(t2.values[1], r.headcount_change / r.headcount_0);
  assert.equal(bi.values[0], b.headcount_change / b.headcount_0);
  assert.equal(t2.values[2], null, 'no Trump II month past N');
  assert.deepEqual(t2.provisional, [false, true, false]);
  if (read('doj_admin.meta.json').range.last_month === '2026-07') {
    assert.equal(n, 19);
    assert.equal((t2.values[1] * 100).toFixed(1), '-5.1');
    assert.equal((bi.values[0] * 100).toFixed(1), '4.2');
  }
  const crs = rowsOf('doj_admin', 'DJ14'), nc = A.months(crs, 'DJ14', 'all', 'trump2');
  const months = R.monthsShown(48, 'month', nc), line = R.pctLine(crs, 'DJ14', 'all', 'trump2', months);
  assert.equal(months[line.values.map((v, i) => v === null ? -1 : i).filter(i => i >= 0).at(-1)], nc);
  if (read('doj_admin.meta.json').range.last_month === '2026-07') assert.equal(nc, 16);
  assert.ok(R.pctLine(crs, 'DJ14', '1811', 'trump2', [1]).values.every(v => v === null), 'no criminal investigators at CRS');
});

test('band names (L-103): left-aligned inside their band when they fit, else left out; the last band always named, right-aligned', () => {
  const bands = [{ x0: 0, x1: 300, w: 50 }, { x0: 300, x1: 330, w: 45 }, { x0: 330, x1: 600, w: 40 }, { x0: 600, x1: 620, w: 260, strong: true }];
  const p = S.labelPlacement(bands, 0, 620);
  assert.deepEqual(p[0], { x: 4, anchor: 'start', from: 4, to: 54 });
  assert.equal(p[1], null, 'too narrow: left out');
  assert.equal(p[3].anchor, 'end'); assert.equal(p[3].x, 618);
  assert.equal(p[2], null, 'Biden would overlap the always-named Trump II, so it gives way');
  assert.deepEqual(S.labelPlacement([{ x0: 0, x1: 400, w: 50 }, { x0: 400, x1: 700, w: 50, strong: true }], 0, 700).map(x => x.anchor), ['start', 'end']);
});

test('negative zero (L-103): a change that rounds to zero reads 0.0%', () => {
  global.self = global.self || {}; // page-kit expects a browser global; only its formats are used here
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'page-kit.js'), 'utf8');
  const sandbox = { OPM: {} };
  new Function('self', src)(sandbox);
  const f = sandbox.OPM.pageKit.fmt;
  assert.equal(f.pctChange(-0.0001), '0.0%'); assert.equal(f.pctChange(0.0004), '0.0%'); assert.equal(f.pctChange(-0.0005), '-0.1%'); assert.equal(f.pctChange(0.042), '+4.2%');
});

test('off-scale layout (L-107): the bar keeps its line; markers on the same side stack clear of it and of each other', () => {
  const out = R.offScaleLayout([{ kind: 'bar', index: 1, dir: -1 }, { kind: 'marker', index: 1, dir: -1 }, { kind: 'marker', index: 1, dir: 1 }, { kind: 'marker', index: 1, dir: 1 }, { kind: 'marker', index: 2, dir: 1 }]);
  assert.deepEqual(out.map(x => x.dy), [0, -13, -6, 6, -8]);
  const three = R.offScaleLayout([{ kind: 'bar', index: 0, dir: 1 }, { kind: 'marker', index: 0, dir: 1 }, { kind: 'marker', index: 0, dir: 1 }, { kind: 'marker', index: 0, dir: 1 }]);
  const ys = three.map(x => x.dy).sort((a, b) => a - b);
  ys.forEach((y, i) => { if (i) assert.ok(y - ys[i - 1] >= 11, 'at least one text line apart: ' + ys.join()); });
});
