"""Build the Workforce Look-Up files into warehouse/lookup/ (staging; promotion is pipeline/promote.py lookup).

    .venv/bin/python pipeline/build_lookup.py [seconds_budget]     (build_db.py runs it after ALL LOADED)

Invariant 10: OPM's release, never more. D-051 (container), D-052 (fields), D-053 (readings), D-054 (plain Parquet
for a small JavaScript reader).
  separations.parquet, accessions.parquet   every DOJ row of every current file, all months
  employment_FY<yyyy>.parquet                the DOJ rows of each September employment file (FY2012 on)
  employment_latest.parquet                  the DOJ rows of the latest employment file, only when it is not a
                                             September (D-052)
  lookup.meta.json                           per file: path, sha256, rows, bytes, source files and versions; the
                                             manifest hash; files_sha256 (same form as doj_leaving)
Columns: exactly pipeline/crosswalks/lookup_fields.csv, in its order, every value the published text (REDACTED kept,
nothing cast, nothing derived) except `period`, the source file's month as YYYYMM (release metadata, D-053).
Rows: DOJ per invariant 2 (department_code from Jan 2015, agency_code before). Each output reads only whole source
files, row for row; nothing links rows from different files or months.
Sort: dynamics by effective month then component, employment by component, series, grade; then every other column,
so the output bytes are deterministic.
Resumable and idempotent: a file is rewritten only when its inputs (source files and versions, the field list, the
writer settings, the text of its select) change; the meta is rewritten only when its content changes.
"""
import csv, datetime, hashlib, json, os, sys, time

T0 = time.time()
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cubes import manifest_hash, write_json   # noqa: E402

OUT = os.path.join(ROOT, 'warehouse', 'lookup')
FIELDS = os.path.join(ROOT, 'pipeline', 'crosswalks', 'lookup_fields.csv')
MANIFEST = os.path.join(ROOT, 'data', 'opm_manifest.json')
FOLDERS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
BUILD_VERSION = 1
# Plain Parquet for common JavaScript readers (D-054): format version 1 pages (PLAIN_DICTIONARY / PLAIN with RLE
# levels), standard ZSTD, row groups of about 100k rows, no bloom filters, no key-value metadata, strings as
# BYTE_ARRAY with the UTF8 annotation.
PARQUET_OPTS = "FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 100000, PARQUET_VERSION V1, WRITE_BLOOM_FILTER false"
FILE_MONTH = 'FILE_MONTH'   # lookup_fields.csv source for `period`
# Invariant 2, explicit: DOJ is the department code for files from Jan 2015 and the agency code before (a source
# file's month, YYYYMM, from its name). OPM's Oct 2026 reissue gave pre-2015 files a department code too; this form
# does not rely on that.
IS_DOJ = ("(CASE WHEN regexp_extract(filename, '_(\\d{6})_\\d+\\.parquet$', 1) >= '201501' "
          "THEN department_code ELSE agency_code END) = 'DJ'")
SORT = {'separations': ['personnel_action_effective_date_yyyymm', 'agency_subelement_code'],
        'accessions': ['personnel_action_effective_date_yyyymm', 'agency_subelement_code'],
        'employment': ['agency_subelement_code', 'occupational_series_code', 'grade']}


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def fields():
    """lookup_fields.csv -> {dataset: [(lookup_column, opm_source_column)] in order}."""
    out = {}
    for r in csv.DictReader(open(FIELDS, encoding='utf-8')):
        out.setdefault(r['dataset'], []).append((int(r['order']), r['lookup_column'], r['opm_source_column']))
    return {d: [(c, s) for _, c, s in sorted(v)] for d, v in out.items()}


def plan():
    """[(name, dataset, [manifest records])] for every file the Look-Up should hold (D-052)."""
    man = json.load(open(MANIFEST))
    by = {ds: sorted((x for x in man if x['dataset'] == ds), key=lambda x: (int(x['year']), int(x['month']))) for ds in FOLDERS}
    out = [('separations', 'separations', by['separations']), ('accessions', 'accessions', by['accessions'])]
    emp = by['employment']
    for x in emp:
        if int(x['month']) == 9:
            out.append((f"employment_FY{int(x['year'])}", 'employment', [x]))
    if emp and int(emp[-1]['month']) != 9:
        out.append(('employment_latest', 'employment', [emp[-1]]))
    return out


def select_sql(con, dataset, recs, cols):
    """The select for one output: the listed source columns of the DOJ rows of whole source files."""
    paths = [os.path.join(ROOT, 'data', FOLDERS[dataset], f"{x['filename']}.parquet") for x in recs]
    lst = '[' + ', '.join(f"'{p}'" for p in paths) + ']'
    src = f"read_parquet({lst}, union_by_name=true, filename=true)"
    names = {r[0] for r in con.execute(f"SELECT DISTINCT name FROM parquet_schema({lst})").fetchall()}
    for need in ('department_code', 'agency_code'):
        if need not in names:
            sys.exit(f'lookup NOT built: {need} is not a column of the {dataset} files (invariant 2 needs it)')
    parts = []
    for col, source in cols:
        if source == FILE_MONTH:
            parts.append(f"regexp_extract(filename, '_(\\d{{6}})_\\d+\\.parquet$', 1) AS {col}")
        else:
            if source not in names:
                sys.exit(f'lookup NOT built: {source} is not a column of the {dataset} files')
            parts.append(f'{source} AS {col}' if source != col else col)
    keys = SORT[dataset] + [c for c, _ in cols if c not in SORT[dataset]]
    return f"SELECT {', '.join(parts)} FROM {src} WHERE {IS_DOJ} ORDER BY {', '.join(keys)}"


def remove_stale(keep):
    """D-058: delete this script's own outputs in warehouse/lookup/ that are not in the current plan (a .parquet
    whose name is not kept, or a leftover .parquet.tmp), printing each removal. Nothing else is touched."""
    for f in sorted(os.listdir(OUT)):
        stale = (f.endswith('.parquet') and f[:-len('.parquet')] not in keep) or f.endswith('.parquet.tmp')
        if stale:
            os.remove(os.path.join(OUT, f))
            print(f'lookup: removed stale {os.path.relpath(os.path.join(OUT, f), ROOT)} (D-058)')


def files_digest(files):
    lines = ''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path']))
    return hashlib.sha256(lines.encode()).hexdigest()


def build(budget=140.0):
    """Write every planned file whose inputs changed, within the time budget. Returns the number still to do."""
    import duckdb
    os.makedirs(OUT, exist_ok=True)
    flds, fields_sha = fields(), sha(FIELDS)
    meta_path = os.path.join(OUT, 'lookup.meta.json')
    old = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    old_files = old.get('files', {})
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'; SET preserve_insertion_order=true")
    files, todo = {}, 0
    for name, dataset, recs in plan():
        sources = [{'file': x['filename'], 'version': int(x['version'])} for x in recs]
        sql = select_sql(con, dataset, recs, flds[dataset])   # its text is part of the inputs: a query change rebuilds
        inputs = hashlib.sha256(json.dumps([sources, fields_sha, PARQUET_OPTS, BUILD_VERSION, sql], sort_keys=True).encode()).hexdigest()
        path = os.path.join(OUT, f'{name}.parquet')
        prev = old_files.get(name)
        if prev and prev.get('inputs_sha256') == inputs and os.path.exists(path) and sha(path) == prev.get('sha256'):
            files[name] = prev
            continue
        if time.time() - T0 > budget:
            todo += 1
            continue
        tmp = path + '.tmp'
        con.execute(f"COPY ({sql}) TO '{tmp}' ({PARQUET_OPTS})")
        os.replace(tmp, path)
        rows = con.execute(f"SELECT count(*) FROM read_parquet('{path}')").fetchone()[0]
        files[name] = {'path': f'lookup/{name}.parquet', 'dataset': dataset, 'sha256': sha(path), 'rows': rows,
                       'bytes': os.path.getsize(path), 'sources': sources, 'inputs_sha256': inputs}
        print(f'lookup: wrote {name}.parquet ({rows:,} rows, {os.path.getsize(path):,} bytes)')
    con.close()
    remove_stale({n for n, _, _ in plan()})   # every planned name is kept, built this run or not
    meta = {'set': 'lookup', 'files': files, 'files_sha256': files_digest(files),
            'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
            'complete': todo == 0,
            'manifest_sha256': manifest_hash(),
            'fields_file': {'path': 'pipeline/crosswalks/lookup_fields.csv', 'sha256': fields_sha},
            'parquet': {'writer_options': PARQUET_OPTS, 'format_version': 1, 'compression': 'ZSTD',
                        'row_group_rows': 100000, 'bloom_filters': False, 'string_type': 'BYTE_ARRAY UTF8'},
            'decisions': ['D-051', 'D-052', 'D-053', 'D-054'], 'built_at': None}
    if old and {k: v for k, v in old.items() if k != 'built_at'} == {k: v for k, v in meta.items() if k != 'built_at'}:
        print(f'lookup: unchanged ({len(files)} files); meta kept, built_at {old["built_at"]}')
        return todo
    meta['built_at'] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    write_json(meta_path, meta)
    print(f'lookup: {len(files)} files, {todo} remaining' + ('  ALL BUILT' if todo == 0 else ''))
    return todo


if __name__ == '__main__':
    os.chdir(ROOT)
    build(float(sys.argv[1]) if len(sys.argv) > 1 else 140.0)
