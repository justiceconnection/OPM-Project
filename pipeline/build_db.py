"""Build / incrementally update opm.duckdb from the OPM FWD Parquet files.

Run from anywhere, repeatedly, until it prints ALL LOADED:   python3 pipeline/build_db.py [seconds_budget]
Query the DB with the working directory set to the project root: its views use relative paths (data/...).
Only files not yet loaded (or whose version changed) are processed, so it is also the monthly-refresh command.

Objects
  files            manifest of every source file (opm_manifest.json)
  load_log         which source files have been loaded into the doj_* tables
  raw_<ds>         views straight over the Parquet files (all text, as published)
  <ds>             typed government-wide views (read Parquet on the fly)
  doj_<ds>         materialized DOJ-only tables (typed)
  doj_monthly      per snapshot month: headcount; accessions, separations (by effective month), net flow,
                   separation and accession categories from pipeline/crosswalks/, DRP overlay
  warehouse/cubes/ aggregate cubes, built by pipeline/build_cubes.py once every file is loaded
Typing rules
  * 'REDACTED' is kept distinct from NULL: numeric/date fields get a <col>_redacted flag.
  * DOJ = department_code 'DJ' (2015+) or agency_code 'DJ' (pre-2015 files lack department_code).
"""
import csv, duckdb, json, os, sys, time
T0 = time.time(); BUDGET = float(sys.argv[1]) if len(sys.argv) > 1 else 140
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)  # views store paths relative to the project root; open the DB from here
DB = os.path.join('warehouse', 'opm.duckdb')
XW = os.path.join('pipeline', 'crosswalks')
DATASETS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
NUMERIC = {'count': 'INTEGER', 'annualized_adjusted_basic_pay': 'DOUBLE', 'length_of_service_years': 'DOUBLE'}
DATES = ['service_computation_date_leave', 'appointment_not_to_exceed_date']
YYYYMM = ['snapshot_yyyymm', 'personnel_action_effective_date_yyyymm']

con = duckdb.connect(DB)
con.execute("SET preserve_insertion_order=false; SET memory_limit='2GB'")
man = os.path.join('data', 'opm_manifest.json')
m = json.load(open(man))
con.execute("CREATE OR REPLACE TABLE files AS SELECT *, make_date(CAST(year AS INT), CAST(month AS INT), 1) AS period FROM read_json_auto(?)", [man])
con.execute("CREATE TABLE IF NOT EXISTS load_log (dataset VARCHAR, source_file VARCHAR, doj_rows BIGINT, loaded_at TIMESTAMP)")

def typed_select(ds):
    cols = [r[0] for r in con.execute(f"DESCRIBE raw_{ds}").fetchall() if r[0] != 'filename']
    sel = []
    for c in cols:
        if c in NUMERIC:
            sel.append(f"TRY_CAST(NULLIF({c},'REDACTED') AS {NUMERIC[c]}) AS {c}")
            if c != 'count': sel.append(f"({c} = 'REDACTED') AS {c}_redacted")
        elif c in DATES:
            sel += [f"TRY_CAST(NULLIF({c},'REDACTED') AS DATE) AS {c}", f"({c} = 'REDACTED') AS {c}_redacted"]
        elif c in YYYYMM:
            sel += [c, f"TRY_STRPTIME({c}, '%Y%m')::DATE AS {c.replace('_yyyymm','')}_month"]
        else:
            sel.append(c)
    dept = "coalesce(department_code, agency_code)"
    return f"""SELECT
        make_date(CAST(substr(regexp_extract(filename, '_(\\d{{6}})_\\d+\\.parquet$', 1),1,4) AS INT),
                  CAST(substr(regexp_extract(filename, '_(\\d{{6}})_\\d+\\.parquet$', 1),5,2) AS INT), 1) AS period,
        CAST(regexp_extract(filename, '_(\\d+)\\.parquet$', 1) AS INT) AS file_version,
        regexp_extract(filename, '([^/]+)\\.parquet$', 1) AS source_file,
        ({dept} = 'DJ') AS is_doj,
        {', '.join(sel)}"""

for ds, folder in DATASETS.items():
    pq = os.path.join('data', folder, f'{ds}_*.parquet')
    con.execute(f"CREATE OR REPLACE VIEW raw_{ds} AS SELECT * FROM read_parquet('{pq}', union_by_name=true, filename=true)")
    sel = typed_select(ds)
    con.execute(f"CREATE OR REPLACE VIEW {ds} AS {sel} FROM raw_{ds}")
    con.execute(f"CREATE TABLE IF NOT EXISTS doj_{ds} AS SELECT * FROM {ds} WHERE false")

def partition(con, xw_file, table, code_col, prefix):
    """Crosswalk -> {column: [codes]}. A decided category becomes <prefix>_<category>; a code whose grouping is
    still pending_signoff stays its own column <prefix>_code_<code>. Exits if a code in the data is unmapped."""
    xw = list(csv.DictReader(open(os.path.join(XW, xw_file))))
    data_codes = {str(r[0]) for r in con.execute(f"SELECT DISTINCT {code_col} FROM {table}").fetchall()}
    missing = sorted(data_codes - {r['code'] for r in xw})
    if missing:
        con.close(); sys.exit(f"doj_monthly NOT rebuilt: {code_col} values missing from {xw_file}: {missing}")
    groups = {}
    for r in xw:
        col = f"{prefix}_{r['proposed_category']}" if r['status'] == 'decided' else f"{prefix}_code_{r['code'].lower()}"
        groups.setdefault(col, []).append(r['code'])
    return groups

def build_monthly(con):
    """doj_monthly, rebuilt in full on every run (idempotent). One row per employment snapshot month.
    Headcount is the snapshot month's stock; accessions and separations are counted by
    personnel_action_effective_date_month (invariant 6); net_flow = accessions - separations (invariant 7).
    acc_* and sep_* columns partition accessions and separations per the crosswalks (D-015).
    sep_drp is an overlay (drp_indicator = 'Y'), not part of the partition. The newest 3 months are provisional.
    Actions effective before the first snapshot month fall outside the table (D-017); the gate reports how many."""
    sep = partition(con, 'separation_codes.csv', 'doj_separations', 'separation_category_code', 'sep')
    acc = partition(con, 'accession_codes.csv', 'doj_accessions', 'accession_category_code', 'acc')
    filt = lambda code_col, g: ', '.join(
        f"count(*) FILTER (WHERE {code_col} IN ({', '.join(repr(c) for c in cs)})) AS {col}" for col, cs in g.items())
    out = lambda g: ', '.join(f"coalesce({col}, 0) AS {col}" for col in g)
    E = 'personnel_action_effective_date_month'
    if con.execute("SELECT count(*) FROM duckdb_views() WHERE view_name = 'doj_monthly'").fetchone()[0]:
        con.execute("DROP VIEW doj_monthly")
    con.execute(f"""CREATE OR REPLACE TABLE doj_monthly AS
      WITH e AS (SELECT snapshot_month AS month, count(*) AS headcount FROM doj_employment GROUP BY 1),
           a AS (SELECT {E} AS month, count(*) AS accessions, {filt('accession_category_code', acc)}
                 FROM doj_accessions GROUP BY 1),
           s AS (SELECT {E} AS month, count(*) AS separations, {filt('separation_category_code', sep)},
                        count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp
                 FROM doj_separations GROUP BY 1)
      SELECT e.month, 'effective' AS time_basis,
             (row_number() OVER (ORDER BY e.month DESC) <= 3) AS provisional,
             headcount, coalesce(accessions, 0) AS accessions, coalesce(separations, 0) AS separations,
             coalesce(accessions, 0) - coalesce(separations, 0) AS net_flow,
             {out(sep)}, coalesce(sep_drp, 0) AS sep_drp, {out(acc)}
      FROM e LEFT JOIN a USING (month) LEFT JOIN s USING (month) ORDER BY e.month""")


todo = []
loaded = {(r[0], r[1]) for r in con.execute("SELECT dataset, source_file FROM load_log").fetchall()}
for x in sorted(m, key=lambda x: (x['dataset'], x['filename'])):
    if (x['dataset'], x['filename']) not in loaded: todo.append(x)
# drop rows from superseded versions of the same month (monthly refresh case)
current = {x['filename'] for x in m}
for ds, sf in list(loaded):
    if sf not in current:
        con.execute(f"DELETE FROM doj_{ds} WHERE source_file = ?", [sf]); con.execute("DELETE FROM load_log WHERE source_file = ?", [sf])
        print('removed superseded', sf)

done = 0
for x in todo:
    if time.time() - T0 > BUDGET: break
    ds, fn = x['dataset'], x['filename']
    con.execute(f"INSERT INTO doj_{ds} BY NAME SELECT * FROM {ds} WHERE source_file = '{fn}' AND is_doj")
    n = con.execute(f"SELECT count(*) FROM doj_{ds} WHERE source_file = ?", [fn]).fetchone()[0]
    con.execute("INSERT INTO load_log VALUES (?, ?, ?, now())", [ds, fn, n])
    done += 1

build_monthly(con)
left = len(todo) - done
if left == 0:  # cubes only from a fully loaded DB (pipeline/build_cubes.py; staged in warehouse/cubes/)
    import build_cubes
    build_cubes.build(con)
con.execute("CHECKPOINT"); con.close()
print(f"loaded {done} files this run in {time.time()-T0:.0f}s; {left} remaining" + ("  ALL LOADED" if left == 0 else ""))
