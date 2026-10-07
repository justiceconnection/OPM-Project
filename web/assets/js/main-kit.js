/* Shared parts of the main pages (docs/pages/redesign.md; D-071, D-072; Appointments, docs/pages/appointments.md): the
   control bar (Component, Job series, Compare with, View; Appointments has no Job series, D-085), the administration
   colors, the component selection and the timeline chart frame (its From/to range: main-range.js). "Explore full history"
   (main-explore.js) is no longer loaded by any main page (D-090); the file stays in the repo.
   Browser only; the figures come from OPM.redesign and OPM.admin (pick and divide). */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  // the comparison colors as built (D-068, section 3): Obama II purple, Trump I gold, Biden teal, Trump II ink
  var COLORS = { obama2: '--admin-obama2', trump1: '--admin-trump1', biden: '--admin-biden', trump2: '--admin-trump2' }; // tokens.css (D-077: the same everywhere)

  // copy-audit: shell:admin.obama2 shell:admin.trump1 shell:admin.biden shell:admin.trump2
  function adminName(copy, id) { return copy.t('shell:admin.' + id); }

  /* "Compare with": three swatch toggles (Biden, Trump I, Obama II, D-077 order), all on by default; on = a filled
     swatch with a check, off = an outlined swatch, on a neutral button with a 3:1 border (L-103). onChange(ids on). */
  function compareControl(container, copy, value, onChange) {
    var h = OPM.dom.h, labelId = OPM.dom.id('compare'), on = {}, buttons = {};
    OPM.redesign.COMPARE.forEach(function (id) { on[id] = value.indexOf(id) >= 0; });
    var group = h('div', { class: 'opm-choices', role: 'group', 'aria-labelledby': labelId });
    OPM.redesign.ORDER.filter(function (id) { return OPM.redesign.COMPARE.indexOf(id) >= 0; }).forEach(function (id) {
      var b = h('button', { type: 'button', class: 'opm-toggle opm-toggle--admin', 'data-admin': id, 'aria-pressed': on[id] ? 'true' : 'false' }, [
        h('span', { class: 'opm-toggle__swatch', 'aria-hidden': 'true', style: '--swatch:' + OPM.chartFrame.token(COLORS[id]) }), adminName(copy, id)]);
      b.addEventListener('click', function () {
        on[id] = !on[id]; b.setAttribute('aria-pressed', on[id] ? 'true' : 'false');
        onChange(get());
      });
      buttons[id] = b; group.appendChild(b);
    });
    function get() { return OPM.redesign.COMPARE.filter(function (id) { return on[id]; }); }
    var wrap = h('div', { class: 'opm-field opm-field--compare' }, [h('span', { class: 'opm-field__name', id: labelId, text: copy.t('shell:ctl.compare') }), group]);
    container.appendChild(wrap);
    return { el: wrap, get: get };
  }

  /* The component selection (D-078): [] = all components (the DOJ rows), one code = that component's rows, several = their
     rows summed per key ('SEL'). */
  function selection(entities) {
    var list = (entities || []).slice();
    return { key: !list.length ? 'DOJ' : list.length === 1 ? list[0] : 'SEL', list: list, load: list.length ? list : ['DOJ'] };
  }
  var KEYS = { core: ['grain', 'period', 'series_group'], admin: ['series_group', 'administration', 'months_in_office'], leaving: ['grain', 'period', 'dimension', 'value', 'series_group'] };
  /* rows of several components -> their summed rows (entity 'SEL'); otherwise the rows as they are */
  function combine(rows, sel, meta, kind) { return sel.key === 'SEL' ? OPM.data.combineEntities(rows, sel.list, meta, KEYS[kind]) : rows; }

  /* The control bar, identical on the main pages. handlers: { entities(list), series(v), compare(list), view(g) }; without
     handlers.series there is no Job series control (Appointments, D-085). The components are listed in the D-090 order,
     the Main Justice ones under their heading; choosing the Community Relations Service, alone or with others, shows
     sel.crsNote under the bar (D-089). */
  function controlBar(body, copy, meta, state, L, handlers) {
    var h = OPM.dom.h, R = OPM.redesign;
    var bar = h('div', { class: 'opm-settings opm-settings--main', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    var latest = meta.range.last_month;
    var groupHead = { mainJustice: copy.t('shell:ctl.components.group.mainJustice') };
    var options = R.componentOrder(meta.entities).map(function (o) {
      // copy-audit: components:*
      return { value: o.code, label: copy.t('components:' + o.code), group: o.group ? groupHead[o.group] : null };
    });
    var crsNote = h('p', { class: 'opm-sel-note', role: 'status', hidden: true, text: copy.t('shell:sel.crsNote') });
    function paintCrs(list) { crsNote.hidden = list.indexOf(R.CRS) < 0; }
    var components = OPM.controls.componentsMulti.render(bar, {
      label: copy.t('shell:ctl.component'), header: copy.t('shell:ctl.components.header'), allLabel: copy.t('shell:ctl.components.all'),
      nLabel: function (n) { return copy.t('shell:ctl.components.n', { n: n }); }, options: options, value: state.entities,
      // D-089: every component combines (CRS has rows to the latest month). Only a component whose rows still end early
      // (older cube files) stands alone, since its rows cannot be summed with the others'.
      exclusive: meta.entities.filter(function (e) { return e !== 'DOJ' && meta.entity_last_month[e] < latest; }),
      onChange: function (list) { paintCrs(list); handlers.entities(list); }
    });
    var series = handlers.series ? OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: state.series, onChange: handlers.series })) : null;
    var compare = compareControl(bar, copy, state.compare, handlers.compare);
    var grain = OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: handlers.view
    });
    body.appendChild(crsNote);
    paintCrs(state.entities);
    return { bar: bar, components: components, series: series, compare: compare, grain: grain, crsNote: crsNote };
  }

  /* The x tick callback of a calendar timeline (L-103): ticks at Januaries, every 1, 2 or 4 years as the width allows, so
     they land on the administration boundaries; on a yearly axis every year, or every 2nd, 3rd... firstOf() gives each
     category's first month. Shared by the timeline frames and the Appointments small multiples (D-090). */
  function calendarTicks(firstOf) {
    return function (v, i) {
      var first = firstOf(), label = this.getLabelForValue(i), f = first[i];
      if (!f) return label;
      var years = first.filter(function (m) { return m.slice(5) === '01'; }).length || 1, perLabel = 72;
      if (!first.some(function (m) { return m.slice(5) === '01'; })) { // a yearly axis (fiscal years start in October)
        var stepY = Math.max(1, Math.ceil(first.length * perLabel / Math.max(1, this.chart.width - 70)));
        return i % stepY === 0 ? label : null;
      }
      if (f.slice(5) !== '01') return null;
      var room = Math.max(1, this.chart.width - 70), step = [1, 2, 4].filter(function (s) { return years / s * perLabel <= room; })[0] || 4;
      return (+f.slice(0, 4) - 2013) % step === 0 ? label : null; // odd years: Jan 2013, 2017, 2021, 2025 always among them
    };
  }
  /* Administration bands for a chart's rows, in the plugin's shape (section 3). */
  function bandsFor(copy, rows, latest) {
    var token = OPM.chartFrame.token;
    return OPM.shading.bands(OPM.shading.periodsOf(rows), latest).map(function (b) {
      return { x0: b.x0, x1: b.x1, label: adminName(copy, b.id), fill: token(OPM.shading.FILL[b.id]), id: b.id, strong: b.strong };
    });
  }

  /* A calendar timeline frame with administration shading (section 3): the band names in a strip above the plot, and
     x ticks at Januaries (every 1, 2 or 4 years as the width allows) so they land on the band boundaries (L-103). */
  function timelineFrame(container, copy, opts) {
    var token = OPM.chartFrame.token;
    OPM.shading.register(root.Chart);
    var first = []; // each category's first month
    var options = Object.assign({}, opts.options || {});
    options.layout = { padding: { top: 20 } };
    options.plugins = Object.assign({}, options.plugins || {}, { opmAdminBands: { bands: [], color: token('--color-ink-soft'), font: token('--font-sans') } });
    options.scales = Object.assign({}, options.scales || {});
    options.scales.x = Object.assign({}, options.scales.x || {}, { ticks: { autoSkip: false, maxRotation: 0, callback: calendarTicks(function () { return first; }) } });
    var frame = OPM.chartFrame.create(container, {
      id: opts.id, title: '', copy: copy, type: opts.type, format: opts.format, legend: opts.legend, options: options,
      exportExtra: function () {
        return { title: frame.el.querySelector('h2').textContent, bands: OPM.shading.exportBands(frame.chart),
          colors: { ink: token('--color-ink'), inkSoft: token('--color-ink-soft'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg') } };
      }
    });
    /* the bands for the rows on the axis; latest: the newest month */
    frame.setBands = function (rows, latest) {
      first = rows.map(function (r) { return r.period_first_month; });
      frame.chart.options.plugins.opmAdminBands.bands = bandsFor(copy, rows, latest);
    };
    return frame;
  }

  /* Trump II's months so far by the calendar (month 1 = January 2025, D-066), for a heading when the selection has no one
     in the job series and so no rows (L-109). */
  function calendarN(latest) { var t = OPM.admin.byId('trump2'); return latest >= t.first ? OPM.periods.monthsBetween(t.first, latest) : null; }

  OPM.mainKit = { calendarN: calendarN, calendarTicks: calendarTicks, bandsFor: bandsFor, COLORS: COLORS, adminName: adminName, selection: selection, combine: combine, KEYS: KEYS, compareControl: compareControl, controlBar: controlBar, timelineFrame: timelineFrame };
})(typeof self !== 'undefined' ? self : this);
