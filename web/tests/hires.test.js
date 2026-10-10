'use strict';
/* Hires and departures tab, Hires mode (D-099 to D-102; docs/pages/hires-and-departures-tab.md): the pure helpers the
   page uses (leaving.js mode lists and labels, admin.js hire types and hire rate, redesign.js leavingPanel on
   doj_joining, data.js combining hire and share columns) against the staged cubes (warehouse/cubes, else web/data; the
   data tests skip when the cube is not there). Expected values come from plain loops over the raw arrays. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const LV = require('../assets/js/leaving.js');
const A = require('../assets/js/admin.js');
const R = require('../assets/js/redesign.js');
const D = require('../assets/js/data.js');
const I = require('./_inputs.js');

const DIR = I.cubesDir();
const has = name => !!(DIR && fs.existsSync(path.join(DIR, name + '.meta.json')));
const meta = name => JSON.parse(fs.readFileSync(path.join(DIR, name + '.meta.json'), 'utf8'));
const cache = {};
/* rows of one entity's file of a per-entity cube, as objects */
function rows(cube, e) {
  const k = cube + ':' + e;
  if (!cache[k]) cache[k] = D.fromCube(JSON.parse(fs.readFileSync(path.join(DIR, meta(cube).files[e].path), 'utf8')));
  return cache[k];
}
/* the raw array's rows (no helper), as objects */
function raw(cube, e) {
  const f = JSON.parse(fs.readFileSync(path.join(DIR, meta(cube).files[e].path), 'utf8'));
  return f.rows.map(r => Object.fromEntries(f.columns.map((c, i) => [c, r[i]])));
}
const SKIP_J = !has('doj_joining') && 'no doj_joining cube';
const ADMIN_HIRES = has('doj_admin') && meta('doj_admin').columns.some(c => c.name === 'hire_num');
const SKIP_A = !ADMIN_HIRES && 'no doj_admin with hire_num (D-100)';
const copy = JSON.parse(fs.readFileSync(path.join(I.WEB, 'copy.json'), 'utf8'));

test('Group by lists per mode (spec section 2): Departures gains education, veteran status, grade level; Hires has rates then two share groups', () => {
  assert.deepEqual(LV.modeDims('departures').map(d => d.key), ['los', 'age', 'edu', 'vet', 'grade', 'sup', 'occ']);
  assert.deepEqual(LV.modeDims('hires').map(d => d.key), ['age', 'edu', 'vet', 'grade', 'occ', 'prior', 'program']);
  assert.deepEqual(LV.modeDims('hires').map(d => d.kind), ['rate', 'rate', 'rate', 'rate', 'rate', 'share', 'share']);
  assert.deepEqual(LV.modeDims('hires').map(d => d.id), ['age', 'education', 'veteran', 'grade', 'occupation', 'prior_service', 'pathways']);
  // occupation hidden with a job series, in both modes (D-062)
  assert.deepEqual(LV.modeDims('departures', true).map(d => d.key), ['los', 'age', 'edu', 'vet', 'grade', 'sup']);
  assert.deepEqual(LV.modeDims('hires', true).map(d => d.key), ['age', 'edu', 'vet', 'grade', 'prior', 'program']);
  assert.throws(() => LV.modeDims('x'), /unknown mode/);
  // every option label is a signed copy key
  for (const m of ['departures', 'hires']) for (const d of LV.modeDims(m)) {
    const k = d.name.replace(/^shell:/, '');
    assert.equal(typeof copy.shell[k], 'string', d.name); assert.equal(copy.shell._status[k], 'signed', d.name);
  }
  assert.equal(LV.DIMS.length, 4, 'the old Who is leaving page keeps its four panels');
});

test('switching mode keeps the Group by when the other mode has it, else the first; a job series drops occupation', () => {
  assert.equal(LV.keepDim('hires', 'grade', false), 'grade');
  assert.equal(LV.keepDim('hires', 'age', false), 'age');
  assert.equal(LV.keepDim('hires', 'los', false), 'age', 'years of service is Departures only');
  assert.equal(LV.keepDim('hires', 'sup', false), 'age');
  assert.equal(LV.keepDim('departures', 'prior', false), 'los', 'prior federal service is Hires only');
  assert.equal(LV.keepDim('departures', 'edu', false), 'edu');
  assert.equal(LV.keepDim('hires', 'occ', true), 'age');
  assert.equal(LV.keepDim('departures', 'occ', true), 'los');
  assert.equal(LV.keepDim('departures', 'occ', false), 'occ');
});

test('group labels: every new dimension value has a signed who-is-leaving label (D-101), in the crosswalk order', () => {
  const csv = fs.readFileSync(path.join(I.REPO, 'pipeline', 'crosswalks', 'leaving_dimensions.csv'), 'utf8').trim().split('\n').slice(1).map(l => l.split(','));
  const want = { education: ['High school or less', 'Some college or associate degree', "Bachelor's degree", "Master's or professional degree", 'Doctorate'], veteran: ['Veterans', 'Non-veterans'],
    grade: ['GS 1 to 7', 'GS 8 to 11', 'GS 12 to 13', 'GS 14 to 15', 'Senior executives', 'Federal wage system (trades and crafts)', 'Attorney and judge pay plans'],
    prior_service: ['Under 1 year (new to federal service)', '1 to 4 years', '5 to 9 years', '10 years or more'], pathways: ['Interns and student trainees', 'Recent graduates', 'Presidential Management Fellows', 'All other hires'] };
  const W = copy.pages['who-is-leaving'];
  for (const [dim, labels] of Object.entries(want)) {
    const values = csv.filter(c => c[0] === dim && c[1] !== 'unknown').sort((a, b) => a[2] - b[2]).map(c => c[1]);
    assert.deepEqual(values.map(v => W[LV.groupLabel(dim, v).ref.replace(/^page:/, '')]), labels, dim);
    for (const v of values) assert.equal(W._status[LV.groupLabel(dim, v).ref.replace(/^page:/, '')], 'signed', dim + ' ' + v);
  }
  assert.throws(() => LV.groupLabel('grade', 'gs_99'), /unexpected grade value/);
});

test('combining components: hire_num and hire_x_num take the attrition denominators (D-079), share_den is summed', () => {
  const plan = D.combinePlan({ columns: [{ name: 'hire_num', kind: 'rate_numerator' }, { name: 'hire_a_num', kind: 'rate_numerator' }, { name: 'rate_den', kind: 'rate_denominator' },
    { name: 'rate_a_den', kind: 'rate_denominator' }, { name: 'share_den', kind: 'share_denominator' }, { name: 'hires', kind: 'flow' }] });
  assert.equal(plan.denOf.hire_num, 'rate_den'); assert.equal(plan.denOf.hire_a_num, 'rate_a_den');
  assert.ok(plan.sum.includes('share_den')); assert.equal(plan.denOf.share_den, undefined);
});

test('hire types (D-100): competitive, excepted and SES new hires and transfers in partition hires in every doj_admin row; shares are type / hires', { skip: SKIP_A }, () => {
  assert.deepEqual(A.HIRE_TYPES, ['acc_competitive', 'acc_excepted', 'acc_ses', 'acc_transfer_in']);
  let n = 0;
  for (const e of meta('doj_admin').entities) for (const r of raw('doj_admin', e)) {
    if (r.hires === null) continue;
    assert.equal(r.acc_competitive + r.acc_excepted + r.acc_ses, r.acc_new_hire, e + ' ' + r.series_group + ' ' + r.administration + ' ' + r.months_in_office);
    assert.equal(r.acc_new_hire + r.acc_transfer_in, r.hires);
    const s = A.hireShares(r);
    if (r.hires) { assert.ok(Math.abs(s.shares.reduce((a, v) => a + v, 0) - 1) < 1e-12); assert.equal(s.shares[0], r.acc_competitive / r.hires); }
    else assert.equal(s.none, true);
    n++;
  }
  assert.ok(n > 1000, n + ' rows');
});

test('hire rate (D-100): hire_num / rate_den of the row, as the cube annualizes it; FBI + DEA is the summed numerator over the summed denominator', { skip: SKIP_A }, () => {
  const d = rows('doj_admin', 'DOJ'), n = A.months(d, 'DOJ', 'all', 'trump2'), r = A.rowAt(d, 'DOJ', 'all', 'trump2', n);
  assert.equal(A.cells(r).hireRate, r.hire_num / r.rate_den);
  assert.ok(Math.abs(r.hire_num - r.hires * 12 / n) < 0.05, 'annualized over the N months');
  const both = rows('doj_admin', 'DJ02').concat(rows('doj_admin', 'DJ06'));
  const sel = D.combineEntities(both, ['DJ02', 'DJ06'], meta('doj_admin'), ['series_group', 'administration', 'months_in_office']);
  const s = A.rowAt(sel, 'SEL', 'all', 'trump2', n), a = A.rowAt(both, 'DJ02', 'all', 'trump2', n), b = A.rowAt(both, 'DJ06', 'all', 'trump2', n);
  assert.equal(A.cells(s).hireRate, (a.hire_num + b.hire_num) / (a.rate_den + b.rate_den));
  assert.equal(s.hires, a.hires + b.hires);
});

test('Who is joining (doj_joining admin_n): rates are rate_num / rate_den; share groups are hires / share_den and sum to 100% of known hires', { skip: SKIP_J }, () => {
  const j = rows('doj_joining', 'DOJ'), ids = R.ORDER;
  const rawJ = raw('doj_joining', 'DOJ');
  for (const d of LV.modeDims('hires')) {
    const p = R.leavingPanel(j, d.id, ids, 'hires');
    assert.ok(p.values.length > 0, d.id);
    for (const id of ids) {
      const want = rawJ.filter(r => r.grain === 'admin_n' && r.period === id && r.dimension === d.id && !r.is_unknown).sort((a, b) => a.value_order - b.value_order);
      assert.deepEqual(p.values, want.map(r => r.value), d.id + ' ' + id);
      p.groups.forEach((g, i) => {
        const c = g.cells[id], r = want[i];
        assert.equal(c.count, r.hires);
        if (d.kind === 'share') { assert.equal(c.isShare, true); assert.equal(c.rate, null); assert.equal(c.share, r.hires / r.share_den); assert.equal(c.smallBase, false); }
        else { assert.equal(c.isShare, false); assert.equal(c.share, null); assert.equal(c.rate, r.rate_num === null ? null : r.rate_num / r.rate_den); }
      });
      if (d.kind === 'share') assert.ok(Math.abs(p.groups.reduce((a, g) => a + g.cells[id].share, 0) - 1) < 1e-12, d.id + ' ' + id + ' shares sum to 1');
      const u = rawJ.find(r => r.grain === 'admin_n' && r.period === id && r.dimension === d.id && r.is_unknown);
      assert.equal(p.unknown[id], u ? u.hires : null, d.id + ' ' + id + ' unknown');
    }
  }
  // the known groups' hires and the Unknown add up to all hires (doj_admin at N) in every dimension
  if (ADMIN_HIRES) {
    const ad = rows('doj_admin', 'DOJ'), n = A.months(ad, 'DOJ', 'all', 'trump2');
    for (const d of LV.modeDims('hires')) {
      const all = rawJ.filter(r => r.grain === 'admin_n' && r.period === 'trump2' && r.dimension === d.id).reduce((a, r) => a + r.hires, 0);
      assert.equal(all, A.rowAt(ad, 'DOJ', 'all', 'trump2', n).hires, d.id);
    }
  }
});

test('Who is joining, several components: shares from summed hires over summed share_den; coverage from summed hires (D-078)', { skip: SKIP_J }, () => {
  const both = rows('doj_joining', 'DJ02').concat(rows('doj_joining', 'DJ06'));
  const sel = D.combineEntities(both, ['DJ02', 'DJ06'], meta('doj_joining'), ['grain', 'period', 'dimension', 'value', 'series_group']);
  const p = R.leavingPanel(sel, 'prior_service', ['trump2'], 'hires');
  const pick = (e, v) => both.find(r => r.entity === e && r.grain === 'admin_n' && r.period === 'trump2' && r.dimension === 'prior_service' && r.value === v);
  p.groups.forEach(g => {
    const a = pick('DJ02', g.value), b = pick('DJ06', g.value);
    assert.equal(g.cells.trump2.share, (a.hires + b.hires) / (a.share_den + b.share_den), g.value);
  });
  const unk = ['DJ02', 'DJ06'].reduce((t, e) => t + pick(e, 'unknown').hires, 0), all = ['DJ02', 'DJ06'].reduce((t, e) => t + both.filter(r => r.entity === e && r.grain === 'admin_n' && r.period === 'trump2' && r.dimension === 'prior_service').reduce((x, r) => x + r.hires, 0), 0);
  assert.equal(p.coverage.trump2, (all - unk) / all);
  assert.ok(Math.abs(p.groups.reduce((a, g) => a + g.cells.trump2.share, 0) - 1) < 1e-12);
});

test('Who is leaving keeps working on doj_leaving with the new dimensions: rates, departures, no shares', { skip: !has('doj_leaving') && 'no doj_leaving cube' }, () => {
  const l = rows('doj_leaving', 'DOJ');
  for (const d of LV.modeDims('departures')) {
    const p = R.leavingPanel(l, d.id, ['trump2']);
    assert.ok(p.values.length > 0, d.id);
    p.groups.forEach(g => { assert.equal(g.cells.trump2.isShare, false); assert.equal(g.cells.trump2.count, g.cells.trump2.departures); });
  }
});

test('the page: mode in the file names and OPM.page.shown; Show radios; every Hires-mode copy key used literally or by directive', () => {
  const src = fs.readFileSync(path.join(I.WEB, 'assets/js/pages/departures.js'), 'utf8');
  assert.match(src, /var suffix = mode \+ '-' \+ e/);
  assert.match(src, /fileSuffix: data\.mode \+ '-' \+ data\.entity/);
  assert.match(src, /OPM\.page\.shown = .*':' \+ mode \+ '\|'/);
  assert.match(src, /role: 'radiogroup', 'aria-labelledby': modeLabelId/);
  for (const k of ['dep.mode', 'dep.mode.departures', 'dep.mode.hires', 'tile.hiresSince', 'tile.newHiresSince', 'tile.transfersInSince', 'tile.hireRateSince', 'dep.running.title.hires', 'dep.how.title', 'dep.how.note',
    'dep.join.title', 'dep.join.note', 'dep.join.noteShare', 'dep.join.axis', 'dep.join.axisShare', 'dep.join.tip', 'dep.join.tipShare', 'dep.join.unknownAdmin', 'dep.join.unknownAdmin1', 'dep.who.gradeNote', 'dep.join.gradeNote', 'dep.how.transfersIn'])
    assert.ok(src.includes("'shell:" + k + "'"), k);
});

test('D-103: chart 2 labels transfers in "Transfers in" (its own key, Hires mode only); series:acc_transfer_in stays "Transfer in"', () => {
  const src = fs.readFileSync(path.join(I.WEB, 'assets/js/pages/departures.js'), 'utf8');
  assert.match(src, /H && c === 'acc_transfer_in' \? copy\.t\('shell:dep\.how\.transfersIn'\)/);
  assert.equal(copy.shell['dep.how.transfersIn'], 'Transfers in'); assert.equal(copy.shell._status['dep.how.transfersIn'], 'signed');
  assert.equal(copy.series.acc_transfer_in, 'Transfer in');
  // the other pages that name transfers in keep the series label
  for (const f of ['pages/hiring-and-departures.js', 'pages/reading-the-data.js']) assert.ok(!fs.readFileSync(path.join(I.WEB, 'assets/js', f), 'utf8').includes('dep.how.transfersIn'), f);
});
