/* Shared parts of the three main pages (docs/pages/redesign.md; D-071, D-072): the control bar (Component, Job series,
   Compare with, View), the "at this point" tile lines, the administration colors, months-in-office and timeline chart
   helpers, and the "Explore full history" section, which frames the old pages (history-*.html) unchanged.
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

  /* The control bar, identical on the three pages. handlers: { entity(v), series(v), compare(list), view(g) } */
  function controlBar(body, copy, meta, state, L, handlers) {
    var bar = OPM.componentBar.render(body, copy, meta, state, L, { entity: handlers.entity });
    bar.classList.add('opm-settings--main');
    var series = OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: state.series, onChange: handlers.series }));
    var compare = compareControl(bar, copy, state.compare, handlers.compare);
    var grain = OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: handlers.view
    });
    return { bar: bar, series: series, compare: compare, grain: grain };
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

  /* "Explore full history" (section 5): collapsed by default; opening it frames the old pages unchanged (with their
     own controls), each sized to its content from the height it reports (opm:height). pages: [{ href, title, views }]
     (views: false for a page without Monthly, Quarterly and Yearly: Who is leaving); opts: { view() } */
  function explore(body, copy, pages, opts) {
    var h = OPM.dom.h, regionId = OPM.dom.id('explore');
    var btn = h('button', { type: 'button', class: 'opm-explore__toggle', 'aria-expanded': 'false', 'aria-controls': regionId }, [
      h('span', { class: 'opm-explore__chevron', 'aria-hidden': 'true' }), h('span', { text: copy.t('shell:explore.title') })]);
    var region = h('div', { class: 'opm-explore__body', id: regionId, hidden: true });
    var section = h('section', { class: 'opm-panel opm-explore', 'data-explore': 'history' }, [
      h('h2', { class: 'opm-explore__title' }, [btn]), h('p', { class: 'opm-field__note opm-explore__note', text: copy.t('shell:explore.note') }), region]);
    body.appendChild(section);
    var frames = [];
    function build() {
      pages.forEach(function (p) {
        // the old page opens at this page's View when it has that View (Monthly by default)
        var view = opts && opts.view ? opts.view() : null;
        var f = h('iframe', { class: 'opm-explore__frame', src: p.href + '?embed=1' + (view && p.views !== false ? '&view=' + view : ''), title: p.title, loading: 'eager', 'data-page': p.href });
        region.appendChild(f);
        frames.push(f);
      });
    }
    root.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.type !== 'opm:height' || !d.height) return;
      frames.forEach(function (f) { if (f.contentWindow === ev.source) f.style.height = Math.ceil(d.height) + 'px'; });
    });
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      region.hidden = !open;
      if (open && !frames.length) build();
    });
    return { el: section, frames: function () { return frames.slice(); }, toggle: btn };
  }

  OPM.mainKit = { COLORS: COLORS, adminName: adminName, compareControl: compareControl, controlBar: controlBar, timelineFrame: timelineFrame, explore: explore };
})(typeof self !== 'undefined' ? self : this);
