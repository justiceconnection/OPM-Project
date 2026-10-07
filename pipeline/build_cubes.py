"""Build the aggregate cubes from warehouse/opm.duckdb into warehouse/cubes/ (staging; never web/data/).

Run on its own:   .venv/bin/python pipeline/build_cubes.py
build_db.py also calls build(con) once every file is loaded. Idempotent: the cube file is deterministic, and
the sidecar meta (with its build time) and the revision baseline are rewritten only when their content changes.

Cube `doj_core` (docs/metric-spec.md; decisions D-015 to D-021):
  entities  DOJ total ('DOJ') plus each component code in pipeline/crosswalks/components.csv
  grains    month, quarter (fiscal), fy (FY2025 = Oct 2024 to Sep 2025); range from the first snapshot month
            (Oct 2011); actions effective before it are excluded (D-017). A component's rows end at its last
            employment month, and its final quarter and year are partial (D-024), unless components.csv continues it
            at 0 to the latest month (after_last_month 'zero', D-089: DJ14 from May 2026).
  stocks    the period's last published month.  flows: summed.  rates: numerator and denominator stored
            separately, so the page divides one by the other (methods A, B, C of D-019).
Format: JSON {"cube", "columns": [names], "rows": [[values]]}, typed, null kept distinct from 0.
Sidecar: doj_core.meta.json (manifest hash, build time, time_basis, column dictionary with kinds).
Revision baseline: revision_baseline.json (file versions per month, for the reissued flag).
Known data issues: pipeline/known_data_issues.csv; a value matching an active row is treated as unknown (D-026).
"""
import csv, datetime, hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'warehouse', 'cubes')
XW = os.path.join(ROOT, 'pipeline', 'crosswalks')
MANIFEST = os.path.join(ROOT, 'data', 'opm_manifest.json')
CUBE = 'doj_core'
E = 'personnel_action_effective_date_month'
DATASETS = ('employment', 'accessions', 'separations')
SMALL_BASE = 30          # invariant 9, D-007
PROVISIONAL_MONTHS = 3   # invariant 8, D-005
RATES = {'attrition': None, 'quit': 'sep_quit', 'retirement': 'sep_retirement'}  # None = all departures
RATE_CODES = {'sep_quit': {'SC'}, 'sep_retirement': {'SD', 'SE', 'SG'}}         # metric spec section 3
NONDRP = '_nondrp'   # D-080: <category>_nondrp = the category's departures without drp_indicator = 'Y'


def nondrp_cols(sep):
    """D-080: one non-DRP column per separation partition column; with sep_drp they partition departures."""
    return [c + NONDRP for c in sep]


def manifest_hash(path=MANIFEST):
    """sha256 of the manifest's canonical content: records sorted by (dataset, filename), keys sorted, compact
    separators. Insensitive to key order and whitespace in the file; sensitive to any value."""
    recs = sorted(json.load(open(path)), key=lambda x: (x['dataset'], x['filename']))
    return hashlib.sha256(json.dumps(recs, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def partition(xw_file, prefix):
    """Crosswalk -> {column: [codes]}, the same rule as build_db.partition (decided category or code of its own)."""
    groups = {}
    for r in csv.DictReader(open(os.path.join(XW, xw_file), encoding='utf-8')):
        col = f"{prefix}_{r['proposed_category']}" if r['status'] == 'decided' else f"{prefix}_code_{r['code'].lower()}"
        groups.setdefault(col, []).append(r['code'])
    return groups


def fy_of(m):   # m: datetime.date, first of month
    return m.year + (1 if m.month >= 10 else 0)


def fq_of(m):
    return (m.month + 2) % 12 // 3 + 1


def ym(m):
    return m.strftime('%Y-%m')


def fiscal_months(fy, q=None):
    """Calendar months (first of month) of a fiscal year or fiscal quarter, in order."""
    out = []
    for i in range(12):
        y, mo = (fy - 1, 10 + i) if i < 3 else (fy, i - 2)
        out.append(datetime.date(y, mo, 1))
    return out if q is None else out[(q - 1) * 3: q * 3]


ISSUES = os.path.join(ROOT, 'pipeline', 'known_data_issues.csv')
# unknown: a value matching an active issue counts as unknown (not summed, not in coverage);
# unusable: the field must not feed any cube for the affected files (D-032)
TREATMENTS = {'unknown', 'unusable'}
KNOWN_BREAKS = os.path.join(ROOT, 'pipeline', 'known_breaks.csv')
# every row-level field doj_core reads, by dataset (checked against 'unusable' issues; recorded in the meta)
CORE_SOURCE_FIELDS = {'employment': ['agency_subelement_code'],
                      'accessions': ['agency_subelement_code', 'accession_category_code'],
                      'separations': ['agency_subelement_code', 'separation_category_code', 'drp_indicator',
                                      'length_of_service_years']}


def known_issues():
    """Active rows of pipeline/known_data_issues.csv. Each row: dataset, field, file months (processing month of
    the source file, YYYY-MM, inclusive), value range (inclusive), treatment, decision. Later issues are rows."""
    rows = [r for r in csv.DictReader(open(ISSUES, encoding='utf-8')) if r['status'] == 'active']
    bad = [r['id'] for r in rows if r['treatment'] not in TREATMENTS]
    if bad:
        sys.exit(f'{CUBE} NOT built: known data issues with unsupported treatment: {bad}')
    return rows


def issue_predicate(issues, dataset, field):
    """SQL that is true when a row's value matches an active issue on this dataset and field, else 'false'."""
    parts = [f"(strftime(period, '%Y-%m') BETWEEN '{r['first_file_month']}' AND '{r['last_file_month'] or '9999-12'}' "
             f"AND {field} BETWEEN {float(r['value_min'])} AND {float(r['value_max'])})"
             for r in issues if r['dataset'] == dataset and r['field'] == field and r['treatment'] == 'unknown']
    return '(' + ' OR '.join(parts) + ')' if parts else 'false'


def refuse_unusable(cube, source_fields, issues):
    """Exit if a cube reads a field an active issue marks unusable (D-032). Cubes read every published file, so any
    such issue overlaps them."""
    hit = sorted(f"{r['id']} {r['dataset']}.{r['field']}" for r in issues if r['treatment'] == 'unusable'
                 and r['field'] in source_fields.get(r['dataset'], []))
    if hit:
        sys.exit(f'{cube} NOT built: it reads fields marked unusable: {hit}')


def known_breaks_list():
    """pipeline/known_breaks.csv -> [{fiscal_year, months, decision, note}] (the signed list, D-012/D-021)."""
    return [{'fiscal_year': int(r['fiscal_year']), 'months': r['months'].split(';'), 'decision': r['decision'],
             'note': r['note']} for r in csv.DictReader(open(KNOWN_BREAKS, encoding='utf-8'))]


def monthly_base(con, sep, acc, issues=(), group_sql=None):
    """{(entity, month): {headcount, hires, departures, categories, drp, los_sum, los_known}} for every entity
    that has any row, from the doj_* tables. Entity 'DOJ' is the total (grouping set without the component).
    With group_sql (the series group expression, D-062) the keys are (entity, group, month)."""
    def f(code_col, g, cond='', suffix=''):
        return ''.join(f", count(*) FILTER (WHERE {code_col} IN ({', '.join(repr(c) for c in cs)}){cond}) AS {col}{suffix}"
                       for col, cs in g.items())
    ent = "CASE WHEN grouping(agency_subelement_code) = 1 THEN 'DOJ' ELSE agency_subelement_code END"
    los_issue = issue_predicate(issues, 'separations', 'length_of_service_years')  # D-026
    gs = f', {group_sql} AS grp' if group_sql else ''
    gk = ', grp' if group_sql else ''
    queries = {
        'employment': f"""SELECT {ent} AS entity, snapshot_month AS month{gs}, count(*) AS headcount
            FROM doj_employment GROUP BY GROUPING SETS ((snapshot_month, agency_subelement_code{gk}), (snapshot_month{gk}))""",
        'separations': f"""SELECT {ent} AS entity, {E} AS month{gs}, count(*) AS departures
              {f('separation_category_code', sep)}, count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp
              {f('separation_category_code', sep, " AND drp_indicator IS DISTINCT FROM 'Y'", NONDRP)},
              sum(length_of_service_years) FILTER (WHERE NOT {los_issue}) AS los_sum,
              count(length_of_service_years) FILTER (WHERE NOT {los_issue}) AS los_known,
              count(*) FILTER (WHERE {los_issue}) AS los_issue
            FROM doj_separations GROUP BY GROUPING SETS (({E}, agency_subelement_code{gk}), ({E}{gk}))""",
        'accessions': f"""SELECT {ent} AS entity, {E} AS month{gs}, count(*) AS hires {f('accession_category_code', acc)}
            FROM doj_accessions GROUP BY GROUPING SETS (({E}, agency_subelement_code{gk}), ({E}{gk}))""",
    }
    base = {}
    for q in queries.values():
        cur = con.execute(q)
        names = [d[0] for d in cur.description]
        for row in cur.fetchall():
            d = dict(zip(names, row))
            key = (d.pop('entity'), d.pop('grp'), d.pop('month')) if group_sql else (d.pop('entity'), d.pop('month'))
            base.setdefault(key, {}).update(d)
    return base


SERIES_GROUPS = os.path.join(XW, 'series_groups.csv')
SERIES_CUBE = 'doj_core_series'


def series_groups():
    """pipeline/crosswalks/series_groups.csv -> ordered group ids (the listed codes, then 'other'; D-062)."""
    rows = sorted(csv.DictReader(open(SERIES_GROUPS, encoding='utf-8')), key=lambda r: int(r['order']))
    return [r['group'] for r in rows]


def series_group_sql(col='occupational_series_code'):
    """SQL giving a row its series group: a listed code, else 'other' (blank and NULL included, D-062)."""
    codes = [g for g in series_groups() if g != 'other']
    return (f"CASE WHEN trim(coalesce({col}, '')) IN ({', '.join(repr(c) for c in codes)}) "
            f"THEN trim({col}) ELSE 'other' END")


def versions_by_month():
    v = {}
    for x in json.load(open(MANIFEST)):
        v.setdefault(f"{int(x['year']):04d}-{int(x['month']):02d}", {})[x['dataset']] = int(x['version'])
    return v


def revision_baseline(mhash, current):
    """Keeps the file versions of the previous manifest, so a month whose version changed stays flagged until the
    next refresh. Rewritten only when the manifest changes, so re-running a build changes nothing. The first build
    has no prior, so every reissued flag is false."""
    path = os.path.join(OUT, 'revision_baseline.json')
    old = json.load(open(path)) if os.path.exists(path) else None
    if old and old.get('manifest_sha256') == mhash:
        return old
    new = {'manifest_sha256': mhash, 'versions': current,
           'prior_manifest_sha256': old['manifest_sha256'] if old else None,
           'prior_versions': old['versions'] if old else None,
           'note': 'versions = file version per month and dataset for manifest_sha256; prior_versions = the same for '
                   'the previous manifest (null on the first build). A month is reissued when any of its three '
                   'versions differs from prior_versions.'}
    write_json(path, new)
    return new


def write_json(path, obj, compact=False):
    text = json.dumps(obj, separators=(',', ':')) if compact else json.dumps(obj, indent=1)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text + '\n')
    os.replace(tmp, path)


def r4(x):
    return None if x is None else round(x, 4)


def _context(con, cube, source_fields):
    """Everything both doj_core and doj_core_series share: crosswalk partitions, entities, months, flags, periods,
    columns and the rate rules."""
    os.makedirs(OUT, exist_ok=True)
    sep, acc = partition('separation_codes.csv', 'sep'), partition('accession_codes.csv', 'acc')
    for col, codes in RATE_CODES.items():
        if set(sep.get(col, [])) != codes:
            sys.exit(f'{cube} NOT built: crosswalk {col} = {sep.get(col)} but the metric spec says {sorted(codes)}')
    comps = [r['agency_subelement_code'] for r in csv.DictReader(open(os.path.join(XW, 'components.csv'), encoding='utf-8'))]
    months = [r[0] for r in con.execute('SELECT DISTINCT snapshot_month FROM doj_employment ORDER BY 1').fetchall()]
    issues = known_issues()
    refuse_unusable(cube, source_fields, issues)
    mhash, vers = manifest_hash(), versions_by_month()
    bl = revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    ctx = {'sep': sep, 'acc': acc, 'entities': ['DOJ'] + comps, 'months': months, 'mset': set(months),
           'idx': {m: i for i, m in enumerate(months)}, 'issues': issues, 'mhash': mhash, 'vers': vers,
           'provisional': set(months[-PROVISIONAL_MONTHS:]),
           'reissued': {mk for mk, v in vers.items() if prior and mk in prior and prior[mk] != v},
           'flow_cols': ['hires', 'departures'] + list(sep) + ['sep_drp'] + nondrp_cols(sep) + list(acc)}
    periods = [('month', ym(m), fy_of(m), fq_of(m), [m]) for m in months]
    fys = sorted({fy_of(m) for m in months})
    for fy in fys:
        for q in range(1, 5):
            exp = fiscal_months(fy, q)
            if any(m in ctx['mset'] for m in exp):
                periods.append(('quarter', f'FY{fy}Q{q}', fy, q, exp))
    for fy in fys:
        periods.append(('fy', f'FY{fy}', fy, None, fiscal_months(fy)))
    ctx['periods'] = periods
    rate_cols = []
    for meth in 'abc':
        rate_cols += [f'{r}_{meth}_num' for r in RATES] + [f'rate_{meth}_den', f'rate_{meth}_months', f'rate_{meth}_small_base']
    ctx['columns'] = (['entity', 'grain', 'period', 'fiscal_year', 'fiscal_quarter', 'period_first_month', 'period_last_month',
                       'months_in_period', 'months_published', 'time_basis', 'file_version',
                       'provisional', 'partial', 'reissued', 'opm_incomplete',
                       'headcount', 'headcount_change'] + ctx['flow_cols'] + ['net_flow', 'years_of_service_lost', 'yos_known',
                       'yos_known_issue', 'years_of_service_lost_coverage'] + rate_cols)
    return ctx


def _month_rec(b, flow_cols):
    rec = {c: b.get(c) or 0 for c in flow_cols + ['headcount', 'los_known', 'los_issue']}
    rec['los_sum'] = b.get('los_sum') or 0.0
    return rec


CONTINUATION = {'zero'}   # components.csv after_last_month values (D-089); blank = rows end at the last month (D-024)


def continued_at_zero():
    """components.csv -> {code: last_month (date)} for each component whose after_last_month is 'zero': it ended at
    last_month and its rows continue at 0 to the latest published month (D-089). Each such row must cite its decision."""
    out = {}
    for r in csv.DictReader(open(os.path.join(XW, 'components.csv'), encoding='utf-8')):
        rule = r.get('after_last_month', '')
        if rule and (rule not in CONTINUATION or not r.get('after_last_month_decision') or not r.get('last_month')):
            sys.exit(f"components.csv {r['agency_subelement_code']}: after_last_month {rule!r} needs a value in "
                     f"{sorted(CONTINUATION)}, a decision and a last_month")
        if rule == 'zero':
            out[r['agency_subelement_code']] = datetime.date(*map(int, r['last_month'].split('-')), 1)
    return out


def entity_ends(cube, entities, months, last_emp, flows_after):
    """Each entity's last cube month and its last employment month. last_emp = {entity: last month with headcount};
    flows_after(entity, month) lists flows effective after that month, which make the build refuse.
    D-024: a component's rows end at its last employment month (DOJ: the latest published month).
    D-089: a component listed in components.csv with after_last_month 'zero' ended at its crosswalk last_month, which
    must equal its last employment month; its rows continue to the latest published month, the later months at 0."""
    emp = {e: last_emp.get(e) for e in entities}
    emp['DOJ'] = months[-1]
    lost = [x for e in entities if emp[e] for x in flows_after(e, emp[e])]
    if lost or None in emp.values():
        sys.exit(f'{cube} NOT built: flows after a component\'s last employment month, or a component never in '
                 f'employment: {lost[:5]} {[e for e, v in emp.items() if v is None]}')
    cont = {e: m for e, m in continued_at_zero().items() if e in emp}
    off = [(e, ym(m), ym(emp[e])) for e, m in cont.items() if emp[e] != m]
    if off:
        sys.exit(f'{cube} NOT built: components.csv last_month of a component continued at zero (D-089) differs from '
                 f'its last employment month (code, crosswalk, data): {off}')
    end = {e: months[-1] if e in cont else emp[e] for e in entities}
    return end, emp


def _entity_end(cube, ctx, head, flows_after):
    """entity_ends for the doj_core family. head = {entity: [months with headcount]}."""
    return entity_ends(cube, ctx['entities'], ctx['months'], {e: max(ms) for e, ms in head.items() if ms}, flows_after)


def continuation_meta(end, emp):
    """Meta block for D-089: the components whose rows continue at 0 after their last employment month."""
    return {'entity_last_employment_month': {e: ym(m) for e, m in emp.items()},
            'entity_continued_at_zero': {e: {'last_employment_month': ym(emp[e]), 'zero_from': ym(next_month(emp[e])),
                                             'through': ym(end[e]), 'decision': 'D-089'} for e in end if end[e] != emp[e]}}


def next_month(m):
    return datetime.date(m.year + m.month // 12, m.month % 12 + 1, 1)


def _period_rows(Me, e, end_e, ctx, columns, extra=None):
    """Every period row for one series of month records (Me = {month: record}) of entity e: stocks take the
    period's last month, flows are summed, rates are ratio-of-sums by methods A, B, C (D-019, D-023, D-027)."""
    months, idx, mset, vers = ctx['months'], ctx['idx'], ctx['mset'], ctx['vers']
    flow_cols = ctx['flow_cols']

    def rate_block(pub, last, grain):
        out = {}
        def put(meth, ms, factor):
            if ms is None:
                for r in RATES: out[f'{r}_{meth}_num'] = None
                out.update({f'rate_{meth}_den': None, f'rate_{meth}_months': None, f'rate_{meth}_small_base': None})
                return
            recs = [Me[m] for m in ms]
            den = sum(x['headcount'] for x in recs) / len(recs)
            if den == 0:  # D-027: no 0/0; the rate is empty, the months that went into it stay
                for r in RATES: out[f'{r}_{meth}_num'] = None
                out.update({f'rate_{meth}_den': None, f'rate_{meth}_months': len(ms), f'rate_{meth}_small_base': None})
                return
            for r, col in RATES.items():
                out[f'{r}_{meth}_num'] = r4(sum(x[col or 'departures'] for x in recs) * factor)
            out.update({f'rate_{meth}_den': r4(den), f'rate_{meth}_months': len(ms), f'rate_{meth}_small_base': den < SMALL_BASE})
        i = idx[last]
        put('a', months[i - 11: i + 1] if i >= 11 else None, 1)                    # trailing 12 months
        put('b', pub if grain == 'fy' else None, 1)                               # fiscal year; partial = year to date (D-023)
        put('c', pub, 12 / len(pub))                                              # annualized per period
        return out

    rows, prev = [], {}
    for grain, label, fy, q, exp in ctx['periods']:
        pub = [m for m in exp if m in mset and m <= end_e]
        if not pub:
            continue
        last = pub[-1]
        partial = len(pub) < len(exp)
        recs = [Me[m] for m in pub]
        flows = {c: sum(x[c] for x in recs) for c in flow_cols}
        dep, known = flows['departures'], sum(x['los_known'] for x in recs)
        row = {
            'entity': e, **(extra or {}), 'grain': grain, 'period': label, 'fiscal_year': fy,
            'fiscal_quarter': q if grain != 'fy' else None,
            'period_first_month': ym(exp[0]), 'period_last_month': ym(last),
            'months_in_period': len(exp), 'months_published': len(pub), 'time_basis': 'effective',
            'file_version': [f"{ym(m)} e{vers[ym(m)]['employment']} a{vers[ym(m)]['accessions']} "
                             f"s{vers[ym(m)]['separations']}" for m in pub],
            'provisional': any(m in ctx['provisional'] for m in pub), 'partial': partial,
            'reissued': any(ym(m) in ctx['reissued'] for m in pub), 'opm_incomplete': False,
            'headcount': Me[last]['headcount'],
            'headcount_change': (Me[last]['headcount'] - prev[grain]) if grain in prev else None,
            **flows,
            'net_flow': flows['hires'] - flows['departures'],
            'years_of_service_lost': round(sum(x['los_sum'] for x in recs), 1),
            'yos_known': known,
            'yos_known_issue': sum(x['los_issue'] for x in recs),
            'years_of_service_lost_coverage': r4(known / dep) if dep else None,
            **rate_block(pub, last, grain),
        }
        rows.append([row[c] for c in columns])
        prev[grain] = row['headcount']
    return rows


def _write_meta(cube, meta, nrows, summary):
    meta_path = os.path.join(OUT, f'{cube}.meta.json')
    old = json.load(open(meta_path)) if os.path.exists(meta_path) else None
    if old and {k: v for k, v in old.items() if k != 'built_at'} == {k: v for k, v in meta.items() if k != 'built_at'}:
        print(f'{cube}: unchanged ({nrows} rows); meta kept, built_at {old["built_at"]}')
        return
    meta['built_at'] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    write_json(meta_path, meta)
    print(summary)


def _common_meta(ctx, end, emp):
    return {
        'manifest_sha256': ctx['mhash'],
        'manifest_hash_method': 'sha256 of data/opm_manifest.json canonical content: records sorted by (dataset, filename), '
                                'json.dumps(sort_keys=True, separators=(",", ":"))',
        **continuation_meta(end, emp),
    }


def build(con):
    ctx = _context(con, CUBE, CORE_SOURCE_FIELDS)
    entities, months, flow_cols = ctx['entities'], ctx['months'], ctx['flow_cols']
    base = monthly_base(con, ctx['sep'], ctx['acc'], ctx['issues'])
    stray = sorted({e for e, _ in base} - set(entities))
    if stray:
        sys.exit(f'{CUBE} NOT built: components not in components.csv: {stray}')
    head = {}
    for (e, m), b in base.items():
        if b.get('headcount'): head.setdefault(e, []).append(m)
    end, emp = _entity_end(CUBE, ctx, head, lambda e, en: [(e, ym(m)) for (x, m), b in base.items()
                                                      if x == e and m > en and any(b.get(c) for c in flow_cols)])
    columns = ctx['columns']
    rows, by_grain, by_entity = [], {}, {}
    for e in entities:
        Me = {m: _month_rec(base.get((e, m), {}), flow_cols) for m in months}
        for r in _period_rows(Me, e, end[e], ctx, columns):
            rows.append(r)
            g = r[columns.index('grain')]
            by_grain[g] = by_grain.get(g, 0) + 1
            by_entity.setdefault(e, {}).setdefault(g, 0)
            by_entity[e][g] += 1

    # D-058: leftovers of this script's own atomic writes (an interrupted run); doj_core has no other stale outputs
    for f in (f'{CUBE}.json.tmp', f'{CUBE}.meta.json.tmp', 'revision_baseline.json.tmp'):
        if os.path.exists(os.path.join(OUT, f)):
            os.remove(os.path.join(OUT, f)); print(f'{CUBE}: removed stale {f} (D-058)')
    cube_path = os.path.join(OUT, f'{CUBE}.json')
    write_json(cube_path, {'cube': CUBE, 'columns': columns, 'rows': rows}, compact=True)
    cube_sha = hashlib.sha256(open(cube_path, 'rb').read()).hexdigest()

    meta = {
        'cube': CUBE, 'file': f'{CUBE}.json', 'format': 'json: {"cube", "columns": [names], "rows": [[values in column order]]}',
        **_common_meta(ctx, end, emp),
        'cube_sha256': cube_sha, 'built_at': None, 'time_basis': 'effective',
        'spec': 'docs/metric-spec.md (signed 2026-09-30, D-019 to D-021); D-024, D-027, D-089',
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'entities': entities, 'rows': len(rows), 'rows_by_grain': by_grain, 'rows_by_entity': by_entity,
        'entity_last_month': {e: ym(m) for e, m in end.items()},
        'provisional_months': [ym(m) for m in sorted(ctx['provisional'])],
        'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'source_fields': CORE_SOURCE_FIELDS,
        'known_breaks': known_breaks_list(),
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'treatment', 'decision')} for r in ctx['issues']]},
        'columns': column_dictionary(columns, ctx['sep'], ctx['acc']),
    }
    _write_meta(CUBE, meta, len(rows), f'{CUBE}: wrote {len(rows)} rows {by_grain} to {os.path.relpath(cube_path, ROOT)}')


SERIES_SOURCE_FIELDS = {ds: fs + ['occupational_series_code'] for ds, fs in CORE_SOURCE_FIELDS.items()}


def build_series(con):
    """doj_core_series (D-061, D-062): doj_core by series group, every grain, one file per entity holding all
    groups. A (entity, group) pair with no headcount and no flow in any month is left out (no staff ever)."""
    cube = SERIES_CUBE
    ctx = _context(con, cube, SERIES_SOURCE_FIELDS)
    entities, months, flow_cols = ctx['entities'], ctx['months'], ctx['flow_cols']
    groups = series_groups()
    base = monthly_base(con, ctx['sep'], ctx['acc'], ctx['issues'], group_sql=series_group_sql())
    stray = sorted({e for e, _, _ in base} - set(entities)) + sorted({g for _, g, _ in base} - set(groups))
    if stray:
        sys.exit(f'{cube} NOT built: components or groups not in the crosswalks: {stray}')
    head = {}
    for (e, g, m), b in base.items():
        if b.get('headcount'): head.setdefault(e, []).append(m)
    end, emp = _entity_end(cube, ctx, head, lambda e, en: [(e, g, ym(m)) for (x, g, m), b in base.items()
                                                      if x == e and m > en and any(b.get(c) for c in flow_cols)])
    columns = ['entity', 'series_group'] + ctx['columns'][1:]
    present = {(e, g) for (e, g, m), b in base.items() if b.get('headcount') or any(b.get(c) for c in flow_cols)}
    os.makedirs(os.path.join(OUT, cube), exist_ok=True)
    files, by_grain, nrows, pairs = {}, {}, 0, {}
    for e in entities:
        erows = []
        for g in groups:
            if (e, g) not in present:
                continue
            Me = {m: _month_rec(base.get((e, g, m), {}), flow_cols) for m in months}
            rs = _period_rows(Me, e, end[e], ctx, columns, extra={'series_group': g})
            erows += rs
            for r in rs:
                gr = r[columns.index('grain')]; by_grain[gr] = by_grain.get(gr, 0) + 1
        pairs[e] = [g for g in groups if (e, g) in present]
        rel = f'{cube}/{e}.json'
        path = os.path.join(OUT, rel)
        write_json(path, {'cube': cube, 'entity': e, 'columns': columns, 'rows': erows}, compact=True)
        files[e] = {'path': rel, 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest(), 'rows': len(erows)}
        nrows += len(erows)
    keep = {f'{e}.json' for e in entities}   # D-058: this script's own stale files in doj_core_series/
    for f in sorted(os.listdir(os.path.join(OUT, cube))):
        if (f.endswith('.json') and f not in keep) or f.endswith('.json.tmp'):
            os.remove(os.path.join(OUT, cube, f)); print(f'{cube}: removed stale {cube}/{f} (D-058)')
    lines = ''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path']))
    meta = {
        'cube': cube, 'files': files, 'files_sha256': hashlib.sha256(lines.encode()).hexdigest(),
        'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
        'format': 'one JSON file per entity, files[<entity>].path: {"cube", "entity", "columns", "rows": [[values in '
                  'column order]]}; rows hold every series group the entity ever had staff or flows in',
        **_common_meta(ctx, end, emp),
        'built_at': None, 'time_basis': 'effective',
        'spec': 'doj_core (docs/metric-spec.md) by series group (D-061, D-062); D-023, D-024, D-027, D-089',
        'series_groups': {'file': 'pipeline/crosswalks/series_groups.csv',
                          'sha256': hashlib.sha256(open(SERIES_GROUPS, 'rb').read()).hexdigest(), 'groups': groups},
        'series_groups_present': pairs,
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'entities': entities, 'rows': nrows, 'rows_by_grain': by_grain,
        'entity_last_month': {e: ym(m) for e, m in end.items()},
        'provisional_months': [ym(m) for m in sorted(ctx['provisional'])],
        'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'source_fields': SERIES_SOURCE_FIELDS,
        'known_breaks': known_breaks_list(),
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'treatment', 'decision')} for r in ctx['issues']]},
        'columns': column_dictionary(columns, ctx['sep'], ctx['acc']),
    }
    big = max(files.values(), key=lambda f: os.path.getsize(os.path.join(OUT, f['path'])))
    _write_meta(cube, meta, nrows, f'{cube}: wrote {nrows} rows {by_grain} as {len(files)} files (largest {big["path"]} '
                                   f'{os.path.getsize(os.path.join(OUT, big["path"])) / 1e6:.2f} MB)')


ADMINS = os.path.join(XW, 'administrations.csv')
ADMIN_CUBE = 'doj_admin'


def administrations(months):
    """administrations.csv (D-065) -> [(id, name, [window months that are published], open)] in file order. Month 1
    is January of the inauguration year (D-066); an open window ('latest') runs to the latest published month."""
    out, mset = [], set(months)
    for r in csv.DictReader(open(ADMINS, encoding='utf-8')):
        y, m = map(int, r['first_month'].split('-'))
        first = datetime.date(y, m, 1)
        last = months[-1] if r['last_month'] == 'latest' else datetime.date(*map(int, r['last_month'].split('-')), 1)
        win = [x for x in months if first <= x <= last]
        out.append((r['id'], r['name'], win, r['last_month'] == 'latest'))
    return out


def build_admin(con):
    """doj_admin (D-065, D-066): per entity x series group ('all' + the D-062 groups present) x administration x
    months in office N: headcount at month 0 and month N, the change, running flows over months 1..N, and the
    annualized departure, quit and retirement rates over months 1..N. One file per entity."""
    cube = ADMIN_CUBE
    ctx = _context(con, cube, SERIES_SOURCE_FIELDS)
    entities, months, flow_cols, idx = ctx['entities'], ctx['months'], ctx['flow_cols'], ctx['idx']
    groups = series_groups()
    core_b = monthly_base(con, ctx['sep'], ctx['acc'], ctx['issues'])
    ser_b = monthly_base(con, ctx['sep'], ctx['acc'], ctx['issues'], group_sql=series_group_sql())
    head = {}
    for (e, m), b in core_b.items():
        if b.get('headcount'): head.setdefault(e, []).append(m)
    end, emp = _entity_end(cube, ctx, head, lambda e, en: [(e, ym(m)) for (x, m), b in core_b.items()
                                                      if x == e and m > en and any(b.get(c) for c in flow_cols)])
    present = {(e, g) for (e, g, m), b in ser_b.items() if b.get('headcount') or any(b.get(c) for c in flow_cols)}
    admins = administrations(months)
    vers = ctx['vers']
    fv = lambda m: f"{ym(m)} e{vers[ym(m)]['employment']} a{vers[ym(m)]['accessions']} s{vers[ym(m)]['separations']}"
    columns = (['entity', 'series_group', 'administration', 'months_in_office', 'admin_months', 'month_0', 'month_n',
                'time_basis', 'provisional', 'partial', 'reissued', 'opm_incomplete', 'headcount_0', 'headcount_n',
                'headcount_change'] + flow_cols + [f'{r}_num' for r in RATES] + ['rate_den', 'rate_months', 'rate_small_base'])
    os.makedirs(os.path.join(OUT, cube), exist_ok=True)
    files, nrows, windows = {}, 0, {}
    for a_id, _, win, _ in admins:
        m0 = months[idx[win[0]] - 1]
        windows[a_id] = {'month_0': ym(m0), 'months': [ym(m) for m in win], 'file_version': [fv(m0)] + [fv(m) for m in win]}
    for e in entities:
        erows = []
        for g in ['all'] + groups:
            if g != 'all' and (e, g) not in present:
                continue
            get = (lambda m: core_b.get((e, m), {})) if g == 'all' else (lambda m, g=g: ser_b.get((e, g, m), {}))
            Me = {m: _month_rec(get(m), flow_cols) for m in months}
            for a_id, _, win_all, is_open in admins:
                win = [m for m in win_all if m <= end[e]]   # D-024: an entity's rows end at its last month
                if not win:
                    continue
                m0 = months[idx[win[0]] - 1]
                run = {c: 0 for c in flow_cols}
                hsum = 0
                for n, m in enumerate(win, 1):
                    for c in flow_cols: run[c] += Me[m][c]
                    hsum += Me[m]['headcount']
                    den = hsum / n
                    row = {'entity': e, 'series_group': g, 'administration': a_id, 'months_in_office': n,
                           'admin_months': len(win), 'month_0': ym(m0), 'month_n': ym(m), 'time_basis': 'effective',
                           'provisional': any(x in ctx['provisional'] for x in win[:n]), 'partial': is_open,
                           'reissued': any(ym(x) in ctx['reissued'] for x in [m0] + win[:n]), 'opm_incomplete': False,
                           'headcount_0': Me[m0]['headcount'], 'headcount_n': Me[m]['headcount'],
                           'headcount_change': Me[m]['headcount'] - Me[m0]['headcount'], **run}
                    if den == 0:   # D-027: no 0/0
                        row.update({**{f'{r}_num': None for r in RATES}, 'rate_den': None, 'rate_months': n, 'rate_small_base': None})
                    else:          # D-066: annualized, x 12 / months in the window
                        row.update({**{f'{r}_num': r4(run[col or 'departures'] * 12 / n) for r, col in RATES.items()},
                                    'rate_den': r4(den), 'rate_months': n, 'rate_small_base': den < SMALL_BASE})
                    erows.append([row[c] for c in columns])
        rel = f'{cube}/{e}.json'
        path = os.path.join(OUT, rel)
        write_json(path, {'cube': cube, 'entity': e, 'columns': columns, 'rows': erows, 'windows': windows}, compact=True)
        files[e] = {'path': rel, 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest(), 'rows': len(erows)}
        nrows += len(erows)
    keep = {f'{e}.json' for e in entities}   # D-058: this script's own stale files in doj_admin/
    for f in sorted(os.listdir(os.path.join(OUT, cube))):
        if (f.endswith('.json') and f not in keep) or f.endswith('.json.tmp'):
            os.remove(os.path.join(OUT, cube, f)); print(f'{cube}: removed stale {cube}/{f} (D-058)')
    lines = ''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path']))
    meta = {
        'cube': cube, 'files': files, 'files_sha256': hashlib.sha256(lines.encode()).hexdigest(),
        'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
        'format': 'one JSON file per entity, files[<entity>].path: {"cube", "entity", "columns", "rows", "windows"}; '
                  'windows[<administration>] = {month_0, months, file_version (month 0 first)}',
        **_common_meta(ctx, end, emp), 'built_at': None, 'time_basis': 'effective',
        'spec': 'D-065 (administrations), D-066 (definitions); D-024, D-027, D-089',
        'administrations': {'file': 'pipeline/crosswalks/administrations.csv',
                            'sha256': hashlib.sha256(open(ADMINS, 'rb').read()).hexdigest(),
                            'list': [{'id': a, 'name': nm, 'first_month': ym(w[0]), 'last_month': ym(w[-1]), 'open': o}
                                     for a, nm, w, o in admins]},
        'series_groups': {'file': 'pipeline/crosswalks/series_groups.csv',
                          'sha256': hashlib.sha256(open(SERIES_GROUPS, 'rb').read()).hexdigest(), 'groups': ['all'] + groups},
        'series_groups_present': {e: ['all'] + [g for g in groups if (e, g) in present] for e in entities},
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'entities': entities, 'rows': nrows, 'entity_last_month': {e: ym(m) for e, m in end.items()},
        'provisional_months': [ym(m) for m in sorted(ctx['provisional'])], 'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'source_fields': SERIES_SOURCE_FIELDS,
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'treatment', 'decision')} for r in ctx['issues']]},
        'columns': admin_dictionary(columns, ctx['sep'], ctx['acc']),
    }
    big = max(files.values(), key=lambda f: os.path.getsize(os.path.join(OUT, f['path'])))
    _write_meta(cube, meta, nrows, f'{cube}: wrote {nrows} rows as {len(files)} files (largest {big["path"]} '
                                   f'{os.path.getsize(os.path.join(OUT, big["path"])) / 1e6:.2f} MB)')


def admin_dictionary(columns, sep, acc):
    known = ['entity', 'series_group', 'time_basis', 'opm_incomplete', 'hires', 'departures', 'sep_drp'] + list(sep) + nondrp_cols(sep) + list(acc)
    base = {d['name']: d for d in column_dictionary([c for c in columns if c in known], sep, acc)}
    d = {
        'administration': ('dimension', "administration id (D-065): obama2, trump1, biden, trump2; names in the meta"),
        'months_in_office': ('dimension', 'N: months in office, month 1 = January of the inauguration year (D-066)'),
        'admin_months': ('dimension', "months of the administration's window that are published (up to the entity's last month, D-024)"),
        'month_0': ('dimension', 'the last month-end before month 1 (YYYY-MM)'),
        'month_n': ('dimension', 'calendar month of month N (YYYY-MM)'),
        'provisional': ('flag', f'months 1..N contain any of the newest {PROVISIONAL_MONTHS} effective months (invariant 8)'),
        'partial': ('flag', 'the administration is still in office (its window is open: Trump II)'),
        'reissued': ('flag', 'month 0 or a month of 1..N changed file version since the previous manifest'),
        'headcount_0': ('stock', 'headcount at month 0'),
        'headcount_n': ('stock', 'headcount at the end of month N'),
        'headcount_change': ('stock_change', 'headcount_n minus headcount_0 (D-066); the page shows the percent as '
                                             'headcount_change / headcount_0'),
        'rate_den': ('rate_denominator', 'mean month-end headcount over months 1..N; null (never 0) when that mean is 0 (D-027)'),
        'rate_months': ('rate_denominator', 'N, the months averaged into rate_den'),
        'rate_small_base': ('flag', f'rate_den < {SMALL_BASE} (invariant 9); null when the rate is empty'),
    }
    out = []
    for c in columns:
        if c in d:
            out.append({'name': c, 'kind': d[c][0], 'description': d[c][1]})
        elif c.endswith('_num') and c[:-4] in RATES:
            what = {'attrition': 'all departures', 'quit': 'departures SC', 'retirement': 'departures SD + SE + SG'}[c[:-4]]
            out.append({'name': c, 'kind': 'rate_numerator', 'description': f'{what} over months 1..N x 12 / N (D-066); rate = {c} / rate_den',
                        'denominator': 'rate_den', 'small_base': 'rate_small_base', 'months': 'rate_months'})
        else:
            b = base[c]
            desc = b['description'].replace('in the period', 'over months 1..N (running sum)') if b['kind'] == 'flow' else b['description']
            out.append({**{k: v for k, v in b.items() if k not in ('source_field', 'coverage_column')}, 'description': desc})
    return out


def column_dictionary(columns, sep, acc):
    labels = {'sep_transfer_out': 'SA + SB', 'sep_quit': 'SC', 'sep_retirement': 'SD + SE + SG', 'sep_rif': 'SH',
              'sep_termination': 'SJ', 'sep_other': 'SL', 'acc_new_hire': 'AC + AD + AE', 'acc_transfer_in': 'AA'}
    method = {'a': 'method A, trailing 12 months ending in period_last_month (null when fewer than 12 months exist, '
                   'i.e. before Sep 2012)',
              'b': 'method B, fiscal year only (null at month and quarter grain); a partial fiscal year is year to '
                   'date over its published months, not annualized (D-023)',
              'c': 'method C, annualized per period over its published months'}
    d = {
        'series_group': ('dimension', "job series group (D-062): a listed occupational_series_code, or 'other' for every "
                                      'other code including blank and NULL; pipeline/crosswalks/series_groups.csv'),
        'entity': ('dimension', "'DOJ' for the department total, else the component's agency_subelement_code "
                                '(pipeline/crosswalks/components.csv); display names belong to the front end'),
        'grain': ('dimension', "'month', 'quarter' (fiscal) or 'fy' (FY2025 = Oct 2024 to Sep 2025)"),
        'period': ('dimension', "'YYYY-MM', 'FYyyyyQn' or 'FYyyyy'"),
        'fiscal_year': ('dimension', 'fiscal year of the period'),
        'fiscal_quarter': ('dimension', 'fiscal quarter 1 to 4 (Q1 = Oct to Dec); null at fy grain'),
        'period_first_month': ('dimension', 'first calendar month of the period (YYYY-MM), published or not'),
        'period_last_month': ('dimension', 'last published month of the period (YYYY-MM): the month stocks are taken from'),
        'months_in_period': ('dimension', 'calendar months in the period: 1, 3 or 12'),
        'months_published': ('dimension', 'months of the period with a published employment file, up to the '
                                          "entity's last month (D-024; a component continued at 0 runs to the latest "
                                          'month, D-089)'),
        'time_basis': ('dimension', "'effective': flows counted by personnel_action_effective_date_month (invariant 6)"),
        'file_version': ('dimension', "one entry per published month of the period: 'YYYY-MM eN aN sN' = employment, "
                                      'accessions and separations file versions in the current manifest'),
        'provisional': ('flag', f'the period contains any of the newest {PROVISIONAL_MONTHS} effective months (invariant 8)'),
        'partial': ('flag', 'the period has months not yet published, or months after the entity\'s last employment '
                            'month (invariant 3, D-024)'),
        'reissued': ('flag', 'a month of the period changed file version since the previous manifest '
                             '(revision_baseline.json); false on the first build'),
        'opm_incomplete': ('flag', 'a month of the period OPM marks incomplete for DOJ; currently none'),
        'headcount': ('stock', 'rows in the employment file of period_last_month'),
        'headcount_change': ('stock_change', 'headcount minus the headcount of the previous period of the same grain '
                                             'and entity (D-025); null for the first period; not derived from flows '
                                             '(invariant 7)'),
        'hires': ('flow', 'accession rows effective in the period'),
        'departures': ('flow', 'separation rows effective in the period (all codes; transfers out and DRP included)'),
        'sep_drp': ('flow', "departures with drp_indicator = 'Y', any code; an overlay outside the partition"),
        'net_flow': ('flow', 'hires minus departures; not derived from or reconciled to headcount change (invariant 7)'),
        'years_of_service_lost': ('flow', 'sum of length_of_service_years (years, one decimal, as published) over '
                                          'departures effective in the period; null values and values matching an '
                                          'active known data issue (D-026) are left out, see coverage'),
        'yos_known': ('flow', 'departures with a non-null length_of_service_years that matches no active known data '
                              'issue; the coverage numerator'),
        'yos_known_issue': ('flow', 'data-quality count: departures whose length_of_service_years matches an active row '
                                    'of pipeline/known_data_issues.csv and is treated as unknown (D-026); left out of '
                                    'years_of_service_lost and yos_known'),
        'years_of_service_lost_coverage': ('coverage', 'yos_known / departures for years_of_service_lost; null when '
                                                       'there are no departures'),
    }
    for c in sep:
        d.setdefault(c, ('flow', f'departures with separation code {labels.get(c, c)} (D-015); part of the partition'))
    for c in sep:
        d.setdefault(c + NONDRP, ('flow', f"departures with separation code {labels.get(c, c)} and drp_indicator not 'Y' "
                                          f"(D-080): {c} without DRP; sep_drp plus the {NONDRP} columns partition departures "
                                          "(the reasons charts)"))
    for c in acc:
        d.setdefault(c, ('flow', f'hires with accession code {labels.get(c, c)} (D-015); part of the partition'))
    what = {'attrition': 'all departures', 'quit': 'departures SC (sep_quit)', 'retirement': 'departures SD + SE + SG (sep_retirement)'}
    for m in 'abc':
        factor = ' times 12 / rate_c_months' if m == 'c' else ''
        for r in RATES:
            d[f'{r}_{m}_num'] = ('rate_numerator', f'{r} rate numerator, {method[m]}: {what[r]}{factor}; '
                                                   f'rate = {r}_{m}_num / rate_{m}_den')
        d[f'rate_{m}_den'] = ('rate_denominator', f'shared denominator of the three rates, {method[m]}: mean of the '
                                                  f'month-end headcounts of rate_{m}_months months')
        d[f'rate_{m}_months'] = ('rate_denominator', f'number of month-end headcounts averaged into rate_{m}_den')
        d[f'rate_{m}_small_base'] = ('flag', f'rate_{m}_den < {SMALL_BASE} (invariant 9); null when the rate is null')
        d[f'rate_{m}_den'] = (d[f'rate_{m}_den'][0], d[f'rate_{m}_den'][1] + '; null, with null numerators and flag, when '
                              'that mean is 0 (D-027); never 0')
    extra = {'years_of_service_lost': {'source_field': 'length_of_service_years', 'coverage_column': 'years_of_service_lost_coverage'},
             'yos_known': {'coverage_numerator_for': 'years_of_service_lost'},
             'yos_known_issue': {'coverage_numerator_for': 'years_of_service_lost'},
             'years_of_service_lost_coverage': {'coverage_for': 'years_of_service_lost'}}
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1], **extra.get(c, {})} for c in columns]


if __name__ == '__main__':
    import duckdb
    os.chdir(ROOT)
    con = duckdb.connect(os.path.join('warehouse', 'opm.duckdb'), read_only=True)
    build(con)
    build_series(con)
    build_admin(con)
    con.close()
