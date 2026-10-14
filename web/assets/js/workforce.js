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

  /* Known breaks between headcount change and net flow come from the cube meta's known_breaks
     (D-012, D-021; D-038 maps FY2025 to Sep 2025 and FY2026 to Oct 2025). The months to mark are
     the cube's knowledge: the page never turns a fiscal year into months. No fallback: a meta
     without the list throws, and the page then shows no markers. */
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  function breakMonths(meta) {
    if (!meta || !Array.isArray(meta.known_breaks)) throw new Error('doj_core.meta.json has no known_breaks list; no known-break markers are shown');
    var out = {};
    meta.known_breaks.forEach(function (b, i) {
      if (!b || !Array.isArray(b.months) || !b.months.length) throw new Error('known_breaks[' + i + '] has no months list');
      b.months.forEach(function (m) {
        if (typeof m !== 'string' || !MONTH.test(m)) throw new Error('known_breaks[' + i + '] has a bad month: ' + m);
        out[m] = true;
      });
    });
    return Object.keys(out).sort();
  }

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

  /* One flag per row: the row's period contains one of the months. */
  function breakFlags(rows, months) {
    if (!Array.isArray(months)) throw new Error('breakFlags needs a months list');
    return rows.map(function (r) { return months.some(function (m) { return containsMonth(r, m); }); });
  }

  /* The month a component was last reported with employees: meta.entity_last_employment_month (D-089: the Community
     Relations Service continues at 0 after April 2026), else its last row's month. */
  function lastEmployment(meta, e) {
    var m = meta.entity_last_employment_month;
    return m && m[e] ? m[e] : meta.entity_last_month ? meta.entity_last_month[e] : null;
  }

  /* Panel 4a: latest-month headcount of the components that report in the latest month, largest
     first; components last reported earlier (D-089: rows at 0 after that) are listed as ended, not ranked, with their
     last reported month. */
  function ranking(rows, meta) {
    var latest = meta.range.last_month, current = [], ended = [];
    meta.entities.filter(function (e) { return e !== 'DOJ'; }).forEach(function (e) {
      var r = latestMonthRow(rows, e), lastEmp = lastEmployment(meta, e);
      if (r && lastEmp && lastEmp < r.period) r = entityRows(rows, e, 'month').filter(function (x) { return x.period === lastEmp; })[0] || r;
      if (!r) return;
      if (r.period === latest) current.push({ entity: e, headcount: D.value(r, 'headcount'), row: r });
      else ended.push({ entity: e, headcount: D.value(r, 'headcount'), row: r });
    });
    current.sort(function (a, b) { return b.headcount - a.headcount; });
    return { current: current, ended: ended };
  }

  return {
    breakMonths: breakMonths, entityRows: entityRows, componentOptions: componentOptions,
    latestMonthRow: latestMonthRow, lastEmployment: lastEmployment, change12: change12, changeRange: changeRange, breakFlags: breakFlags, ranking: ranking
  };
});
