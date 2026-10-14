/* Compare administrations panel (docs/pages/administrations.md section 3; D-065 to D-068), below the existing
   panels of Workforce size, Hiring and departures, Components compared and Who is leaving. Reads
   data/doj_admin.meta.json and the selected entity's doj_admin file (found through the meta's files map), and picks
   the rows of the chosen series group. Every figure is one picked row at months in office N, or one picked value
   divided by another (OPM.admin); nothing is summed in the browser.
   Sections: employee change and hires and departures come from admin-panel-flows.js (not loaded on Who is
   leaving, which shows the departure rate and why people left only); those two are drawn here. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var ADMIN_META = 'data/doj_admin.meta.json';
  // one color per administration, the same in every chart of the panel; none is a party color
  var COLORS = { obama2: '--admin-obama2', trump1: '--admin-trump1', biden: '--admin-biden', trump2: '--admin-trump2' }; // tokens.css (D-077: the same everywhere)
  var REASON_COLORS = ['--chart-16', '--chart-2', '--chart-3', '--chart-4', '--chart-6', '--chart-5', '--chart-11']; // DRP first (D-080), then as on Hiring and departures
  function rateText(v) { return (v * 100).toFixed(1) + '%'; }

  /* A small table: head cells, then one row per item ({ id, name, cells: [text or { text, small }], none }). */
  function table(h, copy, cls, head, items) {
    var t = h('table', { class: 'opm-admin__table ' + cls });
    t.appendChild(h('thead', null, [h('tr', null, head.map(function (x, i) { return h('th', { scope: 'col', class: i === 0 ? 'opm-admin__name' : null, text: x }); }))]));
    var tb = h('tbody');
    items.forEach(function (it) {
      var tr = h('tr', { 'data-admin': it.id }, [h('th', { scope: 'row', class: 'opm-admin__name', text: it.name })]);
      if (it.none) tr.appendChild(h('td', { colspan: String(head.length - 1), class: 'opm-admin__none', text: copy.t('shell:series.none') }));
      else it.cells.forEach(function (c) {
        var td = h('td', { text: typeof c === 'string' ? c : c.text });
        if (c && typeof c === 'object' && c.small === true) td.appendChild(h('span', { class: 'opm-admin__small', role: 'img', 'aria-label': copy.t('shell:flag.smallBase'), title: copy.t('shell:flag.smallBase') }));
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    return h('div', { class: 'opm-admin__scroll', tabindex: '0', role: 'region' }, [t]);
  }

  /* The departure rate, first N months: annualized rate bars, with quit and retirement rates in the table. */
  function rateSection(panelEl, ctx0) {
    var h = OPM.dom.h, copy = ctx0.copy, token = OPM.chartFrame.token, title = '';
    var frame = OPM.chartFrame.create(panelEl, {
      id: 'compare-rate', title: '', copy: copy, type: 'bar', format: rateText, legend: false, sub: true,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 56 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return rateText(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', format: rateText, color: token('--color-ink'), font: token('--font-sans') } }
      },
      exportExtra: function () {
        var m0 = frame.chart.getDatasetMeta(0), ds = frame.chart.data.datasets[0];
        return { title: title, labels: m0.data.map(function (el, j) { return ds.data[j] === null ? null : { x: el.x + 4, y: el.y + 4, text: rateText(ds.data[j]) }; }).filter(Boolean) };
      }
    });
    var heading = frame.el.querySelector('h3');
    var tableBox = h('div', { class: 'opm-admin__tablebox' });
    frame.el.insertBefore(tableBox, frame.notes);
    return {
      frame: frame,
      draw: function (ctx) {
        title = copy.t('shell:compare.rate.title', { n: ctx.n });
        heading.textContent = title;
        var items = ctx.chosen.map(function (id) { var row = ctx.rowAt(id); return { id: id, row: row, c: OPM.admin.noStaff(row) ? null : OPM.admin.cells(row) }; });
        var shown = items.filter(function (x) { return x.c && x.c.attrition !== null; });
        frame.plot.style.height = (Math.max(shown.length, 1) * K.barRowHeight() + 40) + 'px';
        frame.setData({
          labels: shown.map(function (x) { return ctx.name(x.id); }),
          datasets: [{ type: 'bar', label: copy.t('components-compared:col.rate'), data: shown.map(function (x) { return x.c.attrition; }), barThickness: 16,
            _color: token('--chart-3'), borderColor: shown.map(function (x) { return token(COLORS[x.id]); }),
            backgroundColor: shown.map(function (x) { var c = token(COLORS[x.id]); return x.c.smallBase ? OPM.chartFrame.hatch(c) : c; }),
            borderWidth: shown.map(function (x) { return x.c.smallBase ? 1 : 0; }) }],
          fileSuffix: ctx.suffix
        });
        tableBox.textContent = '';
        tableBox.appendChild(table(h, copy, 'opm-admin__table--rate',
          [copy.t('shell:compare.pick'), copy.t('components-compared:col.rate'), copy.t('components-compared:col.quit'), copy.t('components-compared:col.retirement')],
          items.map(function (x) {
            var cell = function (v) { return { text: v === null ? ctx.none : rateText(v), small: x.c && x.c.smallBase && v !== null }; };
            return { id: x.id, name: ctx.name(x.id), none: !x.c, cells: x.c ? [cell(x.c.attrition), cell(x.c.quit), cell(x.c.retirement)] : [] };
          })));
        var notes = [{ text: copy.t('shell:admin.rateNote') }];
        if (items.some(function (x) { return x.c && x.c.smallBase; })) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
        if (ctx.provisional) notes.push({ text: copy.t('shell:compare.provisional'), flag: 'provisional' });
        frame.setNotes(notes);
        return items.map(function (x) { return { id: x.id, none: !x.c, attrition: x.c ? x.c.attrition : null, quit: x.c ? x.c.quit : null, retirement: x.c ? x.c.retirement : null, smallBase: !!(x.c && x.c.smallBase) }; });
      }
    };
  }

  /* Why people left, first N months: one 100% bar per administration, seven reasons, DRP first (D-080). */
  function reasonsSection(panelEl, ctx0) {
    var copy = ctx0.copy, token = OPM.chartFrame.token, title = '';
    var frame = OPM.chartFrame.create(panelEl, {
      id: 'compare-reasons', title: '', copy: copy, type: 'bar', format: rateText, sub: true,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 8 } },
        scales: { x: { stacked: true, min: 0, max: 1, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return (v * 100).toFixed(0) + '%'; } } },
          y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } }
      },
      exportExtra: function () { return { title: title, notes: [copy.t('shell:reasons.drpNote')] }; }
    });
    var heading = frame.el.querySelector('h3');
    return {
      frame: frame,
      draw: function (ctx) {
        title = copy.t('shell:compare.reasons.title', { n: ctx.n });
        heading.textContent = title;
        var items = ctx.chosen.map(function (id) { var row = ctx.rowAt(id); return { id: id, s: OPM.admin.noStaff(row) ? null : OPM.admin.reasonShares(row) }; })
          .filter(function (x) { return x.s && !x.s.none; });
        frame.plot.style.height = (Math.max(items.length, 1) * K.barRowHeight() + 40) + 'px';
        frame.setData({
          labels: items.map(function (x) { return ctx.name(x.id); }),
          datasets: OPM.admin.CHART_REASONS.map(function (c, i) {
            var col = token(REASON_COLORS[i]);
            return { type: 'bar', label: copy.t('series:' + OPM.admin.reasonLabelCol(c)), data: items.map(function (x) { return x.s.shares[i]; }), backgroundColor: col, borderColor: col, _color: col, stack: 'r', barThickness: 16, _col: c }; // copy-audit: series:sep_drp series:sep_transfer_out series:sep_quit series:sep_retirement series:sep_rif series:sep_termination series:sep_other
          }),
          fileSuffix: ctx.suffix
        });
        frame.setNotes([{ text: copy.t('shell:reasons.drpNote'), flag: 'drp' }].concat(ctx.provisional ? [{ text: copy.t('shell:compare.provisional'), flag: 'provisional' }] : []));
        return items.map(function (x) { return { id: x.id, shares: x.s.shares }; });
      }
    };
  }

  /* The doj_admin loader (meta once, then one entity's file when needed, cached); a page that reads doj_admin for
     itself too (Components compared) shares one with the panel. */
  function dataSource() { return OPM.seriesData.create({ doj_admin: ADMIN_META }); }

  /* opts: { copy, L, entity, series, data (optional dataSource()) } -> { update(entity, series), el, last } */
  function create(body, opts) {
    var h = OPM.dom.h, copy = opts.copy, A = OPM.admin;
    var SD = opts.data || dataSource();
    var none = copy.t('shell:num.none');
    // copy-audit: shell:admin.obama2 shell:admin.trump1 shell:admin.biden shell:admin.trump2
    function name(id) { return copy.t('shell:admin.' + id); }

    var panel = h('section', { class: 'opm-panel opm-admin', 'aria-labelledby': 'admin-compare-title', 'data-chart': 'compare-administrations', hidden: true });
    body.appendChild(panel);
    panel.appendChild(h('div', { class: 'opm-panel__head' }, [h('h2', { id: 'admin-compare-title', text: copy.t('shell:compare.title') })]));

    /* controls: the administrations to compare, and N */
    var controls = h('div', { class: 'opm-admin__controls' });
    panel.appendChild(controls);
    var boxes = {};
    var pick = h('fieldset', { class: 'opm-field opm-field--admins' }, [h('legend', { class: 'opm-field__name', text: copy.t('shell:compare.pick') })]);
    var pickRow = h('div', { class: 'opm-choices' });
    A.IDS.forEach(function (id) {
      var box = h('input', { type: 'checkbox', value: id, class: 'opm-check__box' });
      box.checked = A.COMPARE_DEFAULT.indexOf(id) >= 0;
      box.addEventListener('change', function () {
        if (!A.IDS.some(function (x) { return boxes[x].checked; })) { box.checked = true; return; } // at least one stays chosen
        draw();
      });
      boxes[id] = box;
      pickRow.appendChild(h('label', { class: 'opm-check', 'data-admin': id }, [box, h('span', { class: 'opm-check__swatch', 'aria-hidden': 'true', style: 'background:' + OPM.chartFrame.token(COLORS[id]) }), h('span', { text: name(id) })]));
    });
    pick.appendChild(pickRow);
    controls.appendChild(pick);

    var monthsId = OPM.dom.id('admin-months'), noteId = OPM.dom.id('admin-months-note');
    var slider = h('input', { type: 'range', id: monthsId, min: '1', max: String(A.MAX_MONTHS), step: '1', value: '1', 'aria-describedby': noteId });
    var monthsText = h('output', { class: 'opm-admin__months', for: monthsId });
    var cappedNote = h('p', { class: 'opm-field__note opm-admin__capped', hidden: true });
    controls.appendChild(h('div', { class: 'opm-field opm-field--months' }, [
      h('label', { for: monthsId, class: 'opm-field__name', text: copy.t('shell:compare.monthsLabel') }), monthsText, slider,
      h('p', { class: 'opm-field__note', id: noteId, text: copy.t('shell:compare.monthsNote') }), cappedNote
    ]));
    var userN = null;
    slider.addEventListener('input', function () { userN = +slider.value; draw(); });

    var seriesNote = h('p', { class: 'opm-series-none', role: 'status', hidden: true });
    panel.appendChild(seriesNote);
    var charts = h('div', { class: 'opm-admin__charts' });
    panel.appendChild(charts);

    var ctx0 = { copy: copy, L: opts.L };
    var extra = OPM.adminSections || {};
    var sections = [];
    if (extra.change) sections.push({ key: 'change', s: extra.change(charts, ctx0, COLORS, table) });
    if (extra.flows) sections.push({ key: 'flows', s: extra.flows(charts, ctx0, COLORS, table) });
    sections.push({ key: 'rate', s: rateSection(charts, ctx0) });
    sections.push({ key: 'reasons', s: reasonsSection(charts, ctx0) });

    var cur = { entity: opts.entity, series: opts.series, rows: [] };
    var api = { el: panel, last: {}, frames: {}, shown: null };
    sections.forEach(function (x) { api.frames[x.key] = x.s.frame; });

    function draw() {
      var e = cur.entity, g = cur.series, rows = cur.rows;
      var chosen = A.IDS.filter(function (id) { return boxes[id].checked; });
      var cap = A.cap(rows, e, g, chosen);
      var n = Math.max(1, Math.min(userN === null ? (A.months(rows, e, g, 'trump2') || A.MAX_MONTHS) : userN, cap));
      slider.max = String(cap); slider.value = String(n);
      slider.setAttribute('aria-valuetext', copy.t('shell:compare.months', { n: n }));
      monthsText.textContent = copy.t('shell:compare.months', { n: n });
      cappedNote.hidden = cap >= A.MAX_MONTHS;
      cappedNote.textContent = copy.t('shell:compare.capped', { n: cap });
      var empty = !rows.length;
      seriesNote.hidden = !empty; seriesNote.textContent = copy.t('shell:series.none');
      charts.hidden = empty;
      api.last = { entity: e, series: g, chosen: chosen, n: n, cap: cap, empty: empty };
      if (!empty) {
        var ctx = {
          copy: copy, L: opts.L, rows: rows, entity: e, group: g, chosen: chosen, n: n, none: none, name: name,
          rowAt: function (id) { return A.rowAt(rows, e, g, id, n); },
          suffix: e + '-first-' + n + (g !== 'all' ? '-series-' + g : ''),
          // the cube marks a row provisional when months 1 to N hold any of the newest three months (Trump II)
          provisional: chosen.some(function (id) { var r = A.rowAt(rows, e, g, id, n); return !!(r && r.provisional); })
        };
        sections.forEach(function (x) { api.last[x.key] = x.s.draw(ctx); });
      }
      api.shown = e + ':' + g + ':' + n + ':' + chosen.join(',');
      OPM.shell.refreshDraft();
    }

    var ticket = 0;
    /* the rows for the entity and series group in view (the page's component and job series selectors) */
    api.update = function (entity, series) {
      var t = ++ticket;
      return SD.group('doj_admin', [entity], series).then(function (d) {
        if (t !== ticket) return;
        cur = { entity: entity, series: series, rows: d.rows };
        panel.hidden = false;
        draw();
      }, function (err) {
        if (t !== ticket) return;
        console.info('Compare administrations: data not available (' + err.message + ')');
        panel.hidden = true; api.shown = 'unavailable';
      });
    };
    api.meta = function () { return SD.meta('doj_admin'); };
    api.draw = draw;
    api.update(opts.entity, opts.series);
    return api;
  }

  OPM.adminPanel = { create: create, COLORS: COLORS, dataSource: dataSource };
})(typeof self !== 'undefined' ? self : this);
