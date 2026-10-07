/* Appointments (docs/pages/appointments.md; D-084 to D-087): picking doj_appointments rows. Pure and testable.
   The cube has one row per entity x appt_group x grain x period; at grain "admin" the period is the administration id and
   months_in_office is N (headcount at month N, headcount_0 at month 0, hires and departures running over months 1 to N).
   The browser only picks rows, sums the same key's rows across selected components (D-078, D-079) and divides one summed
   column by another: share = headcount / headcount_all, percent change = headcount_change / headcount_0 (null where
   month 0 is below 30, spec section 4). No rates on this page (D-085). Nothing is summed across months, groups or
   administrations here. */
(function (root, factory) {
  var node = typeof require === 'function' && typeof module === 'object';
  var api = factory(node ? require('./data.js') : root.OPM.data);
  if (node && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.appointments = api; }
})(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  var CURRENT = 'trump2';
  var SMALL = 30; // spec section 4: a percent change only where month 0 has 30 or more

  /* The seven groups shown, bottom of the stack first (spec section 3); 'unknown' is counted in totals, never shown. */
  var GROUPS = ['career', 'career_conditional', 'excepted', 'temporary', 'ses', 'political', 'schedule_policy'];
  var SUBGROUPS = ['schedule_c', 'noncareer_ses', 'executive'];
  /* The group picker of the flows and by-component charts: political appointees first (the default), its subgroups,
     Schedule Policy/Career, then the other groups. */
  var PICKER = ['political', 'schedule_c', 'noncareer_ses', 'executive', 'schedule_policy', 'career', 'career_conditional', 'excepted', 'temporary', 'ses'];
  /* The signed label of each group and subgroup (section 7). */
  var LABEL = { career: 'shell:appt.group.career', career_conditional: 'shell:appt.group.careerConditional', excepted: 'shell:appt.group.excepted',
    temporary: 'shell:appt.group.temporary', ses: 'shell:appt.group.ses', political: 'shell:appt.group.political', schedule_policy: 'shell:appt.group.schedulePolicy',
    schedule_c: 'shell:appt.sub.scheduleC', noncareer_ses: 'shell:appt.sub.noncareerSes', executive: 'shell:appt.sub.executive' };
  /* The "since taking office" toggle: All political (the group's own label), then the three subgroups. */
  var SINCE = ['political', 'schedule_c', 'noncareer_ses', 'executive'];

  /* The key a summed row shares (D-078): the same group, grain, period and month in office. */
  var KEYS = ['appt_group', 'grain', 'period', 'months_in_office'];

  /* Several components (two or more, never DOJ; the Community Relations Service combines like any other since D-089) -> one summed row per
     key, entity 'SEL'. Counts and stocks are summed (data.combineEntities); the share and the percent change are then
     recomputed from the summed counts, never averaged, and the month-0 small-base flag is the summed month 0 below 30. */
  function combine(rows, entities, meta) {
    return D.combineEntities(rows, entities, meta, KEYS).map(function (r) {
      r.share = D.divide(D.value(r, 'headcount'), D.value(r, 'headcount_all'));
      if (r.grain === 'admin') {
        var h0 = D.value(r, 'headcount_0');
        r.pct_small_base = h0 === null ? null : h0 < SMALL;
        r.headcount_change_pct = r.pct_small_base === false ? D.divide(D.value(r, 'headcount_change'), h0) : null;
      } else r.pct_small_base = null; // calendar rows carry no month 0 (as in the cube)
      return r;
    });
  }

  /* The rows in view for a selection: [] = the DOJ file's rows; one code = its rows; several = their sum ('SEL').
     byEntity: { code: rows }. */
  function selected(byEntity, entities, meta) {
    if (!entities.length) return byEntity.DOJ;
    if (entities.length === 1) return byEntity[entities[0]];
    var all = [];
    entities.forEach(function (e) { Array.prototype.push.apply(all, byEntity[e]); });
    return combine(all, entities, meta);
  }

  /* Share of the workforce: the group's headcount over the entity's headcount, same month (ratio of sums). */
  function share(row) { return D.ratio(row, 'headcount', 'headcount_all'); }
  /* Change since month 0 as a percent of month 0; null where month 0 is below 30 (a count only). */
  function pctChange(row) { return !row || row.pct_small_base !== false ? null : D.ratio(row, 'headcount_change', 'headcount_0'); }

  function adminRows(rows, group, admin) {
    return rows.filter(function (r) { return r.grain === 'admin' && r.appt_group === group && r.period === admin; })
      .sort(function (a, b) { return a.months_in_office - b.months_in_office; });
  }
  function rowAt(rows, group, admin, n) {
    return rows.filter(function (r) { return r.grain === 'admin' && r.appt_group === group && r.period === admin && r.months_in_office === n; })[0] || null;
  }
  /* Months in office published for an administration (0 when none). */
  function months(rows, admin) {
    var r = adminRows(rows, 'all', admin);
    return r.length ? r[r.length - 1].months_in_office : 0;
  }
  /* N = Trump II's months so far for these rows (the same for every entity since D-089 continues CRS at 0). */
  function currentN(rows) { return months(rows, CURRENT); }

  /* One administration's line over the months in office shown (0 included): month 0 is the month-0 headcount the cube
     carries on each admin row; month m is the headcount of the row at m. */
  function sinceLine(rows, group, admin, list) {
    var by = {}, r0 = null;
    adminRows(rows, group, admin).forEach(function (r) { by[r.months_in_office] = r; if (!r0) r0 = r; });
    return {
      values: list.map(function (m) { return m === 0 ? (r0 ? D.value(r0, 'headcount_0') : null) : by[m] ? D.value(by[m], 'headcount') : null; }),
      provisional: list.map(function (m) { return !!(m > 0 && by[m] && by[m].provisional); }),
      rows: list.map(function (m) { return m === 0 ? null : by[m] || null; })
    };
  }

  /* The calendar rows of one group at a grain, in time order. */
  function timeline(rows, group, grain) {
    return D.selectRows(rows.filter(function (r) { return r.appt_group === group; }), { grain: grain });
  }

  /* The by-component chart (section 5, panel 5): per component, the group's headcount at the component's own N (Trump II
     so far, the same N for all since D-089) and each compared administration's headcount at that N.
     byEntity: { code: rows } (the admin-only file's rows by entity, D-088, or whole entity files); ids: the compared administrations. A component with nobody in the group is listed (0). */
  function byComponent(byEntity, entities, group, ids) {
    return entities.map(function (e) {
      var rows = byEntity[e] || [], n = currentN(rows), cur = n ? rowAt(rows, group, CURRENT, n) : null;
      var at = {};
      ids.forEach(function (id) { var r = n ? rowAt(rows, group, id, n) : null; at[id] = r ? { value: D.value(r, 'headcount'), row: r } : null; });
      return { entity: e, n: n, row: cur, value: cur ? D.value(cur, 'headcount') : null, at: at };
    });
  }

  /* Rows -> { entity: rows } (the admin-only file, D-088, holds every entity). */
  function byEntity(rows) {
    var out = {};
    rows.forEach(function (r) { (out[r.entity] = out[r.entity] || []).push(r); });
    return out;
  }

  /* Employees with an invalid appointment code ('unknown') in a calendar row's period: counted in the total, never shown. */
  function unknownAt(rows, grain, period) {
    var r = rows.filter(function (x) { return x.appt_group === 'unknown' && x.grain === grain && x.period === period; })[0];
    return r ? D.value(r, 'headcount') : null;
  }

  return { CURRENT: CURRENT, SMALL: SMALL, GROUPS: GROUPS, SUBGROUPS: SUBGROUPS, PICKER: PICKER, LABEL: LABEL, SINCE: SINCE, KEYS: KEYS,
    combine: combine, selected: selected, share: share, pctChange: pctChange, adminRows: adminRows, rowAt: rowAt, months: months, currentN: currentN,
    sinceLine: sinceLine, timeline: timeline, byComponent: byComponent, byEntity: byEntity, unknownAt: unknownAt };
});
