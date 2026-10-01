/* Job series filter (docs/pages/job-series-filter.md; container D-061, list and grains D-062, contents and copy
   D-063). The series groups in signed order, row picking and the "no staff" rule; pure and testable. The control
   (render) is the only part that needs a DOM. "All job series" never comes from here: it keeps reading doj_core
   and doj_leaving as before; a series view only picks the rows of one group (no figure from other series). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.OPM = root.OPM || {}; root.OPM.series = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* D-062: fixed list, not recomputed; 'other' = every other code, blank and NULL included */
  var CODES = ['0905', '1811', '0007', '0301', '0132', '0343', '1801', '2210', '0303', '0101', '0950', '0901', '0006', '0201', '7404'];
  var GROUPS = CODES.concat(['other']);
  var ALL = 'all';

  function isSeries(v) { return GROUPS.indexOf(v) >= 0; }
  function normalize(v) { return isSeries(v) ? v : ALL; }

  /* The rows of one series group (a doj_core_series or doj_leaving_series file holds every group of its entity). */
  function pick(rows, group) { return rows.filter(function (r) { return r.series_group === group; }); }

  /* Does the entity have anyone in the group at all (series_groups_present in the series meta)? */
  function present(meta, entity, group) { return !!(meta && meta.series_groups_present && (meta.series_groups_present[entity] || []).indexOf(group) >= 0); }

  /* No one in the group in a period: no row, or a row with no employees and no hires or departures. */
  function noStaff(row) {
    return !row || ((row.headcount === 0 || row.headcount === null) && !row.hires && !row.departures);
  }

  /* opts: { label, allLabel, otherLabel, names: { code: name }, value, onChange } */
  function render(container, opts) {
    var h = self.OPM.dom.h, id = self.OPM.dom.id('series');
    var sel = h('select', { id: id });
    sel.appendChild(h('option', { value: ALL, text: opts.allLabel }));
    CODES.forEach(function (c) { sel.appendChild(h('option', { value: c, text: opts.names[c] + ' (' + c + ')' })); }); // "Name (code)" (D-063)
    sel.appendChild(h('option', { value: 'other', text: opts.otherLabel }));
    sel.value = normalize(opts.value);
    sel.addEventListener('change', function () { if (opts.onChange) opts.onChange(normalize(sel.value)); });
    var wrap = h('div', { class: 'opm-field opm-field--series' }, [h('label', { for: id, class: 'opm-field__name', text: opts.label }), sel]);
    container.appendChild(wrap);
    return { el: wrap, get: function () { return normalize(sel.value); }, set: function (v) { sel.value = normalize(v); } };
  }

  return { CODES: CODES, GROUPS: GROUPS, ALL: ALL, isSeries: isSeries, normalize: normalize, pick: pick, present: present, noStaff: noStaff, render: render };
});
