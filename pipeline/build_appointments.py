"""Build the staged cube doj_appointments (D-084 to D-086; spec docs/pages/appointments.md sections 3, 4, 6).

Run on its own:   .venv/bin/python pipeline/build_appointments.py
build_db.py also calls build(con) once every file is loaded. Writes warehouse/cubes/doj_appointments/<entity>.json and
warehouse/cubes/doj_appointments.meta.json only (staging; promotion needs Cary's approval). Idempotent: files are
deterministic and the meta (with its build time) is rewritten only when its content changes.

Rows, per entity (DOJ plus the components of components.csv; a component's rows end at its last employment month,
D-024) and per appointment group (pipeline/crosswalks/appointment_groups.csv):
  appt_group  'all'; the groups career, career_conditional, excepted, temporary, ses, political, schedule_policy,
              unknown (invalid code '*', counted in totals, not shown); the political subgroups schedule_c,
              noncareer_ses, executive. Groups partition 'all'; subgroups partition 'political'.
  grain       month, quarter (fiscal), fy: headcount = the period's last month (invariant 3), hires and departures
              = rows by appointment_type_code on the accession or separation row, by effective month (invariant 6),
              summed; share = headcount / headcount_all, same month.
              admin: administration x months in office N (D-065, D-066): month 0 = the December before
              inauguration; headcount at month N, at month 0, the change, the change as a fraction of month 0 only
              where month 0 >= 30 (else null, pct_small_base true), running hires and departures over months 1..N.
No rates (D-085). Every DOJ figure is read from the doj_* tables, filtered on is_doj (invariant 2).

Admin view (D-088): warehouse/cubes/doj_appointments/admin.json holds, for every entity, the admin-grain rows at one
months-in-office value only, N = the entity's Trump II months so far (D-072; the entity's own for a component that
ended, D-024), for every administration and appt_group, in the subset of columns ADMIN_COLUMNS. Its rows are copies
of entity-file rows. It is listed in the meta's files (key 'admin') and described in meta views.admin, so the
by-component panel loads one small file instead of 13.
"""
import csv, hashlib, os, sys

import build_cubes as bc

ROOT, OUT, XW = bc.ROOT, bc.OUT, bc.XW
CUBE = 'doj_appointments'
XW_FILE = os.path.join(XW, 'appointment_groups.csv')
E = bc.E
SMALL_BASE = bc.SMALL_BASE      # spec section 4: percent change only where month 0 >= 30
SOURCE_FIELDS = {'employment': ['agency_subelement_code', 'appointment_type_code'],
                 'accessions': ['agency_subelement_code', 'appointment_type_code'],
                 'separations': ['agency_subelement_code', 'appointment_type_code']}
MEASURES = ('headcount', 'hires', 'departures')


def appointment_groups():
    """appointment_groups.csv -> (rows, {code: [appt_group values the code counts in]}, ordered group list).
    A code counts in 'all', its group and, for political codes, its subgroup."""
    rows = list(csv.DictReader(open(XW_FILE, encoding='utf-8')))
    codes = [r['code'] for r in rows]
    if len(codes) != len(set(codes)):
        sys.exit(f'{CUBE} NOT built: duplicate codes in appointment_groups.csv')
    member = {r['code']: ['all', r['group']] + ([r['subgroup']] if r['subgroup'] else []) for r in rows}
    groups = []
    for r in sorted(rows, key=lambda r: int(r['group_order'])):
        if r['group'] not in [g['id'] for g in groups]:
            groups.append({'id': r['group'], 'level': 'group', 'parent': 'all', 'label': r['display_label'],
                           'label_status': r['label_status'], 'codes': []})
        next(g for g in groups if g['id'] == r['group'])['codes'].append(r['code'])
    subs = []
    for r in rows:
        if r['subgroup'] and r['subgroup'] not in [s['id'] for s in subs]:
            subs.append({'id': r['subgroup'], 'level': 'subgroup', 'parent': r['group'], 'label': r['subgroup_label'],
                         'label_status': r['label_status'], 'codes': []})
        if r['subgroup']:
            next(s for s in subs if s['id'] == r['subgroup'])['codes'].append(r['code'])
    order = [{'id': 'all', 'level': 'total', 'parent': None, 'label': None, 'label_status': None, 'codes': codes}]
    for g in groups:
        order.append(g)
        order += [s for s in subs if s['parent'] == g['id']]
    return rows, member, order


def monthly(con, member):
    """{(entity, appt_group, month): {headcount, hires, departures}}; entity 'DOJ' is the grouping set without the
    component. Exits if a code in the data is not in the crosswalk."""
    ent = "CASE WHEN grouping(agency_subelement_code) = 1 THEN 'DOJ' ELSE agency_subelement_code END"
    queries = {
        'headcount': f"""SELECT {ent}, snapshot_month, appointment_type_code, count(*) FROM doj_employment WHERE is_doj
            GROUP BY GROUPING SETS ((snapshot_month, appointment_type_code, agency_subelement_code), (snapshot_month, appointment_type_code))""",
        'hires': f"""SELECT {ent}, {E}, appointment_type_code, count(*) FROM doj_accessions WHERE is_doj
            GROUP BY GROUPING SETS (({E}, appointment_type_code, agency_subelement_code), ({E}, appointment_type_code))""",
        'departures': f"""SELECT {ent}, {E}, appointment_type_code, count(*) FROM doj_separations WHERE is_doj
            GROUP BY GROUPING SETS (({E}, appointment_type_code, agency_subelement_code), ({E}, appointment_type_code))""",
    }
    base, unmapped = {}, set()
    for measure, q in queries.items():
        for e, m, code, n in con.execute(q).fetchall():
            if str(code) not in member:
                unmapped.add(str(code)); continue
            for g in member[str(code)]:
                rec = base.setdefault((e, g, m), {k: 0 for k in MEASURES})
                rec[measure] += n
    if unmapped:
        sys.exit(f'{CUBE} NOT built: appointment_type_code values missing from appointment_groups.csv: {sorted(unmapped)}')
    return base


COLUMNS = ['entity', 'appt_group', 'appt_level', 'grain', 'period', 'fiscal_year', 'fiscal_quarter', 'months_in_office',
           'admin_months', 'period_first_month', 'period_last_month', 'months_in_period', 'months_published', 'time_basis',
           'file_version', 'provisional', 'partial', 'reissued', 'opm_incomplete', 'headcount', 'headcount_all', 'share',
           'hires', 'departures', 'month_0', 'headcount_0', 'headcount_change', 'headcount_change_pct', 'pct_small_base']


# D-088 admin view: the columns the by-component panel needs, with the flags that keep its rows honest
ADMIN_VIEW = 'admin'
ADMIN_COLUMNS = ['entity', 'appt_group', 'appt_level', 'grain', 'period', 'months_in_office', 'admin_months',
                 'period_first_month', 'period_last_month', 'month_0', 'time_basis', 'provisional', 'partial', 'reissued',
                 'opm_incomplete', 'headcount', 'headcount_0', 'headcount_change', 'headcount_change_pct', 'pct_small_base']


def column_dictionary():
    d = {
        'entity': ('dimension', "'DOJ' for the department total, else the component's agency_subelement_code "
                                '(pipeline/crosswalks/components.csv); display names belong to the front end'),
        'appt_group': ('dimension', "'all', an appointment group or a political subgroup "
                                    '(pipeline/crosswalks/appointment_groups.csv, D-086); see meta groups'),
        'appt_level': ('dimension', "'total' (all), 'group' (the groups partition all, unknown included) or "
                                    "'subgroup' (the subgroups partition political)"),
        'grain': ('dimension', "'month', 'quarter' (fiscal), 'fy' (FY2025 = Oct 2024 to Sep 2025) or 'admin' "
                               '(administration x months in office, D-065, D-066)'),
        'period': ('dimension', "'YYYY-MM', 'FYyyyyQn', 'FYyyyy', or at admin grain the administration id "
                                '(obama2, trump1, biden, trump2; names in the meta)'),
        'fiscal_year': ('dimension', 'fiscal year of the period; null at admin grain'),
        'fiscal_quarter': ('dimension', 'fiscal quarter 1 to 4 (Q1 = Oct to Dec); null at fy and admin grain'),
        'months_in_office': ('dimension', 'admin grain: N, months in office, month 1 = January of the inauguration '
                                          'year (D-066); null otherwise'),
        'admin_months': ('dimension', "admin grain: published months of the administration's window, up to the "
                                      "entity's last month (D-024); null otherwise"),
        'period_first_month': ('dimension', 'first calendar month of the period (YYYY-MM), published or not; admin '
                                            'grain: month 1'),
        'period_last_month': ('dimension', 'last published month of the period (YYYY-MM), the month stocks are taken '
                                           'from; admin grain: month N'),
        'months_in_period': ('dimension', 'calendar months in the period: 1, 3 or 12; admin grain: N'),
        'months_published': ('dimension', 'months of the period with a published employment file, up to the '
                                          "entity's last employment month (D-024); admin grain: N"),
        'time_basis': ('dimension', "'effective': hires and departures counted by personnel_action_effective_date_month "
                                    '(invariant 6)'),
        'file_version': ('dimension', "one entry per published month of the period: 'YYYY-MM eN aN sN' = employment, "
                                      'accessions and separations file versions; null at admin grain, where each file '
                                      'carries windows[<administration>].file_version (month 0 first)'),
        'provisional': ('flag', f'the period (admin grain: months 1..N) contains any of the newest '
                                f'{bc.PROVISIONAL_MONTHS} effective months (invariant 8)'),
        'partial': ('flag', "the period has months not yet published or after the entity's last employment month "
                            '(invariant 3, D-024); admin grain: the administration is still in office (Trump II)'),
        'reissued': ('flag', 'a month of the period (admin grain: month 0 or 1..N) changed file version since the '
                             'previous manifest (revision_baseline.json)'),
        'opm_incomplete': ('flag', 'a month of the period OPM marks incomplete for DOJ; currently none'),
        'headcount': ('stock', 'employment rows of the group in period_last_month (admin grain: month N); never '
                               'summed across months'),
        'headcount_all': ('stock', "employment rows of the entity in period_last_month, all groups: the 'all' "
                                   'headcount, the denominator of share'),
        'share': ('ratio', 'headcount / headcount_all, same month, 4 decimals (spec section 4); null when '
                           'headcount_all is 0'),
        'hires': ('flow', 'accession rows whose appointment type is in the group, effective in the period (admin '
                          'grain: running sum over months 1..N); transfers in included'),
        'departures': ('flow', 'separation rows whose appointment type is in the group, effective in the period '
                               '(admin grain: running sum over months 1..N); transfers out and DRP included'),
        'month_0': ('dimension', 'admin grain: the last month-end before month 1 (YYYY-MM); null otherwise'),
        'headcount_0': ('stock', 'admin grain: headcount of the group at month 0; null otherwise'),
        'headcount_change': ('stock_change', 'admin grain: headcount minus headcount_0 (D-066); not derived from '
                                             'flows (invariant 7; conversions between groups are not hires or '
                                             'departures); null otherwise'),
        'headcount_change_pct': ('ratio', f'admin grain: headcount_change / headcount_0, 4 decimals (a fraction); '
                                          f'null where headcount_0 < {SMALL_BASE} (spec section 4: a count only); '
                                          'null at other grains'),
        'pct_small_base': ('flag', f'admin grain: headcount_0 < {SMALL_BASE}, so headcount_change_pct is null; null '
                                   'at other grains'),
    }
    extra = {'share': {'numerator': 'headcount', 'denominator': 'headcount_all'},
             'headcount_change_pct': {'numerator': 'headcount_change', 'denominator': 'headcount_0',
                                      'small_base': 'pct_small_base'}}
    return [{'name': c, 'kind': d[c][0], 'description': d[c][1], **extra.get(c, {})} for c in COLUMNS]


def r4(x):
    return None if x is None else round(x, 4)


def build(con):
    ctx = bc._context(con, CUBE, SOURCE_FIELDS)
    entities, months, idx = ctx['entities'], ctx['months'], ctx['idx']
    xw_rows, member, order = appointment_groups()
    base = monthly(con, member)
    stray = sorted({e for e, _, _ in base} - set(entities))
    if stray:
        sys.exit(f'{CUBE} NOT built: components not in components.csv: {stray}')
    head = {}
    for (e, g, m), b in base.items():
        if g == 'all' and b['headcount']: head.setdefault(e, []).append(m)
    end = bc._entity_end(CUBE, ctx, head, lambda e, en: [(e, bc.ym(m)) for (x, g, m), b in base.items()
                                                         if x == e and g == 'all' and m > en and (b['hires'] or b['departures'])])
    vers = ctx['vers']
    fv = lambda m: f"{bc.ym(m)} e{vers[bc.ym(m)]['employment']} a{vers[bc.ym(m)]['accessions']} s{vers[bc.ym(m)]['separations']}"
    zero = {k: 0 for k in MEASURES}
    get = lambda e, g, m: base.get((e, g, m), zero)
    admins = bc.administrations(months)
    windows = {}
    for a_id, _, win, _ in admins:
        m0 = months[idx[win[0]] - 1]
        windows[a_id] = {'month_0': bc.ym(m0), 'months': [bc.ym(m) for m in win], 'file_version': [fv(m0)] + [fv(m) for m in win]}
    os.makedirs(os.path.join(OUT, CUBE), exist_ok=True)
    files, nrows, by_grain = {}, 0, {}
    # D-088: N per entity = its Trump II (the open administration's) months so far, up to its last month (D-024)
    open_win = next(w for _, _, w, o in admins if o)
    view_n = {e: len([m for m in open_win if m <= end[e]]) for e in entities}
    view_rows = []
    for e in entities:
        erows = []
        for gd in order:
            g = gd['id']
            # month, fiscal quarter, fiscal year: stocks from the period's last month, flows summed (invariant 3)
            for grain, label, fy, q, exp in ctx['periods']:
                pub = [m for m in exp if m in ctx['mset'] and m <= end[e]]
                if not pub:
                    continue
                last = pub[-1]
                h, ha = get(e, g, last)['headcount'], get(e, 'all', last)['headcount']
                row = {'entity': e, 'appt_group': g, 'appt_level': gd['level'], 'grain': grain, 'period': label,
                       'fiscal_year': fy, 'fiscal_quarter': q if grain != 'fy' else None, 'months_in_office': None,
                       'admin_months': None, 'period_first_month': bc.ym(exp[0]), 'period_last_month': bc.ym(last),
                       'months_in_period': len(exp), 'months_published': len(pub), 'time_basis': 'effective',
                       'file_version': [fv(m) for m in pub],
                       'provisional': any(m in ctx['provisional'] for m in pub), 'partial': len(pub) < len(exp),
                       'reissued': any(bc.ym(m) in ctx['reissued'] for m in pub), 'opm_incomplete': False,
                       'headcount': h, 'headcount_all': ha, 'share': r4(h / ha) if ha else None,
                       'hires': sum(get(e, g, m)['hires'] for m in pub),
                       'departures': sum(get(e, g, m)['departures'] for m in pub),
                       'month_0': None, 'headcount_0': None, 'headcount_change': None, 'headcount_change_pct': None,
                       'pct_small_base': None}
                erows.append([row[c] for c in COLUMNS])
                by_grain[grain] = by_grain.get(grain, 0) + 1
            # administration x months in office (D-065, D-066)
            for a_id, _, win_all, is_open in admins:
                win = [m for m in win_all if m <= end[e]]     # D-024
                if not win:
                    continue
                m0 = months[idx[win[0]] - 1]
                h0 = get(e, g, m0)['headcount']
                hires = deps = 0
                for n, m in enumerate(win, 1):
                    hires += get(e, g, m)['hires']; deps += get(e, g, m)['departures']
                    h, ha = get(e, g, m)['headcount'], get(e, 'all', m)['headcount']
                    small = h0 < SMALL_BASE
                    row = {'entity': e, 'appt_group': g, 'appt_level': gd['level'], 'grain': 'admin', 'period': a_id,
                           'fiscal_year': None, 'fiscal_quarter': None, 'months_in_office': n, 'admin_months': len(win),
                           'period_first_month': bc.ym(win[0]), 'period_last_month': bc.ym(m), 'months_in_period': n,
                           'months_published': n, 'time_basis': 'effective', 'file_version': None,
                           'provisional': any(x in ctx['provisional'] for x in win[:n]), 'partial': is_open,
                           'reissued': any(bc.ym(x) in ctx['reissued'] for x in [m0] + win[:n]), 'opm_incomplete': False,
                           'headcount': h, 'headcount_all': ha, 'share': r4(h / ha) if ha else None,
                           'hires': hires, 'departures': deps, 'month_0': bc.ym(m0), 'headcount_0': h0,
                           'headcount_change': h - h0, 'headcount_change_pct': None if small else r4((h - h0) / h0),
                           'pct_small_base': small}
                    erows.append([row[c] for c in COLUMNS])
                    by_grain['admin'] = by_grain.get('admin', 0) + 1
                    if n == view_n[e]:
                        view_rows.append([row[c] for c in ADMIN_COLUMNS])
        rel = f'{CUBE}/{e}.json'
        path = os.path.join(OUT, rel)
        bc.write_json(path, {'cube': CUBE, 'entity': e, 'columns': COLUMNS, 'rows': erows, 'windows': windows}, compact=True)
        files[e] = {'path': rel, 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest(), 'rows': len(erows)}
        nrows += len(erows)
    # D-088 admin view: one file, every entity, admin grain at N = view_n[entity] only
    rel = f'{CUBE}/{ADMIN_VIEW}.json'
    path = os.path.join(OUT, rel)
    bc.write_json(path, {'cube': CUBE, 'view': ADMIN_VIEW, 'columns': ADMIN_COLUMNS, 'rows': view_rows,
                         'months_in_office': view_n, 'windows': windows}, compact=True)
    files[ADMIN_VIEW] = {'path': rel, 'sha256': hashlib.sha256(open(path, 'rb').read()).hexdigest(), 'rows': len(view_rows)}
    keep = {f'{e}.json' for e in entities} | {f'{ADMIN_VIEW}.json'}   # D-058: this script's own stale files in doj_appointments/
    for f in sorted(os.listdir(os.path.join(OUT, CUBE))):
        if (f.endswith('.json') and f not in keep) or f.endswith('.json.tmp'):
            os.remove(os.path.join(OUT, CUBE, f)); print(f'{CUBE}: removed stale {CUBE}/{f} (D-058)')
    if os.path.exists(os.path.join(OUT, f'{CUBE}.meta.json.tmp')):
        os.remove(os.path.join(OUT, f'{CUBE}.meta.json.tmp')); print(f'{CUBE}: removed stale {CUBE}.meta.json.tmp (D-058)')
    lines = ''.join(f"{f['path']} {f['sha256']}\n" for f in sorted(files.values(), key=lambda f: f['path']))
    meta = {
        'cube': CUBE, 'files': files, 'files_sha256': hashlib.sha256(lines.encode()).hexdigest(),
        'files_digest_method': "sha256 of the lines '<path> <sha256>\\n' for every file, sorted by path",
        'format': 'one JSON file per entity, files[<entity>].path: {"cube", "entity", "columns", "rows", "windows"}; '
                  'rows hold every appt_group at grains month, quarter, fy and admin; windows[<administration>] = '
                  '{month_0, months, file_version (month 0 first)}. Plus files.admin, the admin view (see views)',
        'views': {ADMIN_VIEW: {
            'path': files[ADMIN_VIEW]['path'], 'decision': 'D-088', 'grain': 'admin', 'columns': ADMIN_COLUMNS,
            'months_in_office': view_n,
            'description': 'every entity x appt_group x administration at one months_in_office value: N = the '
                           "entity's Trump II months so far (D-072; a component that ended has its own, D-024), the same "
                           'N for every administration whose window reaches it; rows are copies of the entity files\' '
                           'admin rows in these columns; file {"cube", "view", "columns", "rows", "months_in_office", '
                           '"windows"}, windows as in the entity files'}},
        **bc._common_meta(ctx, end), 'built_at': None, 'time_basis': 'effective',
        'spec': 'docs/pages/appointments.md sections 3, 4, 6 (signed, D-086; D-084, D-085); D-024, D-065, D-066',
        'groups': {'file': 'pipeline/crosswalks/appointment_groups.csv',
                   'sha256': hashlib.sha256(open(XW_FILE, 'rb').read()).hexdigest(),
                   'list': order},
        'administrations': {'file': 'pipeline/crosswalks/administrations.csv',
                            'sha256': hashlib.sha256(open(bc.ADMINS, 'rb').read()).hexdigest(),
                            'list': [{'id': a, 'name': nm, 'first_month': bc.ym(w[0]), 'last_month': bc.ym(w[-1]), 'open': o}
                                     for a, nm, w, o in admins]},
        'range': {'first_month': bc.ym(months[0]), 'last_month': bc.ym(months[-1])},
        'entities': entities, 'rows': nrows, 'rows_by_grain': by_grain,
        'entity_last_month': {e: bc.ym(m) for e, m in end.items()},
        'provisional_months': [bc.ym(m) for m in sorted(ctx['provisional'])],
        'reissued_months': sorted(ctx['reissued']),
        'revision_baseline': 'revision_baseline.json', 'small_base_threshold': SMALL_BASE,
        'rates': 'none (D-085): counts and shares only',
        'source_fields': SOURCE_FIELDS,
        'known_data_issues': {'file': 'pipeline/known_data_issues.csv',
                              'sha256': hashlib.sha256(open(bc.ISSUES, 'rb').read()).hexdigest(),
                              'applied': [{k: r[k] for k in ('id', 'dataset', 'field', 'treatment', 'decision')} for r in ctx['issues']]},
        'columns': column_dictionary(),
    }
    big = max(files.values(), key=lambda f: os.path.getsize(os.path.join(OUT, f['path'])))
    bc._write_meta(CUBE, meta, nrows, f'{CUBE}: wrote {nrows} rows {by_grain} as {len(files) - 1} entity files (largest {big["path"]} '
                                      f'{os.path.getsize(os.path.join(OUT, big["path"])) / 1e6:.2f} MB) and {files[ADMIN_VIEW]["path"]} '
                                      f'({len(view_rows)} rows, {os.path.getsize(os.path.join(OUT, files[ADMIN_VIEW]["path"])) / 1e3:.1f} KB)')


if __name__ == '__main__':
    import duckdb
    os.chdir(ROOT)
    con = duckdb.connect(os.path.join('warehouse', 'opm.duckdb'), read_only=True)
    build(con)
    con.close()
