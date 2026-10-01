/* Compare administrations panel, the two sections Who is leaving does not show (docs/pages/administrations.md
   section 3): employee change in office, and hires and departures. Loaded before admin-panel.js by Workforce size,
   Hiring and departures and Components compared; each section reads one doj_admin row per administration and N. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var NUM = new Intl.NumberFormat('en-US');
  function int(v) { return NUM.format(v); }
  function monthLabels(n) { var out = []; for (var i = 1; i <= n; i++) out.push(String(i)); return out; }

  /* One line per administration over months 1 to n; Trump II's provisional months dashed and marked. */
  function lines(ctx, colors, col) {
    return ctx.chosen.map(function (id) {
      var l = OPM.admin.line(ctx.rows, ctx.entity, ctx.group, id, ctx.n, col);
      var ds = K.lineDataset(l.values, colors[id], ctx.name(id), l.provisional, l.provisional.map(function (p) { return p ? 'provisional' : null; }));
      ds.borderWidth = id === 'trump2' ? 2.5 : 2;
      return ds;
    });
  }

  /* Employee change in office: change since month 0 over months 1 to N, and a table at month N. */
  function change(panelEl, ctx0, colors, table) {
    var h = OPM.dom.h, copy = ctx0.copy;
    var frame = OPM.chartFrame.create(panelEl, {
      id: 'compare-change', title: copy.t('shell:compare.change.title'), copy: copy, type: 'line', format: K.fmt.signed, sub: true,
      options: { scales: { y: { beginAtZero: false } } }
    });
    var tableBox = h('div', { class: 'opm-admin__tablebox' });
    frame.el.insertBefore(tableBox, frame.notes);
    return {
      frame: frame,
      draw: function (ctx) {
        frame.setData({ labels: monthLabels(ctx.n), datasets: lines(ctx, colors, 'headcount_change'), fileSuffix: ctx.suffix });
        var items = ctx.chosen.map(function (id) { var row = ctx.rowAt(id); return { id: id, c: OPM.admin.noStaff(row) ? null : OPM.admin.cells(row) }; });
        tableBox.textContent = '';
        tableBox.appendChild(table(h, copy, 'opm-admin__table--change', [copy.t('shell:compare.pick'), copy.t('shell:compare.change.col'), copy.t('shell:compare.change.pct')],
          items.map(function (x) {
            return { id: x.id, name: ctx.name(x.id), none: !x.c,
              cells: x.c ? [x.c.change === null ? ctx.none : K.fmt.signed(x.c.change), x.c.changePct === null ? ctx.none : K.fmt.pctChange(x.c.changePct)] : [] };
          })));
        frame.setNotes(ctx.provisional ? [{ text: copy.t('shell:compare.provisional'), flag: 'provisional' }] : []);
        return items.map(function (x) { return { id: x.id, none: !x.c, change: x.c ? x.c.change : null, pct: x.c ? x.c.changePct : null }; });
      }
    };
  }

  /* Hires and departures: running totals at month N as paired bars, then lines over months 1 to N. */
  function flows(panelEl, ctx0, colors) {
    var copy = ctx0.copy, token = OPM.chartFrame.token, title = '';
    var hiresText = copy.t('components-compared:col.hires'), depsText = copy.t('components-compared:col.departures');
    var frame = OPM.chartFrame.create(panelEl, {
      id: 'compare-flows', title: '', copy: copy, type: 'bar', format: int, sub: true,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 56 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return int(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', format: int, color: token('--color-ink'), font: token('--font-sans') } }
      },
      exportExtra: function () { return { title: title }; }
    });
    var heading = frame.el.querySelector('h3');
    var fHires = OPM.chartFrame.create(frame.el, { id: 'compare-hires', title: hiresText, copy: copy, type: 'line', format: int, sub: true, options: { scales: { y: { beginAtZero: true } } } });
    var fDeps = OPM.chartFrame.create(frame.el, { id: 'compare-departures', title: depsText, copy: copy, type: 'line', format: int, sub: true, options: { scales: { y: { beginAtZero: true } } } });
    return {
      frame: frame, hires: fHires, departures: fDeps,
      draw: function (ctx) {
        title = copy.t('shell:compare.flows.title', { n: ctx.n });
        heading.textContent = title;
        var items = ctx.chosen.map(function (id) { var row = ctx.rowAt(id); return { id: id, c: OPM.admin.noStaff(row) ? null : OPM.admin.cells(row) }; }).filter(function (x) { return x.c; });
        frame.plot.style.height = (Math.max(items.length, 1) * (K.barRowHeight() + 22) + 40) + 'px';
        var c2 = token('--chart-2'), c3 = token('--chart-3');
        frame.setData({
          labels: items.map(function (x) { return ctx.name(x.id); }),
          datasets: [
            { type: 'bar', label: hiresText, data: items.map(function (x) { return x.c.hires; }), backgroundColor: c2, borderColor: c2, _color: c2, barThickness: 14 },
            { type: 'bar', label: depsText, data: items.map(function (x) { return x.c.departures; }), backgroundColor: c3, borderColor: c3, _color: c3, barThickness: 14 }
          ],
          fileSuffix: ctx.suffix
        });
        var notes = ctx.provisional ? [{ text: copy.t('shell:compare.provisional'), flag: 'provisional' }] : [];
        frame.setNotes(notes);
        fHires.setData({ labels: monthLabels(ctx.n), datasets: lines(ctx, colors, 'hires'), fileSuffix: ctx.suffix });
        fDeps.setData({ labels: monthLabels(ctx.n), datasets: lines(ctx, colors, 'departures'), fileSuffix: ctx.suffix });
        fHires.setNotes(notes); fDeps.setNotes(notes);
        return items.map(function (x) { return { id: x.id, hires: x.c.hires, departures: x.c.departures }; });
      }
    };
  }

  OPM.adminSections = { change: change, flows: flows };
})(typeof self !== 'undefined' ? self : this);
