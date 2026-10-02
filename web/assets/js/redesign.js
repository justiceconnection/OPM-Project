/* The redesigned main pages (docs/pages/redesign.md; D-071, D-072): Overview, Departures and Components. Pure and
   testable. Every figure is one picked cube row, or one picked value divided by another: doj_admin at months in office
   N (N = Trump II's months so far for the component and series), doj_leaving grain "admin_n" (the first N months, rates
   already annualized in the cube), doj_core rows for the timelines. Nothing is summed across series, administrations
   or months here. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./data.js') : root.OPM.data, node ? require('./admin.js') : root.OPM.admin);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.redesign = api; }
})(typeof self !== 'undefined' ? self : this, function (D, A) {
  'use strict';

  var COMPARE = ['obama2', 'trump1', 'biden']; // "Compare with": all on by default (section 2)
  var CURRENT = 'trump2';
  var STEP = { month: 1, quarter: 3, fy: 12 }; // View on a months-in-office chart: every month, every 3rd, every 12th (D-071)

  /* The months in office a chart shows at a View: every STEP-th month up to maxN, plus month n (the current point,
     so Trump II's line always reaches its latest month). */
  function monthsShown(maxN, grain, n) {
    var k = STEP[grain] || 1, out = [];
    for (var m = k; m <= maxN; m += k) out.push(m);
    if (n && n <= maxN && out.indexOf(n) < 0) out.push(n);
    return out.sort(function (a, b) { return a - b; });
  }

  /* D-077: administrations are always listed Trump II, Biden, Trump I, Obama II (legends, tables, bars, tooltips, toggles). */
  var ORDER = ['trump2', 'biden', 'trump1', 'obama2'];
  /* The administrations on a chart: Trump II, then the compared ones, in that order. */
  function shown(compared) { return ORDER.filter(function (id) { return id === CURRENT || compared.indexOf(id) >= 0; }); }

  /* "At this point" lines: the compared administrations, the most recent first (Biden, Trump I, Obama II). */
  function atOrder(compared) { return ORDER.filter(function (id) { return id !== CURRENT && compared.indexOf(id) >= 0; }); }

  /* N and Trump II's row at N for one entity and series group (null when the cube has no Trump II rows). */
  function current(rows, entity, group) {
    var n = A.months(rows, entity, group, CURRENT);
    return n ? { n: n, row: A.rowAt(rows, entity, group, CURRENT, n) } : null;
  }

  /* Each administration's row at the same month in office n. */
  function atPoint(rows, entity, group, ids, n) {
    return ids.map(function (id) { return { id: id, row: A.rowAt(rows, entity, group, id, n) }; });
  }

  /* One line per administration over the months shown: the column at each month (null where the cube has none). */
  function lineAt(rows, entity, group, id, months, col) {
    var by = {};
    A.rowsOf(rows, entity, group, id).forEach(function (r) { by[r.months_in_office] = r; });
    return {
      values: months.map(function (m) { return by[m] ? D.value(by[m], col) : null; }),
      provisional: months.map(function (m) { return !!(by[m] && by[m].provisional); })
    };
  }

  /* Percent change since month 0 over the months shown (D-075 mini charts): headcount_change / headcount_0 of the row at
     each month, both picked from that one row (null where the cube has no row or month 0 had no one). */
  function pctLine(rows, entity, group, id, months) {
    var by = {};
    A.rowsOf(rows, entity, group, id).forEach(function (r) { by[r.months_in_office] = r; });
    return {
      values: months.map(function (m) { return by[m] ? D.ratio(by[m], 'headcount_change', 'headcount_0') : null; }),
      provisional: months.map(function (m) { return !!(by[m] && by[m].provisional); })
    };
  }

  /* The Components table (section 4.3): per entity, Trump II at its own N (cut at a component's last month, D-024),
     and each compared administration's change percent at that same N. rowsOf(entity) gives that entity's doj_admin
     rows for the group in view. */
  function componentRow(rows, entity, group, compared) {
    var cur = current(rows, entity, group);
    if (!cur || A.noStaff(cur.row)) return { entity: entity, none: true, n: cur ? cur.n : null, cells: null, at: {} };
    var at = {};
    compared.forEach(function (id) { var r = A.rowAt(rows, entity, group, id, cur.n); at[id] = r && !A.noStaff(r) ? A.cells(r).changePct : null; });
    return { entity: entity, none: false, n: cur.n, row: cur.row, cells: A.cells(cur.row), at: at };
  }

  /* Who is leaving, first N months (section 4.2 Chart C, grain admin_n): for one dimension, the known groups in signed
     order, each with every administration's annualized rate and flags; the Unknown count and the coverage apart. */
  function leavingPanel(rows, dim, ids) {
    var pick = function (id) { return rows.filter(function (r) { return r.grain === 'admin_n' && r.period === id && r.dimension === dim; }); };
    var byAdmin = {}, order = {}, values = [];
    ids.forEach(function (id) {
      byAdmin[id] = {};
      pick(id).forEach(function (r) {
        byAdmin[id][r.value] = r;
        if (r.is_unknown !== true && !(r.value in order)) { order[r.value] = r.value_order; values.push(r.value); }
      });
    });
    values.sort(function (a, b) { return order[a] - order[b]; });
    var unknown = {}, coverage = {}, provisional = false;
    ids.forEach(function (id) {
      var u = Object.keys(byAdmin[id]).map(function (v) { return byAdmin[id][v]; }).filter(function (r) { return r.is_unknown === true; })[0];
      unknown[id] = u ? D.value(u, 'departures') : null;
      var any = byAdmin[id][values[0]];
      coverage[id] = any ? D.value(any, 'coverage') : null;
      if (any && any.provisional) provisional = true;
    });
    return {
      values: values, unknown: unknown, coverage: coverage, provisional: provisional,
      has: ids.some(function (id) { return Object.keys(byAdmin[id]).length > 0; }),
      groups: values.map(function (v) {
        var cells = {};
        ids.forEach(function (id) {
          var r = byAdmin[id][v];
          cells[id] = r ? { rate: D.ratio(r, 'rate_num', 'rate_den'), departures: D.value(r, 'departures'), smallBase: r.rate_small_base === true, na: r.rate_not_applicable === true } : null;
        });
        return { value: v, cells: cells };
      })
    };
  }

  /* Where clamped off-scale values go (Components chart, D-077 and L-107): per row and side, the bar's own value stays on
     the bar's line; markers leaving the same side are stacked clear of it and of each other. items: [{ kind: 'bar' |
     'marker', index, dir }]; returns a copy of each with dy (pixels from the row's centre). Pure. */
  function offScaleLayout(items) {
    var groups = {};
    items.forEach(function (it, i) { var k = it.index + ':' + it.dir; (groups[k] = groups[k] || []).push(i); });
    var out = items.map(function (it) { return Object.assign({}, it, { dy: 0 }); });
    Object.keys(groups).forEach(function (k) {
      var idx = groups[k], hasBar = idx.some(function (i) { return items[i].kind === 'bar'; });
      var markers = idx.filter(function (i) { return items[i].kind === 'marker'; });
      markers.forEach(function (i, j) {
        var ring = Math.floor(j / 2) + 1, sign = j % 2 ? 1 : -1;
        out[i].dy = hasBar ? sign * 13 * ring : markers.length === 1 ? -8 : sign * (6 + 12 * (ring - 1));
      });
    });
    return out;
  }

  return { COMPARE: COMPARE, ORDER: ORDER, CURRENT: CURRENT, STEP: STEP, monthsShown: monthsShown, shown: shown, atOrder: atOrder, current: current, atPoint: atPoint,
    lineAt: lineAt, pctLine: pctLine, offScaleLayout: offScaleLayout, componentRow: componentRow, leavingPanel: leavingPanel };
});
