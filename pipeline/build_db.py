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
  doj_monthly      headcount / accessions / separations per month
Typing rules
  * 'REDACTED' is kept distinct from NULL: numeric/date fields get a <col>_redacted flag.
  * DOJ = department_code 'DJ' (2015+) or agency_code 'DJ' (pre-2015 files lack department_code).
"""
import duckdb, json, os, sys, time
T0 = time.time(); BUDGET = float(sys.argv[1]) if len(sys.argv) > 1 else 140
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)  # views store paths relative to the project root; open the DB from here
DB = os.path.join('warehouse', 'opm.duckdb')
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

con.execute("""CREATE OR REPLACE VIEW doj_monthly AS
  WITH e AS (SELECT period, count(*) headcount FROM doj_employment GROUP BY 1),
       a AS (SELECT period, count(*) accessions FROM doj_accessions GROUP BY 1),
       s AS (SELECT period, count(*) separations FROM doj_separations GROUP BY 1)
  SELECT e.period, headcount, accessions, separations, accessions - separations AS net_flow
  FROM e LEFT JOIN a USING (period) LEFT JOIN s USING (period) ORDER BY period""")
con.execute("CHECKPOINT"); con.close()
left = len(todo) - done
print(f"loaded {done} files this run in {time.time()-T0:.0f}s; {left} remaining" + ("  ALL LOADED" if left == 0 else ""))
