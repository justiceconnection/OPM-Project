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
            and pat.search(open(f, encoding='utf-8').read())]
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

PLANNED = [
    ('output_manifest_hash', 'inv 1', 'Phase 2'), ('stock_flow_rollups', 'inv 3', 'Phase 2'),
    ('coverage_columns', 'inv 4', 'Phase 2'),
    ('time_basis_effective', 'inv 6', 'Phase 2'), ('provisional_and_revisions', 'inv 8', 'Phase 2'),
    ('small_base_flags', 'inv 9', 'Phase 2'), ('lookup_allowlist_and_size', 'inv 10', 'Phase 3'),
]
for name, guards, phase in PLANNED:
    print(f"PLAN  {name:28s} [{guards}] not built yet; required before {phase} ships")

n_pass = sum(ok for _, ok in RESULTS)
print(f"\n{n_pass} of {len(RESULTS)} checks pass ({len(PLANNED)} planned)")
sys.exit(0 if n_pass == len(RESULTS) else 1)
