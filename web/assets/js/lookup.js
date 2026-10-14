/* Workforce Look-Up logic, pure and testable (docs/pages/workforce-lookup.md; container D-051, fields
   D-052, readings D-053, reader D-054, contents and copy D-056; invariant 10). It works on the rows of ONE
   file at a time: filters, searches, counts, sorts, pages and writes CSV. It never merges rows from two
   files and it infers nothing: values stay as published (REDACTED kept); only the fiscal year of an
   effective month is computed, for the filter, and the Appointments tab's group of an appointment type is
   looked up, for the filter (D-095; the mapping is generated from pipeline/crosswalks/appointment_groups.csv). */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./appointment-groups.js') : root.OPM.appointmentGroups);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.lookup = api; }
})(typeof self !== 'undefined' ? self : this, function (P, AG) {
  'use strict';

  /* The signed columns of each dataset, in D-052 order (pipeline/crosswalks/lookup_fields.csv). */
  var FIELDS = {
    separations: ['agency_subelement_code', 'agency_subelement', 'personnel_action_effective_date_yyyymm', 'period', 'separation_category', 'drp_indicator',
      'occupational_series_code', 'occupational_series', 'pay_plan_code', 'grade', 'age_bracket', 'length_of_service_years', 'supervisory_status',
      'appointment_type', 'tenure', 'education_level', 'veteran_indicator', 'work_schedule', 'annualized_adjusted_basic_pay', 'duty_station_state'],
    accessions: ['agency_subelement_code', 'agency_subelement', 'personnel_action_effective_date_yyyymm', 'period', 'accession_category',
      'occupational_series_code', 'occupational_series', 'pay_plan_code', 'grade', 'age_bracket', 'length_of_service_years', 'supervisory_status',
      'appointment_type', 'tenure', 'education_level', 'veteran_indicator', 'work_schedule', 'annualized_adjusted_basic_pay', 'duty_station_state'],
    employment: ['snapshot_yyyymm', 'agency_subelement_code', 'agency_subelement', 'occupational_series_code', 'occupational_series', 'pay_plan_code', 'grade',
      'age_bracket', 'length_of_service_years', 'supervisory_status', 'appointment_type', 'tenure', 'education_level', 'veteran_indicator', 'work_schedule',
      'annualized_adjusted_basic_pay', 'duty_station_state']
  };

  /* The table's columns, in D-052 order: component (code, shown by its signed display name) and occupation
     (series number and title together) each take one column; col names the copy key (col.<col>). */
  var COLUMN_OF = {
    snapshot_yyyymm: 'snapshot', agency_subelement_code: 'component', personnel_action_effective_date_yyyymm: 'effective', period: 'processed',
    separation_category: 'reason', accession_category: 'hireType', drp_indicator: 'drp', occupational_series_code: 'occupation', pay_plan_code: 'payPlan',
    grade: 'grade', age_bracket: 'age', length_of_service_years: 'service', supervisory_status: 'supervisory', appointment_type: 'appointment',
    tenure: 'tenure', education_level: 'education', veteran_indicator: 'veteran', work_schedule: 'schedule', annualized_adjusted_basic_pay: 'pay',
    duty_station_state: 'state'
  };
  function columns(dataset) {
    return FIELDS[dataset].filter(function (f) { return COLUMN_OF[f]; }).map(function (f) { return { col: COLUMN_OF[f], field: f }; });
  }
  var NUMERIC = { grade: true, length_of_service_years: true, annualized_adjusted_basic_pay: true };
  var MONTHS = { snapshot_yyyymm: true, personnel_action_effective_date_yyyymm: true, period: true };

  /* The filters of each dataset (spec section 2). fy is the fiscal year of the month the action took effect. */
  var FILTERS = {
    separations: ['component', 'fy', 'reason', 'occupation', 'grade', 'age', 'supervisory', 'appointment'],
    accessions: ['component', 'fy', 'hireType', 'occupation', 'grade', 'age', 'supervisory', 'appointment'],
    employment: ['component', 'occupation', 'grade', 'age', 'supervisory', 'appointment']
  };
  var FILTER_FIELD = { component: 'agency_subelement_code', reason: 'separation_category', hireType: 'accession_category', occupation: 'occupational_series_code',
    grade: 'grade', age: 'age_bracket', supervisory: 'supervisory_status', appointment: 'appointment_type' };

  /* Appointment type (D-095): OPM's published label -> the Appointments tab's group (D-086), from the generated
     appointment-groups.js. A filter value is either one published label, or GROUP_PREFIX + a group, which matches
     every label of that group. Labels with no group (INVALID, or any label the crosswalk lacks) stand alone. */
  var GROUP_PREFIX = 'group:';
  var APPT_GROUP = {}, APPT_RANK = {};
  AG.groups.forEach(function (g, gi) { g.labels.forEach(function (l, li) { APPT_GROUP[l] = g.group; APPT_RANK[l] = gi * 100 + li; }); });
  function appointmentGroupOf(label) { return Object.prototype.hasOwnProperty.call(APPT_GROUP, label) ? APPT_GROUP[label] : null; }
  function appointmentOrder(a, b) { // crosswalk order; labels with no group last, by text (INVALID among them)
    var ra = appointmentGroupOf(a) ? APPT_RANK[a] : Infinity, rb = appointmentGroupOf(b) ? APPT_RANK[b] : Infinity;
    return ra === rb ? (a < b ? -1 : a > b ? 1 : 0) : ra < rb ? -1 : 1;
  }
  /* The rows of the Appointment type list for the published labels present: each group that has a label present,
     then its labels (nested), then the labels with no group on their own. -> [{ value, group?, label?, nested }] */
  function appointmentOptions(present) {
    var have = {}, out = [];
    present.forEach(function (v) { have[v] = true; });
    AG.groups.forEach(function (g) {
      var labels = g.labels.filter(function (l) { return have[l]; });
      if (!labels.length) return;
      out.push({ value: GROUP_PREFIX + g.group, group: g.group, nested: false });
      labels.forEach(function (l) { out.push({ value: l, label: l, nested: true }); });
    });
    present.filter(function (v) { return !appointmentGroupOf(v); }).sort(appointmentOrder).forEach(function (l) { out.push({ value: l, label: l, nested: false }); });
    return out;
  }
  /* Does a row's value for a filter match the chosen value? */
  function matches(row, key, want) {
    var v = filterValue(row, key);
    if (key === 'appointment' && want.indexOf(GROUP_PREFIX) === 0) return v !== null && appointmentGroupOf(v) === want.slice(GROUP_PREFIX.length);
    return v === want;
  }

  function isEmpty(v) { return v === null || v === undefined || v === ''; }

  function yyyymmToKey(v) { return /^\d{6}$/.test(v || '') ? v.slice(0, 4) + '-' + v.slice(4) : null; }
  function fyOf(v) { var k = yyyymmToKey(v); return k ? 'FY' + P.fiscalYear(k) : null; }

  /* A filter's value for a row: the published value, or the fiscal year of the effective month. */
  function filterValue(row, key) {
    if (key === 'fy') return fyOf(row.personnel_action_effective_date_yyyymm);
    var v = row[FILTER_FIELD[key]];
    return isEmpty(v) ? null : v;
  }

  function seriesOrder(a, b) { // 0905 and 1811 first (D-043), then by series number, then anything else as published (e.g. ' ')
    var rank = function (v) { return v === '0905' ? 0 : v === '1811' ? 1 : /^\d+$/.test(v) ? 2 : 3; };
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  }
  function numericOrder(a, b) {
    var na = parseFloat(a), nb = parseFloat(b), fa = isFinite(na) && /^[\d.]+$/.test(a), fb = isFinite(nb) && /^[\d.]+$/.test(b);
    if (fa && fb) return na - nb || (a < b ? -1 : 1);
    if (fa !== fb) return fa ? -1 : 1; // numbers before words such as REDACTED
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* The published values of each filter present in the rows, in display order. nameOf(key, value) labels. */
  function filterOptions(rows, dataset, nameOf) {
    var out = {};
    FILTERS[dataset].forEach(function (key) {
      var seen = {};
      rows.forEach(function (r) { var v = filterValue(r, key); if (v !== null) seen[v] = true; });
      var vals = Object.keys(seen);
      if (key === 'occupation') vals.sort(seriesOrder);
      else if (key === 'grade') vals.sort(numericOrder);
      else if (key === 'fy') vals.sort().reverse();
      else if (key === 'component') vals.sort(function (a, b) { return nameOf(key, a).localeCompare(nameOf(key, b), 'en'); });
      else if (key === 'appointment') vals.sort(appointmentOrder);
      else vals.sort();
      out[key] = vals;
    });
    return out;
  }

  /* A lower-case text of the shown values of each row, for the search. display(row, column) gives the shown text. */
  function searchIndex(rows, cols, display) {
    return rows.map(function (r) { return cols.map(function (c) { return display(r, c); }).join('\u0001').toLowerCase(); });
  }

  /* Indexes of the rows that pass every chosen filter and contain the search text (case-insensitive). */
  function filterRows(rows, filters, search, index) {
    var keys = Object.keys(filters).filter(function (k) { return filters[k] !== null && filters[k] !== undefined && filters[k] !== ''; });
    var q = (search || '').trim().toLowerCase();
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var ok = true;
      for (var j = 0; j < keys.length && ok; j++) ok = matches(rows[i], keys[j], filters[keys[j]]);
      if (ok && q) ok = index[i].indexOf(q) >= 0;
      if (ok) out.push(i);
    }
    return out;
  }

  /* Counts of the filtered rows by one filter field, largest first (empty values grouped as null). */
  function groupCounts(rows, idx, key) {
    var m = {};
    idx.forEach(function (i) { var v = filterValue(rows[i], key); var k = v === null ? '\u0000' : v; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(function (k) { return { value: k === '\u0000' ? null : k, count: m[k] }; })
      .sort(function (a, b) { return b.count - a.count || String(a.value).localeCompare(String(b.value), 'en'); });
  }

  /* Sort row indexes by one column's field; numbers numerically, months as text; empty values always last. */
  function sortIndexes(rows, idx, field, dir, text) {
    var sign = dir === 'desc' ? -1 : 1;
    var get = text || function (r) { return r[field]; };
    return idx.map(function (i, k) { return { i: i, k: k, v: get(rows[i]) }; }).sort(function (a, b) {
      var ea = isEmpty(a.v), eb = isEmpty(b.v);
      if (ea || eb) return ea === eb ? a.k - b.k : ea ? 1 : -1;
      var c = NUMERIC[field] ? numericOrder(a.v, b.v) : String(a.v).localeCompare(String(b.v), 'en');
      return sign * c || a.k - b.k;
    }).map(function (x) { return x.i; });
  }

  function page(idx, n, size) {
    var pages = Math.max(1, Math.ceil(idx.length / size)), p = Math.min(Math.max(1, n), pages);
    return { page: p, pages: pages, rows: idx.slice((p - 1) * size, p * size) };
  }

  /* KDI-001 (D-026, D-052): departures whose length of service was counted from 1900, in the Jun 2024 to
     Jul 2025 files; the value stays as published and the row carries a marker. */
  var KDI_001 = { dataset: 'separations', field: 'length_of_service_years', firstFile: '202406', lastFile: '202507', min: 124, max: 126 };
  function isKdi001(dataset, row) {
    if (dataset !== KDI_001.dataset) return false;
    var v = parseFloat(row[KDI_001.field]);
    return row.period >= KDI_001.firstFile && row.period <= KDI_001.lastFile && isFinite(v) && v >= KDI_001.min && v <= KDI_001.max;
  }

  /* CSV of the rows: all signed columns in D-052 order, OPM column names as the header, values exactly as
     published (empty for a missing value), RFC 4180 quoting, CRLF line ends. It starts with a UTF-8
     byte-order mark so spreadsheet programs read it as UTF-8 (L-069); the mark is not part of any value. */
  var BOM = '\ufeff';
  function csvField(v) {
    if (isEmpty(v)) return '';
    var s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(dataset, rows, idx) {
    var f = FIELDS[dataset], lines = [f.join(',')];
    idx.forEach(function (i) { lines.push(f.map(function (k) { return csvField(rows[i][k]); }).join(',')); });
    return BOM + lines.join('\r\n') + '\r\n';
  }
  function csvName(dataset, snapshot) { return 'doj-' + dataset + '-' + (snapshot || 'all') + '-filtered.csv'; }

  return { FIELDS: FIELDS, FILTERS: FILTERS, FILTER_FIELD: FILTER_FIELD, MONTHS: MONTHS, NUMERIC: NUMERIC, KDI_001: KDI_001, columns: columns, isEmpty: isEmpty,
    yyyymmToKey: yyyymmToKey, fyOf: fyOf, filterValue: filterValue, filterOptions: filterOptions, searchIndex: searchIndex, filterRows: filterRows,
    groupCounts: groupCounts, sortIndexes: sortIndexes, page: page, isKdi001: isKdi001, toCsv: toCsv, csvName: csvName, BOM: BOM, seriesOrder: seriesOrder,
    GROUP_PREFIX: GROUP_PREFIX, appointmentGroupOf: appointmentGroupOf, appointmentOrder: appointmentOrder, appointmentOptions: appointmentOptions, matches: matches };
});
