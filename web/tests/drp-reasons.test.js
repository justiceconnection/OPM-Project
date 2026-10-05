'use strict';
/* D-080: DRP is the seventh reason in every "Why people left" chart, and the six D-015 categories are shown without DRP
   (cube columns sep_<category>_nondrp), so the seven partition departures. Checked against the cubes (staged
   warehouse/cubes, else web/data); expected values come from plain loops over the raw arrays, not the page code. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('../assets/js/admin.js');
const CC = require('../assets/js/compare.js');
const HD = require('../assets/js/hiring.js');
const D = require('../assets/js/data.js');
const I = require('./_inputs.js');

const CUBES = I.cubesDir();
const has = f => CUBES && fs.existsSync(path.join(CUBES, f));
const read = f => JSON.parse(fs.readFileSync(path.join(CUBES, f), 'utf8'));
const SKIP = !(has('doj_admin.meta.json') && has('doj_core_series.meta.json')) && 'no cubes';
const copy = JSON.parse(fs.readFileSync(path.join(I.WEB, 'copy.json'), 'utf8'));

const SEVEN = ['sep_drp', 'sep_transfer_out_nondrp', 'sep_quit_nondrp', 'sep_retirement_nondrp', 'sep_rif_nondrp', 'sep_termination_nondrp', 'sep_other_nondrp'];
const SIX = ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];

test('one list of seven chart reasons, DRP first, in admin.js, compare.js and hiring.js; the six categories are unchanged', () => {
  assert.deepEqual(A.CHART_REASONS, SEVEN);
  assert.deepEqual(CC.CHART_REASONS, SEVEN);
  assert.deepEqual(HD.CHART_REASONS, SEVEN);
  for (const m of [A, CC, HD]) assert.deepEqual(m.REASONS, SIX, 'tiles and rates keep the six (D-080)');
  // each chart reason is labeled with a signed series label: DRP, then the six existing labels
  assert.deepEqual(SEVEN.map(A.reasonLabelCol), ['sep_drp'].concat(SIX));
  for (const c of SEVEN.map(A.reasonLabelCol)) assert.equal(copy.series._status[c], 'signed', c);
  assert.equal(copy.series.sep_drp, 'DRP');
});

test('every page that draws a reasons chart uses the seven reasons, the D-080 note and one DRP color', () => {
  const src = f => fs.readFileSync(path.join(I.WEB, 'assets/js', f), 'utf8');
  for (const f of ['pages/departures.js', 'admin-panel.js', 'pages/components-compared.js', 'pages/hiring-and-departures.js']) {
    const s = src(f);
    assert.match(s, /CHART_REASONS\.map/, f + ' draws the seven');
    assert.ok(!/\.REASONS\.map/.test(s), f + ' no longer draws the six');
    assert.match(s, /shell:reasons\.drpNote/, f + ' shows the D-080 note');
    const colors = /var REASON_COLORS = \[([^\]]+)\]/.exec(s)[1].split(',').map(x => x.trim().replace(/'/g, ''));
    assert.equal(colors.length, 7, f);
    assert.equal(colors[0], '--chart-16', f + ': DRP is olive everywhere');
    assert.equal(new Set(colors).size, 7, f + ': seven distinct colors');
  }
  // the DRP color is apart from every administration color (tokens.css)
  const tokens = fs.readFileSync(path.join(I.WEB, 'assets/tokens.css'), 'utf8');
  const val = n => new RegExp('--' + n + ':\\s*(#[0-9a-f]{6})', 'i').exec(tokens)[1].toLowerCase();
  for (const a of ['admin-obama2', 'admin-trump1', 'admin-biden', 'admin-trump2']) assert.notEqual(val('chart-16'), val(a), a);
  // the old DRP line on Hiring and departures is gone
  assert.ok(!/lineDataset\(drpValues/.test(src('pages/hiring-and-departures.js')));
});

test('the seven sum to departures in every row of doj_core, doj_core_series and doj_admin', { skip: SKIP }, () => {
  let n = 0;
  const check = (file, label) => {
    const cube = read(file), ci = c => cube.columns.indexOf(c);
    for (const c of SEVEN) assert.ok(ci(c) >= 0, label + ' has ' + c);
    for (const r of cube.rows) {
      const sum = SEVEN.reduce((a, c) => a + r[ci(c)], 0);
      assert.equal(sum, r[ci('departures')], label + ' ' + r.slice(0, 5).join(' '));
      // DRP taken out of the six: each category minus its non-DRP column, summed, is DRP
      assert.equal(SIX.reduce((a, c) => a + r[ci(c)] - r[ci(c + '_nondrp')], 0), r[ci('sep_drp')], label + ' ' + r.slice(0, 5).join(' '));
      n++;
    }
  };
  check('doj_core.json', 'doj_core');
  for (const name of ['doj_core_series', 'doj_admin']) {
    const meta = read(name + '.meta.json');
    for (const [e, f] of Object.entries(meta.files)) check(f.path, name + ' ' + e);
  }
  assert.ok(n > 10000, 'rows checked: ' + n);
});

test('DOJ, Trump II, first 19 months: DRP 3,030 and the six without DRP sum to 20,461; shares are count over departures', { skip: SKIP }, () => {
  const rows = D.fromCube(read(read('doj_admin.meta.json').files.DOJ.path));
  const r = A.rowAt(rows, 'DOJ', 'all', 'trump2', 19);
  const want = { sep_drp: 3030, sep_transfer_out_nondrp: 1424, sep_quit_nondrp: 6739, sep_retirement_nondrp: 7490, sep_rif_nondrp: 81,
    sep_termination_nondrp: 408, sep_other_nondrp: 1289 };
  for (const [c, v] of Object.entries(want)) assert.equal(r[c], v, c);
  assert.equal(r.departures, 20461);
  const s = A.reasonShares(r);
  assert.equal(s.none, false);
  assert.deepEqual(s.shares, SEVEN.map(c => want[c] / 20461));
  assert.ok(Math.abs(s.shares.reduce((a, v) => a + v, 0) - 1) < 1e-12);
  // an administration with no DRP departures has a DRP share of 0, not an empty value
  for (const id of ['biden', 'trump1', 'obama2']) {
    const b = A.rowAt(rows, 'DOJ', 'all', id, 19), bs = A.reasonShares(b);
    assert.equal(b.sep_drp, 0, id);
    assert.equal(bs.shares[0], 0, id);
    assert.ok(Math.abs(bs.shares.reduce((a, v) => a + v, 0) - 1) < 1e-12, id);
  }
});

test('Components compared: the seven shares of a doj_core row; a period with no departures is flagged, not zero', { skip: SKIP }, () => {
  const cube = read('doj_core.json'), rows = D.fromCube(cube);
  const r = CC.rowFor(rows, 'DOJ', 'fy', 'FY2025'), s = CC.reasonShares(r);
  SEVEN.forEach((c, i) => assert.equal(s.shares[i], r[c] / r.departures, c));
  assert.ok(s.shares[0] > 0, 'FY2025 has DRP departures');
  const z = rows.find(x => x.entity === 'DJ14' && x.grain === 'month' && x.departures === 0);
  const zs = CC.reasonShares(z);
  assert.equal(zs.none, true);
  assert.equal(zs.shares.length, 7);
  assert.ok(zs.shares.every(v => v === null));
});

test('a combination of components (D-078, D-079) sums the seven like the other flows', { skip: SKIP }, () => {
  for (const name of ['doj_core', 'doj_core_series', 'doj_admin']) {
    const plan = D.combinePlan(read(name + '.meta.json'));
    for (const c of SEVEN) assert.ok(plan.sum.includes(c), name + ' sums ' + c);
  }
  const meta = read('doj_admin.meta.json');
  const parts = ['DJ02', 'DJ03', 'DJ08'].map(e => D.fromCube(read(meta.files[e].path)).filter(r => r.series_group === 'all' && r.administration === 'trump2' && r.months_in_office === 19)[0]);
  const key = ['series_group', 'administration', 'months_in_office'];
  const sel = D.combineEntities(parts, ['DJ02', 'DJ03', 'DJ08'], meta, key);
  assert.equal(sel.length, 1);
  for (const c of SEVEN) assert.equal(sel[0][c], parts.reduce((a, p) => a + p[c], 0), c);
  assert.equal(SEVEN.reduce((a, c) => a + sel[0][c], 0), sel[0].departures);
  const s = A.reasonShares(sel[0]);
  assert.deepEqual(s.shares, SEVEN.map(c => sel[0][c] / sel[0].departures));
});
