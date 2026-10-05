'use strict';
/* Appointments (docs/pages/appointments.md; D-084 to D-087): the page's data helpers (assets/js/appointments.js) against
   the doj_appointments cube (warehouse/cubes, else web/data; the data tests skip when neither has it). Expected values
   come from plain loops over the raw arrays, and the signed spec's figures (sections 2, 3 and 5). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AP = require('../assets/js/appointments.js');
const D = require('../assets/js/data.js');
const R = require('../assets/js/redesign.js');
const X = require('../assets/js/svg-export.js');
const I = require('./_inputs.js');

const DIR = (() => {
  const staged = I.local(path.join(I.REPO, 'warehouse', 'cubes', 'doj_appointments.meta.json'));
  if (staged) return path.dirname(staged);
  return fs.existsSync(path.join(I.WEB, 'data', 'doj_appointments.meta.json')) ? path.join(I.WEB, 'data') : null;
})();
const SKIP = !DIR && 'no doj_appointments cube';
const META = DIR && JSON.parse(fs.readFileSync(path.join(DIR, 'doj_appointments.meta.json'), 'utf8'));
const raw = (() => { const c = {}; return e => c[e] || (c[e] = JSON.parse(fs.readFileSync(path.join(DIR, META.files[e].path), 'utf8'))); })();
const rows = (() => { const c = {}; return e => c[e] || (c[e] = D.fromCube(raw(e))); })();
/* a plain loop over the raw array: the value of col in the row matching every key */
function rawAt(e, where, col) {
  const f = raw(e), ix = n => f.columns.indexOf(n);
  const hit = f.rows.filter(r => Object.entries(where).every(([k, v]) => r[ix(k)] === v));
  assert.equal(hit.length, 1, JSON.stringify(where) + ' matches ' + hit.length + ' rows');
  return hit[0][ix(col)];
}

test('groups: the seven shown, the political subgroups, the picker and every signed label key (section 7, D-085)', () => {
  assert.deepEqual(AP.GROUPS, ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy']);
  assert.deepEqual(AP.SUBGROUPS, ['schedule_c', 'noncareer_ses', 'executive']);
  assert.equal(AP.PICKER[0], 'political', 'political appointees by default');
  assert.deepEqual([...AP.PICKER].sort(), AP.GROUPS.concat(AP.SUBGROUPS).sort(), 'every shown group and subgroup, unknown never');
  assert.deepEqual(AP.SINCE, ['political', 'schedule_c', 'noncareer_ses', 'executive']);
  const copy = JSON.parse(fs.readFileSync(path.join(I.WEB, 'copy.json'), 'utf8'));
  const want = { career: 'Career', career_conditional: 'Career-conditional', excepted: 'Excepted service', temporary: 'Temporary and term', ses: 'Senior Executive Service',
    political: 'Political appointees', schedule_policy: 'Schedule Policy/Career', schedule_c: 'Schedule C', noncareer_ses: 'Noncareer SES', executive: 'Executive appointments' };
  for (const [g, text] of Object.entries(want)) {
    const k = AP.LABEL[g].replace(/^shell:/, '');
    assert.equal(copy.shell[k], text, g); assert.equal(copy.shell._status[k], 'signed', g);
  }
  assert.equal('unknown' in AP.LABEL, false);
});

test('the meta matches the page: groups and labels as signed, the cube has no rates (D-085)', { skip: SKIP }, () => {
  const ids = META.groups.list.map(g => g.id);
  for (const g of AP.GROUPS.concat(AP.SUBGROUPS, ['all', 'unknown'])) assert.ok(ids.includes(g), g);
  assert.equal(META.groups.list.find(g => g.id === 'unknown').label_status, 'not_shown');
  assert.ok(!META.columns.some(c => /rate/.test(c.name)), 'no rate columns');
  assert.deepEqual(META.entities[0], 'DOJ');
});

test('DOJ tiles at month N = 19 (spec section 5): political appointees 287, Schedule Policy/Career 100, political hires 274 and departures 270', { skip: SKIP }, () => {
  const r = rows('DOJ'), n = AP.currentN(r);
  assert.equal(n, rawAt('DOJ', { grain: 'admin', appt_group: 'all', period: 'trump2', months_in_office: n }, 'admin_months'));
  assert.equal(n, 19);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'headcount'), 287);
  assert.equal(D.value(AP.rowAt(r, 'schedule_policy', 'trump2', n), 'headcount'), 100);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'hires'), 274);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'departures'), 270);
  for (const [g, c] of [['political', 'headcount'], ['schedule_policy', 'headcount'], ['political', 'hires'], ['political', 'departures']])
    assert.equal(D.value(AP.rowAt(r, g, 'trump2', n), c), rawAt('DOJ', { grain: 'admin', appt_group: g, period: 'trump2', months_in_office: n }, c));
  assert.equal(AP.rowAt(r, 'political', 'trump2', n).provisional, true);
});

test('DOJ political appointees since taking office, month 19: Trump II 287 (from 257), Biden 242, Trump I 248, Obama II 280', { skip: SKIP }, () => {
  const r = rows('DOJ'), months = [0].concat(R.monthsShown(48, 'month', 19));
  assert.equal(months.length, 49);
  const at = id => AP.sinceLine(r, 'political', id, months);
  assert.equal(at('trump2').values[0], 257, 'month 0');
  assert.equal(at('trump2').values[19], 287);
  assert.equal(at('biden').values[19], 242);
  assert.equal(at('trump1').values[19], 248);
  assert.equal(at('obama2').values[19], 280);
  assert.equal(at('trump2').values[20], null, 'Trump II stops at N');
  assert.equal(at('biden').values[48], rawAt('DOJ', { grain: 'admin', appt_group: 'political', period: 'biden', months_in_office: 48 }, 'headcount'));
  assert.deepEqual(at('trump2').provisional.slice(17, 20), [true, true, true]);
  assert.equal(at('trump2').provisional[16], false);
  // the subgroups partition the group at every point
  for (const id of R.ORDER) for (const m of [0, 1, 12, 19]) {
    const sum = AP.SUBGROUPS.map(g => AP.sinceLine(r, g, id, [m]).values[0]).reduce((a, b) => a + b, 0);
    assert.equal(sum, at(id).values[m], id + ' month ' + m);
  }
});

test('change since taking office: percent only where month 0 has 30 or more (section 4); Schedule Policy/Career a count', { skip: SKIP }, () => {
  const r = rows('DOJ');
  const p = AP.rowAt(r, 'political', 'trump2', 19);
  assert.equal(p.headcount_change, 30);
  assert.ok(Math.abs(AP.pctChange(p) - 30 / 257) < 1e-12);
  const sp = AP.rowAt(r, 'schedule_policy', 'trump2', 19);
  assert.equal(sp.headcount_change, 100); assert.equal(AP.pctChange(sp), null);
  // every admin row: a percent exactly where the cube gives one
  for (const x of r.filter(x => x.grain === 'admin')) assert.equal(AP.pctChange(x) === null, x.headcount_change_pct === null, x.appt_group + ' ' + x.period + ' ' + x.months_in_office);
});

test('workforce mix: shares are headcount over all headcount; the groups (unknown included) sum to all at every month', { skip: SKIP }, () => {
  const r = rows('DOJ'), all = AP.timeline(r, 'all', 'month');
  assert.equal(all.length, 178); assert.equal(all[0].period, '2011-10'); assert.equal(all.at(-1).period, '2026-07');
  const by = g => Object.fromEntries(AP.timeline(r, g, 'month').map(x => [x.period, x]));
  const groups = Object.fromEntries(AP.GROUPS.concat(['unknown']).map(g => [g, by(g)]));
  for (const a of all) {
    const s = Object.values(groups).reduce((t, m) => t + m[a.period].headcount, 0);
    assert.equal(s, a.headcount, a.period);
  }
  const jul = groups.political['2026-07'];
  assert.equal(AP.share(jul), 287 / 107331);
  assert.equal(Math.round(AP.share(jul) * 1e4) / 1e4, jul.share, 'the cube rounds the same ratio to 4 decimals');
  assert.equal(AP.unknownAt(r, 'month', '2026-07'), 5, 'the invalid-code note (spec section 3: 5 in Jul 2026)');
  const fy = AP.timeline(r, 'all', 'fy');
  assert.equal(fy.at(-1).period, 'FY2026'); assert.equal(fy.at(-1).partial, true);
  assert.equal(fy.at(-1).headcount, 107331, 'a year shows its last month');
});

test('several components: counts summed per key, share and percent recomputed from the sums (never averaged); D-079', { skip: SKIP }, () => {
  const byEntity = { DJ01: rows('DJ01'), DJ09: rows('DJ09') };
  const sel = AP.selected(byEntity, ['DJ01', 'DJ09'], META);
  assert.ok(sel.every(x => x.entity === 'SEL'));
  const one = (e, w) => byEntity[e].find(x => Object.entries(w).every(([k, v]) => x[k] === v));
  for (const w of [{ grain: 'month', appt_group: 'political', period: '2026-07' }, { grain: 'fy', appt_group: 'career', period: 'FY2020' }, { grain: 'admin', appt_group: 'political', period: 'trump2', months_in_office: 19 },
    { grain: 'admin', appt_group: 'noncareer_ses', period: 'biden', months_in_office: 7 }]) {
    const s = sel.find(x => Object.entries(w).every(([k, v]) => x[k] === v)), a = one('DJ01', w), b = one('DJ09', w);
    for (const c of ['headcount', 'headcount_all', 'hires', 'departures']) assert.equal(s[c], a[c] + b[c], c + ' ' + JSON.stringify(w));
    assert.equal(s.share, (a.headcount + b.headcount) / (a.headcount_all + b.headcount_all), 'share of sums');
    assert.equal(s.provisional, a.provisional || b.provisional);
    if (w.grain === 'admin') {
      const h0 = a.headcount_0 + b.headcount_0, ch = a.headcount_change + b.headcount_change;
      assert.equal(s.headcount_0, h0); assert.equal(s.headcount_change, ch);
      assert.equal(s.pct_small_base, h0 < 30);
      assert.equal(AP.pctChange(s), h0 < 30 ? null : ch / h0);
    } else assert.equal(s.pct_small_base, null);
  }
  assert.equal(AP.selected({ DOJ: rows('DOJ') }, [], META), rows('DOJ'), 'none chosen: the DOJ rows');
  assert.equal(AP.selected({ DJ02: rows('DJ02') }, ['DJ02'], META), rows('DJ02'), 'one chosen: its rows');
  assert.throws(() => AP.combine(rows('DOJ').concat(rows('DJ01')), ['DOJ', 'DJ01'], META), /DOJ cannot be combined/);
});

test('every component summed equals DOJ (headcount, hires, departures), so the selection math is consistent', { skip: SKIP }, () => {
  const comps = META.entities.filter(e => e !== 'DOJ' && e !== 'DJ14');
  const byEntity = Object.fromEntries(comps.map(e => [e, rows(e)]));
  const sel = AP.selected(byEntity, comps, META), doj = rows('DOJ');
  const w = { grain: 'month', period: '2026-07' };
  for (const g of AP.GROUPS) {
    const s = sel.find(x => x.appt_group === g && x.grain === w.grain && x.period === w.period), d = doj.find(x => x.appt_group === g && x.grain === w.grain && x.period === w.period);
    for (const c of ['headcount', 'hires', 'departures']) assert.equal(s[c], d[c], g + ' ' + c);
  }
});

test('by component (panel 5): every component listed, each at its own N, compared administrations at that N', { skip: SKIP }, () => {
  const comps = META.entities.filter(e => e !== 'DOJ');
  const byEntity = Object.fromEntries(comps.map(e => [e, rows(e)]));
  const list = AP.byComponent(byEntity, comps, 'political', ['biden', 'trump1', 'obama2']);
  assert.equal(list.length, 12);
  const crs = list.find(x => x.entity === 'DJ14');
  assert.equal(crs.n, 16, 'Community Relations Service stops at Apr 2026 (D-024)');
  const sum = list.filter(x => x.entity !== 'DJ14').reduce((a, x) => a + x.value, 0) + (crs.n === 19 ? crs.value : 0);
  assert.equal(sum, 287, 'the current components sum to DOJ at N = 19');
  for (const x of list) {
    assert.equal(x.value, rawAt(x.entity, { grain: 'admin', appt_group: 'political', period: 'trump2', months_in_office: x.n }, 'headcount'), x.entity);
    assert.equal(x.at.biden.value, rawAt(x.entity, { grain: 'admin', appt_group: 'political', period: 'biden', months_in_office: x.n }, 'headcount'), x.entity + ' Biden');
  }
  assert.ok(list.some(x => x.value === 0), 'a component with none is listed, at 0');
});

test('D-088 tiles: political hires and departures with each compared administration at N (running sums over months 1 to N)', { skip: SKIP }, () => {
  const r = rows('DOJ'), n = AP.currentN(r);
  const want = {};
  for (const a of ['biden', 'trump1', 'obama2']) for (const c of ['headcount', 'hires', 'departures']) {
    const v = D.value(AP.rowAt(r, 'political', a, n), c);
    assert.equal(v, rawAt('DOJ', { grain: 'admin', appt_group: 'political', period: a, months_in_office: n }, c), a + ' ' + c);
    // a running sum: the month rows of that administration's months 1 to N add up to it (headcount is a stock, not summed)
    if (c !== 'headcount') {
      const first = A_FIRST[a], months = monthsFrom(first, n);
      assert.equal(v, months.reduce((t, m) => t + rawAt('DOJ', { grain: 'month', appt_group: 'political', period: m }, c), 0), a + ' ' + c + ' is months 1 to N summed');
    }
    want[a + '.' + c] = v;
  }
  if (META.range.last_month === '2026-07') assert.deepEqual(want, { 'biden.headcount': 242, 'biden.hires': 145, 'biden.departures': 218, 'trump1.headcount': 248, 'trump1.hires': 184, 'trump1.departures': 219,
    'obama2.headcount': 280, 'obama2.hires': 46, 'obama2.departures': 68 }, 'the DOJ figures at N = 19 as built');
});

const A_FIRST = { obama2: '2013-01', trump1: '2017-01', biden: '2021-01', trump2: '2025-01' };
function monthsFrom(first, n) { const out = []; let [y, m] = first.split('-').map(Number); for (let i = 0; i < n; i++) { out.push(y + '-' + String(m).padStart(2, '0')); m++; if (m > 12) { m = 1; y++; } } return out; }

test('D-088 admin-only file: every entity at its own N; the by-component chart reads it exactly as the entity files', { skip: SKIP || (!META.files.admin && 'no admin file') }, () => {
  const file = JSON.parse(fs.readFileSync(path.join(DIR, META.files.admin.path), 'utf8'));
  assert.equal(file.view, 'admin');
  const adminBy = AP.byEntity(D.fromCube(file));
  const ents = META.entities;
  assert.deepEqual(Object.keys(adminBy).sort(), [...ents].sort());
  for (const e of ents) assert.equal(AP.currentN(adminBy[e]), file.months_in_office[e], e);
  assert.equal(file.months_in_office.DJ14, 16);
  const comps = ents.filter(e => e !== 'DOJ'), ids = ['biden', 'trump1', 'obama2'];
  for (const g of AP.PICKER) {
    const a = AP.byComponent(adminBy, comps, g, ids), b = AP.byComponent(Object.fromEntries(comps.map(e => [e, rows(e)])), comps, g, ids);
    assert.deepEqual(a.map(x => [x.entity, x.n, x.value, ids.map(i => x.at[i] && x.at[i].value), AP.pctChange(x.row), x.row.provisional]),
      b.map(x => [x.entity, x.n, x.value, ids.map(i => x.at[i] && x.at[i].value), AP.pctChange(x.row), x.row.provisional]), g);
  }
  assert.ok(Object.keys(META.files).filter(k => k !== 'admin').every(k => ents.includes(k)), 'meta.files: the entities plus admin');
});

test('SVG export: a stacked area is a filled band down to the series below, the first down to zero', () => {
  assert.deepEqual(X.hexAlpha('#2a78d6cc'), { color: '#2a78d6', opacity: 0.8 });
  assert.deepEqual(X.hexAlpha('#2a78d6'), { color: '#2a78d6', opacity: 1 });
  const pts = ys => ys.map((y, i) => ({ x: 10 + i * 10, y }));
  const svg = X.buildSvg({ width: 200, height: 100, area: { left: 0, top: 0, right: 200, bottom: 100 }, series: [
    { label: 'A', color: '#111111', kind: 'line', points: pts([80, 70]), base: pts([100, 100]), fill: '#111111cc' },
    { label: 'B', color: '#222222', kind: 'line', points: pts([50, 40]), base: pts([80, 70]), fill: '#222222cc' }] });
  const areas = [...svg.matchAll(/<path class="opm-svg-area" d="([^"]+)" fill="([^"]+)" fill-opacity="([^"]+)"/g)];
  assert.equal(areas.length, 2);
  assert.equal(areas[1][1], 'M10 50 L20 40 L20 70 L10 80 Z');
  assert.equal(areas[1][2], '#222222'); assert.equal(areas[1][3], '0.8');
});
