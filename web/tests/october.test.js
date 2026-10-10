'use strict';
/* October 2026 changes (docs/pages/october-2026-changes.md; D-089, D-090): the From/to fiscal-year range (section 7),
   the component order and Main Justice group (section 4), and the Group by dimensions (sections 5-6). Pure parts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../assets/js/controls/fy-range.js');
const R = require('../assets/js/redesign.js');
const D = require('../assets/js/data.js');
const LV = require('../assets/js/leaving.js');
const I = require('./_inputs.js');

const BOUNDS = { start: '2011-10', end: '2026-07' };

test('range: the fiscal years offered run FY2012 to the latest month\'s, and a range is whole fiscal years cut to the data', () => {
  const fys = F.fyOptions(BOUNDS);
  assert.equal(fys[0], 'FY2012'); assert.equal(fys.at(-1), 'FY2026'); assert.equal(fys.length, 15);
  assert.deepEqual(F.monthRange('FY2012', 'FY2026', BOUNDS), { start: '2011-10', end: '2026-07' });
  assert.deepEqual(F.monthRange('FY2020', 'FY2022', BOUNDS), { start: '2019-10', end: '2022-09' });
  assert.deepEqual(F.monthRange('FY2025', 'FY2026', BOUNDS), { start: '2024-10', end: '2026-07' }, 'the latest year ends at the latest month');
});

test('range: a reversed pair is never shown; the other select follows the one changed', () => {
  assert.deepEqual(F.adjust('FY2020', 'FY2022', 'from'), { from: 'FY2020', to: 'FY2022' });
  assert.deepEqual(F.adjust('FY2024', 'FY2022', 'from'), { from: 'FY2024', to: 'FY2024' });
  assert.deepEqual(F.adjust('FY2020', 'FY2018', 'to'), { from: 'FY2018', to: 'FY2018' });
});

test('range: the title\'s {from} is the first month and {to} the last (the latest month at the end)', () => {
  const label = m => 'L' + m;
  assert.deepEqual(F.fromTo({ start: '2019-10', end: '2026-07' }, label), { from: 'L2019-10', to: 'L2026-07' });
});

test('range at every View grain: months, fiscal quarters and fiscal years fall wholly inside or outside', () => {
  const CUBES = I.cubesDir();
  if (!CUBES || !fs.existsSync(path.join(CUBES, 'doj_core.json'))) return;
  const rows = D.fromCube(JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_core.json'), 'utf8'))).filter(r => r.entity === 'DOJ');
  const meta = JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_core.meta.json'), 'utf8'));
  const b = { start: meta.range.first_month, end: meta.range.last_month }, r = F.monthRange('FY2020', 'FY2022', b);
  const at = g => F.pick(D.selectRows(rows, { grain: g }), r);
  assert.deepEqual(at('fy').map(x => x.period), ['FY2020', 'FY2021', 'FY2022']);
  const q = at('quarter'); assert.equal(q.length, 12); assert.equal(q[0].period, 'FY2020Q1'); assert.equal(q.at(-1).period, 'FY2022Q4');
  const m = at('month'); assert.equal(m.length, 36); assert.equal(m[0].period, '2019-10'); assert.equal(m.at(-1).period, '2022-09');
  // every row picked lies inside the range (no period straddles a fiscal-year edge)
  for (const g of ['month', 'quarter', 'fy']) assert.ok(at(g).every(x => x.period_first_month >= r.start && x.period_last_month <= r.end), g);
  // the full range keeps every row, the partial latest year included
  const full = F.monthRange('FY2012', 'FY2026', b);
  for (const g of ['month', 'quarter', 'fy']) assert.equal(F.pick(D.selectRows(rows, { grain: g }), full).length, D.selectRows(rows, { grain: g }).length, g);
  assert.equal(F.pick(rows, null), rows, 'no range: the rows as given');
});

test('component order (D-090): the six, then Main Justice in Cary\'s order; DOJ left out; nothing dropped', () => {
  assert.deepEqual(R.COMPONENT_ORDER, ['DJ15', 'DJ03', 'DJ06', 'DJ02', 'DJ09', 'DJ08', 'DJ14', 'DJ12', 'DJ01', 'DJ10', 'DJ07', 'DJ11']);
  const ents = ['DOJ', 'DJ01', 'DJ02', 'DJ03', 'DJ06', 'DJ07', 'DJ08', 'DJ09', 'DJ10', 'DJ11', 'DJ12', 'DJ14', 'DJ15'];
  const o = R.componentOrder(ents);
  assert.deepEqual(o.map(x => x.code), R.COMPONENT_ORDER);
  assert.deepEqual(o.map(x => x.group), [null, null, null, null, null, null, 'mainJustice', 'mainJustice', 'mainJustice', 'mainJustice', 'mainJustice', 'mainJustice']);
  assert.deepEqual(R.componentOrder(['DJ99', 'DJ02']).map(x => x.code), ['DJ02', 'DJ99'], 'an unlisted code follows');
  assert.equal(R.CRS, 'DJ14');
  // the crosswalk the data-engineer keeps carries the same order (display_order) and group (display_group)
  const csv = fs.readFileSync(path.join(__dirname, '..', '..', 'pipeline', 'crosswalks', 'components.csv'), 'utf8').trim().split('\n');
  const head = csv[0].split(','), iCode = head.indexOf('agency_subelement_code'), iOrd = head.indexOf('display_order'), iGrp = head.indexOf('display_group');
  if (iOrd >= 0) {
    const rowsC = csv.slice(1).map(l => l.match(/("[^"]*"|[^,]*)(,|$)/g).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '')));
    const byOrd = rowsC.filter(c => c[iOrd]).sort((a, b) => +a[iOrd] - +b[iOrd]);
    assert.deepEqual(byOrd.map(c => c[iCode]), R.COMPONENT_ORDER, 'components.csv display_order');
    assert.deepEqual(byOrd.map(c => c[iGrp] === 'main_justice'), o.map(x => x.group === 'mainJustice'), 'components.csv display_group');
  }
});

test('Group by (D-090): the four dimensions in selector order, Occupation last (hidden with a job series)', () => {
  assert.deepEqual(LV.DIMS.map(d => d.key), ['los', 'age', 'sup', 'occ']);
  const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'copy.json'), 'utf8'));
  assert.deepEqual(LV.DIMS.map(d => copy.shell['dep.who.dim.' + d.key]), ['Years of service', 'Age', 'Supervisors and everyone else', 'Occupation']);
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pages', 'departures.js'), 'utf8');
  // since D-100 the page lists LV.modeDims (education, veteran status and grade level added; hires-test.js): Occupation is
  // still left out while a job series is chosen, and the chart falls back to Years of service
  assert.match(src, /LV\.modeDims\(state\.mode, bySeries\)/);
  assert.equal(LV.keepDim('departures', 'occ', true), 'los');
  assert.deepEqual(LV.modeDims('departures').filter(d => LV.DIMS.some(x => x.key === d.key)).map(d => d.key), ['los', 'age', 'sup', 'occ'], 'the four in the same order');
});

test('Explore full history is hidden (D-090): no main page loads main-explore.js; the file and the old pages stay', () => {
  const WEB = path.join(__dirname, '..');
  for (const f of ['index.html', 'departures.html', 'components.html', 'appointments.html']) assert.ok(!/main-explore\.js/.test(fs.readFileSync(path.join(WEB, f), 'utf8')), f);
  for (const f of ['assets/js/main-explore.js', 'history-workforce-size.html', 'history-hiring-and-departures.html', 'history-who-is-leaving.html', 'history-components-compared.html']) assert.ok(fs.existsSync(path.join(WEB, f)), f);
});
