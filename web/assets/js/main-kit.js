/* Shared parts of the main pages (docs/pages/redesign.md; D-071, D-072; Appointments, docs/pages/appointments.md): the
   control bar (Component, Job series, Compare with, View; Appointments has no Job series, D-085), the administration
   colors, the component selection and the timeline chart frame. "Explore full history" lives in main-explore.js, loaded
   only by the pages that have it, so each page's copy audit lists only what it draws.
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
     handlers.series there is no Job series control (Appointments, D-085). */
  function controlBar(body, copy, meta, state, L, handlers) {
    var h = OPM.dom.h;
    var bar = h('div', { class: 'opm-settings opm-settings--main', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    var latest = meta.range.last_month;
    var options = OPM.workforce.componentOptions({
      // copy-audit: components:*
      entities: meta.entities, names: meta.entities.reduce(function (o, e) { if (e !== 'DOJ') o[e] = copy.t('components:' + e); return o; }, {}),
      entityLastMonth: meta.entity_last_month, latest: latest, allLabel: copy.t('shell:ctl.components.all'),
      endedLabel: function (n, m) { return copy.t('shell:ctl.component.ended', { name: n, month: L.label(m) }); }
    }).filter(function (o) { return o.value !== 'DOJ'; });
    var components = OPM.controls.componentsMulti.render(bar, {
      label: copy.t('shell:ctl.component'), header: copy.t('shell:ctl.components.header'), allLabel: copy.t('shell:ctl.components.all'),
      nLabel: function (n) { return copy.t('shell:ctl.components.n', { n: n }); }, options: options, value: state.entities,
      // Community Relations Service (ended) cannot be combined with the others (D-078)
      exclusive: meta.entities.filter(function (e) { return e !== 'DOJ' && meta.entity_last_month[e] < latest; }),
      onChange: handlers.entities
    });
    var series = handlers.series ? OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: state.series, onChange: handlers.series })) : null;
    var compare = compareControl(bar, copy, state.compare, handlers.compare);
    var grain = OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: handlers.view
    });
    return { bar: bar, components: components, series: series, compare: compare, grain: grain };
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
    options.scales.x = Object.assign({}, options.scales.x || {}, { ticks: { autoSkip: false, maxRotation: 0, callback: function (v, i) {
      var label = this.getLabelForValue(i), f = first[i];
      if (!f) return label;
      var years = first.filter(function (m) { return m.slice(5) === '01'; }).length || 1, perLabel = 72;
      if (!first.some(function (m) { return m.slice(5) === '01'; })) { // a yearly axis (fiscal years start in October): every year, or every 2nd, 3rd... as room allows
        var stepY = Math.max(1, Math.ceil(first.length * perLabel / Math.max(1, this.chart.width - 70)));
        return i % stepY === 0 ? label : null;
      }
      if (f.slice(5) !== '01') return null;
      var room = Math.max(1, this.chart.width - 70), step = [1, 2, 4].filter(function (s) { return years / s * perLabel <= room; })[0] || 4;
      return (+f.slice(0, 4) - 2013) % step === 0 ? label : null; // odd years: Jan 2013, 2017, 2021, 2025 always among them
    } } });
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
      frame.chart.options.plugins.opmAdminBands.bands = OPM.shading.bands(OPM.shading.periodsOf(rows), latest).map(function (b) {
        return { x0: b.x0, x1: b.x1, label: adminName(copy, b.id), fill: token(OPM.shading.FILL[b.id]), id: b.id, strong: b.strong };
      });
    };
    return frame;
  }

  OPM.mainKit = { COLORS: COLORS, adminName: adminName, selection: selection, combine: combine, KEYS: KEYS, compareControl: compareControl, controlBar: controlBar, timelineFrame: timelineFrame };
})(typeof self !== 'undefined' ? self : this);
