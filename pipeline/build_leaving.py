"""Build the Who is leaving cube `doj_leaving` into warehouse/cubes/ (staging; never web/data/). D-031.

Run on its own:   .venv/bin/python pipeline/build_leaving.py      (build_db.py runs it after doj_core)
Idempotent: the cube file is deterministic; the meta (with build time) is rewritten only when its content changes.

Rows: entity (DOJ + components, ending at each component's last employment month, D-024) x period x dimension value.
  grains  'fy' (fiscal year; a partial year covers its published months, rate year to date, D-023) and
          't12' (the 12 months ending at each month end, from Sep 2012). Never month or quarter (D-031).
  dimensions and values: pipeline/crosswalks/leaving_dimensions.csv (length of service bands, age, supervisory
          status, occupation). Each dimension's values, Unknown included, partition departures and headcount.
  rate    departures in the window / mean month-end headcount of that value over the same window:
          at fy grain this is method B (D-019, year to date when partial), at t12 grain method A.
          Unknown values carry counts and no rate. A zero denominator is a structural zero: the rate is empty and
          rate_not_applicable is true (D-027), never a small-base flag.
Format: JSON {"cube", "columns", "rows", "periods"}; "periods" maps 'grain:period' to its published months and
their file versions, so rows need not repeat them.
"""
import csv, datetime, hashlib, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_cubes import (ROOT, OUT, XW, ISSUES, E, PROVISIONAL_MONTHS, SMALL_BASE, manifest_hash, known_issues,
                         issue_predicate, refuse_unusable, partition, write_json, r4, fy_of, ym, fiscal_months,
                         versions_by_month, revision_baseline)

CUBE = 'doj_leaving'
DIMS = os.path.join(XW, 'leaving_dimensions.csv')
RULES = {'range', 'codes', 'rest', 'unknown'}
SOURCE_FIELDS = {'employment': ['agency_subelement_code', 'length_of_service_years', 'age_bracket',
                                'supervisory_status_code', 'occupational_series_code'],
                 'separations': ['agency_subelement_code', 'length_of_service_years', 'age_bracket',
                                 'supervisory_status_code', 'occupational_series_code', 'separation_category_code',
                                 'drp_indicator']}


def dimensions():
    """leaving_dimensions.csv -> {dimension: [rows in value_order]}, validated."""
    out = {}
    for r in csv.DictReader(open(DIMS, encoding='utf-8')):
        out.setdefault(r['dimension'], []).append(r)
    for d, rows in out.items():
        rows.sort(key=lambda r: int(r['value_order']))
        bad = [r['value'] for r in rows if r['rule'] not in RULES or r['has_rate'] not in ('Y', 'N')
               or (r['rule'] == 'unknown') != (r['has_rate'] == 'N')]
        if bad or len({r['source_field'] for r in rows}) != 1 or sum(r['rule'] == 'unknown' for r in rows) > 1 \
                or sum(r['rule'] == 'rest' for r in rows) > 1 or len({r['value'] for r in rows}) != len(rows):
            sys.exit(f'{CUBE} NOT built: {DIMS} dimension {d} is inconsistent {bad}')
    return out


def value_case(rows, dataset, issues):
    """SQL CASE giving each row its dimension value; unmatched rows get '__unmapped__' (the build then refuses)."""
    f = rows[0]['source_field']
    q = lambda codes: ', '.join("'" + c.replace("'", "''") + "'" for c in codes.split('|'))
    whens = []
    for r in rows:  # unknown first, so a known-data-issue value never lands in a band
        if r['rule'] == 'unknown':
            conds = [f'{f} IS NULL'] + ([f"{f}::VARCHAR IN ({q(r['codes'])})"] if r['codes'] else [])
            conds.append(issue_predicate(issues, dataset, f))
            whens.insert(0, f"WHEN {' OR '.join(conds)} THEN '{r['value']}'")
        elif r['rule'] == 'range':
            hi = f" AND {f} < {float(r['hi'])}" if r['hi'] else ''
            whens.append(f"WHEN {f} >= {float(r['lo'])}{hi} THEN '{r['value']}'")
        elif r['rule'] == 'codes':
            whens.append(f"WHEN {f}::VARCHAR IN ({q(r['codes'])}) THEN '{r['value']}'")
    rest = [r for r in rows if r['rule'] == 'rest']
    if rest:
        whens.append(f"WHEN {f} IS NOT NULL THEN '{rest[0]['value']}'")
    return 'CASE ' + ' '.join(whens) + " ELSE '__unmapped__' END"


def build(con):
    os.makedirs(OUT, exist_ok=True)
    issues = known_issues()
    refuse_unusable(CUBE, SOURCE_FIELDS, issues)
    dims = dimensions()
    sep = partition('separation_codes.csv', 'sep')
    comps = [r['agency_subelement_code'] for r in csv.DictReader(open(os.path.join(XW, 'components.csv'), encoding='utf-8'))]
    entities = ['DOJ'] + comps
    months = [r[0] for r in con.execute('SELECT DISTINCT snapshot_month FROM doj_employment ORDER BY 1').fetchall()]
    mset, idx = set(months), {m: i for i, m in enumerate(months)}
    ent = "CASE WHEN grouping(agency_subelement_code) = 1 THEN 'DOJ' ELSE agency_subelement_code END"
    cats = ''.join(f", count(*) FILTER (WHERE separation_category_code IN ({', '.join(repr(c) for c in cs)})) AS {col}"
                   for col, cs in sep.items())
    H, D = {}, {}   # H[(e, dim, v, m)] = headcount; D[(e, dim, v, m)] = {departures, categories, drp}
    unmapped = []
    for dim, rows in dims.items():
        ve = value_case(rows, 'employment', issues)
        for e, m, v, h in con.execute(f"""SELECT {ent}, snapshot_month, {ve} v, count(*) FROM doj_employment
                GROUP BY GROUPING SETS ((snapshot_month, agency_subelement_code, v), (snapshot_month, v))""").fetchall():
            H[(e, dim, v, m)] = h
            if v == '__unmapped__' and e == 'DOJ': unmapped.append((dim, 'employment', ym(m), h))
        vs = value_case(rows, 'separations', issues)
        cur = con.execute(f"""SELECT {ent} e, {E} m, {vs} v, count(*) departures {cats},
                count(*) FILTER (WHERE drp_indicator = 'Y') sep_drp FROM doj_separations
                GROUP BY GROUPING SETS (({E}, agency_subelement_code, v), ({E}, v))""")
        names = [x[0] for x in cur.description]
        for row in cur.fetchall():
            d = dict(zip(names, row))
            D[(d['e'], dim, d['v'], d['m'])] = d
            if d['v'] == '__unmapped__' and d['e'] == 'DOJ': unmapped.append((dim, 'separations', ym(d['m']), d['departures']))
    if unmapped:
        sys.exit(f'{CUBE} NOT built: values not covered by {os.path.basename(DIMS)}: {unmapped[:5]}')
    first_dim = next(iter(dims))
    end = {e: max((m for (x, d0, _, m), h in H.items() if x == e and d0 == first_dim and h), default=None) for e in entities}
    end['DOJ'] = months[-1]
    lost = sorted({(e, ym(m)) for (e, _, _, m), d in D.items() if e in end and end[e] and m > end[e] and d['departures']})
    if lost or None in end.values():
        sys.exit(f'{CUBE} NOT built: departures after a component\'s last employment month: {lost[:5]}')

    provisional = set(months[-PROVISIONAL_MONTHS:])
    mhash, vers = manifest_hash(), versions_by_month()
    bl = revision_baseline(mhash, vers)
    prior = bl.get('prior_versions')
    reissued = {mk for mk, v in vers.items() if prior and mk in prior and prior[mk] != v}
    fv = lambda m: f"{ym(m)} e{vers[ym(m)]['employment']} a{vers[ym(m)]['accessions']} s{vers[ym(m)]['separations']}"

    periods, pmeta = [], {}
    for fy in sorted({fy_of(m) for m in months}):
        pub = [m for m in fiscal_months(fy) if m in mset]
        periods.append(('fy', f'FY{fy}', fy, pub))
    for i in range(11, len(months)):
        periods.append(('t12', ym(months[i]), fy_of(months[i]), months[i - 11: i + 1]))
    for g, label, _, win in periods:
        pmeta[f'{g}:{label}'] = {'months': [ym(m) for m in win], 'file_version': [fv(m) for m in win]}

    flow_cols = ['departures'] + list(sep) + ['sep_drp']
    columns = (['entity', 'grain', 'period', 'fiscal_year', 'period_first_month', 'period_last_month', 'months_in_period',
                'months_published', 'dimension', 'value', 'value_order', 'time_basis', 'provisional', 'partial',
                'reissued', 'opm_incomplete', 'is_unknown'] + flow_cols +
               ['headcount', 'rate_num', 'rate_den', 'rate_months', 'rate_small_base', 'rate_not_applicable', 'coverage'])
    out_rows, by_grain = [], {}
    for e in entities:
        for g, label, fy, win_all in periods:
            win = [m for m in win_all if m <= end[e]]
            if g == 't12' and win_all[-1] > end[e]:
                continue
            if not win:
                continue
            last = win[-1]
            partial = g == 'fy' and len(win) < 12
            flags = {'provisional': any(m in provisional for m in win), 'partial': partial,
                     'reissued': any(ym(m) in reissued for m in win), 'opm_incomplete': False}
            for dim, vrows in dims.items():
                cells = {}
                for r in vrows:
                    v = r['value']
                    recs = [D.get((e, dim, v, m), {}) for m in win]
                    cells[v] = ({c: sum(x.get(c) or 0 for x in recs) for c in flow_cols},
                                [H.get((e, dim, v, m), 0) for m in win])
                total = sum(f['departures'] for f, _ in cells.values())
                unk = sum(cells[r['value']][0]['departures'] for r in vrows if r['rule'] == 'unknown')
                coverage = r4((total - unk) / total) if total else None
                for r in vrows:
                    f, hs = cells[r['value']]
                    row = {'entity': e, 'grain': g, 'period': label, 'fiscal_year': fy,
                           'period_first_month': ym(win[0]), 'period_last_month': ym(last),
                           'months_in_period': 12, 'months_published': len(win), 'dimension': dim, 'value': r['value'],
                           'value_order': int(r['value_order']), 'time_basis': 'effective', **flags,
                           'is_unknown': r['rule'] == 'unknown', **f, 'headcount': hs[-1], 'coverage': coverage}
                    if r['has_rate'] == 'N':
                        row.update({'rate_num': None, 'rate_den': None, 'rate_months': None,
                                    'rate_small_base': None, 'rate_not_applicable': None})
                    else:
                        den = sum(hs) / len(hs)
                        if den == 0:   # structural zero: nobody on board in that cell (D-027 empty rate)
                            row.update({'rate_num': None, 'rate_den': None, 'rate_months': len(hs),
                                        'rate_small_base': None, 'rate_not_applicable': True})
                        else:
                            row.update({'rate_num': f['departures'], 'rate_den': r4(den), 'rate_months': len(hs),
                                        'rate_small_base': den < SMALL_BASE, 'rate_not_applicable': False})
                    out_rows.append([row[c] for c in columns])
                    by_grain[g] = by_grain.get(g, 0) + 1

    cube_path = os.path.join(OUT, f'{CUBE}.json')
    write_json(cube_path, {'cube': CUBE, 'columns': columns, 'rows': out_rows, 'periods': pmeta}, compact=True)
    cube_sha = hashlib.sha256(open(cube_path, 'rb').read()).hexdigest()
    meta = {
        'cube': CUBE, 'file': f'{CUBE}.json',
        'format': 'json: {"cube", "columns", "rows": [[values in column order]], "periods": {"grain:period": {months, file_version}}}',
        'manifest_sha256': mhash,
        'manifest_hash_method': 'sha256 of data/opm_manifest.json canonical content: records sorted by (dataset, filename), '
                                'json.dumps(sort_keys=True, separators=(",", ":"))',
        'cube_sha256': cube_sha, 'built_at': None, 'time_basis': 'effective',
        'spec': 'D-031 (Who is leaving); D-023, D-024, D-027; docs/metric-spec.md',
        'grains': {'fy': 'fiscal year; rate = method B form (D-019); a partial fiscal year is year to date over its '
                         'published months, not annualized (D-023)',
                   't12': 'the 12 months ending at period_last_month; rate = method A form (D-019); from Sep 2012'},
        'dimensions_file': {'file': 'pipeline/crosswalks/leaving_dimensions.csv',
                            'sha256': hashlib.sha256(open(DIMS, 'rb').read()).hexdigest(),
                            'values': {d: [r['value'] for r in rows] for d, rows in dims.items()}},
        'range': {'first_month': ym(months[0]), 'last_month': ym(months[-1])},
        'entities': entities, 'entity_last_month': {e: ym(m) for e, m in end.items()},
        'rows': len(out_rows), 'rows_by_grain': by_grain,
        'provisional_months': [ym(m) for m in sorted(provisional)], 'reissued_months': sorted(reissued),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'source_fields': SOURCE_FIELDS,
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'treatment', 'decision')} for r in issues]},
        'columns': column_dictionary(columns, sep),
    }
    meta_path = os.path.join(OUT, f'{CUBE}.meta.json')
    old = json.load(open(meta_path)) if os.path.exists(meta_path) else None
    if old and {k: v for k, v in old.items() if k != 'built_at'} == {k: v for k, v in meta.items() if k != 'built_at'}:
        print(f'{CUBE}: unchanged ({len(out_rows)} rows); meta kept, built_at {old["built_at"]}')
        return
    meta['built_at'] = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    write_json(meta_path, meta)
    print(f'{CUBE}: wrote {len(out_rows)} rows {by_grain} to {os.path.relpath(cube_path, ROOT)} '
          f'({os.path.getsize(cube_path) / 1e6:.1f} MB)')


def column_dictionary(columns, sep):
    codes = {'sep_transfer_out': 'SA + SB', 'sep_quit': 'SC', 'sep_retirement': 'SD + SE + SG', 'sep_rif': 'SH',
             'sep_termination': 'SJ', 'sep_other': 'SL'}
    d = {
        'entity': ('dimension', "'DOJ' or a component's agency_subelement_code"),
        'grain': ('dimension', "'fy' (fiscal year) or 't12' (12 months ending at period_last_month); never month or quarter (D-031)"),
        'period': ('dimension', "'FYyyyy' at fy grain; 'YYYY-MM' (the window's last month) at t12 grain"),
        'fiscal_year': ('dimension', 'fiscal year of the period (of its last month at t12 grain)'),
        'period_first_month': ('dimension', 'first month of the window (YYYY-MM)'),
        'period_last_month': ('dimension', 'last published month of the window, where headcount is taken (YYYY-MM)'),
        'months_in_period': ('dimension', 'months in a full window: 12'),
        'months_published': ('dimension', "months of the window with a published employment file, up to the entity's last employment month (D-024)"),
        'dimension': ('dimension', "'los' (length of service), 'age', 'supervisory' or 'occupation' (D-031)"),
        'value': ('dimension', 'value id within the dimension, as in pipeline/crosswalks/leaving_dimensions.csv'),
        'value_order': ('dimension', 'display order of the value within its dimension'),
        'time_basis': ('dimension', "'effective': departures by personnel_action_effective_date_month (invariant 6)"),
        'provisional': ('flag', f'the window contains any of the newest {PROVISIONAL_MONTHS} effective months (invariant 8)'),
        'partial': ('flag', 'a fiscal year with months not yet published or after the entity\'s last employment month (D-023, D-024)'),
        'reissued': ('flag', 'a month of the window changed file version since the previous manifest (revision_baseline.json)'),
        'opm_incomplete': ('flag', 'a month of the window OPM marks incomplete for DOJ; currently none'),
        'is_unknown': ('flag', 'the Unknown value of the dimension: counts only, no rate (D-031)'),
        'departures': ('flow', 'separation rows effective in the window with this value'),
        'sep_drp': ('flow', "departures with drp_indicator = 'Y', any code; an overlay outside the partition"),
        'headcount': ('stock', 'rows with this value in the employment file of period_last_month'),
        'rate_num': ('rate_numerator', 'departures in the window with this value; rate = rate_num / rate_den; null for '
                                       'an Unknown value or a structural zero'),
        'rate_den': ('rate_denominator', 'mean month-end headcount with this value over the window months; null for an '
                                         'Unknown value, and null (never 0) when that mean is 0 (D-027)'),
        'rate_months': ('rate_denominator', 'number of month-end headcounts averaged into rate_den'),
        'rate_small_base': ('flag', f'rate_den < {SMALL_BASE} (invariant 9); null when there is no rate'),
        'rate_not_applicable': ('flag', 'structural zero: nobody with this value on board in any month of the window, so '
                                        'no rate (D-027, D-031); null for an Unknown value'),
        'coverage': ('coverage', "share of the period's departures whose value for this dimension is known (not the "
                                 'Unknown value); null when there are no departures'),
    }
    for c in sep:
        d.setdefault(c, ('flow', f'departures with separation code {codes.get(c, c)} (D-015)'))
    extra = {'value': {'source_fields': sorted({f for fs in SOURCE_FIELDS.values() for f in fs}
                                               - {'agency_subelement_code', 'separation_category_code', 'drp_indicator'}),
                       'coverage_column': 'coverage'},
             'coverage': {'coverage_for': 'value'},
             'rate_num': {'denominator': 'rate_den', 'small_base': 'rate_small_base', 'months': 'rate_months'}}
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1], **extra.get(c, {})} for c in columns]


if __name__ == '__main__':
    import duckdb
    os.chdir(ROOT)
    con = duckdb.connect(os.path.join('warehouse', 'opm.duckdb'), read_only=True)
    build(con)
    con.close()
