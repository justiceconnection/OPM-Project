/* Components (docs/pages/redesign.md section 4.3; D-071, D-072): each component since January 2025 against earlier
   administrations at the same point in office. Reads data/doj_core.meta.json (the component list), data/doj_admin.meta.json
   and every entity's doj_admin file (the series group in view). Each row is Trump II at the component's own months so
   far (cut at a component's last month, D-024) and each compared administration at that same month. Pick and divide.
   Panels: the table "Components since January 2025" (sortable, D-049; scrolls inside its panel on phones) and the chart
   "Change since taking office, by component" (Trump II bars, a marker per compared administration). The Component
   selector highlights that row. "Explore full history" frames the old Components compared page. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var fmtInt = K.fmt.int, fmtSigned = K.fmt.signed, fmtPct = K.fmt.pctChange, fmtRate = K.fmt.rate;

  K.load('Components', build, ['data/doj_core.meta.json', 'data/doj_admin.meta.json']);

  function build(copy, meta) {
    var h = OPM.dom.h, A = OPM.admin, R = OPM.redesign, MK = OPM.mainKit, SR = OPM.series, CC = OPM.compare, token = OPM.chartFrame.token;
    var SD = OPM.seriesData.create({ doj_admin: 'data/doj_admin.meta.json' });
    var L = K.labels(copy), label = L.label;
    var none = copy.t('shell:num.none');
    var latest = meta.range.last_month;
    var state = { entities: [], series: SR.ALL, compare: R.COMPARE.slice(), grain: 'month', sort: null };
    var data = { rows: [], group: SR.ALL };
    function adminName(id) { return MK.adminName(copy, id); }
    function compName(e) {
      if (e === 'DOJ') return copy.t('shell:ctl.component.all');
      var n = copy.t('components:' + e); // copy-audit: components:*
      return meta.entity_last_month[e] < latest ? copy.t('shell:ctl.component.ended', { name: n, month: label(meta.entity_last_month[e]) }) : n;
    }

    OPM.moved.show(copy, copy.t('shell:nav.components'));
    var body = document.getElementById('page-body');
    var ctl = MK.controlBar(body, copy, meta, state, L, {
      entities: function (list) { state.entities = list; draw(); }, // every component stays shown; the chosen ones are highlighted (D-078)
      series: function (v) { state.series = v; load(); },
      compare: function (list) { state.compare = list; draw(); },
      view: function (g) { state.grain = g; draw(); } // nothing on this page has a time axis, so the View changes no figure here
    });

    /* the table */
    var tablePanel = h('section', { class: 'opm-panel opm-compare', 'aria-labelledby': 'comp-table-title', 'data-chart': 'components-table' });
    body.appendChild(tablePanel);
    tablePanel.appendChild(h('div', { class: 'opm-panel__head' }, [h('h2', { id: 'comp-table-title', text: copy.t('shell:comp.table.title') })]));
    var scroller = h('div', { class: 'opm-compare__scroll', tabindex: '0', role: 'region', 'aria-labelledby': 'comp-table-title' });
    var table = h('table', { class: 'opm-compare__table opm-compare__table--components' });
    scroller.appendChild(table);
    var tableNotes = h('div', { class: 'opm-chart__notes' });
    tablePanel.appendChild(scroller); tablePanel.appendChild(tableNotes);

    /* the chart: Trump II's change percent per component, a marker per compared administration at the same point. The axis
       fits the current components (D-077); a bar beyond it (Community Relations Service) runs off the scale with an
       arrow and its value labeled. */
    var offScale = []; // the current off-scale items: [{ kind: 'bar' | 'marker', index, dir, text, ... }]
    /* The arrows and values for items, placed on the chart as it is now. The screen (the plugin) and the SVG export both
       call this with the current items, so the export can never show a previous series' values (L-107). */
    function offScaleGeom(chart, items) {
      var ys = chart.scales.y, area = chart.chartArea, onInk = token('--color-on-ink');
      return R.offScaleLayout(items).map(function (it) {
        var y = ys.getPixelForValue(it.index) + it.dy, x = it.dir < 0 ? area.left : area.right;
        var size = it.kind === 'marker' ? 5 : 6, len = it.kind === 'marker' ? 7 : 9;
        return { x: x, y: y, dir: it.dir, text: it.text, tx: x - it.dir * (len + 4), kind: it.kind, size: size, len: len,
          arrowColor: it.arrowColor || onInk, textColor: it.textColor || onInk, entity: it.entity, admin: it.admin };
      });
    }
    if (!root.OPM._offScaleRegistered) {
      root.OPM._offScaleRegistered = true;
      root.Chart.register({
        id: 'opmOffScale',
        afterDatasetsDraw: function (chart, args, o) {
          chart._opmOffScale = []; // reset on every draw, items or not
          if (!o || !chart._opmGeom || !o.items || !o.items.length) return;
          var ctx = chart.ctx, drawn = chart._opmGeom(chart, o.items);
          ctx.save(); ctx.font = '600 11px ' + o.font; ctx.textBaseline = 'middle';
          drawn.forEach(function (d) {
            // a bar: arrow and value in the panel color on the ink bar; a marker: an arrow in its administration's color and
            // the value in ink, stacked clear of the bar's value and of other markers on that side
            ctx.fillStyle = d.arrowColor;
            ctx.beginPath(); // the tip at the axis edge, the arrow inside the plot pointing off the scale; the value beside it
            ctx.moveTo(d.x + d.dir * 1, d.y); ctx.lineTo(d.x - d.dir * d.len, d.y - d.size); ctx.lineTo(d.x - d.dir * d.len, d.y + d.size); ctx.closePath(); ctx.fill();
            ctx.fillStyle = d.textColor; ctx.textAlign = d.dir < 0 ? 'left' : 'right';
            ctx.fillText(d.text, d.tx, d.y);
          });
          ctx.restore();
          chart._opmOffScale = drawn;
        }
      });
    }
    var fChart = OPM.chartFrame.create(body, {
      id: 'change-by-component', title: copy.t('shell:comp.chart.title'), copy: copy, type: 'bar', format: fmtPct,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'index', axis: 'y', intersect: false }, layout: { padding: { right: 12 } },
        scales: { x: { grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 7, callback: function (v) { return fmtPct(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmOffScale: { items: [], font: token('--font-sans') } }
      },
      exportExtra: function () {
        var drawn = offScaleGeom(fChart.chart, offScale); // the current state, never a cache
        // the off-scale arrows and values as on screen, and the chart's notes (comp.chart.crsNote among them, N2)
        return { arrows: drawn.map(function (d) { return { x: d.x, y: d.y, dir: d.dir, color: d.arrowColor, size: d.size, len: d.len }; }),
          labels: drawn.map(function (d) { return { x: d.tx, y: d.y + 4, text: d.text, anchor: d.dir < 0 ? 'start' : 'end', color: d.textColor }; }),
          notes: [].map.call(fChart.notes.querySelectorAll('p'), function (p) { return p.textContent; }) };
      }
    });

    /* mini charts (D-075, D-081): one per component, percent change since month 0 by months in office, one shared y-axis.
       Small: x ticks "Year 1" to "Year 4" at months 12 to 48, three y labels and a stronger zero line. Each has an Expand
       button opening the same chart in a large dialog (full legend, a tooltip per month, "Months in office", a tick every
       6 months, y every 10%). */
    var MX = OPM.miniExpand;
    var minisPanel = h('section', { class: 'opm-panel opm-minis', 'aria-labelledby': 'comp-minis-title', 'data-chart': 'component-minis' });
    body.appendChild(minisPanel);
    var minisExport = h('button', { type: 'button', class: 'opm-mini-btn', 'data-export': 'component-minis', text: copy.t('shell:chart.exportSvg') });
    minisPanel.appendChild(h('div', { class: 'opm-panel__head' }, [h('h2', { id: 'comp-minis-title', text: copy.t('shell:comp.minis.title') }), minisExport]));
    var minisKey = h('div', { class: 'opm-key opm-key--static', 'aria-hidden': 'true' });
    minisPanel.appendChild(minisKey);
    var minisGrid = h('div', { class: 'opm-multiples opm-multiples--minis' });
    minisPanel.appendChild(minisGrid);
    var minisNotes = h('div', { class: 'opm-chart__notes' });
    minisPanel.appendChild(minisNotes);
    var minis = [];
    minisExport.addEventListener('click', function () {
      var X = OPM.svgExport, colors = { ink: token('--color-ink'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg'), zero: token('--color-faint') };
      var charts = minis.filter(function (m) { return m.chart; });
      var svg = X.buildGridSvg(charts.map(function (m) {
        var spec = X.fromChart(m.chart, { title: compName(m.entity) + '  ' + m.valueEl.textContent, font: token('--font-sans'), colors: colors, note: m.ownScale ? copy.t('shell:comp.minis.crsNote') : undefined });
        spec.yTicks.forEach(function (t, i) { t.strong = m.chart.scales.y.ticks[i].value === 0; }); // the stronger zero line, as on screen
        return spec;
      }),
        { cols: 4, title: copy.t('shell:comp.minis.title'), note: copy.t('shell:comp.minis.note'), font: token('--font-sans'), bg: colors.bg, ink: colors.ink, muted: colors.muted });
      X.download(svg, 'opm-component-minis-' + state.grain + (data.group !== SR.ALL ? '-series-' + data.group : '') + '.svg');
    });

    /* One chart's options and data, small or expanded. l: { months, sets }; sc: the y scale { lo, hi, step }; own: on its
       own scale (D-076). The ticks are placed in afterBuildTicks, so the screen and the SVG export read the same ones. */
    function lineChart(canvas, l, sc, own, big) {
      var o = OPM.chartFrame.baseOptions(fmtPct), labels = l.months.map(String);
      var strong = token('--color-faint'), grid = token('--color-grid');
      o.scales.y.min = sc.lo; o.scales.y.max = sc.hi;
      var yVals = big ? MX.steppedTicks(sc, MX.expandedStep(sc, own)) : MX.miniYTicks(sc, own);
      o.scales.y.afterBuildTicks = function (axis) { axis.ticks = yVals.map(function (v) { return { value: v }; }); };
      o.scales.y.ticks.callback = function (v) { return MX.pctLabel(v); }; // whole percents (L-103)
      o.scales.y.grid = { color: function (c) { return c.tick && c.tick.value === 0 ? strong : grid; }, lineWidth: function (c) { return c.tick && c.tick.value === 0 ? 1.5 : 1; } };
      var xIdx = big ? MX.monthTicks(labels, 6).map(function (t) { return t.index; }) : MX.yearTicks(labels).map(function (t) { return t.index; });
      o.scales.x.afterBuildTicks = function (axis) { axis.ticks = axis.ticks.filter(function (t) { return xIdx.indexOf(t.value) >= 0; }); };
      o.scales.x.ticks.autoSkip = false;
      o.scales.x.ticks.callback = big ? function (v) { return labels[v]; } : function (v) { return copy.t('shell:comp.minis.year', { n: Number(labels[v]) / 12 }); };
      if (big) o.scales.x.title = { display: true, text: copy.t('shell:comp.minis.xTitle'), color: token('--color-muted'), font: { size: 12, family: token('--font-sans') } };
      o.plugins.tooltip.callbacks.title = function (items) { return items.length ? copy.t('shell:adm.tipMonth', { n: items[0].label }) : ''; };
      o.layout = { padding: { right: big ? 12 : 6 } };
      return new root.Chart(canvas, { type: 'line', options: o, data: { labels: labels, datasets: l.sets.map(function (x) {
        // a straight line (tension 0); Trump II emphasized; its provisional months dashed with small hollow points
        var c = token(MK.COLORS[x.id]), dash = x.provisional, cur = x.id === R.CURRENT;
        return { type: 'line', label: adminName(x.id), data: x.values, _color: c, _dashIn: dash, _markers: dash.map(function (p) { return p ? 'provisional' : null; }),
          borderColor: c, backgroundColor: c, borderWidth: big ? (cur ? 3 : 1.75) : (cur ? 2.5 : 1.25), order: cur ? -1 : 0, tension: 0, spanGaps: false,
          pointRadius: dash.map(function (p) { return p ? (big ? 3 : 2) : 0; }), pointBackgroundColor: token('--color-panel'), pointBorderColor: c, pointHoverRadius: big ? 4 : 3,
          segment: { borderDash: function (ctx) { return dash[ctx.p1DataIndex] ? [4, 3] : undefined; } } };
      }) } });
    }

    /* the Expand dialog: one for the page, filled from the mini that opened it */
    var dlgName = h('span', { class: 'opm-dialog__name' }), dlgValue = h('span', { class: 'opm-dialog__value' });
    var dlgClose = h('button', { type: 'button', class: 'opm-mini-btn opm-dialog__close', text: copy.t('shell:comp.minis.close') });
    var dlgKey = h('div', { class: 'opm-key opm-key--static' });
    var dlgCanvas = h('canvas', { role: 'img' });
    var dlgNotes = h('div', { class: 'opm-chart__notes' });
    var dlg = h('dialog', { class: 'opm-dialog', 'aria-labelledby': 'comp-mini-dialog-title', 'data-chart': 'component-mini-expanded' }, [
      h('div', { class: 'opm-panel__head opm-dialog__head' }, [h('h2', { id: 'comp-mini-dialog-title', class: 'opm-dialog__title' }, [dlgName, ' ', dlgValue]), dlgClose]),
      dlgKey, h('div', { class: 'opm-dialog__plot' }, [dlgCanvas]), dlgNotes]);
    document.body.appendChild(dlg);
    var expanded = { chart: null, entity: null };
    var dialog = MX.dialogController(dlg, { doc: document, closeButton: dlgClose,
      onOpen: function (btn) {
        var m = minis.filter(function (x) { return x.expand === btn; })[0];
        if (!m) return;
        // in a frame as tall as the page (Framer), the dialog sits beside the button rather than mid-page
        var framed = !!root.parent && root.parent !== root;
        dlg.style.marginTop = framed ? Math.max(16, Math.round(btn.getBoundingClientRect().top) - 120) + 'px' : '';
        dlgName.textContent = compName(m.entity); dlgValue.textContent = m.valueEl.textContent;
        dlgCanvas.setAttribute('aria-label', compName(m.entity));
        dlgKey.textContent = '';
        m.line.sets.forEach(function (x) { dlgKey.appendChild(h('span', { class: 'opm-key__item opm-key__item--static', 'data-admin': x.id }, [h('span', { class: 'opm-key__swatch', style: 'background:' + token(MK.COLORS[x.id]) }), adminName(x.id)])); });
        dlgNotes.textContent = '';
        if (m.ownScale) dlgNotes.appendChild(h('p', { class: 'opm-chart__note', text: copy.t('shell:comp.minis.crsNote') }));
        if (m.line.sets.some(function (x) { return x.provisional.some(Boolean); })) dlgNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--provisional', text: copy.t('shell:flag.provisional') }));
        if (expanded.chart) expanded.chart.destroy();
        expanded = { chart: lineChart(dlgCanvas, m.line, m.scale, m.ownScale, true), entity: m.entity };
        if (OPM.page) OPM.page.expanded = expanded;
      },
      onClose: function () { if (expanded.chart) expanded.chart.destroy(); expanded = { chart: null, entity: null }; if (OPM.page) OPM.page.expanded = expanded; }
    });

    function drawMinis(list, g) {
      var rows = data.rows, ids = R.shown(state.compare);
      if (dialog.isOpen()) dialog.close(); // the page redraws under it (a control changed): its chart would be stale
      minis.forEach(function (m) { if (m.chart) m.chart.destroy(); });
      minisGrid.textContent = ''; minisKey.textContent = '';
      ids.forEach(function (id) { minisKey.appendChild(h('span', { class: 'opm-key__item opm-key__item--static', 'data-admin': id }, [h('span', { class: 'opm-key__swatch', style: 'background:' + token(MK.COLORS[id]) }), adminName(id)])); });
      var maxN = 0;
      list.forEach(function (r) { ids.forEach(function (id) { maxN = Math.max(maxN, A.months(rows, r.entity, g, id)); }); });
      var lines = list.map(function (r) {
        if (r.none) return null;
        var months = R.monthsShown(maxN, state.grain, r.n); // each component's own N (CRS: 16)
        return { months: months, sets: ids.map(function (id) { return Object.assign({ id: id }, R.pctLine(rows, r.entity, g, id, months)); }) };
      });
      // D-076: the current components share one scale, from their own lines only; a component that ended (Community
      // Relations Service, a very small office) has its own. A scale spans the lowest to highest value drawn, zero in view.
      function ended(e) { return meta.entity_last_month[e] < latest; }
      function scaleOf(idx) {
        var lo = Infinity, hi = -Infinity;
        idx.forEach(function (i) { var l = lines[i]; if (l) l.sets.forEach(function (x) { x.values.forEach(function (v) { if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }); }); });
        if (!isFinite(lo)) { lo = -0.1; hi = 0.1; }
        lo = Math.min(0, lo); hi = Math.max(0, hi);
        var step = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].filter(function (x) { return (hi - lo) / x <= 5; })[0] || 10; // at most five gaps, round steps
        lo = Math.round(Math.floor(lo / step + 1e-9) * step * 1e9) / 1e9; hi = Math.round(Math.ceil(hi / step - 1e-9) * step * 1e9) / 1e9;
        if (hi === lo) hi = lo + step;
        return { lo: lo, hi: hi, step: step };
      }
      var all = list.map(function (r, i) { return i; });
      var shared = scaleOf(all.filter(function (i) { return !ended(list[i].entity); }));
      minis = list.map(function (r, i) {
        var valueEl = h('span', { class: 'opm-multiple__value' });
        var nameId = 'comp-mini-name-' + r.entity;
        var cell = h('div', { class: 'opm-multiple' + (state.entities.indexOf(r.entity) >= 0 ? ' opm-multiple--selected' : ''), 'data-entity': r.entity }, [h('p', { class: 'opm-multiple__head' }, [h('span', { class: 'opm-multiple__name', id: nameId, text: compName(r.entity) }), valueEl])]);
        minisGrid.appendChild(cell);
        if (r.none) { cell.appendChild(h('p', { class: 'opm-multiple__none', text: copy.t('shell:series.none') })); return { entity: r.entity, chart: null, valueEl: valueEl, none: true }; }
        var canvas = h('canvas', { role: 'img', 'aria-label': compName(r.entity) });
        cell.appendChild(h('div', { class: 'opm-multiple__plot' }, [canvas]));
        var own = ended(r.entity), sc = own ? scaleOf([i]) : shared;
        if (own) cell.appendChild(h('p', { class: 'opm-multiple__note', text: copy.t('shell:comp.minis.crsNote') }));
        // "Expand", named with the component (aria-labelledby: the button's own text, then the component's name)
        var btnId = 'comp-mini-expand-' + r.entity;
        var expand = h('button', { type: 'button', class: 'opm-mini-btn opm-multiple__expand', id: btnId, 'aria-labelledby': btnId + ' ' + nameId, 'aria-haspopup': 'dialog', 'data-expand': r.entity, text: copy.t('shell:comp.minis.expand') });
        expand.addEventListener('click', function () { dialog.open(expand); });
        cell.appendChild(h('div', { class: 'opm-multiple__foot' }, [expand]));
        var l = lines[i];
        var ch = lineChart(canvas, l, sc, own, false);
        valueEl.textContent = copy.t('shell:comp.minis.value', { pct: r.cells.changePct === null ? none : fmtPct(r.cells.changePct) });
        return { entity: r.entity, chart: ch, valueEl: valueEl, none: false, ownScale: own, expand: expand, line: l, scale: sc };
      });
      minisNotes.textContent = '';
      minisNotes.appendChild(h('p', { class: 'opm-chart__note', text: copy.t('shell:comp.minis.note') }));
      if (list.some(function (r) { return !r.none && r.cells.provisional; })) minisNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--provisional', text: copy.t('shell:flag.provisional') }));
      if (OPM.page) OPM.page.minis = minis;
      return { lo: shared.lo, hi: shared.hi, step: shared.step };
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { minis.forEach(function (m) { if (m.chart) m.chart.update(); }); });

    var ex = MK.explore(body, copy, [{ href: 'history-components-compared.html', title: copy.t('components-compared:page.title') }], { view: function () { return state.grain; } });

    var last = {};
    function entities() { // DOJ first, then the components by Trump II employees, largest first
      return meta.entities.filter(function (e) { return e !== 'DOJ'; });
    }
    function draw() {
      var g = data.group, rows = data.rows, at = R.atOrder(state.compare);
      function isSel(e) { return state.entities.indexOf(e) >= 0; }
      var list = entities().map(function (e) { return R.componentRow(rows, e, g, at); });
      list.sort(function (a, b) { return ((b.cells && b.cells.employees) || 0) - ((a.cells && a.cells.employees) || 0); });
      var doj = R.componentRow(rows, 'DOJ', g, at);
      function cellsOf(r) {
        var o = r.none ? {} : { now: r.cells.employees, change: r.cells.change, departures: r.cells.departures, rate: r.cells.attrition };
        at.forEach(function (id) { o['at_' + id] = r.none ? null : r.at[id]; });
        return o;
      }
      var items = list.map(function (r) { return { entity: r.entity, r: r, cells: cellsOf(r) }; });
      if (state.sort) items = CC.sortRows(items, state.sort.key, state.sort.dir, compName);
      var cols = [{ key: 'component', text: copy.t('components-compared:col.component') }, { key: 'now', text: copy.t('shell:comp.col.now') },
        { key: 'change', text: copy.t('shell:comp.col.change') }, { key: 'departures', text: copy.t('shell:comp.col.departures') }, { key: 'rate', text: copy.t('shell:comp.col.rate') }]
        .concat(at.map(function (id) { return { key: 'at_' + id, text: copy.t('shell:comp.col.atThisPoint', { admin: adminName(id) }) }; }));

      table.textContent = '';
      var headRow = h('tr');
      cols.forEach(function (col) {
        var sorted = state.sort && state.sort.key === col.key;
        var btn = h('button', { type: 'button', class: 'opm-compare__sort', 'data-col': col.key, text: col.text });
        btn.addEventListener('click', function () {
          var first = col.key === 'component' ? 'asc' : 'desc'; // numbers descending first, names A to Z first (D-049)
          state.sort = { key: col.key, dir: sorted ? (state.sort.dir === 'asc' ? 'desc' : 'asc') : first };
          draw();
        });
        headRow.appendChild(h('th', { scope: 'col', class: col.key === 'component' ? 'opm-compare__name' : null, 'aria-sort': sorted ? (state.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none' }, [btn]));
      });
      table.appendChild(h('thead', null, [headRow]));
      var tbody = h('tbody');
      function tr(r, cls) {
        var row = h('tr', { class: [cls, isSel(r.entity) ? 'opm-compare__selected' : ''].filter(Boolean).join(' ') || null, 'data-entity': r.entity });
        row.appendChild(h('th', { scope: 'row', class: 'opm-compare__name', text: r.entity === 'SEL' ? copy.t('shell:sel.components', { n: state.entities.length }) : compName(r.entity) }));
        if (r.none) { row.appendChild(h('td', { colspan: String(cols.length - 1), class: 'opm-compare__none', text: copy.t('shell:series.none') })); tbody.appendChild(row); return; }
        var c = r.cells;
        var rateTd = h('td', { text: c.attrition === null ? none : fmtRate(c.attrition) });
        if (c.smallBase && c.attrition !== null) rateTd.appendChild(h('span', { class: 'opm-compare__small', role: 'img', 'aria-label': copy.t('shell:flag.smallBase'), title: copy.t('shell:flag.smallBase') }));
        [h('td', { text: c.employees === null ? none : fmtInt(c.employees) }),
          h('td', { text: c.change === null ? none : fmtSigned(c.change) + (c.changePct === null ? '' : ' (' + fmtPct(c.changePct) + ')') }),
          h('td', { text: c.departures === null ? none : fmtInt(c.departures) }), rateTd]
          .concat(at.map(function (id) { return h('td', { 'data-admin': id, text: r.at[id] === null || r.at[id] === undefined ? none : fmtPct(r.at[id]) }); }))
          .forEach(function (td) { row.appendChild(td); });
        tbody.appendChild(row);
      }
      tr(doj, 'opm-compare__doj');
      // several components chosen: their total, the same rows summed per key (ratio of sums), under DOJ (D-078)
      var total = null;
      if (state.entities.length > 1) {
        total = R.componentRow(OPM.data.combineEntities(rows, state.entities, data.meta, MK.KEYS.admin), 'SEL', g, at);
        tr(total, 'opm-compare__total');
      }
      items.forEach(function (it) { tr(it.r); });
      table.appendChild(tbody);
      var all = [doj].concat(list);
      var notes = [{ text: copy.t('shell:admin.rateNote'), flag: 'annualized' }];
      if (all.some(function (r) { return !r.none && r.cells.smallBase; })) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      if (all.some(function (r) { return !r.none && r.cells.provisional; })) notes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      tableNotes.textContent = '';
      notes.forEach(function (n) { tableNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--' + n.flag, text: n.text })); });

      // the chart: DOJ first, then the components by Trump II change percent (largest fall first)
      var bars = [doj].concat(list.filter(function (r) { return !r.none && r.cells.changePct !== null; }).sort(function (a, b) { return a.cells.changePct - b.cells.changePct; }))
        .filter(function (r) { return !r.none && r.cells.changePct !== null; });
      fChart.plot.style.height = (Math.max(bars.length, 1) * (K.barRowHeight() + 4) + 40) + 'px';
      var ink = token(MK.COLORS.trump2);
      // the axis: the current components' bars and markers (an ended component, CRS, is left out of the range)
      var lo = 0, hi = 0;
      bars.forEach(function (r) {
        if (r.entity !== 'DOJ' && meta.entity_last_month[r.entity] < latest) return;
        [r.cells.changePct].concat(at.map(function (id) { return r.at[id]; })).forEach(function (v) { if (v !== null && v !== undefined) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      });
      // round the fitted bounds to a nice step (with a little room) so the ticks fall on round values (L-107)
      var pad0 = (hi - lo) * 0.04;
      var stepX = [0.02, 0.05, 0.1, 0.2, 0.5, 1].filter(function (x) { return (hi - lo + 2 * pad0) / x <= 6; })[0] || 2;
      lo = Math.round(Math.floor((lo - pad0) / stepX) * stepX * 1e6) / 1e6; hi = Math.round(Math.ceil((hi + pad0) / stepX) * stepX * 1e6) / 1e6;
      fChart.chart.options.scales.x.min = lo; fChart.chart.options.scales.x.max = hi; fChart.chart.options.scales.x.ticks.stepSize = stepX;
      offScale = bars.map(function (r, i) { var v = r.cells.changePct; return v < lo || v > hi ? { kind: 'bar', index: i, dir: v < lo ? -1 : 1, text: fmtPct(v), entity: r.entity } : null; }).filter(Boolean);
      // a comparison marker beyond the axis (N1): not dropped; clamped to the edge with an arrow and its value
      bars.forEach(function (r, i) {
        at.forEach(function (id) {
          var v = r.at[id];
          if (v === null || v === undefined || (v >= lo && v <= hi)) return;
          offScale.push({ kind: 'marker', index: i, dir: v < lo ? -1 : 1, text: fmtPct(v), entity: r.entity, admin: id, arrowColor: token(MK.COLORS[id]), textColor: token('--color-ink') });
        });
      });
      fChart.chart.options.plugins.opmOffScale.items = offScale;
      fChart.chart._opmGeom = offScaleGeom; // on the chart, not in its options (Chart.js would call a function there as scriptable)
      function onScale(v) { return v === null || v === undefined || v < lo || v > hi ? null : v; } // an off-scale marker is drawn by the plugin
      fChart.setData({
        labels: bars.map(function (r) { return compName(r.entity); }), fileSuffix: g !== SR.ALL ? 'series-' + g : 'all',
        // a chosen component's bar is outlined in the accent (D-078: highlighted, every component still shown)
        datasets: [{ type: 'bar', label: adminName('trump2'), data: bars.map(function (r) { return r.cells.changePct; }), backgroundColor: ink, _color: ink, barThickness: 14, order: 2,
          borderColor: bars.map(function (r) { return isSel(r.entity) ? token('--color-accent') : ink; }), borderWidth: bars.map(function (r) { return isSel(r.entity) ? 3 : 0; }), _selected: bars.map(function (r) { return isSel(r.entity); }) }]
          .concat(at.map(function (id) {
            var c = token(MK.COLORS[id]);
            return { type: 'line', label: adminName(id), data: bars.map(function (r) { return onScale(r.at[id]); }), showLine: false, borderColor: c, backgroundColor: c, _color: c,
              pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 6, pointBorderColor: token('--color-panel'), pointBorderWidth: 1, order: 1 };
          }))
      });
      var cn = [];
      if (offScale.some(function (x) { return x.entity === 'DJ14' && x.kind === 'bar'; })) cn.push({ text: copy.t('shell:comp.chart.crsNote'), flag: 'offscale' });
      if (bars.some(function (r) { return r.cells.provisional; })) cn.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fChart.setNotes(cn);

      var scale = drawMinis(list, g);
      last = { doj: doj, total: total, rows: list, bars: bars.map(function (r) { return r.entity; }), at: at, scale: scale, axis: { lo: lo, hi: hi }, offScale: offScale };
      OPM.page.last = last;
      OPM.page.shown = g + ':' + state.compare.join(',') + ':' + state.entities.join('+');
      OPM.shell.refreshDraft();
    }

    var ticket = 0;
    function load() {
      var t = ++ticket, g = state.series;
      return SD.group('doj_admin', meta.entities, g).then(function (d) {
        if (t !== ticket) return;
        data = { rows: d.rows, group: g, meta: d.meta };
        draw();
      }, function (err) {
        if (t !== ticket) return;
        console.info('Components: data not available (' + err.message + ')');
        if (g !== SR.ALL) { state.series = SR.ALL; ctl.series.set(SR.ALL); load(); return; }
        K.unavailable(copy, 'Components', err);
      });
    }

    OPM.page = { state: state, meta: meta, frames: { chart: fChart }, explore: ex, last: last, draw: draw, ready: false, data: function () { return data; } };
    load().then(function () { OPM.page.ready = true; });
  }
})(typeof self !== 'undefined' ? self : this);
