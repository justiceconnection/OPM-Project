/* Workforce size page logic, pure and testable (docs/pages/workforce-size.md, D-029, D-030).
   Picks cube rows and sums or divides them through data.js. It never subtracts two rows:
   change tiles sum headcount_change, which telescopes. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./data.js') : root.OPM.data);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.workforce = api; }
})(typeof self !== 'undefined' ? self : this, function (P, D) {
  'use strict';

  /* Known breaks between headcount change and net flow (D-012, D-021): the DRP wave.
     A period is marked when it contains one of these months, which puts the marker on FY2025
     and FY2026 at fiscal-year grain, FY2025Q4 and FY2026Q1 at quarter grain, and Sep and
     Oct 2025 at month grain, as the spec says. */
  var KNOWN_BREAK_MONTHS = ['2025-09', '2025-10'];

  function byStart(a, b) { return a.period_first_month < b.period_first_month ? -1 : a.period_first_month > b.period_first_month ? 1 : 0; }

  function entityRows(rows, entity, grain) {
    return rows.filter(function (r) { return r.entity === entity && r.grain === grain; }).sort(byStart);
  }

  /* DOJ first, then the components by display name; a component that ended shows its end month. */
  function componentOptions(opts) {
    var comps = opts.entities.filter(function (e) { return e !== 'DOJ'; }).map(function (e) {
      var ended = opts.entityLastMonth[e] && opts.entityLastMonth[e] < opts.latest;
      var name = opts.names[e];
      return { value: e, name: name, label: ended ? opts.endedLabel(name, opts.entityLastMonth[e]) : name };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, 'en'); });
    return [{ value: 'DOJ', label: opts.allLabel }].concat(comps.map(function (c) { return { value: c.value, label: c.label }; }));
  }

  function latestMonthRow(rows, entity) {
    var m = entityRows(rows, entity, 'month');
    return m.length ? m[m.length - 1] : null;
  }

  /* Change over the last 12 months: the sum of the last 12 monthly headcount_change values,
     over the headcount of the month before them (picked as a row). */
  function change12(rows, entity, meta) {
    var m = entityRows(rows, entity, 'month');
    if (m.length < 13) return null;
    var last12 = m.slice(-12);
    var base = D.previousRow(rows, last12[0]);
    var sum = D.sumAcrossPeriods(last12, 'headcount_change', meta);
    return { sum: sum, pct: base ? D.divide(sum, D.value(base, 'headcount')) : null, base: base, first: last12[0], last: last12[11] };
  }

  /* Change over the chosen range at the chosen grain, with a percent (spec: "with the same percent").
     With a row for the period before the range, that row is the base: the sum of headcount_change
     over the range, over the base's headcount. Without one (the range starts at the entity's first
     period, whose change is null), the change is measured from the end of the first period: the
     first period's row is the base (from = base), and the sum runs over the rest of the range. */
  function changeRange(rows, entity, grain, range, meta) {
    var picked = D.selectRows(rows, { entity: entity, grain: grain, range: range });
    if (!picked.length) return null;
    var base = D.previousRow(rows, picked[0]);
    var first = picked[0], last = picked[picked.length - 1];
    if (base) {
      var sum = D.sumAcrossPeriods(picked, 'headcount_change', meta);
      return { sum: sum, pct: D.divide(sum, D.value(base, 'headcount')), base: base, from: null, first: first, last: last };
    }
    var rest = picked.slice(1);
    var restSum = rest.length ? D.sumAcrossPeriods(rest, 'headcount_change', meta) : null;
    return { sum: restSum, pct: D.divide(restSum, D.value(first, 'headcount')), base: first, from: first, first: first, last: last };
  }

  function containsMonth(row, month) {
    return row.period_first_month <= month && month <= P.periodBounds(row.period).end;
  }

  function breakFlags(rows, months) {
    var list = months || KNOWN_BREAK_MONTHS;
    return rows.map(function (r) { return list.some(function (m) { return containsMonth(r, m); }); });
  }

  /* Panel 4a: latest-month headcount of the components that report in the latest month, largest
     first; components whose last month is earlier are listed as ended, not ranked. */
  function ranking(rows, meta) {
    var latest = meta.range.last_month, current = [], ended = [];
    meta.entities.filter(function (e) { return e !== 'DOJ'; }).forEach(function (e) {
      var r = latestMonthRow(rows, e);
      if (!r) return;
      if (r.period === latest) current.push({ entity: e, headcount: D.value(r, 'headcount'), row: r });
      else ended.push({ entity: e, headcount: D.value(r, 'headcount'), row: r });
    });
    current.sort(function (a, b) { return b.headcount - a.headcount; });
    return { current: current, ended: ended };
  }

  return {
    KNOWN_BREAK_MONTHS: KNOWN_BREAK_MONTHS, entityRows: entityRows, componentOptions: componentOptions,
    latestMonthRow: latestMonthRow, change12: change12, changeRange: changeRange, breakFlags: breakFlags, ranking: ranking
  };
});
