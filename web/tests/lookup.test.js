'use strict';
/* Workforce Look-Up: the vendored Parquet reader against the real files (read only: the staged warehouse/lookup
   when present, else the promoted web/data/lookup), and the page logic (filters, search, counts, sorting, CSV).
   Independent checks: lookup.meta.json, pipeline/crosswalks/lookup_fields.csv, pipeline/known_data_issues.csv,
   DuckDB (local .venv only) and the doj_leaving cube. Tests that need files skip when they are absent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const LU = require('../assets/js/lookup.js');

const INPUTS = require('./_inputs.js');
const REPO = INPUTS.REPO;
const LK = INPUTS.lookup();
const SKIP = !LK && 'no Look-Up files (warehouse/lookup or web/data/lookup)';
const meta = LK ? JSON.parse(fs.readFileSync(LK.meta, 'utf8')) : { files: {} };
const CUBES = INPUTS.cubesDir();
const PQ = new Function(fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'hyparquet-bundle.js'), 'utf8') + ';return OPMParquet;')();
function buf(name) { const b = fs.readFileSync(path.join(LK.base, meta.files[name].path)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
const cache = {};
async function read(name) { return cache[name] || (cache[name] = await PQ.parquetReadObjects({ file: buf(name), compressors: PQ.compressors })); }
function csvRows(text) { // RFC 4180 parser, for the round trip
  const out = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(f); out.push(row); row = []; f = ''; i++; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); out.push(row); }
  return out;
}

test('the signed columns are listed in D-052 order (lookup_fields.csv)', () => {
  const fields = {};
  fs.readFileSync(path.join(REPO, 'pipeline', 'crosswalks', 'lookup_fields.csv'), 'utf8').trim().split('\n').slice(1).forEach(line => {
    const [ds, order, col] = line.split(',');
    (fields[ds] = fields[ds] || [])[+order - 1] = col;
  });
  assert.deepEqual(LU.FIELDS, fields);
});

test('the vendored reader reads the files: row counts equal lookup.meta.json, columns equal lookup_fields.csv', { skip: SKIP }, async () => {
  const fields = LU.FIELDS;
  for (const name of ['separations', 'accessions', 'employment_FY2025', 'employment_latest']) {
    const rows = await read(name);
    assert.equal(rows.length, meta.files[name].rows, name + ' rows');
    assert.deepEqual(Object.keys(rows[0]), fields[meta.files[name].dataset], name + ' columns');
  }
  assert.equal((await read('employment_FY2025')).length, 112540);
});

test('the 39 KDI-001 rows are there as published; the page rule matches pipeline/known_data_issues.csv', { skip: SKIP }, async () => {
  const kdiLine = fs.readFileSync(path.join(REPO, 'pipeline', 'known_data_issues.csv'), 'utf8').split('\n').find(l => l.startsWith('KDI-001,'));
  const [, ds, field, first, last, min, max] = kdiLine.split(',');
  assert.deepEqual([LU.KDI_001.dataset, LU.KDI_001.field, LU.KDI_001.firstFile, LU.KDI_001.lastFile, LU.KDI_001.min, LU.KDI_001.max],
    [ds, field, first.replace('-', ''), last.replace('-', ''), +min, +max]);
  const rows = await read('separations');
  const kdi = rows.filter(r => LU.isKdi001('separations', r));
  assert.equal(kdi.length, 39);
  assert.ok(kdi.every(r => +r.length_of_service_years >= 124 && +r.length_of_service_years <= 126 && r.period >= '202406' && r.period <= '202507'));
  assert.ok(kdi.every(r => /^\d+\.\d$/.test(r.length_of_service_years)), 'values as published text');
  assert.equal(LU.isKdi001('accessions', kdi[0]), false);
});

test('REDACTED pay in the separations file equals an independent DuckDB count', { skip: SKIP || (!INPUTS.venvPython() && 'no .venv/bin/python (local only)') }, async () => {
  const rows = await read('separations');
  const mine = [rows.filter(r => r.annualized_adjusted_basic_pay === 'REDACTED').length, rows.filter(r => r.annualized_adjusted_basic_pay === null).length];
  const file = path.join(LK.base, meta.files.separations.path);
  const out = execFileSync(INPUTS.venvPython(), ['-c',
    "import duckdb,sys; c=duckdb.connect(); print(*c.execute(\"select count(*) filter (where annualized_adjusted_basic_pay='REDACTED'), count(*) filter (where annualized_adjusted_basic_pay is null) from read_parquet(?)\", [sys.argv[1]]).fetchone())", file],
    { cwd: REPO, encoding: 'utf8' }).trim().split(' ').map(Number);
  assert.deepEqual(mine, out);
  assert.equal(mine[0], 75417);
});

test('filters: attorneys (0905) in FY2025 by the month the action took effect = 3,106, as in the doj_leaving cube', { skip: SKIP || (!CUBES && 'no doj_leaving') }, async () => {
  const rows = await read('separations');
  const idx = LU.filterRows(rows, { occupation: '0905', fy: 'FY2025' }, '', null);
  const f = JSON.parse(fs.readFileSync(path.join(CUBES, 'doj_leaving', 'DOJ.json'), 'utf8')), c = n => f.columns.indexOf(n);
  const cube = f.rows.find(r => r[c('grain')] === 'fy' && r[c('period')] === 'FY2025' && r[c('dimension')] === 'occupation' && r[c('value')] === '0905');
  assert.equal(idx.length, cube[c('departures')]);
  assert.equal(idx.length, 3106);
  assert.equal(LU.fyOf('202410'), 'FY2025');
  assert.equal(LU.fyOf('202509'), 'FY2025');
  assert.equal(LU.fyOf('REDACTED'), null);
});

test('options, search, counts and sorting', () => {
  const rows = [
    { agency_subelement_code: 'DJ02', occupational_series_code: '1811', grade: '13', personnel_action_effective_date_yyyymm: '202410', annualized_adjusted_basic_pay: '120000', occupational_series: 'CRIMINAL INVESTIGATION' },
    { agency_subelement_code: 'DJ03', occupational_series_code: '0007', grade: '9', personnel_action_effective_date_yyyymm: '202309', annualized_adjusted_basic_pay: 'REDACTED', occupational_series: 'CORRECTIONAL OFFICER' },
    { agency_subelement_code: 'DJ02', occupational_series_code: '0905', grade: '15', personnel_action_effective_date_yyyymm: '202501', annualized_adjusted_basic_pay: null, occupational_series: 'GENERAL ATTORNEY' },
    { agency_subelement_code: 'DJ09', occupational_series_code: '0303', grade: 'REDACTED', personnel_action_effective_date_yyyymm: '202502', annualized_adjusted_basic_pay: '64000', occupational_series: 'MISCELLANEOUS CLERK' }
  ];
  const names = { DJ02: 'FBI', DJ03: 'BOP', DJ09: 'EOUSA and USAOs' };
  const opts = LU.filterOptions(rows, 'separations', (k, v) => (k === 'component' ? names[v] : v));
  assert.deepEqual(opts.occupation, ['0905', '1811', '0007', '0303']); // D-043, then by number
  assert.deepEqual([' ', '0303', '1811', '0905'].sort(LU.seriesOrder), ['0905', '1811', '0303', ' ']); // a published ' ' (NO DATA REPORTED) goes last
  assert.deepEqual(opts.component, ['DJ03', 'DJ09', 'DJ02']); // by display name
  assert.deepEqual(opts.fy, ['FY2025', 'FY2023']);
  assert.deepEqual(opts.grade, ['9', '13', '15', 'REDACTED']);
  const cols = [{ field: 'occupational_series' }];
  const index = LU.searchIndex(rows, cols, (r, c) => r[c.field]);
  assert.deepEqual(LU.filterRows(rows, {}, 'attorney', index), [2]);
  assert.deepEqual(LU.filterRows(rows, {}, '  CRIMINAL ', index), [0]);
  assert.deepEqual(LU.filterRows(rows, { component: 'DJ02' }, '', index), [0, 2]);
  assert.deepEqual(LU.filterRows(rows, { component: 'DJ02', fy: 'FY2025' }, 'general', index), [2]);
  const g = LU.groupCounts(rows, [0, 1, 2, 3], 'component');
  assert.deepEqual(g.map(x => [x.value, x.count]), [['DJ02', 2], ['DJ03', 1], ['DJ09', 1]]);
  assert.equal(g.reduce((a, x) => a + x.count, 0), 4);
  assert.deepEqual(LU.sortIndexes(rows, [0, 1, 2, 3], 'grade', 'asc'), [1, 0, 2, 3]);
  assert.deepEqual(LU.sortIndexes(rows, [0, 1, 2, 3], 'grade', 'desc'), [3, 2, 0, 1]); // REDACTED is text: after numbers ascending, first descending
  assert.deepEqual(LU.sortIndexes(rows, [0, 1, 2, 3], 'annualized_adjusted_basic_pay', 'asc'), [3, 0, 1, 2]); // empty last
  const pg = LU.page([...Array(120).keys()], 3, 50);
  assert.deepEqual([pg.page, pg.pages, pg.rows.length, pg.rows[0]], [3, 3, 20, 100]);
  assert.equal(LU.page([], 1, 50).pages, 1);
});

test('CSV: all signed columns in D-052 order, OPM names as the header, values as published; it round-trips', { skip: SKIP }, async () => {
  const rows = await read('separations');
  const idx = LU.filterRows(rows, { occupation: '0905', fy: 'FY2025' }, '', null);
  const csv = LU.toCsv('separations', rows, idx);
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.charCodeAt(0), 0xfeff, 'starts with a UTF-8 byte-order mark');
  assert.equal(Buffer.from(csv, 'utf8').subarray(0, 3).toString('hex'), 'efbbbf');
  const parsed = csvRows(csv.slice(1)); // the mark is not part of the header or any value
  assert.deepEqual(parsed[0], LU.FIELDS.separations);
  assert.equal(parsed.length - 1, idx.length);
  parsed.slice(1).forEach((line, k) => {
    const r = rows[idx[k]];
    assert.deepEqual(line, LU.FIELDS.separations.map(f => (r[f] === null ? '' : r[f])), 'row ' + k);
  });
});

test('CSV quoting: commas, quotes and line breaks survive; file names', () => {
  const tricky = [{ agency_subelement_code: 'DJ01', agency_subelement: 'OFFICES, BOARDS AND DIVISIONS', occupational_series: 'A "B"\nC' }];
  const trickyCsv = LU.toCsv('employment', tricky, [0]);
  assert.equal(trickyCsv[0], LU.BOM);
  const back = csvRows(trickyCsv.slice(1));
  assert.equal(back[1][LU.FIELDS.employment.indexOf('agency_subelement')], 'OFFICES, BOARDS AND DIVISIONS');
  assert.equal(back[1][LU.FIELDS.employment.indexOf('occupational_series')], 'A "B"\nC');
  assert.equal(LU.csvName('separations', null), 'doj-separations-all-filtered.csv');
  assert.equal(LU.csvName('employment', 'FY2025'), 'doj-employment-FY2025-filtered.csv');
});

test('no SQL and one file at a time in the page code (invariant 10)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pages', 'workforce-lookup.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'lookup.js'), 'utf8');
  assert.ok(!/\bJOIN\b/.test(src) && !/\bSELECT\b/.test(src) && !/\bjoin\s+[\w."']+\s+(?:as\s+\w+\s+)?(?:on|using)\b/i.test(src));
  assert.equal((src.match(/parquetReadObjects\(/g) || []).length, 1, 'one read call, for the chosen file');
});

/* ---- Appointment type filter (D-095). The mapping must equal pipeline/crosswalks/appointment_groups.csv exactly. */
const AG = require('../assets/js/appointment-groups.js');
function crosswalk() { // parsed here with the test's own CSV reader, not the generator's
  const text = fs.readFileSync(path.join(REPO, 'pipeline', 'crosswalks', 'appointment_groups.csv'), 'utf8').replace(/\r?\n/g, '\r\n');
  const [head, ...rows] = csvRows(text).filter(r => r.some(v => v !== ''));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const XW = crosswalk();
const XW_GROUP_LABELS = g => XW.filter(r => r.group === g).map(r => r.opm_label);

test('appointment-groups.js equals the crosswalk exactly: groups in group_order, labels in row order, INVALID on its own', () => {
  const shown = XW.filter(r => r.display_label);
  const order = [...new Set(shown.sort((a, b) => +a.group_order - +b.group_order).map(r => r.group))];
  assert.deepEqual(AG.groups.map(g => g.group), order);
  assert.deepEqual(AG.groups.map(g => g.group), ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy']); // D-086 order
  for (const g of AG.groups) assert.deepEqual(g.labels, XW.filter(r => r.display_label && r.group === g.group).map(r => r.opm_label), g.group);
  assert.deepEqual(AG.unknown, XW.filter(r => !r.display_label).map(r => r.opm_label));
  assert.deepEqual(AG.unknown, ['INVALID']);
  const all = AG.groups.flatMap(g => g.labels).concat(AG.unknown);
  assert.equal(all.length, XW.length, 'every crosswalk row, once');
  assert.equal(new Set(all).size, all.length, 'no label twice');
  // Political appointees = Schedule C + Noncareer SES + Executive (codes 44, 55, 46, 36)
  assert.deepEqual(XW.filter(r => r.group === 'political').map(r => r.code).sort(), ['36', '44', '46', '55']);
  assert.deepEqual(AG.groups.find(g => g.group === 'political').labels, XW_GROUP_LABELS('political'));
  assert.ok(all.includes('NONPERMANENT (COMPETITTIVE SERVICE NONPERMANENT)'), 'OPM spelling kept as published');
  for (const l of all) assert.equal(LU.appointmentGroupOf(l), l === 'INVALID' ? null : XW.find(r => r.opm_label === l).group, l);
  // the generator agrees with the file on disk
  execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build-appointment-groups.js'), '--check'], { encoding: 'utf8' });
});

test('appointment groups: each shown group has its signed label (shell appt.group.*), used by the page', () => {
  const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'copy.json'), 'utf8'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'pages', 'workforce-lookup.js'), 'utf8');
  for (const g of AG.groups) {
    const key = 'appt.group.' + g.group.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const row = XW.find(r => r.group === g.group);
    assert.equal(copy.shell[key], row.display_label, key + ' = the crosswalk display label');
    assert.equal(copy.shell._status[key], 'signed', key);
    assert.match(src, new RegExp(g.group + ": copy\\.t\\('shell:" + key.replace(/\./g, '\\.') + "'\\)"), 'the page labels ' + g.group);
  }
  assert.equal(copy.pages['workforce-lookup']['ctl.filter.appointment'], 'Appointment type');
  assert.equal(copy.pages['workforce-lookup']._status['ctl.filter.appointment'], 'signed');
});

test('appointment options: groups present in order, each followed by its labels (nested), then the labels with no group', () => {
  const present = ['INVALID', 'ZZ NOT IN THE CROSSWALK', 'EXECUTIVE (EXCEPTED SERVICE NONPERMANENT)', 'CAREER (COMPETITIVE SERVICE PERMANENT)', 'SCHEDULE C (EXCEPTED SERVICE NONPERMANENT)'];
  const opts = LU.appointmentOptions(present);
  assert.deepEqual(opts.map(o => [o.value, o.nested]), [
    ['group:career', false], ['CAREER (COMPETITIVE SERVICE PERMANENT)', true],
    ['group:political', false], ['SCHEDULE C (EXCEPTED SERVICE NONPERMANENT)', true], ['EXECUTIVE (EXCEPTED SERVICE NONPERMANENT)', true],
    ['INVALID', false], ['ZZ NOT IN THE CROSSWALK', false]]);
  assert.deepEqual(LU.FILTERS.separations.slice(-2), ['supervisory', 'appointment']);
  assert.deepEqual(LU.FILTERS.accessions.slice(-2), ['supervisory', 'appointment']);
  assert.deepEqual(LU.FILTERS.employment.slice(-2), ['supervisory', 'appointment']);
  const rows = present.map(v => ({ appointment_type: v })).concat([{ appointment_type: null }]);
  assert.deepEqual(LU.filterRows(rows, { appointment: 'group:political' }, '', null), [2, 4]);
  assert.deepEqual(LU.filterRows(rows, { appointment: 'EXECUTIVE (EXCEPTED SERVICE NONPERMANENT)' }, '', null), [2]);
  assert.deepEqual(LU.filterRows(rows, { appointment: 'INVALID' }, '', null), [0]);
  assert.deepEqual(LU.filterRows(rows, { appointment: 'group:ses' }, '', null), []);
  assert.deepEqual(LU.filterOptions(rows, 'employment', v => v).appointment, ['CAREER (COMPETITIVE SERVICE PERMANENT)', 'SCHEDULE C (EXCEPTED SERVICE NONPERMANENT)',
    'EXECUTIVE (EXCEPTED SERVICE NONPERMANENT)', 'INVALID', 'ZZ NOT IN THE CROSSWALK']);
});

test('appointment groups on the real files: a group filter = the sum of its types = a raw count of its crosswalk labels; every row in one entry', { skip: SKIP }, async () => {
  for (const name of ['separations', 'accessions', 'employment_FY2025', 'employment_latest']) {
    const rows = await read(name), ds = meta.files[name].dataset;
    const opts = LU.filterOptions(rows, ds, v => v).appointment;
    let groupsTotal = 0;
    for (const g of AG.groups) {
      const n = LU.filterRows(rows, { appointment: 'group:' + g.group }, '', null).length;
      const types = opts.filter(v => LU.appointmentGroupOf(v) === g.group).reduce((a, v) => a + LU.filterRows(rows, { appointment: v }, '', null).length, 0);
      const raw = rows.filter(r => XW_GROUP_LABELS(g.group).includes(r.appointment_type)).length;
      assert.equal(n, types, name + ' ' + g.group + ' = sum of its types');
      assert.equal(n, raw, name + ' ' + g.group + ' = raw count');
      groupsTotal += n;
    }
    const alone = opts.filter(v => !LU.appointmentGroupOf(v)).reduce((a, v) => a + LU.filterRows(rows, { appointment: v }, '', null).length, 0);
    const empty = rows.filter(r => LU.isEmpty(r.appointment_type)).length;
    assert.equal(groupsTotal + alone + empty, rows.length, name + ': groups + labels on their own + empty = all rows');
  }
  const sep = await read('separations');
  assert.equal(LU.filterRows(sep, { appointment: 'group:political' }, '', null).length, 1175); // 470 Executive + 369 Schedule C + 336 Noncareer SES
});

test('Political appointees in web/data/lookup/separations.parquet equals an independent DuckDB count of the four labels', { skip: (!INPUTS.venvPython() && 'no .venv/bin/python (local only)') || (!fs.existsSync(path.join(REPO, 'web', 'data', 'lookup', 'separations.parquet')) && 'no promoted Look-Up') }, async () => {
  const file = path.join(REPO, 'web', 'data', 'lookup', 'separations.parquet');
  const b = fs.readFileSync(file);
  const rows = await PQ.parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), compressors: PQ.compressors });
  const mine = LU.filterRows(rows, { appointment: 'group:political' }, '', null).length;
  const labels = XW_GROUP_LABELS('political');
  const out = +execFileSync(INPUTS.venvPython(), ['-c',
    "import duckdb,sys,json; c=duckdb.connect(); print(c.execute('select count(*) from read_parquet(?) where appointment_type in (select unnest(?::varchar[]))', [sys.argv[1], json.loads(sys.argv[2])]).fetchone()[0])",
    file, JSON.stringify(labels)], { cwd: REPO, encoding: 'utf8' }).trim();
  assert.equal(mine, out);
  assert.equal(mine, 1175);
});
