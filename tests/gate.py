"""OPM-Project gate. Run from anywhere: python3 tests/gate.py
Each check guards an invariant in .claude/skills/opm-invariants/SKILL.md or a rule in CLAUDE.md.
Prints PASS/FAIL per check and "N of M checks pass"; exits 1 if any check fails.
Checks marked PLANNED guard things not built yet; they must be implemented before that thing ships."""
import json, os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
DB = 'warehouse/opm.duckdb'
DATASETS = {'employment': 'Employment', 'accessions': 'Accessions', 'separations': 'Separations'}
RESULTS = []

def check(name, guards):
    def wrap(fn):
        t = time.time()
        try:
            ok, detail = fn()
        except Exception as e:  # a check that cannot run is a failure, not a skip
            ok, detail = False, f'error: {e}'
        RESULTS.append((name, ok))
        print(f"{'PASS' if ok else 'FAIL'}  {name:28s} [{guards}] {detail} ({time.time() - t:.1f}s)")
        return fn
    return wrap

def db():
    import duckdb
    return duckdb.connect(DB, read_only=True)

def tracked_files():
    try:
        out = subprocess.run(['git', '-c', 'safe.directory=*', 'ls-files', '--cached', '--others', '--exclude-standard'],
                             capture_output=True, text=True, check=True).stdout
        return [f for f in out.splitlines() if f]
    except Exception:
        return [os.path.join(d, f) for d, _, fs in os.walk('.') for f in fs
                if not d.startswith(('./data', './warehouse', './.git'))]

# ---- process rules (CLAUDE.md) ----
@check('size_caps', 'CLAUDE.md')
def _():
    caps = {'.claude/skills/opm-invariants/SKILL.md': 8192, '.claude/skills/opm-context/SKILL.md': 30720, 'CLAUDE.md': 5120}
    sizes = {p: os.path.getsize(p) for p in caps}
    over = [f'{p} {s} > {caps[p]}' for p, s in sizes.items() if s > caps[p]]
    return not over, '; '.join(over) or ', '.join(f'{os.path.basename(os.path.dirname(p)) or p} {s} B' for p, s in sizes.items())

@check('no_em_dash', 'CLAUDE.md')
def _():
    hits = []
    local = ['CLAUDE.md'] + [os.path.join(d, f) for top in ('.claude', 'ops') if os.path.isdir(top)
                             for d, _, fs in os.walk(top) for f in fs]  # git-ignored but still checked
    for f in sorted(set(tracked_files() + local)):
        if f.endswith(('.md', '.py', '.js', '.css', '.html', '.json', '.txt')) and not f.startswith(('data/', 'warehouse/')):
            try:
                if chr(0x2014) in open(f, encoding='utf-8').read(): hits.append(f)
            except (UnicodeDecodeError, FileNotFoundError):
                pass
    return not hits, ', '.join(hits) or 'none in tracked text files'

# ---- invariant 1: the manifest is the source of truth ----
MAN = json.load(open('data/opm_manifest.json'))

@check('manifest_files', 'inv 1')
def _():
    problems = []
    listed = set()
    for x in MAN:
        p = f"data/{DATASETS[x['dataset']]}/{x['filename']}.parquet"; listed.add(p)
        if not os.path.exists(p): problems.append(f'missing {p}')
        elif x.get('size') is not None and os.path.getsize(p) != x['size']: problems.append(f'size {p}')
    extra = [f'data/{d}/{f}' for d in DATASETS.values() for f in os.listdir(f'data/{d}')
             if f.endswith('.parquet') and f'data/{d}/{f}' not in listed]
    problems += [f'unlisted {e}' for e in extra]
    return not problems, '; '.join(problems[:5]) or f'{len(MAN)} files present, sizes match, none unlisted'

@check('load_log_matches_manifest', 'inv 1')
def _():
    got = {(d, f) for d, f in db().execute('select dataset, source_file from load_log').fetchall()}
    want = {(x['dataset'], x['filename']) for x in MAN}
    return got == want, f'{len(got)} loaded; missing {len(want - got)}, stale {len(got - want)}'

# ---- invariant 2: DOJ means is_doj ----
@check('doj_continuity_2015', 'inv 2')
def _():
    r = dict(db().execute("select period, count(*) from doj_employment where period in ('2014-12-01','2015-01-01') group by 1").fetchall())
    a, b = [r.get(k) for k in sorted(r)] if len(r) == 2 else (None, None)
    if not a or not b: return False, f'missing months: {r}'
    chg = (b - a) / a
    return abs(chg) < 0.02, f'Dec 2014 {a:,} -> Jan 2015 {b:,} ({chg:+.2%}; limit 2%)'

@check('no_bare_department_filter', 'inv 2')
def _():
    pat = re.compile(r"department_code\s*(=|==|IN)\s*\(?\s*['\"]DJ", re.I)
    hits = [f for f in tracked_files() if f.startswith(('pipeline/', 'web/')) and f.endswith(('.py', '.sql', '.js'))
            and os.path.exists(f) and pat.search(open(f, encoding='utf-8').read())]  # a deleted tracked file has no text
    return not hits, ', '.join(hits) or 'none in pipeline/ or web/'

# ---- invariant 4: redacted is not missing ----
@check('redaction_preserved', 'inv 4')
def _():
    c = db(); bad = []
    for ds in DATASETS:
        typed = c.execute(f'select count(*) filter (where annualized_adjusted_basic_pay_redacted) from doj_{ds}').fetchone()[0]
        raw = c.execute(f"select count(*) from raw_{ds} where coalesce(department_code, agency_code) = 'DJ' "
                        f"and annualized_adjusted_basic_pay = 'REDACTED'").fetchone()[0]
        if typed != raw: bad.append(f'{ds} typed {typed} vs raw {raw}')
    return not bad, '; '.join(bad) or 'DOJ pay REDACTED counts equal raw in all three datasets'

# ---- invariant 5: every code is mapped, and nothing hides inside a total ----
XW = 'pipeline/crosswalks'
E = 'personnel_action_effective_date_month'

def crosswalk(name, key):
    import csv
    rows = list(csv.DictReader(open(f'{XW}/{name}', encoding='utf-8')))
    keys = [r[key] for r in rows]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    return rows, set(keys), dup

def partition_columns(rows, prefix):
    """Columns doj_monthly must carry: each decided category, and each still-pending code on its own."""
    cols = {}
    for r in rows:
        col = f"{prefix}_{r['proposed_category']}" if r['status'] == 'decided' else f"{prefix}_code_{r['code'].lower()}"
        cols.setdefault(col, []).append(r['code'])
    return cols

@check('codes_mapped_and_partition', 'inv 5')
def _():
    c = db(); bad = []
    sep, sep_k, d1 = crosswalk('separation_codes.csv', 'code')
    acc, acc_k, d2 = crosswalk('accession_codes.csv', 'code')
    comp, comp_k, d3 = crosswalk('components.csv', 'agency_subelement_code')
    for n, d in (('separation', d1), ('accession', d2), ('component', d3)):
        if d: bad.append(f'duplicate {n} rows {d}')
    bad += [f"{r['code']} status {r['status']}" for r in sep + acc if r['status'] not in ('decided', 'pending_signoff')]
    bad += [f"{r['code']} label_status {r['label_status']}" for r in sep + acc if r['label_status'] not in ('signed', 'pending_signoff')]
    bad += [f"{r['agency_subelement_code']} display_name_status {r['display_name_status']}" for r in comp
            if r['display_name_status'] not in ('signed', 'pending_signoff')]
    bad += [f"{r['code']} not in attrition (D-006)" for r in sep if r['counts_in_attrition'] != 'Y']
    bad += [f"{r['code']} not in hires" for r in acc if r['counts_in_hires'] != 'Y']
    for rows in (sep, acc):  # one label per category
        labels = {}
        for r in rows: labels.setdefault(r['proposed_category'], set()).add((r['display_label'], r['label_status']))
        bad += [f'category {k} has labels {sorted(v)}' for k, v in labels.items() if len(v) > 1]
    dist = lambda sql: {str(r[0]) for r in c.execute(sql).fetchall()}  # NULL becomes 'None' and must be mapped too
    sd = dist('select distinct separation_category_code from doj_separations')
    ad = dist('select distinct accession_category_code from doj_accessions')
    cd = dist('select distinct agency_subelement_code from doj_employment union select distinct agency_subelement_code '
              'from doj_accessions union select distinct agency_subelement_code from doj_separations')
    for n, data, xw in (('separation', sd, sep_k), ('accession', ad, acc_k), ('component', cd, comp_k)):
        if data - xw: bad.append(f'unmapped {n} codes {sorted(data - xw)}')
    scols, acols = partition_columns(sep, 'sep'), partition_columns(acc, 'acc')
    have = {r[0] for r in c.execute('describe doj_monthly').fetchall()}
    for prefix, cols in (('sep', scols), ('acc', acols)):
        got = {x for x in have if x.startswith(prefix + '_') and x != 'sep_drp'}
        if got != set(cols): bad.append(f'doj_monthly {prefix} columns {sorted(got)} != crosswalk {sorted(cols)}')
    if 'sep_drp' not in have: bad.append('doj_monthly lacks sep_drp')
    rows = []
    if not bad:
        rows = c.execute(f"""
          with s as (select {E} as month, count(*) n, count(*) filter (where drp_indicator = 'Y') drp from doj_separations group by 1),
               a as (select {E} as month, count(*) n from doj_accessions group by 1)
          select m.month, m.separations, {' + '.join(sorted(scols))}, coalesce(s.n, 0),
                 m.accessions, {' + '.join(sorted(acols))}, coalesce(a.n, 0), m.sep_drp, coalesce(s.drp, 0)
          from doj_monthly m left join s using (month) left join a using (month)""").fetchall()
        for mo, tot, parts, direct, acc_m, acc_parts, acc_d, drp_m, drp_d in rows:
            if parts != tot: bad.append(f'{mo} separation categories {parts} != separations {tot}')
            if tot != direct: bad.append(f'{mo} separations {tot} != effective-month count {direct}')
            if acc_parts != acc_m: bad.append(f'{mo} accession categories {acc_parts} != accessions {acc_m}')
            if acc_m != acc_d: bad.append(f'{mo} accessions {acc_m} != effective-month count {acc_d}')
            if drp_m != drp_d: bad.append(f'{mo} sep_drp {drp_m} != {drp_d}')
    pre = c.execute(f"select (select count(*) from doj_separations where {E} < (select min(month) from doj_monthly)), "
                    f"(select count(*) from doj_accessions where {E} < (select min(month) from doj_monthly))").fetchone()
    return not bad, '; '.join(bad[:5]) or (f'{len(sd)} separation, {len(ad)} accession, {len(cd)} component codes mapped; '
        f'{len(scols)} separation and {len(acols)} accession categories sum to their totals in all {len(rows)} months; '
        f'effective before range (D-017): {pre[0]} separations, {pre[1]} accessions')

# ---- invariants 6, 7, 8 for doj_monthly ----
@check('doj_monthly_basis', 'inv 6/7/8')
def _():
    c = db(); bad = []
    r = c.execute("""
      with e as (select snapshot_month as month, count(*) h from doj_employment group by 1)
      select count(*), count(*) filter (where m.time_basis is distinct from 'effective'),
             count(*) filter (where m.net_flow is distinct from m.accessions - m.separations),
             count(*) filter (where m.headcount is distinct from e.h),
             (select count(*) from e) ,
             string_agg(strftime(m.month, '%Y-%m'), ',' order by m.month) filter (where m.provisional),
             (select string_agg(strftime(month, '%Y-%m'), ',' order by month) from (select month from e order by month desc limit 3))
      from doj_monthly m left join e using (month)""").fetchone()
    n, basis, net, head, n_emp, prov, want_prov = r
    if basis: bad.append(f'{basis} rows not effective')
    if net: bad.append(f'{net} rows net_flow != accessions - separations')
    if head: bad.append(f'{head} rows headcount != snapshot count')
    if n != n_emp: bad.append(f'{n} months vs {n_emp} snapshot months')
    if prov != want_prov: bad.append(f'provisional {prov} != newest 3 {want_prov}')
    return not bad, '; '.join(bad) or f'{n} months, all effective basis; provisional {prov}'

# ---- invariant 7: headcount change and net flow stay separate; reconciliation monitored ----
def decision_ids():
    return set(re.findall(r'^## (D-\d+)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M))

def known_breaks():
    text = open('ops/DECISIONS.md', encoding='utf-8').read()
    years = set()
    for sec in re.split(r'\n## ', text):
        if 'known breaks' in sec.split('\n', 1)[0].lower():
            years |= {int(y) for y in re.findall(r'FY(\d{4})', sec)}
    return years

@check('reconciliation_fy', 'inv 7')
def _():
    E = 'personnel_action_effective_date_month'
    rows = db().execute(f"""
      with e as (select period p, count(*) h from doj_employment group by 1),
           m as (select p, h - lag(h) over (order by p) dh from e),
           a as (select {E} p, count(*) n from doj_accessions group by 1),
           s as (select {E} p, count(*) n from doj_separations group by 1)
      select year(p + interval 3 month) fy, sum(dh) - sum(coalesce(a.n,0) - coalesce(s.n,0)) gap
      from m left join a using (p) left join s using (p) where dh is not null group by 1 order by 1""").fetchall()
    kb = known_breaks()
    over = [(fy, g) for fy, g in rows if abs(g) > 500]
    unexplained = [f'FY{fy} {g:+,}' for fy, g in over if fy not in kb]
    listed = ', '.join(f'FY{fy} {g:+,}' for fy, g in over if fy in kb)
    return not unexplained, (('unexplained: ' + ', '.join(unexplained) + '; ') if unexplained else '') + f'known breaks: {listed or "none"}'

# ---- cubes (warehouse/cubes/, staged by pipeline/build_cubes.py). These checks never import the cube code:
# they recompute from doj_* and the manifest on their own. ----
CUBES = 'warehouse/cubes'
KINDS = {'dimension', 'stock', 'stock_change', 'flow', 'rate_numerator', 'rate_denominator', 'flag', 'coverage'}
_cache = {}

def cubes():
    """{name: (meta, columns, rows as dicts)} for every <cube>.meta.json in warehouse/cubes/."""
    if 'c' not in _cache:
        out = {}
        for f in sorted(os.listdir(CUBES)) if os.path.isdir(CUBES) else []:
            if f.endswith('.meta.json'):
                meta = json.load(open(f'{CUBES}/{f}'))
                if 'files' in meta:   # a multi-file cube (D-044): rows from every listed file, in listed order
                    parts, cols, rows = {}, None, []
                    for ent, fi in meta['files'].items():
                        if not os.path.exists(f"{CUBES}/{fi['path']}"): continue   # cube_files_listed names it
                        data = json.load(open(f"{CUBES}/{fi['path']}"))
                        parts[ent] = data; cols = cols or data['columns']
                        rows += [dict(zip(data['columns'], r)) for r in data['rows']]
                    _cache.setdefault('parts', {})[meta['cube']] = parts
                    out[meta['cube']] = (meta, cols, rows)
                else:
                    data = json.load(open(f"{CUBES}/{meta['file']}"))
                    out[meta['cube']] = (meta, data['columns'], [dict(zip(data['columns'], r)) for r in data['rows']])
        if not out: raise RuntimeError(f'no cube meta in {CUBES}/ (run pipeline/build_cubes.py)')
        _cache['c'] = out
    return _cache['c']

ADMIN_SIGNED = [('obama2', 'Obama II', '2013-01', '2016-12'), ('trump1', 'Trump I', '2017-01', '2020-12'),
                ('biden', 'Biden', '2021-01', '2024-12'), ('trump2', 'Trump II', '2025-01', 'latest')]   # D-065

def admin_n_months(published):
    """D-072: N = the open administration's months so far (Trump II: latest month minus Dec 2024)."""
    return len(admin_windows(published)['trump2'])

def admin_windows(published):
    """{admin id: [published months YYYY-MM of its window]} from the D-065 constants."""
    return {a: [m for m in published if lo <= m and (hi == 'latest' or m <= hi)] for a, _, lo, hi in ADMIN_SIGNED}

def core():
    return cubes()['doj_core']

def digest_of(files):
    """Gate's own combined hash of a multi-file cube: sha256 over '<path> <sha256>\\n' lines sorted by path."""
    import hashlib
    return hashlib.sha256(''.join(f'{p} {h}\n' for p, h in sorted(files.items())).encode()).hexdigest()

CUBE_FILE_MAX = 2_000_000  # bytes; no single cube file may exceed 2 MB (D-044 page loads one entity file)

def canonical_manifest_hash():
    import hashlib
    recs = sorted(MAN, key=lambda x: (x['dataset'], x['filename']))
    return hashlib.sha256(json.dumps(recs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def manifest_versions():
    v = {}
    for x in MAN: v.setdefault(f"{int(x['year']):04d}-{int(x['month']):02d}", {})[x['dataset']] = int(x['version'])
    return v

def snapshot_months():
    return [r[0].strftime('%Y-%m') for r in db().execute('select distinct snapshot_month from doj_employment order by 1').fetchall()]

def entity_last_months():
    """{entity: last employment month YYYY-MM}; DOJ = the last snapshot month (D-024)."""
    c = db()
    out = {e: m.strftime('%Y-%m') for e, m in c.execute('select agency_subelement_code, max(snapshot_month) from doj_employment group by 1').fetchall()}
    out['DOJ'] = c.execute('select max(snapshot_month) from doj_employment').fetchone()[0].strftime('%Y-%m')
    return out

def period_months(row, published, last=None):
    """Published months (YYYY-MM) of a cube row up to the entity's last month, derived from grain and fiscal
    year/quarter, not from the cube."""
    if last: published = {m for m in published if m <= last}
    if row['grain'] == 'month': return [row['period']] if row['period'] in published else []
    fy, q = row['fiscal_year'], row['fiscal_quarter']
    cal = [f'{fy - 1}-{m:02d}' for m in (10, 11, 12)] + [f'{fy}-{m:02d}' for m in range(1, 10)]
    if row['grain'] == 'quarter': cal = cal[(q - 1) * 3: q * 3]
    return [m for m in cal if m in published]

@check('output_manifest_hash', 'inv 1')
def _():
    import hashlib
    want, bad = canonical_manifest_hash(), []
    for name, (meta, _, _) in cubes().items():
        if meta.get('manifest_sha256') != want: bad.append(f"{name} manifest {str(meta.get('manifest_sha256'))[:12]} != current {want[:12]}")
        if 'files' in meta:
            got = {fi['path']: hashlib.sha256(open(f"{CUBES}/{fi['path']}", 'rb').read()).hexdigest() if os.path.exists(f"{CUBES}/{fi['path']}") else 'missing'
                   for fi in meta['files'].values()}
            bad += [f"{name} {fi['path']} sha256 does not match its meta" for fi in meta['files'].values() if got[fi['path']] != fi['sha256']]
            if meta.get('files_sha256') != digest_of({fi['path']: fi['sha256'] for fi in meta['files'].values()}):
                bad.append(f'{name} files_sha256 does not match its listed files')
        else:
            got = hashlib.sha256(open(f"{CUBES}/{meta['file']}", 'rb').read()).hexdigest()
            if meta.get('cube_sha256') != got: bad.append(f'{name} cube_sha256 does not match {meta["file"]}')
    return not bad, '; '.join(bad) or f'{len(cubes())} cube(s) built from manifest {want[:12]}; cube file hashes match their meta'

@check('cube_files_listed', 'inv 1')
def _():
    """A multi-file cube's meta lists exactly the files on disk, with matching hashes, row counts, entity, columns and
    periods; and no cube file exceeds 2 MB."""
    import hashlib
    bad, sizes, n = [], {}, 0
    for name, (meta, cols, rows) in cubes().items():
        if 'files' not in meta:
            sizes[meta['file']] = os.path.getsize(f"{CUBES}/{meta['file']}"); continue
        d = f'{CUBES}/{name}'
        on_disk = {f'{name}/{f}' for f in os.listdir(d)} if os.path.isdir(d) else set()
        listed = {fi['path'] for fi in meta['files'].values()}
        bad += [f'{p} is on disk but not in {name}.meta.json' for p in sorted(on_disk - listed)]
        bad += [f'{p} is in {name}.meta.json but not on disk' for p in sorted(listed - on_disk)]
        if set(meta['files']) != set(meta.get('entities', [])): bad.append(f"{name} files {sorted(meta['files'])} != entities {meta.get('entities')}")
        want_cols = [c['name'] for c in meta['columns']]
        for ent, fi in meta['files'].items():
            if fi['path'] != f'{name}/{ent}.json': bad.append(f"{name} {ent} path {fi['path']} != {name}/{ent}.json")
            if fi['path'] not in on_disk: continue
            full = f"{CUBES}/{fi['path']}"; sizes[fi['path']] = os.path.getsize(full); n += 1
            if hashlib.sha256(open(full, 'rb').read()).hexdigest() != fi['sha256']: bad.append(f"{fi['path']} sha256 != meta")
            data = _cache['parts'][name].get(ent) or json.load(open(full))
            if data.get('cube') != name or data.get('entity') != ent: bad.append(f"{fi['path']} says cube {data.get('cube')} entity {data.get('entity')}")
            if data.get('columns') != want_cols: bad.append(f"{fi['path']} columns differ from the meta column dictionary")
            if len(data.get('rows', [])) != fi['rows']: bad.append(f"{fi['path']} has {len(data.get('rows', []))} rows, meta says {fi['rows']}")
            ei = want_cols.index('entity')
            if any(r[ei] != ent for r in data.get('rows', [])): bad.append(f"{fi['path']} holds rows of another entity")
            if 'grain' in want_cols:
                gi, pi = want_cols.index('grain'), want_cols.index('period')
                used = {f'{r[gi]}:{r[pi]}' for r in data.get('rows', [])}
            if 'periods' in data and set(data['periods']) != used: bad.append(f"{fi['path']} periods {len(data.get('periods', {}))} != windows its rows use {len(used)}")
    over = [f'{p} {s_ / 1e6:.2f} MB' for p, s_ in sorted(sizes.items()) if s_ > CUBE_FILE_MAX]
    bad += [f'over 2 MB: {x}' for x in over]
    big = max(sizes.items(), key=lambda x: x[1])
    return not bad, '; '.join(bad[:5]) or (f'{n} split file(s) listed exactly, hashes, rows, entity, columns and periods match; '
                                           f'largest cube file {big[0]} {big[1] / 1e6:.2f} MB (limit 2 MB)')

ISSUE_COLS = ['id', 'dataset', 'field', 'first_file_month', 'last_file_month', 'value_min', 'value_max', 'treatment',
              'status', 'decision', 'note']

def active_issues():
    import csv
    return [r for r in csv.DictReader(open('pipeline/known_data_issues.csv', encoding='utf-8')) if r['status'] == 'active']

def issue_sql(dataset, field):
    """Gate's own reading of pipeline/known_data_issues.csv: true when the row's value matches an active issue."""
    conds = [f"(period >= DATE '{r['first_file_month']}-01' AND period <= DATE '{r['last_file_month'] or '9999-12'}-01' "
             f"AND {field} >= {r['value_min']} AND {field} <= {r['value_max']})"
             for r in active_issues() if r['dataset'] == dataset and r['field'] == field and r['treatment'] == 'unknown']
    return ' OR '.join(conds) or 'false'

def independent_core():
    """Every doj_core figure recomputed in SQL from doj_*: a DOJ + component x month grid, then month, fiscal quarter
    and fiscal year rows (stocks = last month, flows = sums, rates = ratio of sums, trailing 12 by window)."""
    import csv
    sep = partition_columns(crosswalk('separation_codes.csv', 'code')[0], 'sep')
    acc = partition_columns(crosswalk('accession_codes.csv', 'code')[0], 'acc')
    comps = [r['agency_subelement_code'] for r in csv.DictReader(open(f'{XW}/components.csv', encoding='utf-8'))]
    f = lambda col, g: ''.join(f", sum(({col} in ({', '.join(repr(c) for c in cs)}))::int) {k}" for k, cs in g.items())
    cats = list(sep) + ['sep_drp'] + list(acc)
    flows = ['hires', 'departures'] + cats + ['los', 'los_n', 'los_iss']
    iss = issue_sql('separations', 'length_of_service_years')
    ents = ', '.join(f"('{e}')" for e in ['DOJ'] + comps)
    s_sel = (f"count(*) departures {f('separation_category_code', sep)}, sum((drp_indicator = 'Y')::int) sep_drp, "
             f"sum(case when not ({iss}) then length_of_service_years end) los, "
             f"count(case when not ({iss}) then length_of_service_years end) los_n, coalesce(sum(({iss})::int), 0) los_iss")
    a_sel = f"count(*) hires {f('accession_category_code', acc)}"
    sql = f"""
      with ents(e) as (values {ents}),
      mo as (select distinct snapshot_month m from doj_employment),
      lastm as (select agency_subelement_code e, max(snapshot_month) lm from doj_employment group by 1
                union all select 'DOJ', max(snapshot_month) from doj_employment),
      h as (select agency_subelement_code e, snapshot_month m, count(*) h from doj_employment group by 1, 2
            union all select 'DOJ', snapshot_month, count(*) from doj_employment group by 2),
      s as (select agency_subelement_code e, {E} m, {s_sel} from doj_separations group by 1, 2
            union all select 'DOJ', {E}, {s_sel} from doj_separations group by 2),
      a as (select agency_subelement_code e, {E} m, {a_sel} from doj_accessions group by 1, 2
            union all select 'DOJ', {E}, {a_sel} from doj_accessions group by 2),
      g as materialized (select e, m, year(m + interval 3 month) fy, (month(m) + 2) % 12 // 3 + 1 q, coalesce(h.h, 0) h,
                   {', '.join(f'coalesce({c}, 0) {c}' for c in flows)}
            from ents cross join mo join lastm using (e) left join h using (e, m) left join s using (e, m) left join a using (e, m)
            where m <= lm),
      t as materialized (select *, sum(departures) over w t_dep, sum(sep_quit) over w t_quit, sum(sep_retirement) over w t_ret,
                   avg(h) over w t_h, count(*) over w t_n
            from g window w as (partition by e order by m rows between 11 preceding and current row)),
      p as materialized (select e, 'month' grain, strftime(m, '%Y-%m') period, m last_m, 1 n_exp, g.* exclude (e, m) , 1 n, h mean_h from g
            union all
            select e, 'quarter', 'FY' || fy || 'Q' || q, max(m), 3, fy, q, arg_max(h, m), {', '.join(f'sum({c})' for c in flows)}, count(*), avg(h) from g group by e, fy, q
            union all
            select e, 'fy', 'FY' || fy, max(m), 12, fy, null, arg_max(h, m), {', '.join(f'sum({c})' for c in flows)}, count(*), avg(h) from g group by e, fy)
      select p.*, p.h - lag(p.h) over (partition by p.e, p.grain order by p.last_m) h_chg,
             t.t_dep, t.t_quit, t.t_ret, t.t_h, t.t_n from p join t on t.e = p.e and t.m = p.last_m"""
    c = db()
    cur = c.execute(sql)
    names = [d[0] for d in cur.description]
    got = [dict(zip(names, x)) for x in cur.fetchall()]  # fetch before the next query on this connection
    months = [r[0] for r in c.execute('select distinct snapshot_month from doj_employment order by 1').fetchall()]
    contiguous = all((b.year * 12 + b.month) - (a.year * 12 + a.month) == 1 for a, b in zip(months, months[1:]))
    return {(r['e'], r['grain'], r['period']): r for r in got}, cats, contiguous

@check('stock_flow_rollups', 'inv 3')
def _():
    meta, cols, rows = core()
    bad = []
    kinds = {d['name']: d.get('kind') for d in meta['columns']}
    if [d['name'] for d in meta['columns']] != cols: bad.append('meta column dictionary does not list the cube columns in order')
    bad += [f'{c} kind {kinds.get(c)}' for c in cols if kinds.get(c) not in KINDS]
    bad += [f'{c} has no description' for c in cols if not next((d.get('description') for d in meta['columns'] if d['name'] == c), None)]
    want, cats, contiguous = independent_core()
    if not contiguous: bad.append('snapshot months are not contiguous: trailing-12 windows by row count would be wrong')
    near = lambda x, y, tol: (x is None and y is None) or (x is not None and y is not None and abs(x - y) <= tol)
    got_keys = {(r['entity'], r['grain'], r['period']) for r in rows}
    if got_keys != set(want): bad.append(f'row set differs: {len(got_keys - set(want))} extra, {len(set(want) - got_keys)} missing')
    checked = set()
    for r in rows:
        w = want.get((r['entity'], r['grain'], r['period']))
        if w is None: continue
        k = f"{r['entity']} {r['period']}"
        n = w['n']; partial = n < w['n_exp']
        exp = {'headcount': w['h'], 'headcount_change': w['h_chg'], 'hires': w['hires'], 'departures': w['departures'], 'net_flow': w['hires'] - w['departures'],
               'yos_known': w['los_n'], 'yos_known_issue': w['los_iss'], 'months_published': n, 'months_in_period': w['n_exp'], 'partial': partial,
               'period_last_month': w['last_m'].strftime('%Y-%m'), **{c: w[c] for c in cats}}
        for c, v in exp.items():
            if r[c] != v: bad.append(f'{k} {c} {r[c]} != {v}')
        if not near(r['years_of_service_lost'], float(w['los'] or 0), 0.051): bad.append(f"{k} years_of_service_lost {r['years_of_service_lost']} != {w['los']}")
        # rates: numerators and the shared denominator per method, then the ratio of sums
        a_ok = w['t_n'] == 12
        rate = {'a': (a_ok, w['t_dep'], w['t_quit'], w['t_ret'], w['t_h'], 12, 1),
                'b': (r['grain'] == 'fy', w['departures'], w['sep_quit'], w['sep_retirement'], w['mean_h'], n, 1),  # partial: year to date (D-023)
                'c': (True, w['departures'], w['sep_quit'], w['sep_retirement'], w['mean_h'], n, 12 / n)}
        for m, (on, dep, quit_, ret, den, months, fac) in rate.items():
            nums = {'attrition': dep, 'quit': quit_, 'retirement': ret}
            if not on:
                if any(r[f'{x}_{m}_num'] is not None for x in nums) or r[f'rate_{m}_den'] is not None or r[f'rate_{m}_months'] is not None:
                    bad.append(f'{k} method {m.upper()} should be null')
                continue
            if r[f'rate_{m}_months'] != months: bad.append(f"{k} rate_{m}_months {r[f'rate_{m}_months']} != {months}")
            if den == 0:  # D-027: a zero mean headcount leaves the rate empty
                if any(r[f'{x}_{m}_num'] is not None for x in nums) or r[f'rate_{m}_den'] is not None or r[f'rate_{m}_small_base'] is not None:
                    bad.append(f'{k} method {m.upper()} has a zero denominator and should be empty (D-027)')
                continue
            if not near(r[f'rate_{m}_den'], den, 1e-3): bad.append(f"{k} rate_{m}_den {r[f'rate_{m}_den']} != {den}")
            for x, v in nums.items():
                if not near(r[f'{x}_{m}_num'], v * fac, 1e-3): bad.append(f"{k} {x}_{m}_num {r[f'{x}_{m}_num']} != {v * fac}")
                elif den and not near(r[f'{x}_{m}_num'] / r[f'rate_{m}_den'], v * fac / den, 1e-5): bad.append(f'{k} {x} rate {m} ratio differs')
        checked.add(k)
    need = ['DOJ FY2026', 'DOJ FY2025', 'DOJ FY2026Q4', 'DOJ FY2025Q4', 'DJ03 FY2026', 'DOJ 2012-09', 'DJ14 FY2026', 'DJ14 FY2026Q3', 'DJ14 2026-04']
    # D-024: rows end at each entity's last employment month, and no flow falls after it
    lastm = entity_last_months()
    for e, lm in lastm.items():
        ends = {g: max((r['period_last_month'] for r in rows if r['entity'] == e and r['grain'] == g), default=None) for g in ('month', 'quarter', 'fy')}
        if set(ends.values()) != {lm}: bad.append(f'{e} rows end {ends}, last employment month {lm}')
    after = db().execute(f"""with l as (select agency_subelement_code e, max(snapshot_month) lm from doj_employment group by 1)
        select (select count(*) from doj_separations x join l on x.agency_subelement_code = l.e where {E} > lm)
             + (select count(*) from doj_accessions x join l on x.agency_subelement_code = l.e where {E} > lm)""").fetchone()[0]
    if after: bad.append(f'{after} actions effective after their component\'s last employment month fall outside the cube')
    bad += [f'{k} not compared' for k in need if k not in checked]
    fy26 = next((r for r in rows if r['entity'] == 'DOJ' and r['period'] == 'FY2026'), {})
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"{len(cols)} columns all declare a kind; {len(checked)} rows (every entity, grain and period) match an independent "
        f"recomputation, incl. partial FY2026 ({fy26.get('months_published')} of 12 months, headcount {fy26.get('headcount'):,}) and FY2026Q4; "
        f"rows end at each entity's last employment month (DJ14 {lastm.get('DJ14')})")

def leaving_dims():
    import csv
    out = {}
    for r in csv.DictReader(open(f'{XW}/leaving_dimensions.csv', encoding='utf-8')): out.setdefault(r['dimension'], []).append(r)
    return out

def leaving_value_sql(rows, dataset):
    """Gate's own value assignment for one D-031 dimension: Unknown first (NULL, listed codes, active 'unknown'
    known-data-issue values), then bands and code lists, then the catch-all; anything else is NULL (unmapped)."""
    f = rows[0]['source_field']
    lit = lambda codes: ', '.join("'" + c.replace("'", "''") + "'" for c in codes.split('|'))
    order = [r for r in rows if r['rule'] == 'unknown'] + [r for r in rows if r['rule'] in ('range', 'codes')] + [r for r in rows if r['rule'] == 'rest']
    arms = []
    for r in order:
        if r['rule'] == 'unknown':
            cond = f'{f} is null' + (f" or cast({f} as varchar) in ({lit(r['codes'])})" if r['codes'] else '') + f" or ({issue_sql(dataset, f)})"
        elif r['rule'] == 'range':
            cond = f"{f} >= {r['lo']}" + (f" and {f} < {r['hi']}" if r['hi'] else '')
        elif r['rule'] == 'codes':
            cond = f"cast({f} as varchar) in ({lit(r['codes'])})"
        else:
            cond = f'{f} is not null'
        arms.append(f"when {cond} then '{r['value']}'")
    return 'case ' + ' '.join(arms) + ' end'

def independent_leaving():
    """Every doj_leaving figure recomputed in SQL from doj_* (not from the cube code): per dimension, a DOJ + component
    x month x value grid cut at each entity's last month, then fiscal-year sums and 12-month windows."""
    import csv
    sep = partition_columns(crosswalk('separation_codes.csv', 'code')[0], 'sep')
    comps = [r['agency_subelement_code'] for r in csv.DictReader(open(f'{XW}/components.csv', encoding='utf-8'))]
    ents = ', '.join(f"('{e}')" for e in ['DOJ'] + comps)
    admin_case = 'case ' + ' '.join(f"when strftime(m, '%Y-%m') >= '{lo}'" + ('' if hi == 'latest' else f" and strftime(m, '%Y-%m') <= '{hi}'") + f" then '{a}'"
                                    for a, _, lo, hi in ADMIN_SIGNED) + ' end'
    mio_case = 'case ' + ' '.join(f"when strftime(m, '%Y-%m') >= '{lo}'" + ('' if hi == 'latest' else f" and strftime(m, '%Y-%m') <= '{hi}'")
                                  + f" then year(m) * 12 + month(m) - {int(lo[:4]) * 12 + int(lo[5:])} + 1" for a, _, lo, hi in ADMIN_SIGNED) + ' end'
    n_now = admin_n_months(snapshot_months())
    c = db(); out = {}; unmapped = 0
    fl = ['dep'] + list(sep) + ['drp']
    for dim, rows in leaving_dims().items():
        ve, vs = leaving_value_sql(rows, 'employment'), leaving_value_sql(rows, 'separations')
        vals = ', '.join(f"('{r['value']}')" for r in rows)
        cats = ''.join(f", sum((separation_category_code in ({', '.join(repr(x) for x in cs)}))::int) {k}" for k, cs in sep.items())
        s_sel = f"count(*) dep {cats}, sum((drp_indicator = 'Y')::int) drp"
        unmapped += c.execute(f"select (select count(*) from doj_employment where ({ve}) is null) + (select count(*) from doj_separations where ({vs}) is null)").fetchone()[0]
        sql = f"""
          with ents(e) as (values {ents}), vals(v) as (values {vals}),
          mo as (select distinct snapshot_month m from doj_employment),
          lastm as (select agency_subelement_code e, max(snapshot_month) lm from doj_employment group by 1
                    union all select 'DOJ', max(snapshot_month) from doj_employment),
          h as (select agency_subelement_code e, snapshot_month m, {ve} v, count(*) h from doj_employment group by all
                union all select 'DOJ', snapshot_month, {ve}, count(*) from doj_employment group by all),
          s as (select agency_subelement_code e, {E} m, {vs} v, {s_sel} from doj_separations group by all
                union all select 'DOJ', {E}, {vs}, {s_sel} from doj_separations group by all),
          g as materialized (select e, m, v, year(m + interval 3 month) fy, {admin_case} adm, {mio_case} mio, coalesce(h.h, 0) h, {', '.join(f'coalesce({x}, 0) {x}' for x in fl)}
                from ents cross join mo join lastm using (e) cross join vals left join h using (e, m, v) left join s using (e, m, v)
                where m <= lm),
          t as materialized (select *, {', '.join(f'sum({x}) over w t_{x}' for x in fl)}, avg(h) over w t_h, count(*) over w t_n
                from g window w as (partition by e, v order by m rows between 11 preceding and current row))
          select e, 'fy' grain, 'FY' || fy period, v, max(m) last_m, count(*) n, {', '.join(f'sum({x}) {x}' for x in fl)},
                 arg_max(h, m) h_end, avg(h) mean_h from g group by e, v, fy
          union all
          select e, 't12', strftime(m, '%Y-%m'), v, m, t_n, {', '.join(f't_{x}' for x in fl)}, h, t_h from t where t_n = 12
          union all
          select e, 'admin', adm, v, max(m), count(*), {', '.join(f'sum({x})' for x in fl)}, arg_max(h, m), avg(h)
          from g where adm is not null group by e, v, adm
          union all
          select e, 'admin_n', adm, v, max(m), count(*), {', '.join(f'sum({x})' for x in fl)}, arg_max(h, m), avg(h)
          from g where adm is not null and mio <= {n_now} group by e, v, adm"""
        # the fy, t12 and admin selects run one at a time (a union of the three stalls DuckDB's planner)
        head = sql[:sql.index("          select e, 'fy' grain")]
        names = None
        for part in sql[len(head):].split('union all'):
            cur = c.execute(head + part); names = names or [d[0] for d in cur.description]
            for x in cur.fetchall():
                r = dict(zip(names, x)); out[(r['e'], r['grain'], r['period'], dim, r['v'])] = r
    return out, list(sep), unmapped

# D-031 (bands, groups), D-038 (Unknown for UNSPECIFIED and *) and D-043 (occupation order), as literal constants:
# (value, rule, lo, hi, codes), in display order
LEAVING_SIGNED = {
    'los': ('length_of_service_years', [('lt1', 'range', 0, 1, ''), ('1_4', 'range', 1, 5, ''), ('5_9', 'range', 5, 10, ''),
            ('10_19', 'range', 10, 20, ''), ('20_24', 'range', 20, 25, ''), ('25_29', 'range', 25, 30, ''),
            ('30plus', 'range', 30, None, ''), ('unknown', 'unknown', None, None, '')]),
    'age': ('age_bracket', [('under25', 'codes', None, None, 'LESS THAN 20|20-24')] +
            [(f'{a}_{a + 4}', 'codes', None, None, f'{a}-{a + 4}') for a in range(25, 65, 5)] +
            [('65plus', 'codes', None, None, '65 OR MORE'), ('unknown', 'unknown', None, None, 'UNSPECIFIED')]),
    'supervisory': ('supervisory_status_code', [('supervisor', 'codes', None, None, '2|4|5'), ('other', 'codes', None, None, '6|7|8'),
                    ('unknown', 'unknown', None, None, '*')]),
    # display order D-043 (amends D-031): 0905, 1811, 0007, then all other
    'occupation': ('occupational_series_code', [('0905', 'codes', None, None, '0905'), ('1811', 'codes', None, None, '1811'),
                   ('0007', 'codes', None, None, '0007'), ('other', 'rest', None, None, '')]),
}

def leaving_dims_drift():
    """Differences between pipeline/crosswalks/leaving_dimensions.csv and the D-031/D-038 constants."""
    num = lambda x: None if x == '' else float(x)
    got = {d: (rs[0]['source_field'], [(r['value'], r['rule'], num(r['lo']), num(r['hi']), '|'.join(sorted(r['codes'].split('|'))) if r['codes'] else '')
                                        for r in sorted(rs, key=lambda r: int(r['value_order']))]) for d, rs in leaving_dims().items()}
    want = {d: (f, [(v, ru, None if lo is None else float(lo), None if hi is None else float(hi), '|'.join(sorted(c.split('|'))) if c else '')
                    for v, ru, lo, hi, c in vs]) for d, (f, vs) in LEAVING_SIGNED.items()}
    out = [f'dimensions {sorted(got)} != {sorted(want)}'] if set(got) != set(want) else []
    for d in sorted(set(got) & set(want)):
        if got[d][0] != want[d][0]: out.append(f'{d} source field {got[d][0]} != {want[d][0]}')
        for g_, w_ in zip(got[d][1], want[d][1]):
            if g_ != w_: out.append(f'{d} {g_} != signed {w_}')
        if len(got[d][1]) != len(want[d][1]): out.append(f'{d} has {len(got[d][1])} values, signed {len(want[d][1])}')
    rates = {(r['dimension'], r['value']): r['has_rate'] for rs in leaving_dims().values() for r in rs}
    out += [f'{d} {v} has_rate {h} (Unknown has no rate, every other value has one)' for (d, v), h in rates.items() if (h == 'N') != (v == 'unknown')]
    return out

@check('leaving_rollups', 'inv 3, D-031')
def _():
    meta, cols, rows = cubes()['doj_leaving']
    bad = [f'leaving_dimensions.csv: {x}' for x in leaving_dims_drift()]
    kinds = {d['name']: d.get('kind') for d in meta['columns']}
    if [d['name'] for d in meta['columns']] != cols: bad.append('meta column dictionary does not list the cube columns in order')
    bad += [f'{c} kind {kinds.get(c)}' for c in cols if kinds.get(c) not in KINDS]
    grains = {r['grain'] for r in rows}
    if grains != {'fy', 't12', 'admin', 'admin_n'}: bad.append(f'grains {sorted(grains)} != fy, t12, admin, admin_n (D-031, D-066, D-072: never month or quarter)')
    full = admin_windows(snapshot_months()); n_now = admin_n_months(snapshot_months())
    if meta.get('admin_n_months') != n_now: bad.append(f"meta admin_n_months {meta.get('admin_n_months')} != Trump II months so far {n_now} (D-072)")
    want, cats, unmapped = independent_leaving()
    if unmapped: bad.append(f'{unmapped} rows have a value no leaving_dimensions.csv rule covers')
    dims = leaving_dims()
    has_rate = {(d, r['value']): r['has_rate'] == 'Y' for d, rs in dims.items() for r in rs}
    if {(r['entity'], r['grain'], r['period'], r['dimension'], r['value']) for r in rows} != set(want):
        bad.append(f'row set differs from the independent grid ({len(rows)} vs {len(want)})')
    near = lambda x, y, tol=1e-3: (x is None and y is None) or (x is not None and y is not None and abs(x - y) <= tol)
    # coverage per entity, period and dimension, from the independent Unknown counts
    tot, unk = {}, {}
    for (e, g, p, d, v), w in want.items():
        tot[(e, g, p, d)] = tot.get((e, g, p, d), 0) + w['dep']
        if not has_rate[(d, v)]: unk[(e, g, p, d)] = unk.get((e, g, p, d), 0) + w['dep']
    checked = 0; na = 0
    for r in rows:
        key = (r['entity'], r['grain'], r['period'], r['dimension'], r['value'])
        w = want.get(key)
        if w is None: continue
        k = ' '.join(map(str, key)); n = w['n']
        exp = {'departures': w['dep'], 'sep_drp': w['drp'], 'headcount': w['h_end'], 'months_published': n,
               'period_last_month': w['last_m'].strftime('%Y-%m'),
               'partial': (r['grain'] == 'fy' and n < 12) or (r['grain'] == 'admin' and (r['period'] == 'trump2' or n < len(full[r['period']])))
                          or (r['grain'] == 'admin_n' and (r['period'] == 'trump2' or n < n_now)),
               'is_unknown': not has_rate[(r['dimension'], r['value'])], **{x: w[x] for x in cats}}
        for c, v in exp.items():
            if r[c] != v: bad.append(f'{k} {c} {r[c]} != {v}')
        t = tot[key[:4]]
        cov = round((t - unk.get(key[:4], 0)) / t, 4) if t else None
        if r['coverage'] != cov: bad.append(f"{k} coverage {r['coverage']} != {cov}")
        if not has_rate[(r['dimension'], r['value'])]:
            if any(r[x] is not None for x in ('rate_num', 'rate_den', 'rate_months', 'rate_small_base', 'rate_not_applicable')):
                bad.append(f'{k} Unknown value carries a rate')
        elif w['mean_h'] == 0:   # structural zero: not applicable, empty rate (D-027), no small-base flag
            na += 1
            if not (r['rate_not_applicable'] is True and r['rate_num'] is None and r['rate_den'] is None and r['rate_small_base'] is None and r['rate_months'] == n):
                bad.append(f'{k} structural zero should be not applicable with an empty rate')
        else:
            want_num = round(w['dep'] * 12 / n, 4) if r['grain'] in ('admin', 'admin_n') else w['dep']   # D-066: admin rates annualized
            if r['rate_not_applicable'] is not False or not near(r['rate_num'], want_num, 1e-3) or not near(r['rate_den'], w['mean_h']) or r['rate_months'] != n:
                bad.append(f"{k} rate {r['rate_num']}/{r['rate_den']} ({r['rate_months']}) != {w['dep']}/{w['mean_h']} ({n})")
        checked += 1
    # each dimension partitions doj_core's departures and headcount for the same entity and period
    cm, cc, crows = core()
    ck = {(r['entity'], r['grain'], r['period']): r for r in crows}
    sums, nmon = {}, {}
    for r in rows:
        a = sums.setdefault((r['entity'], r['grain'], r['period'], r['dimension']), [0, 0])
        a[0] += r['departures']; a[1] += r['headcount']
        nmon[(r['entity'], r['grain'], r['period'])] = r['months_published']
    admin_all = {(r['entity'], r['administration']): r for r in cubes()['doj_admin'][2]
                 if r['series_group'] == 'all' and r['months_in_office'] == r['admin_months']}   # whole windows
    admin_at = {(r['entity'], r['administration'], r['months_in_office']): r for r in cubes()['doj_admin'][2] if r['series_group'] == 'all'}
    lastm_e = entity_last_months()
    for (e, g, p, d), (dep, hc) in sums.items():
        if g == 'admin_n':   # months 1..N partition doj_admin's 'all' row at N (D-072)
            ar = admin_at.get((e, p, nmon[(e, g, p)]))
            if ar is None: bad.append(f'{e} admin_n {p} has no doj_admin row at N={nmon[(e, g, p)]}'); continue
            if dep != ar['departures'] or hc != ar['headcount_n']: bad.append(f"{e} admin_n {p} {d}: departures {dep} / headcount {hc} != doj_admin N={nmon[(e, g, p)]} {ar['departures']} / {ar['headcount_n']}")
            if nmon[(e, g, p)] != min(n_now, len([m for m in full[p] if m <= lastm_e[e]])): bad.append(f'{e} admin_n {p} covers {nmon[(e, g, p)]} months, N is {n_now}')
            continue
        if g == 'admin':   # an administration window partitions doj_admin's whole-window row
            ar = admin_all.get((e, p))
            if ar is None: bad.append(f'{e} admin {p} has no doj_admin whole-window row'); continue
            if dep != ar['departures'] or hc != ar['headcount_n']: bad.append(f"{e} admin {p} {d}: departures {dep} / headcount {hc} != doj_admin {ar['departures']} / {ar['headcount_n']}")
            continue
        cr = ck.get((e, 'fy' if g == 'fy' else 'month', p))
        if cr is None: bad.append(f'{e} {g} {p} has no doj_core row'); continue
        cdep = cr['departures'] if g == 'fy' else cr['attrition_a_num']
        if dep != cdep or hc != cr['headcount']: bad.append(f'{e} {g} {p} {d}: departures {dep} / headcount {hc} != doj_core {cdep} / {cr["headcount"]}')
    need = [('DOJ', 'fy', 'FY2026'), ('DOJ', 'fy', 'FY2025'), ('DJ14', 'fy', 'FY2026'), ('DOJ', 't12', '2012-09'), ('DJ14', 't12', '2026-04'),
            ('DOJ', 'admin', 'trump2'), ('DJ14', 'admin', 'trump2'), ('DOJ', 'admin', 'obama2'),
            ('DOJ', 'admin_n', 'trump2'), ('DOJ', 'admin_n', 'biden'), ('DJ14', 'admin_n', 'trump2')]
    bad += [f'{n_} not present' for n_ in need if not any(k[:3] == n_ for k in want)]
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"leaving_dimensions.csv matches the D-031/D-038/D-043 constants; {checked} rows match an independent recomputation (grains fy, t12, admin, admin_n with N={n_now}); every dimension partitions doj_core (doj_admin at admin and admin_n grain) "
        f"departures and headcount in all {len(sums)} entity-period-dimension groups; {na} structural zeros not applicable")

# ---- D-062: job series groups ----
SERIES_SIGNED = ['0905', '1811', '0007', '0301', '0132', '0343', '1801', '2210', '0303', '0101', '0950', '0901', '0006',
                 '0201', '7404']   # D-062, in this order, then 'other' (every other code, blank and NULL included)

def series_sql(col='occupational_series_code'):
    """Gate's own series grouping, straight from the D-062 constants."""
    return f"case when trim(coalesce({col}, '')) in ({', '.join(repr(c) for c in SERIES_SIGNED)}) then trim({col}) else 'other' end"

@check('series_partition', 'inv 3, D-062')
def _():
    import csv
    bad = []
    rows_ = sorted(csv.DictReader(open(f'{XW}/series_groups.csv', encoding='utf-8')), key=lambda r: int(r['order']))
    want = [(c, c, i, 'D-062') for i, c in enumerate(SERIES_SIGNED, 1)] + [('*', 'other', 16, 'D-062')]
    got = [(r['code'], r['group'], int(r['order']), r['decision']) for r in rows_]
    if got != want: bad.append(f'series_groups.csv {got[:3]}... != D-062 constants')
    groups = SERIES_SIGNED + ['other']
    near = lambda a, b, tol=0.01: abs((a or 0) - (b or 0)) <= tol
    # 1. doj_core_series partitions doj_core per entity, grain and period
    cm, cc, crows = core(); sm, sc, srows = cubes()['doj_core_series']
    if [c for c in sc if c != 'series_group'] != cc: bad.append('doj_core_series columns are not doj_core columns plus series_group')
    if {r['series_group'] for r in srows} - set(groups): bad.append('doj_core_series has groups outside D-062')
    core_k = {(r['entity'], r['grain'], r['period']): r for r in crows}
    ints = ['headcount', 'hires', 'departures', 'net_flow', 'yos_known', 'yos_known_issue', 'sep_drp'] + \
           [c for c in cc if c.startswith(('sep_', 'acc_')) and c != 'sep_drp']
    rate_cols = [c for c in cc if c.endswith(('_num', '_den'))]
    sums, pairs, emptied, short = {}, {}, {}, set()
    for r in srows:
        k = (r['entity'], r['grain'], r['period'])
        a = sums.setdefault(k, {c: 0 for c in ints + rate_cols + ['years_of_service_lost', 'headcount_change']})
        for c in ints + rate_cols + ['years_of_service_lost']: a[c] += r[c] or 0
        for m_ in 'abc':   # D-027: a group with nobody on board in the window has an empty rate (numerator too)
            if r[f'rate_{m_}_months'] is not None and r[f'rate_{m_}_den'] is None: emptied.setdefault(k, set()).add(m_)
        a['headcount_change'] = None if r['headcount_change'] is None or a['headcount_change'] is None else a['headcount_change'] + r['headcount_change']
        pairs.setdefault(k, set()).add(r['series_group'])
        cr = core_k.get(k)
        if cr is None: bad.append(f'doj_core_series row {k} has no doj_core row'); continue
        for f in ('provisional', 'partial', 'reissued', 'opm_incomplete', 'file_version', 'months_published', 'period_last_month', 'time_basis'):
            if r[f] != cr[f]: bad.append(f"doj_core_series {k} {r['series_group']} {f} differs from doj_core"); break
    if set(sums) != set(core_k): bad.append(f'doj_core_series covers {len(sums)} entity-periods, doj_core {len(core_k)}')
    present = sm.get('series_groups_present', {})
    for k, a in sums.items():
        cr = core_k.get(k)
        if cr is None: continue
        if pairs[k] != set(present.get(k[0], [])): bad.append(f'{k} groups {sorted(pairs[k])} != series_groups_present'); continue
        for c in ints:
            if a[c] != cr[c]: bad.append(f'{k} {c}: groups sum {a[c]} != doj_core {cr[c]}')
        if not near(a['years_of_service_lost'], cr['years_of_service_lost'], 0.5): bad.append(f"{k} years_of_service_lost {a['years_of_service_lost']} != {cr['years_of_service_lost']}")
        if a['headcount_change'] != cr['headcount_change']: bad.append(f"{k} headcount_change {a['headcount_change']} != {cr['headcount_change']}")
        for c in rate_cols:   # denominators always sum (groups partition headcount; an empty one is 0);
            m_ = c.split('_')[-2] if c.endswith('_num') else c.split('_')[1]
            if c.endswith('_num') and m_ in emptied.get(k, ()):   # numerators: exactly, unless a group's rate is empty
                if (a[c] or 0) > (cr[c] or 0) + 0.01 * len(pairs[k]): bad.append(f'{k} {c}: groups sum {a[c]} > doj_core {cr[c]}')
                elif not near(a[c], cr[c], 0.01 * len(pairs[k])): short.add(k)
            elif not near(a[c], cr[c], 0.01 * len(pairs[k])): bad.append(f'{k} {c}: groups sum {a[c]} != doj_core {cr[c]}')
    # 2. doj_leaving_series partitions doj_leaving (fy, los/age/supervisory) and keeps its rules
    lm, lc, lrows = cubes()['doj_leaving']; xm, xc, xrows = cubes()['doj_leaving_series']
    if {r['grain'] for r in xrows} != {'fy', 'admin', 'admin_n'}: bad.append(f"doj_leaving_series grains {sorted({r['grain'] for r in xrows})} != fy, admin, admin_n (D-062, D-066, D-072)")
    if {r['dimension'] for r in xrows} != {'los', 'age', 'supervisory'}: bad.append(f"doj_leaving_series dimensions {sorted({r['dimension'] for r in xrows})}")
    lk = {(r['entity'], r['grain'], r['period'], r['dimension'], r['value']): r for r in lrows if r['grain'] in ('fy', 'admin', 'admin_n') and r['dimension'] != 'occupation'}
    lsum, tot, unk = {}, {}, {}
    lflows = ['departures', 'headcount', 'sep_drp'] + [c for c in lc if c.startswith('sep_') and c != 'sep_drp']
    for r in xrows:
        k = (r['entity'], r['grain'], r['period'], r['dimension'], r['value'])
        a = lsum.setdefault(k, {c: 0 for c in lflows + ['rate_num', 'rate_den', 'na']})
        for c in lflows + ['rate_num', 'rate_den']: a[c] += r[c] or 0
        a['na'] += r['rate_not_applicable'] is True and r['departures'] > 0   # a departure in a no-staff group cell
        g = (r['entity'], r['grain'], r['period'], r['series_group'], r['dimension'])
        tot[g] = tot.get(g, 0) + r['departures']
        if r['is_unknown']: unk[g] = unk.get(g, 0) + r['departures']
        if r['is_unknown'] and any(r[c] is not None for c in ('rate_num', 'rate_den', 'rate_small_base', 'rate_not_applicable')): bad.append(f'{k} Unknown carries a rate')
        if not r['is_unknown'] and (r['rate_not_applicable'] is True) != (r['rate_den'] is None): bad.append(f"{k} {r['series_group']} not-applicable flag inconsistent")
        lr = lk.get(k)
        if lr and any(r[f] != lr[f] for f in ('provisional', 'partial', 'reissued', 'months_published', 'period_last_month', 'is_unknown')):
            bad.append(f"{k} {r['series_group']} flags differ from doj_leaving")
    for r in xrows:
        g = (r['entity'], r['grain'], r['period'], r['series_group'], r['dimension'])
        want_cov = round((tot[g] - unk.get(g, 0)) / tot[g], 4) if tot[g] else None
        if r['coverage'] != want_cov: bad.append(f"{g} coverage {r['coverage']} != {want_cov}"); break
    if set(lsum) != set(lk): bad.append(f'doj_leaving_series covers {len(lsum)} cells, doj_leaving fy {len(lk)}')
    # admin_n series cells partition doj_admin's group rows at N (departures, headcount at month N), per dimension
    adm = {(r['entity'], r['series_group'], r['administration'], r['months_in_office']): r for r in cubes()['doj_admin'][2]}
    an = {}
    for r in xrows:
        if r['grain'] != 'admin_n': continue
        a_ = an.setdefault((r['entity'], r['series_group'], r['period'], r['dimension'], r['months_published']), [0, 0])
        a_[0] += r['departures']; a_[1] += r['headcount']
    for (e, gr, a, d, n), (dep, hc) in an.items():
        ar = adm.get((e, gr, a, n))
        if ar is None or dep != ar['departures'] or hc != ar['headcount_n']:
            bad.append(f"doj_leaving_series admin_n {e} {gr} {a} {d} N={n}: {dep}/{hc} != doj_admin {ar and ar['departures']}/{ar and ar['headcount_n']}")
    leaving_na = 0
    for k, a in lsum.items():
        lr = lk.get(k)
        if lr is None: continue
        for c in lflows:
            if a[c] != lr[c]: bad.append(f'{k} {c}: groups sum {a[c]} != doj_leaving {lr[c]}')
        if not near(a['rate_den'], lr['rate_den'], 0.01 * 16): bad.append(f"{k} rate_den groups sum {a['rate_den']} != doj_leaving {lr['rate_den']}")
        if a['na']: leaving_na += 1
        if (a['na'] and (a['rate_num'] or 0) > (lr['rate_num'] or 0)) or (not a['na'] and not near(a['rate_num'], lr['rate_num'])):
            bad.append(f"{k} rate_num groups sum {a['rate_num']} vs doj_leaving {lr['rate_num']}")
    # 3. independent recomputation of a sample of doj_core_series rows from doj_* (own SQL, own grouping)
    E_ = 'personnel_action_effective_date_month'
    sample = [(e, g) for e in ('DOJ', 'DJ03', 'DJ02') for g in ('0905', '0007', '1811', 'other')]
    skey = {(r['entity'], r['series_group'], r['grain'], r['period']): r for r in srows}
    c = db(); n = 0
    for grain, period, lo, hi in (('fy', 'FY2025', '2024-10-01', '2025-09-01'), ('fy', 'FY2026', '2025-10-01', '2026-09-01'),
                                  ('quarter', 'FY2026Q3', '2026-04-01', '2026-06-01'), ('month', '2025-09', '2025-09-01', '2025-09-01')):
        for e, g in sample:
            ef = '' if e == 'DOJ' else f"and agency_subelement_code = '{e}'"
            sq = f"{series_sql()} = '{g}' {ef}"
            hc = c.execute(f"select count(*) from doj_employment where snapshot_month = (select max(snapshot_month) from doj_employment where snapshot_month between '{lo}' and '{hi}') and {sq}").fetchone()[0]
            dep, quit_ = c.execute(f"select count(*), count(*) filter (where separation_category_code = 'SC') from doj_separations where {E_} between '{lo}' and '{hi}' and {sq}").fetchone()
            hires = c.execute(f"select count(*) from doj_accessions where {E_} between '{lo}' and '{hi}' and {sq}").fetchone()[0]
            mean_h = c.execute(f"select count(*) * 1.0 / count(distinct snapshot_month) from doj_employment where snapshot_month between '{lo}' and '{hi}' and {sq}").fetchone()[0]
            r = skey.get((e, g, grain, period))
            if r is None:
                if hc or dep or hires: bad.append(f'sample {e} {g} {period} missing from doj_core_series')
                continue
            for col, v in (('headcount', hc), ('departures', dep), ('sep_quit', quit_), ('hires', hires)):
                if r[col] != v: bad.append(f'sample {e} {g} {period} {col} {r[col]} != recomputed {v}')
            if grain == 'fy' and mean_h and not near(r['rate_b_den'], mean_h, 0.001): bad.append(f"sample {e} {g} {period} rate_b_den {r['rate_b_den']} != {mean_h}")
            n += 1
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"series_groups.csv = D-062 constants; doj_core_series ({len(srows)} rows, {sum(len(v) for v in present.values())} entity-group pairs) "
        f"sums exactly to doj_core in all {len(sums)} entity-periods (stocks, flows, categories, rate denominators; rate numerators exactly in "
        f"{len(sums) - len(short)}; in {len(short)} a departure from a group with nobody on board in the window has no group rate under "
        f"D-027, so the groups' numerators sum below doj_core's), flags equal; "
        f"doj_leaving_series ({len(xrows)} rows, fy, admin, admin_n) sums to doj_leaving in all {len(lsum)} cells (rate numerators exactly except {leaving_na} cells holding a departure in a not-applicable group cell); {n} sample rows match an independent recomputation")

@check('admin_rollups', 'inv 3, D-066')
def _():
    import csv
    bad = []
    got = [(r['id'], r['name'], r['first_month'], r['last_month']) for r in csv.DictReader(open(f'{XW}/administrations.csv', encoding='utf-8'))]
    if got != ADMIN_SIGNED: bad.append(f'administrations.csv {got} != D-065 constants')
    am, ac, arows = cubes()['doj_admin']
    pub = snapshot_months(); wins = admin_windows(pub); prov = set(pub[-3:]); lastm = entity_last_months()
    cm, cc, crows = core()
    cmon = {(r['entity'], r['period']): r for r in crows if r['grain'] == 'month'}
    near = lambda a, b, tol=0.01: abs((a or 0) - (b or 0)) <= tol
    # 1. every 'all' row from doj_core month rows (stocks at month 0 and N, running flows, annualized rates)
    flows = ['hires', 'departures', 'sep_drp'] + [c for c in ac if c.startswith(('sep_', 'acc_')) and c != 'sep_drp']
    keys = set(); n_all = 0
    for r in arows:
        a = r['administration']; win = [m for m in wins[a] if m <= lastm[r['entity']]]
        keys.add((r['entity'], r['series_group'], a, r['months_in_office']))
        if r['admin_months'] != len(win): bad.append(f"{r['entity']} {a} admin_months {r['admin_months']} != {len(win)}"); continue
        ms = win[:r['months_in_office']]
        if r['month_n'] != ms[-1] or r['month_0'] != pub[pub.index(win[0]) - 1]: bad.append(f"{r['entity']} {a} N={r['months_in_office']} months wrong"); continue
        if r['provisional'] != any(m in prov for m in ms) or r['partial'] != (a == 'trump2'): bad.append(f"{r['entity']} {r['series_group']} {a} N={r['months_in_office']} flags wrong"); continue
        if r['headcount_change'] != r['headcount_n'] - r['headcount_0']: bad.append(f"{r['entity']} {a} change != n - 0")
        if r['series_group'] != 'all': continue
        n_all += 1; mr = [cmon[(r['entity'], m)] for m in ms]
        exp = {'headcount_0': cmon[(r['entity'], r['month_0'])]['headcount'], 'headcount_n': mr[-1]['headcount'],
               **{c: sum(x[c] for x in mr) for c in flows}}
        for c, v in exp.items():
            if r[c] != v: bad.append(f"{r['entity']} all {a} N={r['months_in_office']} {c} {r[c]} != doj_core {v}")
        den = sum(x['headcount'] for x in mr) / len(mr)
        if den and (not near(r['rate_den'], den, 1e-3) or not near(r['attrition_num'], exp['departures'] * 12 / len(mr), 1e-3)):
            bad.append(f"{r['entity']} all {a} N={r['months_in_office']} rate {r['attrition_num']}/{r['rate_den']} != {exp['departures'] * 12 / len(mr)}/{den}")
    # every (entity, group present, administration, N) row exists
    present = am.get('series_groups_present', {})
    want_keys = {(e, g, a, n) for e, gs in present.items() for g in gs for a in wins
                 for n in range(1, len([m for m in wins[a] if m <= lastm[e]]) + 1)}
    if keys != want_keys: bad.append(f'row set: {len(keys - want_keys)} extra, {len(want_keys - keys)} missing')
    # 2. series groups sum to 'all' (counts and denominators exactly; numerators per the D-027 caveat)
    tot, allr, short = {}, {}, 0
    for r in arows:
        k = (r['entity'], r['administration'], r['months_in_office'])
        if r['series_group'] == 'all': allr[k] = r; continue
        t = tot.setdefault(k, {c: 0 for c in ['headcount_0', 'headcount_n', 'headcount_change', 'rate_den', 'attrition_num', 'quit_num', 'retirement_num', 'empty'] + flows})
        for c in t:
            if c != 'empty': t[c] += r[c] or 0
        t['empty'] += r['rate_den'] is None
    for k, t in tot.items():
        ar = allr[k]
        for c in ['headcount_0', 'headcount_n', 'headcount_change'] + flows:
            if t[c] != ar[c]: bad.append(f'{k} {c}: groups {t[c]} != all {ar[c]}')
        if not near(t['rate_den'], ar['rate_den'], 0.01 * 17): bad.append(f"{k} rate_den groups {t['rate_den']} != all {ar['rate_den']}")
        for c in ('attrition_num', 'quit_num', 'retirement_num'):
            if t['empty'] and (t[c] or 0) > (ar[c] or 0) + 0.2: bad.append(f'{k} {c} groups {t[c]} > all {ar[c]}')
            elif not t['empty'] and not near(t[c], ar[c], 0.01 * 17): bad.append(f'{k} {c} groups {t[c]} != all {ar[c]}')
            elif t['empty'] and not near(t[c], ar[c], 0.01 * 17): short += 1
    # 3. independent recomputation of samples from doj_* (own SQL, D-065 constants, own series grouping)
    c = db(); E_ = 'personnel_action_effective_date_month'; n_s = 0
    for e, g, a, n in (('DOJ', 'all', 'trump2', len(wins['trump2'])), ('DOJ', 'all', 'biden', 19), ('DOJ', '0905', 'trump1', 19),
                       ('DJ03', '0007', 'biden', 48), ('DJ02', '1811', 'trump2', 12), ('DJ14', 'all', 'trump2', 16)):
        ms = wins[a][:n]; m0 = pub[pub.index(wins[a][0]) - 1]
        ef = '' if e == 'DOJ' else f"and agency_subelement_code = '{e}'"
        gf = '' if g == 'all' else f"and {series_sql()} = '{g}'"
        h0 = c.execute(f"select count(*) from doj_employment where strftime(snapshot_month, '%Y-%m') = '{m0}' {ef} {gf}").fetchone()[0]
        hn = c.execute(f"select count(*) from doj_employment where strftime(snapshot_month, '%Y-%m') = '{ms[-1]}' {ef} {gf}").fetchone()[0]
        dep = c.execute(f"select count(*) from doj_separations where strftime({E_}, '%Y-%m') between '{ms[0]}' and '{ms[-1]}' {ef} {gf}").fetchone()[0]
        hir = c.execute(f"select count(*) from doj_accessions where strftime({E_}, '%Y-%m') between '{ms[0]}' and '{ms[-1]}' {ef} {gf}").fetchone()[0]
        mh = c.execute(f"select count(*) * 1.0 / {len(ms)} from doj_employment where strftime(snapshot_month, '%Y-%m') between '{ms[0]}' and '{ms[-1]}' {ef} {gf}").fetchone()[0]
        r = next((x for x in arows if (x['entity'], x['series_group'], x['administration'], x['months_in_office']) == (e, g, a, n)), None)
        if r is None: bad.append(f'sample {e} {g} {a} N={n} missing'); continue
        for col, v in (('headcount_0', h0), ('headcount_n', hn), ('departures', dep), ('hires', hir)):
            if r[col] != v: bad.append(f'sample {e} {g} {a} N={n} {col} {r[col]} != recomputed {v}')
        if not near(r['rate_den'], mh, 1e-3) or not near(r['attrition_num'], dep * 12 / n, 1e-3): bad.append(f'sample {e} {g} {a} N={n} rate differs')
        n_s += 1
    t2 = next(x for x in arows if (x['entity'], x['series_group'], x['administration'], x['months_in_office']) == ('DOJ', 'all', 'trump2', len(wins['trump2'])))
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"administrations.csv = D-065 constants; {len(arows)} rows, every (entity, group, administration, N) present; {n_all} 'all' rows equal "
        f"doj_core month rows (month-0 and month-N headcount, running flows, annualized rates); series groups sum to 'all' in {len(tot)} cells "
        f"(numerators short in {short} under D-027); {n_s} samples match an independent recomputation; DOJ Trump II N={t2['months_in_office']}: "
        f"change {t2['headcount_change']:+,}, departures {t2['departures']:,}")

@check('coverage_columns', 'inv 4')
def _():
    c = db(); bad = []; n = 0
    # row-level fields a column names (source_field, or an underscored field name in its description)
    fields = {x[0] for ds in DATASETS for x in c.execute(f'describe doj_{ds}').fetchall() if '_' in x[0]}
    for name, (meta, cols, rows) in cubes().items():
        dic = {d['name']: d for d in meta['columns']}
        for d in meta['columns']:
            refs = {d.get('source_field')} | set(d.get('source_fields', [])) | {f for f in fields if re.search(rf'\b{f}\b', d.get('description', ''))}
            refs.discard(None)
            for f in refs:
                partly = sum(c.execute(f"select count(*) filter (where {f} is null or {f}::varchar = 'REDACTED') from doj_{ds}").fetchone()[0]
                             for ds in DATASETS if f in {x[0] for x in c.execute(f'describe doj_{ds}').fetchall()})
                if not partly or d.get('kind') == 'coverage' or d.get('coverage_for') or d.get('coverage_numerator_for'): continue
                cov = d.get('coverage_column'); n += 1
                if not cov or cov not in cols or dic.get(cov, {}).get('kind') != 'coverage' or dic[cov].get('coverage_for') != d['name']:
                    bad.append(f'{name}.{d["name"]} uses {f} ({partly:,} null or REDACTED rows) without a coverage column')
    low = None
    for name, (meta, cols, rows) in cubes().items():
        if 'years_of_service_lost_coverage' not in cols: continue
        for r in rows:
            want = round(r['yos_known'] / r['departures'], 4) if r['departures'] else None
            if r['years_of_service_lost_coverage'] != want:
                bad.append(f"{name} {r['entity']} {r.get('series_group', '')} {r['period']} coverage {r['years_of_service_lost_coverage']} != {want}"); break
        if name == 'doj_core':
            low = min((r['years_of_service_lost_coverage'] for r in rows if r['years_of_service_lost_coverage'] is not None), default=None)
    return not bad, '; '.join(bad[:5]) or f'{n} figure(s) on partly missing fields, each with its coverage column; lowest coverage {low}'

@check('known_data_issues', 'inv 4')
def _():
    import csv
    bad = []
    rows = list(csv.DictReader(open('pipeline/known_data_issues.csv', encoding='utf-8')))
    if rows and list(rows[0].keys()) != ISSUE_COLS: bad.append(f'columns {list(rows[0].keys())} != {ISSUE_COLS}')
    keys = [(r['id'], r['dataset'], r['field']) for r in rows]
    if len(keys) != len(set(keys)): bad.append('duplicate issue rows (id, dataset, field)')
    decisions = set(re.findall(r'^## (D-\d+)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M))
    for r in rows:
        if r['decision'] not in decisions: bad.append(f"{r['id']} cites {r['decision']}, not in ops/DECISIONS.md")
        if r['treatment'] not in ('unknown', 'unusable'): bad.append(f"{r['id']} treatment {r['treatment']}")
        if r['status'] not in ('active', 'retired'): bad.append(f"{r['id']} status {r['status']}")
        ym_ok = lambda x: re.fullmatch(r'\d{4}-\d{2}', x) is not None
        months_ok = ym_ok(r['first_file_month']) and (r['last_file_month'] == '' or (ym_ok(r['last_file_month']) and r['first_file_month'] <= r['last_file_month']))
        if r['treatment'] == 'unknown':   # a value rule is required
            vals_ok = r['value_min'] != '' and r['value_max'] != '' and float(r['value_min']) <= float(r['value_max'])
        else:                             # unusable: the whole field, no value rule
            vals_ok = r['value_min'] == '' and r['value_max'] == ''
        if not (months_ok and vals_ok): bad.append(f"{r['id']} {r['field']} bad month or value range for treatment {r['treatment']}")
    act = active_issues()
    import hashlib
    csv_sha = hashlib.sha256(open('pipeline/known_data_issues.csv', 'rb').read()).hexdigest()
    unusable = {(r['dataset'], r['field']): r['id'] for r in act if r['treatment'] == 'unusable'}
    for name, (m_, _, _) in cubes().items():
        applied = m_.get('known_data_issues', {})
        if [(a['id'], a['field']) for a in applied.get('applied', [])] != [(r['id'], r['field']) for r in act]:
            bad.append(f'{name} meta applied issues != active issues')
        if applied.get('sha256') != csv_sha: bad.append(f'{name} built from a different known_data_issues.csv')
        src = m_.get('source_fields')
        if not src: bad.append(f'{name} meta does not declare source_fields')
        for ds, fs in (src or {}).items():
            bad += [f'{name} reads {ds}.{f}, marked unusable by {unusable[(ds, f)]}' for f in fs if (ds, f) in unusable]
    # and no build code reads an unusable field (a declared list can be incomplete; the code cannot hide)
    for f in [x for x in os.listdir('pipeline') if x.startswith('build') and x.endswith('.py')]:
        code = '\n'.join(l.split('#', 1)[0] for l in open(f'pipeline/{f}', encoding='utf-8'))
        bad += [f'pipeline/{f} mentions {fld}, marked unusable by {i}' for (ds, fld), i in unusable.items() if re.search(rf'\b{fld}\b', code)]
        # a cube builder may not select every column, which the textual check cannot see through. build_db.py is
        # exempt: it loads the warehouse (raw views, doj_* tables) that the Look-Up republishes in full (invariant 10).
        if f != 'build_db.py':
            star = re.findall(r'select\s+(?:distinct\s+)?(?:\w+\.)?\*', code, re.I)
            if star: bad.append(f'pipeline/{f} has {len(star)} SELECT * (a cube builder must name its columns)')
    meta, cols, crows = core()
    # no matching value reaches the sum: DOJ month rows' excluded counts equal the matching rows in doj_separations,
    # and known + excluded + null = departures on every row
    c = db(); iss = issue_sql('separations', 'length_of_service_years')
    match = c.execute(f'select count(*) from doj_separations where {E} >= (select min(snapshot_month) from doj_employment) and ({iss})').fetchone()[0]
    nulls = dict((m.strftime('%Y-%m'), n) for m, n in c.execute(f'select {E}, count(*) from doj_separations where length_of_service_years is null group by 1').fetchall())
    doj_m = [r for r in crows if r['entity'] == 'DOJ' and r['grain'] == 'month']
    got = sum(r['yos_known_issue'] for r in doj_m)
    if got != match: bad.append(f'cube excludes {got} values, doj_separations has {match} matching active issues')
    off = [r['period'] for r in doj_m if r['yos_known'] + r['yos_known_issue'] + nulls.get(r['period'], 0) != r['departures']]
    if off: bad.append(f'known + excluded + null != departures in {off[:3]}')
    # doj_leaving: DOJ length-of-service Unknown departures over all fiscal years = active matches + NULLs
    lm_, lc_, lrows = cubes()['doj_leaving']
    unk = sum(r['departures'] for r in lrows if r['entity'] == 'DOJ' and r['grain'] == 'fy' and r['dimension'] == 'los' and r['is_unknown'])
    nnull = c.execute(f'select count(*) from doj_separations where {E} >= (select min(snapshot_month) from doj_employment) and length_of_service_years is null').fetchone()[0]
    if unk != match + nnull: bad.append(f'doj_leaving los unknown {unk} != {match} issue values + {nnull} NULL')
    return not bad, '; '.join(bad[:5]) or (f"{len(rows)} issue row(s), {len(act)} active ({', '.join(sorted({r['id'] + ' ' + r['treatment'] for r in act}))}), "
        f"each citing a decision; {match} DOJ values excluded from years_of_service_lost and counted Unknown in doj_leaving; "
        f"no cube or build file reads an unusable field ({', '.join(f'{d}.{f}' for d, f in unusable)})")

KNOWN_BREAK_MONTHS = {2025: ['2025-09'], 2026: ['2025-10']}  # signed constants, D-038 (years from D-012/D-021)

@check('known_breaks_meta', 'inv 7')
def _():
    import csv
    signed = known_breaks()
    listed = [dict(r) for r in csv.DictReader(open('pipeline/known_breaks.csv', encoding='utf-8'))]
    meta = core()[0].get('known_breaks')
    bad = []
    if {int(r['fiscal_year']) for r in listed} != signed: bad.append(f"pipeline/known_breaks.csv years {sorted(int(r['fiscal_year']) for r in listed)} != signed {sorted(signed)}")
    if meta is None: return False, 'doj_core meta has no known_breaks'
    if sorted(b['fiscal_year'] for b in meta) != sorted(signed): bad.append(f"doj_core meta known_breaks {sorted(b['fiscal_year'] for b in meta)} != signed {sorted(signed)}")
    ids = decision_ids()
    for b in meta:
        fy = b['fiscal_year']
        inside = [m for m in b.get('months', []) if f'{fy - 1}-10' <= m <= f'{fy}-09']
        if not b.get('months') or inside != b['months']: bad.append(f'FY{fy} months {b.get("months")} not all inside FY{fy}')
        if b.get('decision') not in ids: bad.append(f"FY{fy} cites {b.get('decision')}, not in ops/DECISIONS.md")
    # months: known_breaks.csv == meta == the D-038 constants
    if set(KNOWN_BREAK_MONTHS) != signed: bad.append(f'D-038 constants cover {sorted(KNOWN_BREAK_MONTHS)}, signed years are {sorted(signed)}')
    csv_m = {int(r['fiscal_year']): r['months'].split(';') for r in listed}
    meta_m = {b['fiscal_year']: b.get('months') for b in meta}
    if csv_m != KNOWN_BREAK_MONTHS: bad.append(f'pipeline/known_breaks.csv months {csv_m} != D-038 {KNOWN_BREAK_MONTHS}')
    if meta_m != KNOWN_BREAK_MONTHS: bad.append(f'doj_core meta known_breaks months {meta_m} != D-038 {KNOWN_BREAK_MONTHS}')
    return not bad, '; '.join(bad) or 'doj_core meta known_breaks = signed list and D-038 months: ' + ', '.join(f"FY{b['fiscal_year']} {'/'.join(b['months'])} ({b['decision']})" for b in meta)

@check('time_basis_effective', 'inv 6')
def _():
    bad = []; n = 0
    for name, (meta, cols, rows) in cubes().items():
        if not any(d.get('kind') == 'flow' for d in meta['columns']): continue
        n += 1
        if meta.get('time_basis') != 'effective': bad.append(f"{name} meta time_basis {meta.get('time_basis')}")
        if 'time_basis' not in cols: bad.append(f'{name} has no time_basis column')
        else:
            off = sum(r['time_basis'] != 'effective' for r in rows)
            if off: bad.append(f'{name} {off} rows not effective')
    return not bad and n > 0, '; '.join(bad) or f'{n} flow cube(s), meta and every row effective'

@check('provisional_and_revisions', 'inv 8')
def _():
    meta, cols, rows = core(); bad = []
    pub = snapshot_months(); prov = set(pub[-3:]); pubset = set(pub); vers = manifest_versions(); lastm = entity_last_months()
    path = f'{CUBES}/revision_baseline.json'
    if not os.path.exists(path): return False, 'revision_baseline.json missing'
    bl = json.load(open(path))
    if bl.get('manifest_sha256') != canonical_manifest_hash(): bad.append('revision baseline is not for the current manifest')
    if bl.get('versions') != vers: bad.append('revision baseline versions != manifest versions')
    prior = bl.get('prior_versions')
    reissued = {m for m, v in vers.items() if prior and m in prior and prior[m] != v}
    for c in ('file_version', 'provisional', 'reissued', 'opm_incomplete'):
        if c not in cols: bad.append(f'cube lacks {c}')
    if bad: return False, '; '.join(bad)
    for r in rows:
        ms = period_months(r, pubset, lastm[r['entity']]); k = f"{r['entity']} {r['period']}"
        if r['provisional'] != any(m in prov for m in ms): bad.append(f"{k} provisional {r['provisional']}")
        if r['reissued'] != any(m in reissued for m in ms): bad.append(f"{k} reissued {r['reissued']}")
        fv = [f"{m} e{vers[m]['employment']} a{vers[m]['accessions']} s{vers[m]['separations']}" for m in ms]
        if r['file_version'] != fv: bad.append(f'{k} file_version {r["file_version"]} != {fv}')
        if r['opm_incomplete'] is not False: bad.append(f'{k} opm_incomplete {r["opm_incomplete"]} (none marked for DOJ)')
    flagged = sorted({r['period'] for r in rows if r['provisional'] and r['entity'] == 'DOJ'})
    # doj_leaving keeps each period's months and file versions once, in its "periods" map
    lrows = cubes()['doj_leaving'][2] + cubes()['doj_leaving_series'][2]
    periods = {}
    for cname in ('doj_leaving', 'doj_leaving_series'):
        for ent, data in _cache['parts'][cname].items():   # each entity file carries its own windows
            for key, pm in data.get('periods', {}).items():
                if key in periods and periods[key] != pm: bad.append(f'{cname} {ent} period {key} differs from another file')
                periods[key] = pm
    for key, pm in periods.items():
        g, p = key.split(':', 1)
        if g == 'admin':
            ms = admin_windows(pub).get(p)
        elif g == 'admin_n':
            ms = admin_windows(pub).get(p)[:admin_n_months(pub)]
        elif g == 'fy':
            fy = int(p[2:]); ms = [m for m in [f'{fy - 1}-{x:02d}' for x in (10, 11, 12)] + [f'{fy}-{x:02d}' for x in range(1, 10)] if m in pubset]
        else:
            i = pub.index(p); ms = pub[i - 11: i + 1] if i >= 11 else None
        if pm.get('months') != ms: bad.append(f'doj_leaving period {key} months {pm.get("months")} != {ms}')
        fv = [f"{m} e{vers[m]['employment']} a{vers[m]['accessions']} s{vers[m]['separations']}" for m in (ms or [])]
        if pm.get('file_version') != fv: bad.append(f'doj_leaving period {key} file_version differs from the manifest')
    lflag = set()
    for r in lrows:
        pm = periods.get(f"{r['grain']}:{r['period']}")
        if pm is None: bad.append(f"doj_leaving row {r['grain']}:{r['period']} has no periods entry"); break
        ms = [m for m in pm['months'] if m <= lastm[r['entity']]]
        if r['provisional'] != any(m in prov for m in ms) or r['reissued'] != any(m in reissued for m in ms) or r['opm_incomplete'] is not False:
            bad.append(f"doj_leaving {r['entity']} {r['grain']} {r['period']} {r['value']} flags wrong"); break
        if r['provisional'] and r['entity'] == 'DOJ': lflag.add(f"{r['grain']}:{r['period']}")
    return not bad, '; '.join(bad[:5]) or (f"provisional months {sorted(prov)}; DOJ periods flagged {flagged}; doj_leaving {sorted(lflag)}; "
        f"baseline present ({'prior manifest ' + str(bl.get('prior_manifest_sha256'))[:12] if prior else 'first build, no prior'}), "
        f'{len(reissued)} reissued; file versions on every doj_core row and every doj_leaving period')

@check('small_base_flags', 'inv 9')
def _():
    bad = []; flagged = {}; n = 0
    for name, (meta, cols, rows) in cubes().items():
        nd = [d for d in meta['columns'] if d.get('kind') == 'rate_numerator']
        groups = {}
        for d in nd:  # doj_core names by method (<rate>_<m>_num -> rate_<m>_den); doj_leaving declares them
            m = d['name'].rsplit('_', 2)[1] if 'denominator' not in d else d['name']
            groups.setdefault((m, d.get('denominator') or f'rate_{m}_den', d.get('small_base') or f'rate_{m}_small_base'), []).append(d['name'])
        for (m, den, flag), members in sorted(groups.items()):
            nums = members
            if den not in cols or flag not in cols: bad.append(f'{name} method {m} lacks {den} or {flag}'); continue
            for r in rows:
                if r[den] is None and not all(r[x] is None for x in nums):
                    bad.append(f"{name} {r['entity']} {r.get('period') or (str(r.get('administration')) + ' N=' + str(r.get('months_in_office')))} method {m} numerator without denominator")
                if r[den] is not None and r[den] <= 0:  # D-027: never a zero (or negative) denominator
                    bad.append(f"{name} {r['entity']} {r.get('period') or (str(r.get('administration')) + ' N=' + str(r.get('months_in_office')))} {den} = {r[den]} (D-027 forbids zero denominators)")
                want = None if r[den] is None else r[den] < 30
                n += r[den] is not None
                if r[flag] != want: bad.append(f"{name} {r['entity']} {r.get('period') or (str(r.get('administration')) + ' N=' + str(r.get('months_in_office')))} {flag} {r[flag]} != {want}")
                label = m.upper() if name == 'doj_core' else name
                if r[flag]: flagged[label] = flagged.get(label, 0) + 1
    return not bad, '; '.join(bad[:5]) or (f'{n} rate rows scanned, no zero denominator (D-027); small base (<30) flagged: '
                                           + ', '.join(f'{m} {k}' for m, k in sorted(flagged.items())))

# ---- web/: the site's own tests (stamp freshness, copy discipline, no CDN, cube contract) ----
@check('web_tests', 'web/')
def _():
    if not os.path.isdir('web/tests'): return False, 'web/tests missing'
    tests = sorted(os.path.join('web/tests', f) for f in os.listdir('web/tests') if f.endswith('.test.js'))
    r = subprocess.run(['node', '--test', *tests], capture_output=True, text=True, timeout=120)
    counts = dict(re.findall(r'^\u2139 (pass|fail|skipped) (\d+)$', r.stdout, re.M))
    return r.returncode == 0 and counts.get('fail') == '0', f"node --test: {counts.get('pass', '?')} pass, {counts.get('fail', '?')} fail, {counts.get('skipped', '?')} skipped"

# ---- promotion: web/data/ must equal the staged cube it was promoted from (pipeline/promote.py) ----
def decision_entry(did):
    """The text of one ops/DECISIONS.md entry, from its '## D-nnn' heading to the next '## ' heading ('' if absent)."""
    m = re.search(rf'^## {re.escape(did)}\b.*?(?=^## |\Z)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M | re.S)
    return m.group(0) if m else ''

def decision_approves(did, cube):
    """A decision approves promoting a cube only if its own entry names the cube and says promot(e/ion/ed)."""
    text = decision_entry(did)
    # the HEADING line must say promote/promotion and name the cube as a whole word (a decision that only
    # mentions promotion in its body, or names doj_core_series, does not approve doj_core or doj_leaving)
    heading = text.split('\n', 1)[0]
    named = re.search(rf'(?<![\w-]){re.escape(cube)}(?![\w-])', heading) is not None
    return bool(text) and named and re.search(r'promot', heading, re.I) is not None

STAGED_TARGETS = {'lookup': ('warehouse', 'warehouse/lookup/lookup.meta.json')}  # as pipeline/promote.py TARGETS

def staged_meta_path(cube):
    return STAGED_TARGETS[cube][1] if cube in STAGED_TARGETS else f'{CUBES}/{cube}.meta.json'

def staged_path(cube, published):
    """The staged file behind a published path (web/data/<published>)."""
    if published == f'{cube}.meta.json': return staged_meta_path(cube)
    return f'{STAGED_TARGETS[cube][0]}/{published}' if cube in STAGED_TARGETS else f'{CUBES}/{published}'

@check('promoted_matches_staged', 'inv 1')
def _():
    import hashlib
    dest = os.environ.get('OPM_WEB_DATA') or 'web/data'
    tag = f' [override {dest}]' if os.environ.get('OPM_WEB_DATA') else ''
    if not os.path.isdir(dest): return True, 'nothing promoted' + tag
    h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    present = sorted(os.path.relpath(os.path.join(r, f), dest) for r, _, fs in os.walk(dest) for f in fs)  # every file, any depth
    if not present: return True, 'nothing promoted' + tag
    rec_path = f'{dest}/promotions.json'
    if not os.path.exists(rec_path): return False, f'{len(present)} file(s) in {dest} but no promotions.json' + tag
    recs = json.load(open(rec_path)).get('cubes', {})
    problems, stale = [], set()
    expected = {'promotions.json'}
    for c, e in recs.items():
        expected |= {f'{c}.meta.json'} | (set(e['files']) if 'files' in e else {f'{c}.json'})
    problems += [f'unexpected file in {dest}: {f}' for f in present if f not in expected]
    for cube in sorted(recs):
        e = recs[cube]
        if not decision_approves(e.get('decision', ''), cube):
            problems.append(f"{cube} promoted under {e.get('decision')}, whose ops/DECISIONS.md entry does not approve promoting {cube}")
        if 'files' in e:   # a multi-file cube: meta plus one file per entity; cube_sha256 is their combined hash
            if digest_of(e['files']) != e.get('cube_sha256'): problems.append(f'{cube} promotions.json files do not give its cube_sha256')
            pairs = [(f'{cube}.meta.json', e.get('meta_sha256'))] + sorted(e['files'].items())
            smeta = staged_meta_path(cube)
            if os.path.exists(smeta):
                staged_files = {fi['path'] for fi in json.load(open(smeta)).get('files', {}).values()}
                if staged_files != set(e['files']): stale.add(cube)
        else:
            pairs = [(f'{cube}.json', e.get('cube_sha256')), (f'{cube}.meta.json', e.get('meta_sha256'))]
        for f, want_h in pairs:
            pub, stg = f'{dest}/{f}', staged_path(cube, f)
            if not os.path.exists(pub): problems.append(f'promotions.json names {cube} but {f} is missing from {dest}'); continue
            if h(pub) != want_h: problems.append(f'{f} in {dest} is not the file promotions.json records'); continue
            if not os.path.exists(stg): problems.append(f'{f} has no staged file in {CUBES}'); continue
            if h(pub) != h(stg): stale.add(cube)
    # L-038: a decision promotes a cube under one content only (one cube_sha256 and one meta_sha256)
    seen = {}
    for h_ in json.load(open(rec_path)).get('history', []):
        seen.setdefault((h_.get('cube'), h_.get('decision')), set()).add((h_.get('cube_sha256'), h_.get('meta_sha256')))
    problems += [f'{c} promoted under {d} with {len(v)} different contents (a refresh needs its own decision)' for (c, d), v in sorted(seen.items()) if len(v) > 1]
    problems += [f'stale: {c}' for c in sorted(stale)]
    return not problems, ('; '.join(problems) + tag if problems else '') or (f"{len(recs)} promoted cube(s) equal their staged files: "
        + ', '.join(f"{c} ({recs[c]['decision']})" for c in sorted(recs)) + tag)

# ---- served files must not be git-ignored (L-074: a broad .gitignore rule twice hid published files) ----
def served_files():
    """Every file under web/data/, every web/*.html page, and every local file the pages reference (src/href)."""
    out = set()
    for d, _, fs in os.walk('web/data'):
        out |= {os.path.join(d, f) for f in fs}
    for page in sorted(f for f in os.listdir('web') if f.endswith('.html')):
        out.add(f'web/{page}')
        html = open(f'web/{page}', encoding='utf-8').read()
        for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
            if re.match(r'^(?:[a-z][a-z0-9+.-]*:|//|#)', ref, re.I): continue   # external, data:, mailto:, anchors
            path = os.path.normpath(os.path.join('web', ref.split('?', 1)[0].split('#', 1)[0]))
            if path.startswith('web' + os.sep) or path == 'web': out.add(path)
    return sorted(out)

@check('served_files_not_ignored', 'inv 1')
def _():
    files = served_files()
    git = ['git', '-c', 'safe.directory=*', 'check-ignore', '--no-index', '--stdin']   # local only; --no-index covers tracked files too
    r = subprocess.run(git, input='\n'.join(files) + '\n', capture_output=True, text=True)
    if r.returncode not in (0, 1): return False, f'git check-ignore failed: {r.stderr.strip()[:200]}'
    ignored = [l for l in r.stdout.splitlines() if l]
    if not ignored:
        return True, f'{len(files)} served files (web/data and every file the pages reference) are not git-ignored'
    why = subprocess.run(git + ['-v'], input='\n'.join(ignored) + '\n', capture_output=True, text=True).stdout.splitlines()
    return False, f'{len(ignored)} served file(s) git-ignored: ' + '; '.join(why[:5]) + (f' (+{len(ignored) - 5} more)' if len(ignored) > 5 else '')

# ---- series labels: crosswalk display_label = web/copy.json series.<column>, both signed (D-015, D-018, D-020) ----
DRP_LABEL = ('DRP', 'D-020')  # the DRP overlay has no crosswalk row; its signed label is D-020's

@check('series_labels_consistent', 'D-020')
def _():
    copy = json.load(open('web/copy.json', encoding='utf-8'))
    series = copy.get('series')
    if not isinstance(series, dict): return False, 'web/copy.json has no top-level series section'
    st = series.get('_status', {})
    want = {}
    for name, prefix in (('separation_codes.csv', 'sep'), ('accession_codes.csv', 'acc')):
        for r in crosswalk(name, 'code')[0]:
            col = f"{prefix}_{r['proposed_category']}" if r['status'] == 'decided' else f"{prefix}_code_{r['code'].lower()}"
            want.setdefault(col, set()).add((r['display_label'], r['label_status'], r['code']))
    bad = []
    labels = {}
    for col, v in sorted(want.items()):
        texts = {t for t, _, _ in v}
        if len(texts) > 1: bad.append(f'{col}: crosswalk codes disagree on the label {sorted(texts)}'); continue
        unsigned = sorted(c for _, s_, c in v if s_ != 'signed')
        if unsigned: bad.append(f'{col}: crosswalk label_status not signed for {", ".join(unsigned)}')
        labels[col] = texts.pop()
    labels['sep_drp'] = DRP_LABEL[0]
    for col, text in labels.items():
        if col not in series: bad.append(f'web/copy.json series.{col} missing (expected "{text}")'); continue
        if series[col] != text: bad.append(f'series.{col} "{series[col]}" != crosswalk "{text}"')
        if st.get(col) != 'signed': bad.append(f'series.{col} status {st.get(col)}')
    return not bad, '; '.join(bad[:6]) or f'{len(labels)} series labels equal in crosswalks and web/copy.json, all signed'

# ---- copy: a page that reads web/data may use only signed copy keys (CLAUDE.md, D-034) ----
COPY_EXEMPT = {'shell:site.draftNotice'}  # the draft badge's own text (web/tools/copy-audit.js header)

@check('web_copy_signed', 'CLAUDE.md')
def _():
    """Runs web/tools/copy-audit.js --json (format opm-copy-audit/1), then re-derives every key's status from
    web/copy.json itself, so the tool's 'signed' is checked, not trusted."""
    tool = 'web/tools/copy-audit.js'
    if not os.path.exists(tool): return False, f'{tool} not present'
    r = subprocess.run(['node', tool, '--json'], capture_output=True, text=True, timeout=60)
    try:
        out = json.loads(r.stdout)
    except ValueError:
        return False, f'{tool} --json did not print JSON (exit {r.returncode}): {(r.stderr or r.stdout)[:200]}'
    if not isinstance(out, dict) or out.get('format') != 'opm-copy-audit/1':
        return False, f"{tool} format {out.get('format') if isinstance(out, dict) else type(out).__name__} != opm-copy-audit/1"
    copy = json.load(open('web/copy.json', encoding='utf-8'))
    def status(ref):
        sec, key = ref.split(':', 1)
        # top-level sections (shell, components, series, ...) sit beside 'pages'; page sections sit inside it
        block = copy.get(sec) if sec != 'pages' and not sec.startswith('_') and sec in copy else copy.get('pages', {}).get(sec)
        return (block or {}).get('_status', {}).get(key)
    bad = [f'audit error: {e}' for e in out.get('errors', [])]
    pages = out.get('pages') or []
    if not pages: bad.append('audit lists no pages')
    for pg in pages:
        name = pg.get('page') or pg.get('file')
        bad += [f'{name}: audit error: {e}' for e in pg.get('errors', [])]
        exempt = set(pg.get('exempt', []))
        if exempt - COPY_EXEMPT: bad.append(f'{name}: exempts {sorted(exempt - COPY_EXEMPT)} (only {sorted(COPY_EXEMPT)} may be)')
        mine = set()
        for k in pg.get('keys', []):
            st = status(k['ref'])
            if st is None: bad.append(f"{name}: {k['ref']} is not in web/copy.json"); continue
            if st != k.get('status'): bad.append(f"{name}: {k['ref']} is {st} in copy.json, audit says {k.get('status')}")
            if st != 'signed' and k['ref'] not in exempt: mine.add(k['ref'])
        if mine != set(pg.get('unsigned', [])): bad.append(f"{name}: unsigned {sorted(pg.get('unsigned', []))} != copy.json {sorted(mine)}")
        if pg.get('readsData') and mine: bad.append(f"{name} reads web/data and uses unsigned copy: {', '.join(sorted(mine)[:5])}")
    data_pages = [pg.get('page') for pg in pages if pg.get('readsData')]
    return not bad, '; '.join(bad[:5]) or (f"{len(data_pages)} of {len(pages)} pages read web/data ({', '.join(data_pages)}); "
        f"none uses an unsigned copy key; statuses re-checked against web/copy.json")

# ---- invariant 10: the Look-Up republishes OPM's release, never more (D-051 to D-054) ----
LOOKUP = 'warehouse/lookup'
LOOKUP_MAX, LOOKUP_WARN = 100_000_000, 5_000_000
LOOKUP_ENCODINGS = {'PLAIN', 'PLAIN_DICTIONARY', 'RLE_DICTIONARY', 'RLE', 'BIT_PACKED'}

# D-052 signed column lists, as literal constants: lookup_fields.csv and every Look-Up file must equal them, in order
_LOOKUP_COMMON = ['occupational_series_code', 'occupational_series', 'pay_plan_code', 'grade', 'age_bracket',
                  'length_of_service_years', 'supervisory_status', 'appointment_type', 'tenure', 'education_level',
                  'veteran_indicator', 'work_schedule', 'annualized_adjusted_basic_pay', 'duty_station_state']
LOOKUP_SIGNED = {
    'separations': ['agency_subelement_code', 'agency_subelement', 'personnel_action_effective_date_yyyymm', 'period',
                    'separation_category', 'drp_indicator'] + _LOOKUP_COMMON,
    'accessions': ['agency_subelement_code', 'agency_subelement', 'personnel_action_effective_date_yyyymm', 'period',
                   'accession_category'] + _LOOKUP_COMMON,
    'employment': ['snapshot_yyyymm', 'agency_subelement_code', 'agency_subelement'] + _LOOKUP_COMMON,
}
LOOKUP_PERIOD_SOURCE = 'FILE_MONTH'   # D-053: period is the source file's month

def lookup_fields():
    import csv
    out = {}
    for r in csv.DictReader(open(f'{XW}/lookup_fields.csv', encoding='utf-8')):
        out.setdefault(r['dataset'], []).append((int(r['order']), r['lookup_column'], r['opm_source_column']))
    return {d: [(c, s_) for _, c, s_ in sorted(v)] for d, v in out.items()}

def lookup_plan():
    """Gate's own reading of D-052 against the manifest: {name: (dataset, [manifest records])}."""
    by = {ds: sorted((x for x in MAN if x['dataset'] == ds), key=lambda x: (int(x['year']), int(x['month']))) for ds in DATASETS}
    plan = {'separations': ('separations', by['separations']), 'accessions': ('accessions', by['accessions'])}
    for x in by['employment']:
        if int(x['month']) == 9: plan[f"employment_FY{int(x['year'])}"] = ('employment', [x])
    if by['employment'] and int(by['employment'][-1]['month']) != 9: plan['employment_latest'] = ('employment', [by['employment'][-1]])
    return plan

def lookup_js_violations(root='web/assets/js'):
    """JS files that name data/lookup/ and contain an SQL join (the page reads one file and never joins, D-053)."""
    out = []
    for d, _, fs in os.walk(root):
        for f in fs:
            if not f.endswith(('.js', '.mjs')): continue
            code = open(os.path.join(d, f), encoding='utf-8').read()
            if 'data/lookup' in code and (re.search(r'\bJOIN\b', code) or re.search(r'\bjoin\s+[\w."\']+\s+(?:as\s+\w+\s+)?(?:on|using)\b', code, re.I)):
                out.append(os.path.join(d, f))
    return out

@check('lookup_allowlist_and_size', 'inv 10')
def _():
    import duckdb, hashlib
    bad, warn = [], []
    mpath = f'{LOOKUP}/lookup.meta.json'
    if not os.path.exists(mpath): return False, f'{mpath} missing (run pipeline/build_lookup.py)'
    meta = json.load(open(mpath)); flds = lookup_fields(); plan = lookup_plan()
    # lookup_fields.csv == the D-052 constants (columns, order, sources); the files are compared with the csv below
    for ds, cols in LOOKUP_SIGNED.items():
        got = [c for c, _ in flds.get(ds, [])]
        if got != cols: bad.append(f'lookup_fields.csv {ds} columns {got} != D-052 {cols}')
        srcs = {c: s_ for c, s_ in flds.get(ds, [])}
        bad += [f'lookup_fields.csv {ds}.{c} source {s_} (period must be {LOOKUP_PERIOD_SOURCE}, every other column its own name)'
                for c, s_ in srcs.items() if s_ != (LOOKUP_PERIOD_SOURCE if c == 'period' else c)]
    if set(flds) != set(LOOKUP_SIGNED): bad.append(f'lookup_fields.csv datasets {sorted(flds)} != D-052 {sorted(LOOKUP_SIGNED)}')
    h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    # the file set, the meta hashes, the combined hash and the manifest
    on_disk = {f[:-8] for f in os.listdir(LOOKUP) if f.endswith('.parquet')}
    other = [f for f in os.listdir(LOOKUP) if not f.endswith('.parquet') and f != 'lookup.meta.json']
    if on_disk != set(plan): bad.append(f'files on disk {sorted(on_disk ^ set(plan))} differ from the D-052 plan')
    if set(meta.get('files', {})) != set(plan): bad.append(f"meta lists {sorted(set(meta.get('files', {})) ^ set(plan))} unlike the plan")
    bad += [f'unexpected file {LOOKUP}/{f}' for f in other]
    if meta.get('complete') is not True: bad.append('meta says the build is incomplete')
    if meta.get('manifest_sha256') != canonical_manifest_hash(): bad.append('meta manifest hash is not the current manifest')
    if meta.get('fields_file', {}).get('sha256') != h(f'{XW}/lookup_fields.csv'): bad.append('meta built from a different lookup_fields.csv')
    if meta.get('files_sha256') != digest_of({fi['path']: fi['sha256'] for fi in meta.get('files', {}).values()}): bad.append('files_sha256 does not match the listed files')
    con = duckdb.connect(); con.execute("SET memory_limit='2GB'")
    kdi = [r for r in active_issues() if r['treatment'] == 'unknown' and r['dataset'] == 'separations' and r['field'] == 'length_of_service_years']
    sizes, checked = {}, 0
    for name, (ds, recs) in sorted(plan.items()):
        path = f'{LOOKUP}/{name}.parquet'; fi = meta.get('files', {}).get(name, {})
        if not os.path.exists(path): continue
        size = os.path.getsize(path); sizes[name] = size
        if size >= LOOKUP_MAX: bad.append(f'{name}.parquet {size / 1e6:.1f} MB is not under 100 MB'); continue
        if size > LOOKUP_WARN: warn.append(f'{name}.parquet {size / 1e6:.1f} MB')
        if fi.get('path') != f'lookup/{name}.parquet' or fi.get('sha256') != h(path): bad.append(f'{name}.parquet sha256 or path differs from the meta')
        if fi.get('sources') != [{'file': x['filename'], 'version': int(x['version'])} for x in recs]: bad.append(f'{name} sources differ from the manifest files')
        # columns exactly the allow-list, in order, all VARCHAR; plain Parquet
        want = [c for c, _ in flds[ds]]
        sch = con.execute(f"DESCRIBE SELECT * FROM read_parquet('{path}')").fetchall()
        if [r[0] for r in sch] != want: bad.append(f'{name} columns {[r[0] for r in sch]} != lookup_fields.csv {want}'); continue
        if any(r[1] != 'VARCHAR' for r in sch): bad.append(f"{name} has non-VARCHAR columns {[r[0] for r in sch if r[1] != 'VARCHAR']}")
        pm = con.execute(f"SELECT list(DISTINCT compression), list(DISTINCT encodings), count(*) FILTER (WHERE bloom_filter_offset IS NOT NULL) FROM parquet_metadata('{path}')").fetchone()
        encs = {e.strip() for x in pm[1] for e in x.split(',')}
        fv = con.execute(f"SELECT format_version FROM parquet_file_metadata('{path}')").fetchone()[0]
        if set(pm[0]) != {'ZSTD'} or not encs <= LOOKUP_ENCODINGS or pm[2] or fv != 1:
            bad.append(f'{name} is not plain Parquet v1 + ZSTD (compression {pm[0]}, encodings {sorted(encs)}, bloom {pm[2]}, format {fv})')
        if con.execute(f"SELECT count(*) FROM parquet_kv_metadata('{path}')").fetchone()[0]: bad.append(f'{name} carries key-value metadata')
        # the raw DOJ rows of the same source files, selected independently (period = the file's month, YYYYMM)
        files = [f"data/{DATASETS[ds]}/{x['filename']}.parquet" for x in recs]
        src = f"read_parquet([{', '.join(repr(f) for f in files)}], union_by_name=true, filename=true)"
        names = {r[0] for r in con.execute(f'DESCRIBE SELECT * FROM {src} LIMIT 0').fetchall()}
        doj = "coalesce(department_code, agency_code) = 'DJ'" if 'department_code' in names else "agency_code = 'DJ'"
        sel = ', '.join("regexp_extract(filename, '_([0-9]{6})_[0-9]+[.]parquet$', 1) AS period" if s_ == 'FILE_MONTH' else f'{s_} AS {c}' for c, s_ in flds[ds])
        con.execute(f'CREATE OR REPLACE TEMP TABLE r AS SELECT {sel} FROM {src} WHERE {doj}')
        con.execute(f"CREATE OR REPLACE TEMP TABLE l AS SELECT * FROM read_parquet('{path}')")
        # one-to-one with the source: identical multisets, and equal counts per source month
        a = con.execute('SELECT count(*) FROM (SELECT * FROM l EXCEPT ALL SELECT * FROM r)').fetchone()[0]
        b = con.execute('SELECT count(*) FROM (SELECT * FROM r EXCEPT ALL SELECT * FROM l)').fetchone()[0]
        if a or b: bad.append(f'{name}: {a} Look-Up rows not in the source, {b} source rows not in the Look-Up')
        key = 'period' if 'period' in want else 'snapshot_yyyymm'
        agg = ', '.join(f"count(*) FILTER (WHERE {c} = 'REDACTED'), count(*) FILTER (WHERE {c} IS NULL)" for c in want)
        lc = {x[0]: x[1:] for x in con.execute(f'SELECT {key}, count(*), {agg} FROM l GROUP BY 1').fetchall()}
        rc = {x[0]: x[1:] for x in con.execute(f'SELECT {key}, count(*), {agg} FROM r GROUP BY 1').fetchall()}
        if lc != rc:
            diff = sorted(k for k in set(lc) | set(rc) if lc.get(k) != rc.get(k))
            bad.append(f'{name}: row, REDACTED or NULL counts differ from the raw DOJ rows in source month(s) {diff[:3]}')
        if name == 'separations' and kdi:   # KDI-001 values present and unchanged (as published)
            cond = ' OR '.join(f"(period BETWEEN '{r['first_file_month'].replace('-', '')}' AND '{(r['last_file_month'] or '9999-12').replace('-', '')}' "
                               f"AND try_cast(length_of_service_years AS DOUBLE) BETWEEN {r['value_min']} AND {r['value_max']})" for r in kdi)
            got = con.execute(f'SELECT count(*) FROM l WHERE {cond}').fetchone()[0]
            want_n = db().execute(f"SELECT count(*) FROM doj_separations WHERE {issue_sql('separations', 'length_of_service_years')}").fetchone()[0]
            kept = con.execute(f'SELECT count(*) FROM (SELECT * FROM l WHERE {cond} EXCEPT ALL SELECT * FROM r WHERE {cond})').fetchone()[0]
            if got != want_n or kept: bad.append(f'separations: {got} KDI-001 rows, {want_n} expected, {kept} changed')
            kdi_n = got
        checked += 1
    # no code that could link rows across files or months
    code = '\n'.join(l.split('#', 1)[0] for l in open('pipeline/build_lookup.py', encoding='utf-8'))
    # an SQL JOIN (a '.' before 'join' is a method call such as str.join, not SQL)
    for pat, what in ((r'(?<![.\w])join\b', 'JOIN'), (r'\bover\s*\(', 'window function'), (r'select\s+(?:distinct\s+)?(?:\w+\.)?\*', 'SELECT *')):
        if re.search(pat, code, re.I): bad.append(f'pipeline/build_lookup.py contains {what}')
    js = lookup_js_violations()
    bad += [f'{f} names data/lookup/ and joins' for f in js]
    big = max(sizes.items(), key=lambda x: x[1]) if sizes else ('none', 0)
    return not bad, '; '.join(bad[:5]) + (f' (+{len(bad) - 5} more)' if len(bad) > 5 else '') or (
        f"{checked} files: columns = lookup_fields.csv = D-052 constants (all VARCHAR, plain Parquet v1 + ZSTD); every row one-to-one with the raw DOJ rows "
        f"(EXCEPT ALL empty both ways; row, REDACTED and NULL counts equal per source month); KDI-001 rows kept as published ({locals().get('kdi_n', 0)}); "
        f"hashes, combined hash and manifest current; largest {big[0]}.parquet {big[1] / 1e6:.2f} MB (limit 100 MB"
        + (f"; over 5 MB: {', '.join(warn)}" if warn else '; none over 5 MB') + '); no join, window or SELECT * in build_lookup.py; '
        f"no web JS joins Look-Up data")

PLANNED = []
for name, guards, phase in PLANNED:
    print(f"PLAN  {name:28s} [{guards}] not built yet; required before {phase} ships")

n_pass = sum(ok for _, ok in RESULTS)
print(f"\n{n_pass} of {len(RESULTS)} checks pass ({len(PLANNED)} planned)")
sys.exit(0 if n_pass == len(RESULTS) else 1)
