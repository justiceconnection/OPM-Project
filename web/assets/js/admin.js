/* Administrations (docs/pages/administrations.md; container D-065, definitions D-066, contents and copy D-068).
   Pure and testable. The four windows (D-065), the date-range presets built from them, and picking doj_admin
   rows: one row per entity, series group, administration and months in office N. The browser only picks a row
   and divides one picked value by another (percent = headcount_change / headcount_0; rates = numerator /
   rate_den, already annualized in the cube; reason share = reason / departures, D-080's seven reasons). Nothing is summed across
   series, administrations or months here. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./data.js') : root.OPM.data);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.admin = api; }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  /* D-065, in time order. Month 1 is January of the inauguration year; a null last month means "to the
     latest month" (Trump II, still in office). Checked against pipeline/crosswalks/administrations.csv. */
  var LIST = [
    { id: 'obama2', first: '2013-01', last: '2016-12' },
    { id: 'trump1', first: '2017-01', last: '2020-12' },
    { id: 'biden', first: '2021-01', last: '2024-12' },
    { id: 'trump2', first: '2025-01', last: null }
  ];
  var IDS = LIST.map(function (a) { return a.id; });
  var COMPARE_DEFAULT = ['trump2', 'biden', 'trump1']; // spec section 3
  var MAX_MONTHS = 48;
  var REASONS = ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];
  /* The "Why people left" charts (D-080): seven reasons that partition departures, DRP first, then the six D-015
     categories with DRP departures taken out (cube columns sep_<category>_nondrp). Tiles and rates keep REASONS. */
  var CHART_REASONS = ['sep_drp', 'sep_transfer_out_nondrp', 'sep_quit_nondrp', 'sep_retirement_nondrp', 'sep_rif_nondrp', 'sep_termination_nondrp', 'sep_other_nondrp'];
  /* The signed series label's column for a chart reason: sep_quit_nondrp -> sep_quit (D-080 keeps the six labels). */
  function reasonLabelCol(col) { return col.replace(/_nondrp$/, ''); }

  function isAdmin(id) { return IDS.indexOf(id) >= 0; }
  function byId(id) { return LIST.filter(function (a) { return a.id === id; })[0] || null; }

  /* The months an administration covers, with the open one ending at the latest month. */
  function windowOf(id, latest) {
    var a = byId(id);
    if (!a) throw new Error('admin.windowOf: unknown administration ' + id);
    return { first: a.first, last: a.last || latest, open: a.last === null };
  }

  /* Date-range presets (controls/range.js shape): the four administrations, then All. names: { id: label, all }. */
  function presets(names, bounds) {
    return LIST.map(function (a) { return { id: a.id, label: names[a.id], start: a.first, end: a.last }; })
      .concat([{ id: 'all', label: names.all, start: bounds.start, end: null }]);
  }

  /* The chosen ids in time order. */
  function ordered(ids) { return IDS.filter(function (id) { return ids.indexOf(id) >= 0; }); }

  /* The rows of one entity, series group and administration, by N. */
  function rowsOf(rows, entity, group, admin) {
    return rows.filter(function (r) { return r.entity === entity && r.series_group === group && r.administration === admin; })
      .sort(function (a, b) { return a.months_in_office - b.months_in_office; });
  }

  function rowAt(rows, entity, group, admin, n) {
    return rows.filter(function (r) { return r.entity === entity && r.series_group === group && r.administration === admin && r.months_in_office === n; })[0] || null;
  }

  /* Months in office the cube publishes for this entity and group (0 when none). */
  function months(rows, entity, group, admin) {
    var r = rowsOf(rows, entity, group, admin);
    return r.length ? r[r.length - 1].months_in_office : 0;
  }

  /* The whole window: the row at N = admin_months (D-066). */
  function windowRow(rows, entity, group, admin) {
    var r = rowsOf(rows, entity, group, admin);
    if (!r.length) return null;
    return r.filter(function (x) { return x.months_in_office === x.admin_months; })[0] || null;
  }

  /* The largest N the chosen set allows: the shortest chosen administration (those without rows are left out). */
  function cap(rows, entity, group, chosen) {
    var m = chosen.map(function (id) { return months(rows, entity, group, id); }).filter(function (x) { return x > 0; });
    return m.length ? Math.min.apply(null, m) : MAX_MONTHS;
  }

  /* No one in the group over the window to N: no row, or no employees at either end and no hires or departures. */
  function noStaff(row) {
    return !row || (!row.headcount_0 && !row.headcount_n && !row.hires && !row.departures);
  }

  /* The figures of one row, in the shape of compare.tableRow (Components compared reads both). */
  function cells(row) {
    if (!row) return null;
    return {
      employees: D.value(row, 'headcount_n'), change: D.value(row, 'headcount_change'),
      changePct: D.ratio(row, 'headcount_change', 'headcount_0'),
      hires: D.value(row, 'hires'), departures: D.value(row, 'departures'),
      attrition: D.ratio(row, 'attrition_num', 'rate_den'), quit: D.ratio(row, 'quit_num', 'rate_den'), retirement: D.ratio(row, 'retirement_num', 'rate_den'),
      smallBase: row.rate_small_base === true, provisional: row.provisional === true, partial: row.partial === true
    };
  }

  /* Reason shares for the reasons charts: each of the seven CHART_REASONS over the row's departures (D-080); a row
     with no DRP departures has a DRP share of 0. Null when there are no departures. */
  function reasonShares(row) {
    var deps = row ? D.value(row, 'departures') : null;
    if (!deps) return { none: deps === 0, shares: CHART_REASONS.map(function () { return null; }) };
    return { none: false, shares: CHART_REASONS.map(function (c) { return D.ratio(row, c, 'departures'); }) };
  }

  /* One line per administration over months 1 to n: the column at each N (null where the cube has no row). */
  function line(rows, entity, group, admin, n, col) {
    var by = {};
    rowsOf(rows, entity, group, admin).forEach(function (r) { by[r.months_in_office] = r; });
    var out = { values: [], provisional: [], rows: [] };
    for (var i = 1; i <= n; i++) {
      var r = by[i] || null;
      out.rows.push(r); out.values.push(r ? D.value(r, col) : null); out.provisional.push(!!(r && r.provisional));
    }
    return out;
  }

  return { LIST: LIST, IDS: IDS, COMPARE_DEFAULT: COMPARE_DEFAULT, MAX_MONTHS: MAX_MONTHS, REASONS: REASONS, CHART_REASONS: CHART_REASONS, reasonLabelCol: reasonLabelCol, isAdmin: isAdmin, byId: byId, windowOf: windowOf,
    presets: presets, ordered: ordered, rowsOf: rowsOf, rowAt: rowAt, months: months, windowRow: windowRow, cap: cap, noStaff: noStaff, cells: cells,
    reasonShares: reasonShares, line: line };
});
