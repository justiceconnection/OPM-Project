/* Shared parts of the three main pages (docs/pages/redesign.md; D-071, D-072): the control bar (Component, Job series,
   Compare with, View), the "at this point" tile lines, the administration colors, months-in-office and timeline chart
   helpers, and the "Explore full history" section, which frames the old pages (history-*.html) unchanged.
   Browser only; the figures come from OPM.redesign and OPM.admin (pick and divide). */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  // the comparison colors as built (D-068, section 3): Obama II purple, Trump I gold, Biden teal, Trump II ink
  var COLORS = { obama2: '--chart-5', trump1: '--chart-8', biden: '--chart-7', trump2: '--chart-1' };

  // copy-audit: shell:admin.obama2 shell:admin.trump1 shell:admin.biden shell:admin.trump2
  function adminName(copy, id) { return copy.t('shell:admin.' + id); }

  /* "Compare with": three toggles (Obama II, Trump I, Biden), all on by default. onChange(list of ids on). */
  function compareControl(container, copy, value, onChange) {
    var h = OPM.dom.h, labelId = OPM.dom.id('compare'), on = {}, buttons = {};
    OPM.redesign.COMPARE.forEach(function (id) { on[id] = value.indexOf(id) >= 0; });
    var group = h('div', { class: 'opm-choices', role: 'group', 'aria-labelledby': labelId });
    OPM.redesign.COMPARE.forEach(function (id) {
      var b = h('button', { type: 'button', class: 'opm-choice opm-choice--admin', 'data-admin': id, 'aria-pressed': on[id] ? 'true' : 'false' }, [
        h('span', { class: 'opm-key__swatch', 'aria-hidden': 'true', style: 'background:' + OPM.chartFrame.token(COLORS[id]) }), adminName(copy, id)]);
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
    var series = OPM.series.render(bar, Object.assign(OPM.seriesData.controlCopy(copy), { value: state.series, onChange: handlers.series }));
    var compare = compareControl(bar, copy, state.compare, handlers.compare);
    var grain = OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: handlers.view
    });
    return { bar: bar, series: series, compare: compare, grain: grain };
  }

  /* A months-in-office line chart frame (Overview Chart A, Departures Chart A); a rule marks month N. */
  function monthsFrame(container, copy, opts) {
    var token = OPM.chartFrame.token, ruleAt = [];
    var frame = OPM.chartFrame.create(container, {
      id: opts.id, title: opts.title, copy: copy, type: 'line', format: opts.format,
      options: { scales: { y: { beginAtZero: !!opts.zero } }, plugins: { opmMarkers: { flags: [], glyph: '', color: token('--color-ink'), font: token('--font-sans'), width: 1, dash: [3, 3] } } },
      exportExtra: function () {
        var xs = frame.chart.scales.x;
        return { title: frame.el.querySelector('h2').textContent, markers: ruleAt.map(function (on, i) { return on ? { x: xs.getPixelForValue(i), kind: 'rule' } : null; }).filter(Boolean) };
      }
    });
    /* data: { months, lines: [{ id, values, provisional }], n, suffix } */
    frame.draw = function (data) {
      ruleAt = data.months.map(function (m) { return m === data.n; });
      frame.chart.options.plugins.opmMarkers.flags = ruleAt;
      frame.setData({
        labels: data.months.map(String), fileSuffix: data.suffix,
        datasets: data.lines.map(function (l) {
          var ds = K.lineDataset(l.values, COLORS[l.id], adminName(copy, l.id), l.provisional, l.provisional.map(function (p) { return p ? 'provisional' : null; }));
          ds.borderWidth = l.id === 'trump2' ? 3 : 1.75; // Trump II emphasized
          ds.order = l.id === 'trump2' ? -1 : 0;
          return ds;
        })
      });
    };
    return frame;
  }

  /* A calendar timeline frame with administration shading (section 3). */
  function timelineFrame(container, copy, opts) {
    var token = OPM.chartFrame.token;
    OPM.shading.register(root.Chart);
    var options = Object.assign({}, opts.options || {});
    options.plugins = Object.assign({}, options.plugins || {}, { opmAdminBands: { bands: [], color: token('--color-muted'), font: token('--font-sans') } });
    var frame = OPM.chartFrame.create(container, {
      id: opts.id, title: '', copy: copy, type: opts.type, format: opts.format, legend: opts.legend, options: options,
      exportExtra: function () { return { title: frame.el.querySelector('h2').textContent, bands: OPM.shading.exportBands(frame.chart) }; }
    });
    /* the bands for the rows on the axis; latest: the newest month */
    frame.setBands = function (rows, latest) {
      frame.chart.options.plugins.opmAdminBands.bands = OPM.shading.bands(OPM.shading.periodsOf(rows), latest).map(function (b) {
        return { x0: b.x0, x1: b.x1, label: adminName(copy, b.id), fill: token(OPM.shading.FILL[b.id]), id: b.id };
      });
    };
    return frame;
  }

  /* "Explore full history" (section 5): collapsed by default; opening it frames the old pages unchanged (with their
     own controls), each sized to its content from the height it reports (opm:height). pages: [{ href, title }] */
  function explore(body, copy, pages) {
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
        var f = h('iframe', { class: 'opm-explore__frame', src: p.href + '?embed=1', title: p.title, loading: 'eager', 'data-page': p.href });
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

  OPM.mainKit = { COLORS: COLORS, adminName: adminName, compareControl: compareControl, controlBar: controlBar, monthsFrame: monthsFrame, timelineFrame: timelineFrame, explore: explore };
})(typeof self !== 'undefined' ? self : this);
