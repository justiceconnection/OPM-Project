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
                data = json.load(open(f"{CUBES}/{meta['file']}"))
                out[meta['cube']] = (meta, data['columns'], [dict(zip(data['columns'], r)) for r in data['rows']])
        if not out: raise RuntimeError(f'no cube meta in {CUBES}/ (run pipeline/build_cubes.py)')
        _cache['c'] = out
    return _cache['c']

def core():
    return cubes()['doj_core']

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
        got = hashlib.sha256(open(f"{CUBES}/{meta['file']}", 'rb').read()).hexdigest()
        if meta.get('cube_sha256') != got: bad.append(f'{name} cube_sha256 does not match {meta["file"]}')
    return not bad, '; '.join(bad) or f'{len(cubes())} cube(s) built from manifest {want[:12]}; cube file hashes match their meta'

ISSUE_COLS = ['id', 'dataset', 'field', 'first_file_month', 'last_file_month', 'value_min', 'value_max', 'treatment',
              'status', 'decision', 'note']

def active_issues():
    import csv
    return [r for r in csv.DictReader(open('pipeline/known_data_issues.csv', encoding='utf-8')) if r['status'] == 'active']

def issue_sql(dataset, field):
    """Gate's own reading of pipeline/known_data_issues.csv: true when the row's value matches an active issue."""
    conds = [f"(period >= DATE '{r['first_file_month']}-01' AND period <= DATE '{r['last_file_month']}-01' "
             f"AND {field} >= {r['value_min']} AND {field} <= {r['value_max']})"
             for r in active_issues() if r['dataset'] == dataset and r['field'] == field]
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

@check('coverage_columns', 'inv 4')
def _():
    c = db(); bad = []; n = 0
    # row-level fields a column names (source_field, or an underscored field name in its description)
    fields = {x[0] for ds in DATASETS for x in c.execute(f'describe doj_{ds}').fetchall() if '_' in x[0]}
    for name, (meta, cols, rows) in cubes().items():
        dic = {d['name']: d for d in meta['columns']}
        for d in meta['columns']:
            refs = {d.get('source_field')} | {f for f in fields if re.search(rf'\b{f}\b', d.get('description', ''))}
            refs.discard(None)
            for f in refs:
                partly = sum(c.execute(f"select count(*) filter (where {f} is null or {f}::varchar = 'REDACTED') from doj_{ds}").fetchone()[0]
                             for ds in DATASETS if f in {x[0] for x in c.execute(f'describe doj_{ds}').fetchall()})
                if not partly or d.get('kind') == 'coverage' or d.get('coverage_for') or d.get('coverage_numerator_for'): continue
                cov = d.get('coverage_column'); n += 1
                if not cov or cov not in cols or dic.get(cov, {}).get('kind') != 'coverage' or dic[cov].get('coverage_for') != d['name']:
                    bad.append(f'{name}.{d["name"]} uses {f} ({partly:,} null or REDACTED rows) without a coverage column')
    meta, cols, rows = core()
    for r in rows:
        want = round(r['yos_known'] / r['departures'], 4) if r['departures'] else None
        if r['years_of_service_lost_coverage'] != want:
            bad.append(f"{r['entity']} {r['period']} coverage {r['years_of_service_lost_coverage']} != {want}"); break
    low = min((r['years_of_service_lost_coverage'] for r in rows if r['years_of_service_lost_coverage'] is not None), default=None)
    return not bad, '; '.join(bad[:5]) or f'{n} figure(s) on partly missing fields, each with its coverage column; lowest coverage {low}'

@check('known_data_issues', 'inv 4')
def _():
    import csv
    bad = []
    rows = list(csv.DictReader(open('pipeline/known_data_issues.csv', encoding='utf-8')))
    if rows and list(rows[0].keys()) != ISSUE_COLS: bad.append(f'columns {list(rows[0].keys())} != {ISSUE_COLS}')
    ids = [r['id'] for r in rows]
    if len(ids) != len(set(ids)): bad.append('duplicate issue ids')
    decisions = set(re.findall(r'^## (D-\d+)', open('ops/DECISIONS.md', encoding='utf-8').read(), re.M))
    for r in rows:
        if r['decision'] not in decisions: bad.append(f"{r['id']} cites {r['decision']}, not in ops/DECISIONS.md")
        if r['treatment'] != 'unknown': bad.append(f"{r['id']} treatment {r['treatment']}")
        if r['status'] not in ('active', 'retired'): bad.append(f"{r['id']} status {r['status']}")
        if not (re.fullmatch(r'\d{4}-\d{2}', r['first_file_month']) and re.fullmatch(r'\d{4}-\d{2}', r['last_file_month'])
                and r['first_file_month'] <= r['last_file_month'] and float(r['value_min']) <= float(r['value_max'])):
            bad.append(f"{r['id']} bad month or value range")
    meta, cols, crows = core()
    act = active_issues()
    applied = meta.get('known_data_issues', {})
    if [a['id'] for a in applied.get('applied', [])] != [r['id'] for r in act]: bad.append('cube meta applied issues != active issues')
    import hashlib
    if applied.get('sha256') != hashlib.sha256(open('pipeline/known_data_issues.csv', 'rb').read()).hexdigest():
        bad.append('cube built from a different known_data_issues.csv')
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
    return not bad, '; '.join(bad[:5]) or (f"{len(rows)} issue(s), {len(act)} active, each citing a decision in ops/DECISIONS.md; "
        f"{match} DOJ values match and are excluded from years_of_service_lost ({', '.join(r['id'] for r in act)})")

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
    return not bad, '; '.join(bad[:5]) or (f"provisional months {sorted(prov)}; DOJ periods flagged {flagged}; baseline present "
        f"({'prior manifest ' + str(bl.get('prior_manifest_sha256'))[:12] if prior else 'first build, no prior'}), "
        f'{len(reissued)} reissued; file versions on every row')

@check('small_base_flags', 'inv 9')
def _():
    bad = []; flagged = {}; n = 0
    for name, (meta, cols, rows) in cubes().items():
        nums = [d['name'] for d in meta['columns'] if d.get('kind') == 'rate_numerator']
        methods = sorted({x.rsplit('_', 2)[1] for x in nums})
        for m in methods:
            den, flag = f'rate_{m}_den', f'rate_{m}_small_base'
            if den not in cols or flag not in cols: bad.append(f'{name} method {m} lacks {den} or {flag}'); continue
            for r in rows:
                if r[den] is None and not all(r[x] is None for x in nums if x.rsplit('_', 2)[1] == m):
                    bad.append(f"{name} {r['entity']} {r['period']} method {m} numerator without denominator")
                if r[den] is not None and r[den] <= 0:  # D-027: never a zero (or negative) denominator
                    bad.append(f"{name} {r['entity']} {r['period']} {den} = {r[den]} (D-027 forbids zero denominators)")
                want = None if r[den] is None else r[den] < 30
                n += r[den] is not None
                if r[flag] != want: bad.append(f"{name} {r['entity']} {r['period']} {flag} {r[flag]} != {want}")
                if r[flag]: flagged[m] = flagged.get(m, 0) + 1
    return not bad, '; '.join(bad[:5]) or (f'{n} rate rows scanned, no zero denominator (D-027); small base (<30) flagged: '
                                           + ', '.join(f'{m.upper()} {k}' for m, k in sorted(flagged.items())))

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
    return bool(text) and cube in text and re.search(r'promot', text, re.I) is not None

@check('promoted_matches_staged', 'inv 1')
def _():
    import hashlib
    dest = os.environ.get('OPM_WEB_DATA') or 'web/data'
    tag = f' [override {dest}]' if os.environ.get('OPM_WEB_DATA') else ''
    if not os.path.isdir(dest): return True, 'nothing promoted' + tag
    h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    present = sorted(os.listdir(dest))  # every file, not only *.json
    if not present: return True, 'nothing promoted' + tag
    rec_path = f'{dest}/promotions.json'
    if not os.path.exists(rec_path): return False, f'{len(present)} file(s) in {dest} but no promotions.json' + tag
    recs = json.load(open(rec_path)).get('cubes', {})
    problems, stale = [], set()
    expected = {'promotions.json'} | {f'{c}{x}' for c in recs for x in ('.json', '.meta.json')}
    problems += [f'unexpected file in {dest}: {f}' for f in present if f not in expected]
    for cube in sorted(recs):
        e = recs[cube]
        if not decision_approves(e.get('decision', ''), cube):
            problems.append(f"{cube} promoted under {e.get('decision')}, whose ops/DECISIONS.md entry does not approve promoting {cube}")
        for f, key in ((f'{cube}.json', 'cube_sha256'), (f'{cube}.meta.json', 'meta_sha256')):
            pub, stg = f'{dest}/{f}', f'{CUBES}/{f}'
            if not os.path.exists(pub): problems.append(f'promotions.json names {cube} but {f} is missing from {dest}'); continue
            if h(pub) != e.get(key): problems.append(f'{f} in {dest} is not the file promotions.json records'); continue
            if not os.path.exists(stg): problems.append(f'{f} has no staged file in {CUBES}'); continue
            if h(pub) != h(stg): stale.add(cube)
    problems += [f'stale: {c}' for c in sorted(stale)]
    return not problems, ('; '.join(problems) + tag if problems else '') or (f"{len(recs)} promoted cube(s) equal their staged files: "
        + ', '.join(f"{c} ({recs[c]['decision']})" for c in sorted(recs)) + tag)

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
        block = copy.get(sec) if sec in ('shell', 'components') else copy.get('pages', {}).get(sec)
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

PLANNED = [('lookup_allowlist_and_size', 'inv 10', 'Phase 3')]
for name, guards, phase in PLANNED:
    print(f"PLAN  {name:28s} [{guards}] not built yet; required before {phase} ships")

n_pass = sum(ok for _, ok in RESULTS)
print(f"\n{n_pass} of {len(RESULTS)} checks pass ({len(PLANNED)} planned)")
sys.exit(0 if n_pass == len(RESULTS) else 1)
