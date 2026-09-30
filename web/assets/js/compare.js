/* Components compared page logic, pure and testable (docs/pages/components-compared.md; container
   D-046, contents and copy D-047). doj_core only. Picks rows and divides one picked value by another:
   change percent = headcount_change / previous row's headcount; rates = numerator / denominator;
   growth = headcount / start-year-end headcount; reason share = reason / departures. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./periods.js') : root.OPM.periods, node ? require('./data.js') : root.OPM.data, node ? require('./workforce.js') : root.OPM.workforce);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.compare = api; }
})(typeof self !== 'undefined' ? self : this, function (P, D, W) {
  'use strict';

  var REASONS = ['sep_transfer_out', 'sep_quit', 'sep_retirement', 'sep_rif', 'sep_termination', 'sep_other'];
  var RATES = ['attrition', 'quit', 'retirement'];

  function rowFor(rows, entity, grain, period) {
    return rows.filter(function (r) { return r.entity === entity && r.grain === grain && r.period === period; })[0] || null;
  }

  /* Periods of the view that DOJ has, latest first. */
  function periods(rows, grain) {
    var seen = {};
    rows.forEach(function (r) { if (r.entity === 'DOJ' && r.grain === grain) seen[r.period] = r.period_first_month; });
    return Object.keys(seen).sort(function (a, b) { return seen[a] < seen[b] ? 1 : seen[a] > seen[b] ? -1 : 0; });
  }

  /* The components for a period: the current ones always; one that ended (CRS) only when it has a row for
     the period, i.e. the period falls within its existence (D-024). Order: latest employee count, largest first. */
  /* Every component, ended ones included, by latest employee count (largest first). */
  function allComponents(rows, meta) {
    var latest = meta.range.last_month;
    return meta.entities.filter(function (e) { return e !== 'DOJ'; }).map(function (e) {
      var last = W.latestMonthRow(rows, e);
      return { entity: e, ended: meta.entity_last_month[e] < latest, endMonth: meta.entity_last_month[e], latestHeadcount: last ? last.headcount : null };
    }).sort(function (a, b) { return (b.latestHeadcount || 0) - (a.latestHeadcount || 0); });
  }

  function components(rows, meta, grain, period) {
    return allComponents(rows, meta).map(function (c) { return Object.assign({ row: rowFor(rows, c.entity, grain, period) }, c); })
      .filter(function (c) { return !c.ended || c.row; });
  }

  /* One table row: the columns of the spec for an entity's row, rates under the chosen method. */
  function tableRow(rows, row, method) {
    if (!row) return null;
    var prev = D.previousRow(rows, row);
    var out = {
      employees: D.value(row, 'headcount'), change: D.value(row, 'headcount_change'),
      changePct: prev ? D.divide(D.value(row, 'headcount_change'), D.value(prev, 'headcount')) : null,
      hires: D.value(row, 'hires'), departures: D.value(row, 'departures'),
      smallBase: row['rate_' + method + '_small_base'] === true,
      provisional: row.provisional === true, partial: row.partial === true
    };
    RATES.forEach(function (m) { out[m] = D.ratio(row, m + '_' + method + '_num', 'rate_' + method + '_den'); });
    return out;
  }

  /* Sort table rows (DOJ is kept apart by the caller). dir 'desc' first; empty values always last. */
  function sortRows(list, key, dir, nameOf) {
    var sign = dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var va = key === 'component' ? nameOf(a.entity) : a.cells[key], vb = key === 'component' ? nameOf(b.entity) : b.cells[key];
      var na = va === null || va === undefined, nb = vb === null || vb === undefined;
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      if (typeof va === 'string') return sign * va.localeCompare(vb, 'en');
      return sign * (va - vb);
    });
  }

  /* Growth since a start year: at each period of the view from the start year's first month, the
     headcount over the headcount at the end of the start year (its fiscal-year row). */
  function growth(rows, entity, grain, startFy) {
    var base = rowFor(rows, entity, 'fy', startFy);
    var first = P.periodBounds(startFy).start;
    var picked = D.selectRows(rows, { entity: entity, grain: grain }).filter(function (r) { return r.period_first_month >= first; });
    return {
      base: base, rows: picked,
      values: picked.map(function (r) { return base ? D.divide(D.value(r, 'headcount'), D.value(base, 'headcount')) : null; })
    };
  }

  /* Reason shares for one row: each reason over the row's departures; null when there are no departures. */
  function reasonShares(row) {
    var deps = row ? D.value(row, 'departures') : null;
    if (!deps) return { none: deps === 0, shares: REASONS.map(function () { return null; }) };
    return { none: false, shares: REASONS.map(function (c) { return D.ratio(row, c, 'departures'); }) };
  }

  return { REASONS: REASONS, RATES: RATES, rowFor: rowFor, periods: periods, allComponents: allComponents, components: components, tableRow: tableRow, sortRows: sortRows, growth: growth, reasonShares: reasonShares };
});
