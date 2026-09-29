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
    ('coverage_columns', 'inv 4', 'Phase 2'), ('codes_mapped_and_partition', 'inv 5', 'Phase 1'),
    ('time_basis_effective', 'inv 6', 'Phase 2'), ('provisional_and_revisions', 'inv 8', 'Phase 2'),
    ('small_base_flags', 'inv 9', 'Phase 2'), ('lookup_allowlist_and_size', 'inv 10', 'Phase 3'),
]
for name, guards, phase in PLANNED:
    print(f"PLAN  {name:28s} [{guards}] not built yet; required before {phase} ships")

n_pass = sum(ok for _, ok in RESULTS)
print(f"\n{n_pass} of {len(RESULTS)} checks pass ({len(PLANNED)} planned)")
sys.exit(0 if n_pass == len(RESULTS) else 1)
