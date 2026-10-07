'use strict';
/* Several components together (D-078): summing the same key across components, against the cubes (staged warehouse/cubes,
   else web/data). The 12 components partition DOJ, so their sum must equal the DOJ row for every count and denominator. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../assets/js/data.js');
const I = require('./_inputs.js');

const CUBES = I.cubesDir();
const has = f => CUBES && fs.existsSync(path.join(CUBES, f));
const read = f => JSON.parse(fs.readFileSync(path.join(CUBES, f), 'utf8'));
const SKIP = !has('doj_admin.meta.json') && 'no cubes';
// the cube rounds annualized numerators to 4 decimals per entity, so a sum of 12 may differ from DOJ by up to 12 x 0.00005
const close = (a, b) => a === b || (a !== null && b !== null && Math.abs(a - b) <= 0.001 + 1e-9 * Math.abs(b));

function checkPartition(rows, meta, keyCols, label) {
  const comps = meta.entities.filter(e => e !== 'DOJ');
  const doj = {};
  rows.filter(r => r.entity === 'DOJ').forEach(r => { doj[keyCols.map(c => String(r[c])).join('|')] = r; });
  // a component's row whose stocks come from an earlier month than DOJ's (CRS after it ended) is not part of that period's partition
  const aligned = rows.filter(r => { if (r.entity === 'DOJ') return false; const d = doj[keyCols.map(c => String(r[c])).join('|')];
    return d && ['period_last_month', 'month_n', 'month_0'].every(k => r[k] === d[k]); });
  const sel = D.combineEntities(aligned, comps, meta, keyCols);
  const plan = D.combinePlan(meta);
  let checked = 0, bad = [];
  for (const s of sel) {
    const d = doj[keyCols.map(c => String(s[c])).join('|')];
    if (!d) continue;
    // only keys where all 12 components have a row are a full partition of DOJ (CRS ends Apr 2026; a series group may lack a component)
    if (s.entities.length !== comps.length) continue;
    for (const c of plan.sum) if (s[c] !== null && !close(s[c], D.value(d, c))) bad.push(label + ' ' + keyCols.map(k => s[k]).join('/') + ' ' + c + ': ' + s[c] + ' vs ' + d[c]);
    checked++;
  }
  assert.deepEqual(bad.slice(0, 5), [], label);
  assert.ok(checked > 10, label + ': checked ' + checked);
  return checked;
}

test('doj_core: the 12 components summed equal DOJ for every count, flow, numerator and denominator (months, quarters, fiscal years)', { skip: SKIP }, () => {
  const meta = read('doj_core.meta.json'), rows = D.fromCube(read('doj_core.json'));
  checkPartition(rows, meta, ['grain', 'period'], 'doj_core');
});

test('doj_admin: summed across the 12 components = DOJ at every series group, administration and N', { skip: SKIP }, () => {
  const meta = read('doj_admin.meta.json');
  const rows = [].concat(...meta.entities.map(e => D.fromCube(read(meta.files[e].path))));
  checkPartition(rows, meta, ['series_group', 'administration', 'months_in_office'], 'doj_admin');
});

test('doj_leaving: summed departures and rate denominators per value = DOJ (admin_n and fy)', { skip: SKIP }, () => {
  const meta = read('doj_leaving.meta.json');
  const rows = [].concat(...meta.entities.map(e => D.fromCube(read(meta.files[e].path)))).filter(r => r.grain === 'admin_n' || r.grain === 'fy');
  checkPartition(rows, meta, ['grain', 'period', 'dimension', 'value'], 'doj_leaving');
});

test('the guards: no DOJ in a combination, no mixed keys, no duplicate component; small base on the summed denominator', { skip: SKIP }, () => {
  const meta = read('doj_admin.meta.json');
  const fbi = D.fromCube(read(meta.files.DJ02.path)), dea = D.fromCube(read(meta.files.DJ06.path)), doj = D.fromCube(read(meta.files.DOJ.path));
  const key = ['series_group', 'administration', 'months_in_office'];
  const pick = (rows, a, n) => rows.find(r => r.series_group === 'all' && r.administration === a && r.months_in_office === n);
  assert.throws(() => D.sumAcrossEntities([pick(fbi, 'trump2', 19), pick(doj, 'trump2', 19)], meta, key), /DOJ cannot be part/);
  assert.throws(() => D.sumAcrossEntities([pick(fbi, 'trump2', 19), pick(dea, 'trump2', 18)], meta, key), /differ on months_in_office/);
  assert.throws(() => D.sumAcrossEntities([pick(fbi, 'trump2', 19), pick(dea, 'biden', 19)], meta, key), /differ on administration/);
  assert.throws(() => D.sumAcrossEntities([pick(fbi, 'trump2', 19), pick(fbi, 'trump2', 19)], meta, key), /listed twice/);
  assert.throws(() => D.combineEntities(fbi.concat(doj), ['DJ02', 'DOJ'], meta, key), /DOJ cannot be combined/);
  const s = D.sumAcrossEntities([pick(fbi, 'trump2', 19), pick(dea, 'trump2', 19)], meta, key);
  assert.equal(s.headcount_n, pick(fbi, 'trump2', 19).headcount_n + pick(dea, 'trump2', 19).headcount_n);
  assert.equal(s.rate_months, 19, 'a months count is not added');
  assert.equal(s.provisional, true);
  // small base: below 30 on the summed denominator (two tiny made-up rows)
  const tiny = (e, den) => Object.assign({}, pick(fbi, 'trump2', 19), { entity: e, rate_den: den });
  assert.equal(D.sumAcrossEntities([tiny('X1', 10), tiny('X2', 15)], meta, key).rate_small_base, true);
  assert.equal(D.sumAcrossEntities([tiny('X1', 10), tiny('X2', 25)], meta, key).rate_small_base, false);
  // a genuinely missing value (a null count) keeps the sum null
  assert.equal(D.sumAcrossEntities([Object.assign(tiny('X1', 10), { departures: null }), tiny('X2', 25)], meta, key).departures, null);
});

test('D-079: a component with nobody in the group adds 0 to the rate; missing data still empties it; all structural stays empty', { skip: SKIP }, () => {
  const meta = read('doj_admin.meta.json'), key = ['series_group', 'administration', 'months_in_office'];
  const rowsOf = e => D.fromCube(read(meta.files[e].path));
  const n = Math.max(...rowsOf('DOJ').filter(r => r.series_group === 'all' && r.administration === 'trump2').map(r => r.months_in_office));
  const at = (e, g, a) => rowsOf(e).find(r => r.series_group === g && r.administration === a && r.months_in_office === n);
  // OBD has no criminal investigators: OBD + FBI, series 1811 = FBI's numerator and denominator
  for (const a of ['trump2', 'trump1', 'obama2']) {
    const obd = at('DJ01', '1811', a), fbi = at('DJ02', '1811', a);
    assert.equal(obd.rate_den, null); assert.equal(obd.headcount_n, 0);
    const s = D.sumAcrossEntities([obd, fbi], meta, key);
    assert.equal(s.attrition_num, fbi.attrition_num, a); assert.equal(s.rate_den, fbi.rate_den, a);
    assert.equal(s.departures, obd.departures + fbi.departures, 'counts still add');
    if (meta.range.last_month === '2026-07') assert.equal((s.attrition_num / s.rate_den * 100).toFixed(1), { trump2: '7.5', trump1: '5.1', obama2: '3.5' }[a], a);
  }
  // a case where every component is structural: no rate
  const none = D.sumAcrossEntities([at('DJ01', '1811', 'trump2'), Object.assign({}, at('DJ01', '1811', 'trump2'), { entity: 'DJX' })], meta, key);
  assert.equal(none.rate_den, null); assert.equal(none.attrition_num, null); assert.equal(none.departures, 0);
  // a null denominator with no published counts is missing, not structural: it empties the rate
  const miss = Object.assign({}, at('DJ02', '1811', 'trump2'), { entity: 'DJY', rate_den: null, attrition_num: null, headcount_0: null, headcount_n: null, departures: null });
  assert.equal(D.sumAcrossEntities([at('DJ02', '1811', 'trump2'), miss], meta, key).rate_den, null);
});

test('D-079: BOP + USMS + OIG by occupation (admin_n): criminal investigators and correctional officers keep their rates', { skip: SKIP }, () => {
  const meta = read('doj_leaving.meta.json'), key = ['grain', 'period', 'dimension', 'value', 'series_group'];
  const rows = [].concat(...['DJ03', 'DJ08', 'DJ10'].map(e => D.fromCube(read(meta.files[e].path)))).filter(r => r.grain === 'admin_n' && r.dimension === 'occupation');
  if (!rows.length) return;
  const sel = D.combineEntities(rows, ['DJ03', 'DJ08', 'DJ10'], meta, key);
  const get = v => sel.find(r => r.period === 'trump2' && r.value === v);
  const raw = (v) => rows.filter(r => r.period === 'trump2' && r.value === v && !r.rate_not_applicable);
  for (const v of ['1811', '0007']) {
    const s = get(v), rr = raw(v);
    assert.equal(s.rate_not_applicable, false, v);
    assert.equal(s.rate_num, rr.reduce((a, r) => a + r.rate_num, 0), v); assert.equal(s.rate_den, rr.reduce((a, r) => a + r.rate_den, 0), v);
  }
  if (read('doj_admin.meta.json').range.last_month === '2026-07') {
    assert.equal((get('1811').rate_num / get('1811').rate_den).toFixed(4), '0.0621');
    assert.equal((get('0007').rate_num / get('0007').rate_den).toFixed(4), '0.1210');
  }
  // every component structural for a group (USMS + OIG have no correctional officers): not applicable
  const two = D.combineEntities(rows, ['DJ08', 'DJ10'], meta, key).find(r => r.period === 'trump2' && r.value === '0007');
  assert.equal(two.rate_not_applicable, true); assert.equal(two.rate_den, null);
});

test('D-089: Community Relations Service combines with others: every row sums (no differing last month), its zero months add 0 to rates', { skip: SKIP }, () => {
  const core = read('doj_core.json'), meta = read('doj_core.meta.json');
  assert.equal(meta.entity_last_month.DJ14, meta.range.last_month, 'CRS rows run to the latest month');
  const rows = D.fromCube(core).filter(r => r.entity === 'DJ14' || r.entity === 'DJ02');
  const sel = D.combineEntities(rows, ['DJ02', 'DJ14'], meta, ['grain', 'period']); // threw before D-089: CRS FY2026 ended in April
  const fbi = rows.filter(r => r.entity === 'DJ02'), byKey = r => r.grain + '|' + r.period;
  assert.equal(sel.length, fbi.length, 'one summed row per FBI row');
  const may = sel.find(r => r.grain === 'month' && r.period === '2026-05'), fbiMay = fbi.find(r => r.grain === 'month' && r.period === '2026-05');
  assert.equal(may.headcount, fbiMay.headcount, 'CRS adds 0 employees in May 2026');
  assert.equal(may.hires, fbiMay.hires); assert.equal(may.departures, fbiMay.departures);
  // a rate whose CRS denominator is 0 (D-027: nobody on board in the window) takes FBI's numerator and denominator alone (D-079)
  const crsMay = rows.find(r => r.entity === 'DJ14' && r.grain === 'month' && r.period === '2026-05');
  for (const m of ['a', 'b', 'c']) {
    const den = crsMay['rate_' + m + '_den'];
    if (den === 0 || den === null) { assert.equal(may['attrition_' + m + '_num'], fbiMay['attrition_' + m + '_num'], m); assert.equal(may['rate_' + m + '_den'], fbiMay['rate_' + m + '_den'], m); }
    else assert.ok(Math.abs(may['rate_' + m + '_den'] - fbiMay['rate_' + m + '_den'] - den) < 1e-6, m + ': a window with CRS staff still counts it');
  }
  assert.ok(['a', 'b', 'c'].some(m => !crsMay['rate_' + m + '_den']), 'May 2026 has an empty CRS rate (0 on board)');
  const apr = sel.find(r => r.grain === 'month' && r.period === '2026-04'), fbiApr = fbi.find(r => r.grain === 'month' && r.period === '2026-04');
  assert.equal(apr.headcount, fbiApr.headcount + 9, 'the 9 CRS employees on board in April 2026');
  const fy26 = sel.find(r => r.grain === 'fy' && r.period === 'FY2026');
  assert.equal(fy26.period_last_month, meta.range.last_month);
  // admin: the Trump II window to N, CRS at the same N as FBI
  const am = read('doj_admin.meta.json'), arows = ['DJ02', 'DJ14'].flatMap(e => D.fromCube(read(am.files[e].path)));
  const asel = D.combineEntities(arows, ['DJ02', 'DJ14'], am, ['series_group', 'administration', 'months_in_office']);
  const nF = Math.max(...arows.filter(r => r.entity === 'DJ02' && r.administration === 'trump2' && r.series_group === 'all').map(r => r.months_in_office));
  assert.ok(asel.some(r => r.administration === 'trump2' && r.series_group === 'all' && r.months_in_office === nF && r.entities.length === 2), 'FBI + CRS at N');
  void byKey;
});

test('the multi-select: an exclusive code stands alone; another component clears it; [] is all (D-089: no code is exclusive with current cubes)', () => {
  const M = require('../assets/js/controls/components-multi.js');
  assert.deepEqual(M.toggle([], 'DJ02', ['DJ14']), ['DJ02']);
  assert.deepEqual(M.toggle(['DJ02'], 'DJ06', ['DJ14']), ['DJ02', 'DJ06']);
  assert.deepEqual(M.toggle(['DJ02', 'DJ06'], 'DJ14', ['DJ14']), ['DJ14']);
  assert.deepEqual(M.toggle(['DJ14'], 'DJ08', ['DJ14']), ['DJ08']);
  assert.deepEqual(M.toggle(['DJ02'], 'DJ02', ['DJ14']), []);
});
