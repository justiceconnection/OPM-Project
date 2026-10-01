'use strict';
/* Workforce Look-Up: the vendored Parquet reader against the staged files (warehouse/lookup, read only),
   and the page logic (filters, search, counts, sorting, CSV). Independent checks: lookup.meta.json,
   pipeline/crosswalks/lookup_fields.csv, pipeline/known_data_issues.csv, DuckDB, and the doj_leaving cube. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const LU = require('../assets/js/lookup.js');

const REPO = path.join(__dirname, '..', '..');
const LOOKUP = path.join(REPO, 'warehouse', 'lookup');
const meta = JSON.parse(fs.readFileSync(path.join(LOOKUP, 'lookup.meta.json'), 'utf8'));
const PQ = new Function(fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'hyparquet-bundle.js'), 'utf8') + ';return OPMParquet;')();
function buf(name) { const b = fs.readFileSync(path.join(REPO, 'warehouse', meta.files[name].path)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
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

test('the vendored reader reads the staged files: row counts equal lookup.meta.json, columns equal lookup_fields.csv', async () => {
  const fields = {};
  fs.readFileSync(path.join(REPO, 'pipeline', 'crosswalks', 'lookup_fields.csv'), 'utf8').trim().split('\n').slice(1).forEach(line => {
    const [ds, order, col] = line.split(',');
    (fields[ds] = fields[ds] || [])[+order - 1] = col;
  });
  assert.deepEqual(LU.FIELDS, fields, 'the page lists the signed columns in D-052 order');
  for (const name of ['separations', 'accessions', 'employment_FY2025', 'employment_latest']) {
    const rows = await read(name);
    assert.equal(rows.length, meta.files[name].rows, name + ' rows');
    assert.deepEqual(Object.keys(rows[0]), fields[meta.files[name].dataset], name + ' columns');
  }
  assert.equal((await read('employment_FY2025')).length, 112540);
});

test('the 39 KDI-001 rows are there as published; the page rule matches pipeline/known_data_issues.csv', async () => {
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

test('REDACTED pay in the separations file equals an independent DuckDB count', { skip: !fs.existsSync(path.join(REPO, '.venv', 'bin', 'python')) && 'no .venv/bin/python' }, async () => {
  const rows = await read('separations');
  const mine = [rows.filter(r => r.annualized_adjusted_basic_pay === 'REDACTED').length, rows.filter(r => r.annualized_adjusted_basic_pay === null).length];
  const out = execFileSync(path.join(REPO, '.venv', 'bin', 'python'), ['-c',
    "import duckdb,sys; c=duckdb.connect(); print(*c.execute(\"select count(*) filter (where annualized_adjusted_basic_pay='REDACTED'), count(*) filter (where annualized_adjusted_basic_pay is null) from read_parquet('warehouse/lookup/separations.parquet')\").fetchone())"],
    { cwd: REPO, encoding: 'utf8' }).trim().split(' ').map(Number);
  assert.deepEqual(mine, out);
  assert.equal(mine[0], 75417);
});

test('filters: attorneys (0905) in FY2025 by the month the action took effect = 3,106, as in the doj_leaving cube', async () => {
  const rows = await read('separations');
  const idx = LU.filterRows(rows, { occupation: '0905', fy: 'FY2025' }, '', null);
  const f = JSON.parse(fs.readFileSync(path.join(REPO, 'web', 'data', 'doj_leaving', 'DOJ.json'), 'utf8')), c = n => f.columns.indexOf(n);
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

test('CSV: all signed columns in D-052 order, OPM names as the header, values as published; it round-trips', async () => {
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
  // quoting: commas, quotes and line breaks survive
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
