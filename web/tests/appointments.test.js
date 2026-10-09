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

test('DOJ tiles at month N = 20 (spec section 5, as of the Aug 2026 data): political appointees 292, Schedule Policy/Career 106, political hires 284 and departures 276', { skip: SKIP }, () => {
  const r = rows('DOJ'), n = AP.currentN(r);
  assert.equal(n, rawAt('DOJ', { grain: 'admin', appt_group: 'all', period: 'trump2', months_in_office: n }, 'admin_months'));
  assert.equal(n, 20);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'headcount'), 292);
  assert.equal(D.value(AP.rowAt(r, 'schedule_policy', 'trump2', n), 'headcount'), 106);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'hires'), 284);
  assert.equal(D.value(AP.rowAt(r, 'political', 'trump2', n), 'departures'), 276);
  for (const [g, c] of [['political', 'headcount'], ['schedule_policy', 'headcount'], ['political', 'hires'], ['political', 'departures']])
    assert.equal(D.value(AP.rowAt(r, g, 'trump2', n), c), rawAt('DOJ', { grain: 'admin', appt_group: g, period: 'trump2', months_in_office: n }, c));
  assert.equal(AP.rowAt(r, 'political', 'trump2', n).provisional, true);
});

test('DOJ political appointees since taking office, month 20: Trump II 292 (from 257), Biden 238, Trump I 245, Obama II 279', { skip: SKIP }, () => {
  const r = rows('DOJ'), months = [0].concat(R.monthsShown(48, 'month', 20));
  assert.equal(months.length, 49);
  const at = id => AP.sinceLine(r, 'political', id, months);
  assert.equal(at('trump2').values[0], 257, 'month 0');
  assert.equal(at('trump2').values[20], 292);
  assert.equal(at('biden').values[20], 238);
  assert.equal(at('trump1').values[20], 245);
  assert.equal(at('obama2').values[20], 279);
  assert.equal(at('trump2').values[21], null, 'Trump II stops at N');
  assert.equal(at('biden').values[48], rawAt('DOJ', { grain: 'admin', appt_group: 'political', period: 'biden', months_in_office: 48 }, 'headcount'));
  assert.deepEqual(at('trump2').provisional.slice(18, 21), [true, true, true]);
  assert.equal(at('trump2').provisional[17], false);
  // the subgroups partition the group at every point
  for (const id of R.ORDER) for (const m of [0, 1, 12, 20]) {
    const sum = AP.SUBGROUPS.map(g => AP.sinceLine(r, g, id, [m]).values[0]).reduce((a, b) => a + b, 0);
    assert.equal(sum, at(id).values[m], id + ' month ' + m);
  }
});

test('change since taking office: percent only where month 0 has 30 or more (section 4); Schedule Policy/Career a count', { skip: SKIP }, () => {
  const r = rows('DOJ');
  const p = AP.rowAt(r, 'political', 'trump2', 20);
  assert.equal(p.headcount_change, 35);
  assert.ok(Math.abs(AP.pctChange(p) - 35 / 257) < 1e-12);
  const sp = AP.rowAt(r, 'schedule_policy', 'trump2', 20);
  assert.equal(sp.headcount_change, 106); assert.equal(AP.pctChange(sp), null);
  // every admin row: a percent exactly where the cube gives one
  for (const x of r.filter(x => x.grain === 'admin')) assert.equal(AP.pctChange(x) === null, x.headcount_change_pct === null, x.appt_group + ' ' + x.period + ' ' + x.months_in_office);
});

test('workforce mix: shares are headcount over all headcount; the groups (unknown included) sum to all at every month', { skip: SKIP }, () => {
  const r = rows('DOJ'), all = AP.timeline(r, 'all', 'month');
  assert.equal(all.length, 179); assert.equal(all[0].period, '2011-10'); assert.equal(all.at(-1).period, '2026-08');
  const by = g => Object.fromEntries(AP.timeline(r, g, 'month').map(x => [x.period, x]));
  const groups = Object.fromEntries(AP.GROUPS.concat(['unknown']).map(g => [g, by(g)]));
  for (const a of all) {
    const s = Object.values(groups).reduce((t, m) => t + m[a.period].headcount, 0);
    assert.equal(s, a.headcount, a.period);
  }
  const aug = groups.political['2026-08'];
  assert.equal(AP.share(aug), 292 / 107516);
  assert.equal(Math.round(AP.share(aug) * 1e4) / 1e4, aug.share, 'the cube rounds the same ratio to 4 decimals');
  assert.equal(AP.unknownAt(r, 'month', '2026-08'), 5, 'the invalid-code note (spec section 3 says 5 in Jul 2026; 5 again in Aug 2026)');
  const fy = AP.timeline(r, 'all', 'fy');
  assert.equal(fy.at(-1).period, 'FY2026'); assert.equal(fy.at(-1).partial, true);
  assert.equal(fy.at(-1).headcount, 107516, 'a year shows its last month');
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
  const comps = META.entities.filter(e => e !== 'DOJ'); // D-089: CRS included, its rows continue at 0
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
  const crs = list.find(x => x.entity === 'DJ14'), nDoj = AP.currentN(rows('DOJ'));
  assert.equal(crs.n, nDoj, 'D-089: Community Relations Service continues at 0 to the latest month, so its N is everyone\'s');
  assert.ok(list.every(x => x.n === nDoj), 'every component at the same N');
  assert.equal(crs.value, 0, 'D-089: no CRS political appointees after April 2026');
  const sum = list.reduce((a, x) => a + x.value, 0);
  assert.equal(sum, D.value(AP.rowAt(rows('DOJ'), 'political', 'trump2', nDoj), 'headcount'), 'the components sum to DOJ at N');
  if (META.range.last_month === '2026-08') assert.equal(sum, 292);
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
  if (META.range.last_month === '2026-08') assert.deepEqual(want, { 'biden.headcount': 238, 'biden.hires': 146, 'biden.departures': 226, 'trump1.headcount': 245, 'trump1.hires': 185, 'trump1.departures': 225,
    'obama2.headcount': 279, 'obama2.hires': 51, 'obama2.departures': 72 }, 'the DOJ figures at N = 20 as built (Aug 2026 data)');
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
  assert.equal(file.months_in_office.DJ14, file.months_in_office.DOJ, 'D-089: CRS at the same N as DOJ');
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

/* D-094: the Political appointees tile's line "Schedule C {sc} · Noncareer SES {ses} · Executive appointments {exec}",
   from the same rows and month as the tile value; the parts sum to it for DOJ, one component and a combination. */
test('D-094 tile parts: the three political subgroups at month N sum to the political appointees tile (DOJ, one component, a combination)', { skip: SKIP }, () => {
  const n = AP.currentN(rows('DOJ'));
  const check = (label, r) => {
    const p = AP.politicalParts(r, n), tile = D.value(AP.rowAt(r, 'political', 'trump2', n), 'headcount');
    assert.deepEqual(Object.keys(p), ['schedule_c', 'noncareer_ses', 'executive'], label);
    for (const g of AP.SUBGROUPS) assert.equal(typeof p[g], 'number', label + ' ' + g + ' is a count (0, never missing)');
    assert.equal(p.schedule_c + p.noncareer_ses + p.executive, tile, label + ': the parts sum to the tile value');
    return p;
  };
  const doj = check('DOJ', rows('DOJ'));
  for (const g of AP.SUBGROUPS) assert.equal(doj[g], rawAt('DOJ', { grain: 'admin', appt_group: g, period: 'trump2', months_in_office: n }, 'headcount'), 'DOJ ' + g);
  // the latest month: the admin row at N is the latest month's headcount
  for (const g of AP.SUBGROUPS) assert.equal(doj[g], rawAt('DOJ', { grain: 'month', appt_group: g, period: META.range.last_month }, 'headcount'), 'DOJ ' + g + ' is the latest month');
  if (META.range.last_month === '2026-08') assert.deepEqual(doj, { schedule_c: 119, noncareer_ses: 59, executive: 114 }, 'Aug 2026 (spec section 3 gives the Jul 2026 figures)');
  const comps = META.entities.filter(e => e !== 'DOJ');
  for (const e of comps) check(e, rows(e)); // one component each (some parts are 0)
  assert.ok(comps.some(e => Object.values(AP.politicalParts(rows(e), n)).includes(0)), 'a part at 0 is a 0, not missing');
  const two = AP.selected({ DJ01: rows('DJ01'), DJ09: rows('DJ09') }, ['DJ01', 'DJ09'], META), p2 = check('DJ01+DJ09', two);
  for (const g of AP.SUBGROUPS) assert.equal(p2[g], AP.politicalParts(rows('DJ01'), n)[g] + AP.politicalParts(rows('DJ09'), n)[g], 'summed across the selection: ' + g);
  const all = check('all components', AP.selected(Object.fromEntries(comps.map(e => [e, rows(e)])), comps, META));
  assert.deepEqual(all, doj, 'every component summed equals DOJ');
});

test('D-094 copy: the tile line and the political note are signed word for word and drawn in both panels and their SVG exports', () => {
  const copy = JSON.parse(fs.readFileSync(path.join(I.WEB, 'copy.json'), 'utf8'));
  assert.equal(copy.shell['appt.tile.politicalParts'], 'Schedule C {sc} · Noncareer SES {ses} · Executive appointments {exec}');
  assert.equal(copy.shell['appt.note.political'], 'Political appointees are the total of three appointment types: Schedule C, Noncareer SES and Executive appointments. Schedule Policy/Career is counted separately.');
  for (const k of ['appt.tile.politicalParts', 'appt.note.political']) assert.equal(copy.shell._status[k], 'signed', k);
  const src = fs.readFileSync(path.join(I.WEB, 'assets/js/pages/appointments.js'), 'utf8');
  assert.match(src, /copy\.t\('shell:appt\.tile\.politicalParts', \{ sc: f\(p\.schedule_c\), ses: f\(p\.noncareer_ses\), exec: f\(p\.executive\) \}\)/);
  assert.match(src, /fSince\.setNotes\(\[politicalNote\(\), /, 'first under the since-taking-office chart');
  assert.match(src, /var notes = \[politicalNote\(\), \{ text: copy\.t\('shell:appt\.mix\.note'\)/, 'first under the small multiples');
  assert.match(src, /exportNotes: true/, 'the since chart exports its notes');
  assert.match(src, /notes: \[copy\.t\('shell:appt\.note\.political'\)\], note: copy\.t\('shell:appt\.mix\.note'\)/, 'the small multiples export the note');
  // the grid export draws opts.notes then opts.note, one line each
  const base = { width: 100, height: 60, area: { left: 0, top: 0, right: 100, bottom: 60 }, series: [] };
  const svg = X.buildGridSvg([base, base], { cols: 2, title: 'T', notes: ['first'], note: 'second' });
  assert.deepEqual([...svg.matchAll(/<text class="opm-svg-note"[^>]*>([^<]*)</g)].map(m => m[1]), ['first', 'second']);
  const one = X.buildGridSvg([base], { cols: 1, note: 'only' }), H = +/height="([\d.]+)"/.exec(one)[1];
  assert.match(one, new RegExp('y="' + (H - 12) + '"[^>]*>only<'), 'a single note sits where it always did');
});
