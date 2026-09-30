"""Build the aggregate cubes from warehouse/opm.duckdb into warehouse/cubes/ (staging; never web/data/).

Run on its own:   .venv/bin/python pipeline/build_cubes.py
build_db.py also calls build(con) once every file is loaded. Idempotent: the cube file is deterministic, and
the sidecar meta (with its build time) and the revision baseline are rewritten only when their content changes.

Cube `doj_core` (docs/metric-spec.md; decisions D-015 to D-021):
  entities  DOJ total ('DOJ') plus each component code in pipeline/crosswalks/components.csv
  grains    month, quarter (fiscal), fy (FY2025 = Oct 2024 to Sep 2025); range from the first snapshot month
            (Oct 2011); actions effective before it are excluded (D-017). A component's rows end at its last
            employment month, and its final quarter and year are partial (D-024).
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
TREATMENTS = {'unknown'}  # a value matching an active issue counts as unknown: not summed, not in coverage


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
    parts = [f"(strftime(period, '%Y-%m') BETWEEN '{r['first_file_month']}' AND '{r['last_file_month']}' "
             f"AND {field} BETWEEN {float(r['value_min'])} AND {float(r['value_max'])})"
             for r in issues if r['dataset'] == dataset and r['field'] == field]
    return '(' + ' OR '.join(parts) + ')' if parts else 'false'


def monthly_base(con, sep, acc, issues=()):
    """{(entity, month): {headcount, hires, departures, categories, drp, los_sum, los_known}} for every entity
    that has any row, from the doj_* tables. Entity 'DOJ' is the total (grouping set without the component)."""
    def f(code_col, g):
        return ''.join(f", count(*) FILTER (WHERE {code_col} IN ({', '.join(repr(c) for c in cs)})) AS {col}"
                       for col, cs in g.items())
    ent = "CASE WHEN grouping(agency_subelement_code) = 1 THEN 'DOJ' ELSE agency_subelement_code END"
    los_issue = issue_predicate(issues, 'separations', 'length_of_service_years')  # D-026
    queries = {
        'employment': f"""SELECT {ent} AS entity, snapshot_month AS month, count(*) AS headcount
            FROM doj_employment GROUP BY GROUPING SETS ((snapshot_month, agency_subelement_code), (snapshot_month))""",
        'separations': f"""SELECT {ent} AS entity, {E} AS month, count(*) AS departures
              {f('separation_category_code', sep)}, count(*) FILTER (WHERE drp_indicator = 'Y') AS sep_drp,
              sum(length_of_service_years) FILTER (WHERE NOT {los_issue}) AS los_sum,
              count(length_of_service_years) FILTER (WHERE NOT {los_issue}) AS los_known,
              count(*) FILTER (WHERE {los_issue}) AS los_issue
            FROM doj_separations GROUP BY GROUPING SETS (({E}, agency_subelement_code), ({E}))""",
        'accessions': f"""SELECT {ent} AS entity, {E} AS month, count(*) AS hires {f('accession_category_code', acc)}
            FROM doj_accessions GROUP BY GROUPING SETS (({E}, agency_subelement_code), ({E}))""",
    }
    base = {}
    for q in queries.values():
        cur = con.execute(q)
        names = [d[0] for d in cur.description]
        for row in cur.fetchall():
            d = dict(zip(names, row))
            base.setdefault((d.pop('entity'), d.pop('month')), {}).update(d)
    return base


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


def build(con):
    os.makedirs(OUT, exist_ok=True)
    sep, acc = partition('separation_codes.csv', 'sep'), partition('accession_codes.csv', 'acc')
    for col, codes in RATE_CODES.items():
        if set(sep.get(col, [])) != codes:
            sys.exit(f'{CUBE} NOT built: crosswalk {col} = {sep.get(col)} but the metric spec says {sorted(codes)}')
    comps = [r['agency_subelement_code'] for r in csv.DictReader(open(os.path.join(XW, 'components.csv'), encoding='utf-8'))]
    entities = ['DOJ'] + comps
    months = [r[0] for r in con.execute('SELECT DISTINCT snapshot_month FROM doj_employment ORDER BY 1').fetchall()]
    mset = set(months)
    issues = known_issues()
    base = monthly_base(con, sep, acc, issues)
    stray = sorted({e for e, _ in base} - set(entities))
    if stray:
        sys.exit(f'{CUBE} NOT built: components not in components.csv: {stray}')
    provisional = set(months[-PROVISIONAL_MONTHS:])
    mhash = manifest_hash()
    vers = versions_by_month()
    bl = revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    reissued_months = {mk for mk, v in vers.items() if prior and mk in prior and prior[mk] != v}
    flow_cols = ['hires', 'departures'] + list(sep) + ['sep_drp'] + list(acc)

    def month_rec(e, m):
        b = base.get((e, m), {})
        rec = {c: b.get(c) or 0 for c in flow_cols + ['headcount', 'los_known', 'los_issue']}
        rec['los_sum'] = b.get('los_sum') or 0.0
        return rec

    M = {e: {m: month_rec(e, m) for m in months} for e in entities}
    idx = {m: i for i, m in enumerate(months)}
    # D-024: a component's rows end at its last employment month (DOJ: the last published month). A flow effective
    # after that month would drop out of the component's series, so the build refuses instead of hiding it.
    end = {e: max((m for (x, m), b in base.items() if x == e and b.get('headcount')), default=None) for e in entities}
    end['DOJ'] = months[-1]
    lost = [(e, ym(m)) for (e, m), b in base.items() if end.get(e) and m > end[e] and any(b.get(c) for c in flow_cols)]
    if lost or None in end.values():
        sys.exit(f'{CUBE} NOT built: flows after a component\'s last employment month, or a component never in '
                 f'employment: {lost[:5]} {[e for e, v in end.items() if v is None]}')

    # periods: (grain, label, fy, q, expected months)
    periods = [('month', ym(m), fy_of(m), fq_of(m), [m]) for m in months]
    fys = sorted({fy_of(m) for m in months})
    for fy in fys:
        for q in range(1, 5):
            exp = fiscal_months(fy, q)
            if any(m in mset for m in exp):
                periods.append(('quarter', f'FY{fy}Q{q}', fy, q, exp))
    for fy in fys:
        periods.append(('fy', f'FY{fy}', fy, None, fiscal_months(fy)))

    rate_cols = []
    for meth in 'abc':
        rate_cols += [f'{r}_{meth}_num' for r in RATES] + [f'rate_{meth}_den', f'rate_{meth}_months', f'rate_{meth}_small_base']
    columns = (['entity', 'grain', 'period', 'fiscal_year', 'fiscal_quarter', 'period_first_month', 'period_last_month',
                'months_in_period', 'months_published', 'time_basis', 'file_version',
                'provisional', 'partial', 'reissued', 'opm_incomplete',
                'headcount', 'headcount_change'] + flow_cols + ['net_flow', 'years_of_service_lost', 'yos_known', 'yos_known_issue', 'years_of_service_lost_coverage']
               + rate_cols)

    def rate_block(e, pub, last, grain, partial):
        """Rate numerators, shared denominator, months and small-base flag for methods A, B, C."""
        out = {}
        def put(meth, ms, factor):
            if ms is None:
                for r in RATES: out[f'{r}_{meth}_num'] = None
                out.update({f'rate_{meth}_den': None, f'rate_{meth}_months': None, f'rate_{meth}_small_base': None})
                return
            recs = [M[e][m] for m in ms]
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

    rows, by_grain, by_entity, prev = [], {}, {}, {}
    for e in entities:
        for grain, label, fy, q, exp in periods:
            pub = [m for m in exp if m in mset and m <= end[e]]
            if not pub:
                continue
            last = pub[-1]
            partial = len(pub) < len(exp)
            recs = [M[e][m] for m in pub]
            flows = {c: sum(x[c] for x in recs) for c in flow_cols}
            dep, known = flows['departures'], sum(x['los_known'] for x in recs)
            row = {
                'entity': e, 'grain': grain, 'period': label, 'fiscal_year': fy,
                'fiscal_quarter': q if grain != 'fy' else None,
                'period_first_month': ym(exp[0]), 'period_last_month': ym(last),
                'months_in_period': len(exp), 'months_published': len(pub), 'time_basis': 'effective',
                'file_version': [f"{ym(m)} e{vers[ym(m)]['employment']} a{vers[ym(m)]['accessions']} "
                                 f"s{vers[ym(m)]['separations']}" for m in pub],
                'provisional': any(m in provisional for m in pub), 'partial': partial,
                'reissued': any(ym(m) in reissued_months for m in pub), 'opm_incomplete': False,
                'headcount': M[e][last]['headcount'],
                'headcount_change': (M[e][last]['headcount'] - prev[(e, grain)]) if (e, grain) in prev else None,
                **flows,
                'net_flow': flows['hires'] - flows['departures'],
                'years_of_service_lost': round(sum(x['los_sum'] for x in recs), 1),
                'yos_known': known,
                'yos_known_issue': sum(x['los_issue'] for x in recs),
                'years_of_service_lost_coverage': r4(known / dep) if dep else None,
                **rate_block(e, pub, last, grain, partial),
            }
            rows.append([row[c] for c in columns])
            prev[(e, grain)] = row['headcount']
            by_grain[grain] = by_grain.get(grain, 0) + 1
            by_entity.setdefault(e, {}).setdefault(grain, 0)
            by_entity[e][grain] += 1

    cube_path = os.path.join(OUT, f'{CUBE}.json')
    write_json(cube_path, {'cube': CUBE, 'columns': columns, 'rows': rows}, compact=True)
    cube_sha = hashlib.sha256(open(cube_path, 'rb').read()).hexdigest()

    meta = {
        'cube': CUBE, 'file': f'{CUBE}.json', 'format': 'json: {"cube", "columns": [names], "rows": [[values in column order]]}',
        'manifest_sha256': mhash,
        'manifest_hash_method': 'sha256 of data/opm_manifest.json canonical content: records sorted by (dataset, filename), '
                                'json.dumps(sort_keys=True, separators=(",", ":"))',
        'cube_sha256': cube_sha, 'built_at': None, 'time_basis': 'effective',
        'spec': 'docs/metric-spec.md (signed 2026-09-30, D-019 to D-021)',
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'entities': entities, 'rows': len(rows), 'rows_by_grain': by_grain, 'rows_by_entity': by_entity,
        'entity_last_month': {e: ym(m) for e, m in end.items()},
        'provisional_months': [ym(m) for m in sorted(provisional)],
        'reissued_months': sorted(reissued_months),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'decision')} for r in issues]},
        'columns': column_dictionary(columns, sep, acc),
    }
    meta_path = os.path.join(OUT, f'{CUBE}.meta.json')
    old = json.load(open(meta_path)) if os.path.exists(meta_path) else None
    if old and {k: v for k, v in old.items() if k != 'built_at'} == {k: v for k, v in meta.items() if k != 'built_at'}:
        print(f'{CUBE}: unchanged ({len(rows)} rows); meta kept, built_at {old["built_at"]}')
        return
    meta['built_at'] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    write_json(meta_path, meta)
    print(f'{CUBE}: wrote {len(rows)} rows {by_grain} to {os.path.relpath(cube_path, ROOT)}')


def column_dictionary(columns, sep, acc):
    labels = {'sep_transfer_out': 'SA + SB', 'sep_quit': 'SC', 'sep_retirement': 'SD + SE + SG', 'sep_rif': 'SH',
              'sep_termination': 'SJ', 'sep_other': 'SL', 'acc_new_hire': 'AC + AD + AE', 'acc_transfer_in': 'AA'}
    method = {'a': 'method A, trailing 12 months ending in period_last_month (null when fewer than 12 months exist, '
                   'i.e. before Sep 2012)',
              'b': 'method B, fiscal year only (null at month and quarter grain); a partial fiscal year is year to '
                   'date over its published months, not annualized (D-023)',
              'c': 'method C, annualized per period over its published months'}
    d = {
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
                                          "entity's last employment month (D-024)"),
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
    con.close()
