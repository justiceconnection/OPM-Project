/* Appointments, the fourth main tab (docs/pages/appointments.md sections 4, 5 and 7; D-084 to D-088). Reads
   data/doj_appointments.meta.json, the DOJ file (or the chosen components' files) for panels 1 to 4, and the small
   admin-only file (meta.files.admin: every entity at its own N, D-088) for the chart by component. Pick, sum across selected components and divide only
   (OPM.appointments). No rates (D-085), no Job series control (D-085).
   Panels: 1 tiles (political appointees now with each compared administration at this point; Schedule Policy/Career now;
   political hires and departures since January 2025, both with each compared administration at this point, D-088); 2 political appointees since taking office (lines by months in
   office, one per administration, subgroup toggle); 3 workforce by type of appointment (small multiples, one line chart per
   group on its own scale, share or count, administration bands, each expandable, its own From/to range; D-090); 4 hires
   and departures for the chosen group (paired bars, administration bands, its own From/to range); 5 the chosen
   group by component (Trump II bars, a marker per compared administration); 6 notes under the panels they apply to. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var fmtInt = K.fmt.int, fmtSigned = K.fmt.signed, fmtPct = K.fmt.pctChange, fmtShare = K.fmt.rate;
  // the seven groups of the stacked chart, bottom first (OPM.appointments.GROUPS order)
  var GROUP_COLORS = { career: '--chart-2', career_conditional: '--chart-18', excepted: '--chart-4', temporary: '--chart-11', ses: '--chart-9', political: '--chart-3', schedule_policy: '--chart-6' };

  K.load('Appointments', build, ['data/doj_appointments.meta.json']);

  function build(copy, meta) {
    var h = OPM.dom.h, D = OPM.data, AP = OPM.appointments, R = OPM.redesign, MK = OPM.mainKit, token = OPM.chartFrame.token;
    var L = K.labels(copy), label = L.label, periodText = L.periodText;
    var none = copy.t('shell:num.none');
    var latest = meta.range.last_month;
    var COMPONENTS = meta.entities.filter(function (e) { return e !== 'DOJ'; });
    var state = { entities: [], compare: R.COMPARE.slice(), grain: 'month', since: 'political', mix: 'share', group: 'political', mixRange: null, flowsRange: null }; // ranges: null = full
    var byEntity = {}; // code -> rows, filled as files arrive
    var adminBy = null; // the admin-only file's rows by entity (panel 5), once it arrives
    var data = { rows: null, entity: 'DOJ', list: [] };
    function adminName(id) { return MK.adminName(copy, id); }
    // copy-audit: shell:appt.group.career shell:appt.group.careerConditional shell:appt.group.excepted shell:appt.group.temporary shell:appt.group.ses shell:appt.group.political shell:appt.group.schedulePolicy shell:appt.sub.scheduleC shell:appt.sub.noncareerSes shell:appt.sub.executive
    function groupName(g) { return copy.t(AP.LABEL[g]); }
    function compName(e) {
      return copy.t('components:' + e); // copy-audit: components:*
    }
    function changeText(row) { // "(+30, +11.7%)", the percent left out where month 0 is below 30 (spec section 4)
      if (!row || D.value(row, 'headcount_change') === null) return '';
      var p = AP.pctChange(row);
      return ' (' + fmtSigned(D.value(row, 'headcount_change')) + (p === null ? '' : ', ' + fmtPct(p)) + ')';
    }

    var body = document.getElementById('page-body');
    MK.controlBar(body, copy, meta, state, L, {
      entities: function (list) { state.entities = list; load(); },
      compare: function (list) { state.compare = list; draw(); },
      view: function (g) { state.grain = g; draw(); }
    });

    /* A row of choices (a radio group) named by its panel's title. items: [{ value, text }] */
    function choices(container, labelledBy, items, value, onChange) {
      var cur = value, buttons = {};
      var group = h('div', { class: 'opm-choices', role: 'radiogroup', 'aria-labelledby': labelledBy });
      function paint() { items.forEach(function (it) { var on = it.value === cur; buttons[it.value].setAttribute('aria-checked', on ? 'true' : 'false'); buttons[it.value].tabIndex = on ? 0 : -1; }); }
      function set(v) { if (v === cur) return; cur = v; paint(); onChange(v); }
      items.forEach(function (it, i) {
        var b = h('button', { type: 'button', class: 'opm-choice', role: 'radio', 'data-value': it.value, text: it.text });
        b.addEventListener('click', function () { set(it.value); });
        b.addEventListener('keydown', function (ev) {
          var k = ev.key, j = items.map(function (x) { return x.value; }).indexOf(cur), n = items.length, next = null;
          if (k === 'ArrowRight' || k === 'ArrowDown') next = items[(j + 1) % n].value;
          else if (k === 'ArrowLeft' || k === 'ArrowUp') next = items[(j - 1 + n) % n].value;
          else if (k === 'Home') next = items[0].value; else if (k === 'End') next = items[n - 1].value;
          if (next) { ev.preventDefault(); set(next); buttons[next].focus(); }
        });
        buttons[it.value] = b; group.appendChild(b);
      });
      paint();
      var wrap = h('div', { class: 'opm-field opm-field--appt-choice' }, [group]);
      container.appendChild(wrap);
      return { el: wrap, get: function () { return cur; } };
    }
    /* The group picker of panels 4 and 5 (signed group and subgroup labels), named by its panel's title; the two stay in step. */
    var pickers = [];
    function picker(frame) {
      var sel = h('select', { 'aria-labelledby': frame.el.querySelector('h2').id, 'data-picker': frame.el.getAttribute('data-chart') });
      AP.PICKER.forEach(function (g) {
        var sub = AP.SUBGROUPS.indexOf(g) >= 0; // a political subgroup, set in under Political appointees
        sel.appendChild(h('option', { value: g, text: (sub ? '   ' : '') + groupName(g) }));
      });
      sel.value = state.group;
      sel.addEventListener('change', function () { state.group = sel.value; pickers.forEach(function (p) { p.value = state.group; }); draw(); });
      frame.tools.hidden = false;
      frame.tools.appendChild(h('div', { class: 'opm-field opm-field--appt-group' }, [sel]));
      pickers.push(sel);
      return sel;
    }

    /* 1 tiles */
    var tiles = h('section', { class: 'opm-tiles opm-tiles--four', 'aria-label': copy.t('shell:appt.title') });
    body.appendChild(tiles);
    var TILES = [
      { group: 'political', col: 'headcount', name: copy.t('shell:appt.tile.political'), cls: 'opm-tile--political' },
      { group: 'schedule_policy', col: 'headcount', name: copy.t('shell:appt.tile.schedulePolicy'), cls: 'opm-tile--schedule-policy', noAt: true }, // began June 2026: no "at this point" (D-085)
      { group: 'political', col: 'hires', name: copy.t('shell:appt.tile.politicalHires'), cls: 'opm-tile--political-hires' }, // running hires over months 1 to N (D-088)
      { group: 'political', col: 'departures', name: copy.t('shell:appt.tile.politicalDepartures'), cls: 'opm-tile--political-departures' } // running departures over months 1 to N (D-088)
    ];
    TILES.forEach(function (t) { t.el = h('div', { class: 'opm-tile ' + t.cls }); tiles.appendChild(t.el); });
    var tilesNotes = h('div', { class: 'opm-chart__notes opm-tiles__notes' });
    body.appendChild(tilesNotes);

    /* 2 political appointees since taking office, with the subgroup toggle */
    var fSince = MK.monthsFrame(body, copy, { id: 'political-since-taking-office', title: copy.t('shell:appt.since.title'), format: fmtInt, zero: true });
    fSince.tools.hidden = false;
    var sinceToggle = choices(fSince.tools, fSince.el.querySelector('h2').id, AP.SINCE.map(function (g) { return { value: g, text: groupName(g) }; }), state.since,
      function (v) { state.since = v; draw(); });
    fSince.chart.options.plugins.tooltip.callbacks.label = function (c) {
      var rows = c.dataset._rows || [];
      return c.dataset.label + ': ' + fmtInt(c.raw) + changeText(rows[c.dataIndex]);
    };

    /* 3 workforce by type of appointment (D-090): one small line chart per group, each on its own scale, administration
       bands shaded, share or count for all of them, an Expand button per chart, and the panel's own From/to range */
    var MX = OPM.miniExpand;
    var mixTitleId = OPM.dom.id('appt-mix-title');
    var mixExport = h('button', { type: 'button', class: 'opm-mini-btn', 'data-export': 'workforce-by-appointment', text: copy.t('shell:chart.exportSvg') });
    var mixTools = h('div', { class: 'opm-chart__tools' });
    var mixGrid = h('div', { class: 'opm-multiples opm-multiples--mix' });
    var mixNotes = h('div', { class: 'opm-chart__notes' });
    var mixPanel = h('section', { class: 'opm-panel opm-chart opm-mix', 'aria-labelledby': mixTitleId, 'data-chart': 'workforce-by-appointment' }, [
      h('div', { class: 'opm-panel__head' }, [h('h2', { id: mixTitleId }), mixExport]), mixTools, mixGrid, mixNotes]);
    body.appendChild(mixPanel);
    var fMix = { el: mixPanel, tools: mixTools, notes: mixNotes };
    Object.defineProperty(fMix, 'chart', { get: function () { return minis.length ? minis[0].chart : null; } }); // the first small chart (its axis is every chart's)
    var mixToggle = choices(mixTools, mixTitleId, [{ value: 'share', text: copy.t('shell:compare.change.pct') }, { value: 'count', text: copy.t('shell:tile.employees') }], state.mix,
      function (v) { state.mix = v; drawMix(); });
    var mixRange = MK.rangeControl(fMix, copy, meta, L, function (r) { state.mixRange = r.full ? null : r; drawMix(); });
    var minis = [];
    OPM.shading.register(root.Chart);
    function mixLabel(ds, i) { // the tooltip line: the value in view first, the other in brackets
      var n = ds._counts[i], s = ds._shares[i];
      return ds.label + ': ' + (state.mix === 'share' ? (s === null ? none : fmtShare(s)) + ' (' + (n === null ? none : fmtInt(n)) + ')' : (n === null ? none : fmtInt(n)) + ' (' + (s === null ? none : fmtShare(s)) + ')');
    }
    /* One group's chart, small or expanded. m: { group, rows, labels, firsts, counts, shares, dashed, bands } */
    function mixChart(canvas, m, big) {
      var share = state.mix === 'share', fmt = share ? fmtShare : fmtInt;
      var o = OPM.chartFrame.baseOptions(fmt), c = token(GROUP_COLORS[m.group]);
      o.layout = { padding: { top: 18, right: big ? 12 : 6 } };
      o.scales.y.beginAtZero = false;
      o.scales.y.ticks.maxTicksLimit = big ? 8 : 4;
      // a share's tick shows as many decimals as the step between ticks needs (0.05% steps: two), so no two ticks read alike
      o.scales.y.ticks.callback = share ? function (v, i, ticks) {
        var step = ticks.length > 1 ? Math.abs(ticks[1].value - ticks[0].value) * 100 : 1;
        return (v * 100).toFixed(Math.min(3, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)))) + '%';
      } : function (v) { return fmtInt(v); };
      if (!share) o.scales.y.ticks.precision = 0;
      o.scales.x.ticks.autoSkip = false; o.scales.x.ticks.maxRotation = 0;
      o.scales.x.ticks.callback = MK.calendarTicks(function () { return m.firsts; });
      o.plugins.opmAdminBands = { bands: m.bands, color: token('--color-ink-soft'), font: token('--font-sans') };
      o.plugins.tooltip.callbacks.label = function (ctx) { return mixLabel(ctx.dataset, ctx.dataIndex); };
      return new root.Chart(canvas, { type: 'line', options: o, data: { labels: m.labels, datasets: [{
        type: 'line', label: groupName(m.group), data: share ? m.shares : m.counts, _counts: m.counts, _shares: m.shares, _color: c, _dashIn: m.dashed, _group: m.group,
        _markers: m.dashed.map(function (p) { return p ? 'provisional' : null; }), borderColor: c, backgroundColor: c, borderWidth: big ? 2.5 : 2, pointRadius: 0, pointHoverRadius: 3, tension: 0, spanGaps: false,
        segment: { borderDash: function (ctx) { return m.dashed[ctx.p1DataIndex] ? [4, 3] : undefined; } } }] } });
    }
    /* the Expand dialog: one for the panel, filled from the chart that opened it (as on Components, D-081) */
    var dlgName = h('span', { class: 'opm-dialog__name' }), dlgValue = h('span', { class: 'opm-dialog__value' });
    var dlgClose = h('button', { type: 'button', class: 'opm-mini-btn opm-dialog__close', text: copy.t('shell:comp.minis.close') });
    var dlgCanvas = h('canvas', { role: 'img' });
    var dlgNotes = h('div', { class: 'opm-chart__notes' });
    var dlg = h('dialog', { class: 'opm-dialog', 'aria-labelledby': 'appt-mix-dialog-title', 'data-chart': 'workforce-by-appointment-expanded' }, [
      h('div', { class: 'opm-panel__head opm-dialog__head' }, [h('h2', { id: 'appt-mix-dialog-title', class: 'opm-dialog__title' }, [dlgName, ' ', dlgValue]), dlgClose]),
      h('div', { class: 'opm-dialog__plot' }, [dlgCanvas]), dlgNotes]);
    document.body.appendChild(dlg);
    var expanded = { chart: null, group: null };
    var dialog = MX.dialogController(dlg, { doc: document, closeButton: dlgClose,
      onOpen: function (btn) {
        var m = minis.filter(function (x) { return x.expand === btn; })[0];
        if (!m) return;
        var framed = !!root.parent && root.parent !== root; // in a frame as tall as the page (Framer): beside the button
        dlg.style.marginTop = framed ? Math.max(16, Math.round(btn.getBoundingClientRect().top) - 120) + 'px' : '';
        dlgName.textContent = groupName(m.group); dlgValue.textContent = m.valueEl.textContent;
        dlgCanvas.setAttribute('aria-label', groupName(m.group));
        dlgNotes.textContent = '';
        dlgNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--shade', text: copy.t('shell:shade.note') }));
        if (m.data.dashed.some(Boolean)) dlgNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--provisional', text: copy.t('shell:flag.provisional') }));
        if (expanded.chart) expanded.chart.destroy();
        expanded = { chart: mixChart(dlgCanvas, m.data, true), group: m.group };
        if (OPM.page) OPM.page.expanded = expanded;
      },
      onClose: function () { if (expanded.chart) expanded.chart.destroy(); expanded = { chart: null, group: null }; if (OPM.page) OPM.page.expanded = expanded; }
    });
    mixExport.addEventListener('click', function () {
      var X = OPM.svgExport, colors = { ink: token('--color-ink'), inkSoft: token('--color-ink-soft'), muted: token('--color-muted'), grid: token('--color-grid'), bg: token('--color-panel'), plot: token('--color-plot-bg') };
      var svg = X.buildGridSvg(minis.map(function (m) {
        return X.fromChart(m.chart, { title: groupName(m.group) + '  ' + m.valueEl.textContent, font: token('--font-sans'), colors: colors, bands: OPM.shading.exportBands(m.chart) });
      }), { cols: 4, title: mixPanel.querySelector('h2').textContent, note: copy.t('shell:appt.mix.note'), font: token('--font-sans'), bg: colors.bg, ink: colors.ink, muted: colors.muted });
      X.download(svg, 'opm-workforce-by-appointment-' + data.entity + '-' + state.mix + '-' + state.grain + MK.rangeSuffix(state.mixRange) + '.svg');
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { minis.forEach(function (m) { m.chart.update(); }); });

    function drawMix() {
      var rows = data.rows;
      if (!rows) return;
      if (dialog.isOpen()) dialog.close(); // the charts redraw under it: its chart would be stale
      mixPanel.querySelector('h2').textContent = copy.t('shell:appt.mix.title', MK.rangeVars(mixRange, L));
      var allRows = OPM.controls.fyRange.pick(AP.timeline(rows, 'all', state.grain), state.mixRange);
      var periods = allRows.map(function (r) { return r.period; });
      var share = state.mix === 'share';
      minis.forEach(function (m) { m.chart.destroy(); });
      mixGrid.textContent = '';
      var bands = MK.bandsFor(copy, allRows, latest), firsts = allRows.map(function (r) { return r.period_first_month; }), labels = allRows.map(periodText);
      var dashed = allRows.map(function (r) { return r.provisional === true; });
      minis = AP.GROUPS.map(function (g) {
        var by = {};
        AP.timeline(rows, g, state.grain).forEach(function (r) { by[r.period] = r; });
        var m = { group: g, labels: labels, firsts: firsts, bands: bands, dashed: dashed,
          counts: periods.map(function (p) { return by[p] ? D.value(by[p], 'headcount') : null; }),
          shares: periods.map(function (p) { return by[p] ? AP.share(by[p]) : null; }) };
        // the latest value in the range, and the month it is from (a stock: the period's last month)
        var vals = share ? m.shares : m.counts, li = -1;
        for (var i = vals.length - 1; i >= 0; i--) if (vals[i] !== null) { li = i; break; }
        var valueEl = h('span', { class: 'opm-multiple__value', text: li < 0 ? none : copy.t('shell:appt.mix.value', { value: share ? fmtShare(vals[li]) : fmtInt(vals[li]), month: label(allRows[li].period_last_month) }) });
        var nameId = OPM.dom.id('appt-mix-name');
        var cell = h('div', { class: 'opm-multiple', 'data-group': g }, [h('p', { class: 'opm-multiple__head' }, [h('span', { class: 'opm-multiple__name', id: nameId, text: groupName(g) }), valueEl])]);
        var canvas = h('canvas', { role: 'img', 'aria-label': groupName(g) });
        cell.appendChild(h('div', { class: 'opm-multiple__plot' }, [canvas]));
        var btnId = OPM.dom.id('appt-mix-expand');
        var expand = h('button', { type: 'button', class: 'opm-mini-btn opm-multiple__expand', id: btnId, 'aria-labelledby': btnId + ' ' + nameId, 'aria-haspopup': 'dialog', 'data-expand': g, text: copy.t('shell:comp.minis.expand') });
        expand.addEventListener('click', function () { dialog.open(expand); });
        cell.appendChild(h('div', { class: 'opm-multiple__foot' }, [expand]));
        mixGrid.appendChild(cell);
        return { group: g, chart: mixChart(canvas, m, false), valueEl: valueEl, expand: expand, data: m, latest: li < 0 ? null : vals[li] };
      });
      var lastAll = allRows[allRows.length - 1];
      var unknown = lastAll ? AP.unknownAt(rows, state.grain, lastAll.period) : null;
      var notes = [{ text: copy.t('shell:appt.mix.note'), flag: 'scale' }, { text: copy.t('shell:shade.note'), flag: 'shade' }, { text: copy.t('shell:appt.note.schedulePolicy'), flag: 'schedule-policy' }]
        .concat(unknown ? [{ text: copy.t('shell:appt.note.unknown', { count: fmtInt(unknown) }), flag: 'unknown' }] : [])
        .concat(provNote(dashed.some(Boolean)));
      mixNotes.textContent = '';
      notes.forEach(function (n) { mixNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--' + n.flag, text: n.text })); });
      last.unknown = unknown;
      last.mix = { periods: periods, values: minis.map(function (m) { return { group: m.group, latest: m.latest, text: m.valueEl.textContent }; }) };
      if (OPM.page) OPM.page.minis = minis;
    }

    /* 4 hires and departures for the chosen group */
    var fFlows = MK.timelineFrame(body, copy, { id: 'appointment-hires-departures', type: 'bar', format: fmtInt, legend: true });
    picker(fFlows);
    var flowsRange = MK.rangeControl(fFlows, copy, meta, L, function (r) { state.flowsRange = r.full ? null : r; drawFlows(); });

    /* 5 the chosen group by component: Trump II's bars, a marker per compared administration at the same point */
    var fComp = OPM.chartFrame.create(body, {
      id: 'appointments-by-component', title: '', copy: copy, type: 'bar', format: fmtInt,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'index', axis: 'y', intersect: false }, layout: { padding: { right: 44 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 6, precision: 0, callback: function (v) { return fmtInt(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', color: token('--color-ink'), font: token('--font-sans') },
          tooltip: { callbacks: { label: function (c) { var r = (c.dataset._rows || [])[c.dataIndex]; return c.dataset.label + ': ' + fmtInt(c.raw) + changeText(r); } } } }
      },
      exportExtra: function () {
        var ds = fComp.chart.data.datasets[0], m0 = fComp.chart.getDatasetMeta(0);
        return { title: fComp.el.querySelector('h2').textContent,
          labels: ds ? m0.data.map(function (el, j) { var t = ds._labels && ds._labels[j]; return t ? { x: el.x + 4, y: el.y + 4, text: t } : null; }).filter(Boolean) : [],
          notes: [].map.call(fComp.notes.querySelectorAll('p'), function (p) { return p.textContent; }) };
      }
    });
    picker(fComp);

    function groupNotes(g) { // the notes that explain the chosen group
      var out = [];
      if (g === 'political' || g === 'executive') out.push({ text: copy.t('shell:appt.note.executive'), flag: 'executive' });
      if (g === 'schedule_policy') out.push({ text: copy.t('shell:appt.note.schedulePolicy'), flag: 'schedule-policy' });
      return out;
    }
    function provNote(any) { return any ? [{ text: copy.t('shell:flag.provisional'), flag: 'provisional' }] : []; }

    var last = {};
    function draw() {
      var rows = data.rows;
      if (!rows) return;
      var n = AP.currentN(rows), at = R.atOrder(state.compare), shownIds = R.shown(state.compare);
      var suffix = data.entity;

      // 1 tiles at month N (Trump II so far); the political appointees tile with each compared administration at N
      var prov = false;
      last.tiles = TILES.map(function (t) {
        var r = n ? AP.rowAt(rows, t.group, AP.CURRENT, n) : null, v = r ? D.value(r, t.col) : null;
        if (r && r.provisional) prov = true;
        MK.tile(copy, t.el, { name: t.name, badges: r && r.provisional ? [K.provisionalBadge(copy)] : [], value: v === null ? none : fmtInt(v),
          at: t.noAt ? [] : at.map(function (id) { var x = n ? AP.rowAt(rows, t.group, id, n) : null, w = x ? D.value(x, t.col) : null; return { id: id, text: w === null ? none : fmtInt(w) }; }) });
        return v;
      });
      tilesNotes.textContent = '';
      if (prov) tilesNotes.appendChild(MK.provNote(copy));
      tilesNotes.appendChild(h('p', { class: 'opm-chart__note opm-chart__note--schedule-policy', text: copy.t('shell:appt.note.schedulePolicy') }));

      // 2 since taking office: months 0 to 48 at the View's step, month N always included
      var maxN = Math.max.apply(null, shownIds.map(function (id) { return AP.months(rows, id); }).concat([0]));
      var months = [0].concat(R.monthsShown(maxN, state.grain, n));
      var lines = shownIds.map(function (id) { return Object.assign({ id: id }, AP.sinceLine(rows, state.since, id, months)); });
      fSince.draw({ months: months, lines: lines, n: n, suffix: suffix + '-' + state.since + '-' + state.grain });
      fSince.chart.data.datasets.forEach(function (ds, i) { ds._rows = lines[i].rows; });
      fSince.setNotes([{ text: copy.t('shell:appt.note.executive'), flag: 'executive' }].concat(provNote(lines.some(function (l) { return l.provisional.some(Boolean); }))));

      // 3 workforce by type of appointment
      drawMix();

      // 4 hires and departures for the chosen group
      var g = state.group;
      drawFlows();


      // 5 the chosen group by component (every component listed, a component with none at 0)
      fComp.el.querySelector('h2').textContent = copy.t('shell:appt.comp.title', { group: groupName(g) });
      var ready = !!adminBy;
      var list = ready ? AP.byComponent(adminBy, COMPONENTS, g, at) : [];
      list.sort(function (a, b) { return (b.value || 0) - (a.value || 0) || (a.entity < b.entity ? -1 : 1); });
      fComp.plot.style.height = (Math.max(list.length, 1) * (K.barRowHeight() + 4) + 40) + 'px';
      var ink = token(MK.COLORS.trump2);
      function isSel(e) { return state.entities.indexOf(e) >= 0; }
      fComp.setData({ labels: list.map(function (x) { return compName(x.entity); }), fileSuffix: g,
        // a chosen component's bar is outlined in the accent (D-078: highlighted, every component still shown)
        datasets: !list.length ? [] : [{ type: 'bar', label: adminName(AP.CURRENT), data: list.map(function (x) { return x.value; }), backgroundColor: ink, _color: ink, barThickness: 14, order: 2,
          borderColor: list.map(function (x) { return isSel(x.entity) ? token('--color-accent') : ink; }), borderWidth: list.map(function (x) { return isSel(x.entity) ? 3 : 0; }),
          _labels: list.map(function (x) { return x.value === null ? none : fmtInt(x.value); }), _rows: list.map(function (x) { return x.row; }) }]
          .concat(at.map(function (id) {
            var c = token(MK.COLORS[id]);
            return { type: 'line', label: adminName(id), data: list.map(function (x) { return x.at[id] ? x.at[id].value : null; }), showLine: false, borderColor: c, backgroundColor: c, _color: c,
              pointStyle: 'rectRot', pointRadius: 5, pointHoverRadius: 6, pointBorderColor: token('--color-panel'), pointBorderWidth: 1, order: 1,
              _rows: list.map(function (x) { return x.at[id] ? x.at[id].row : null; }) };
          }))
      });
      fComp.setNotes(groupNotes(g).concat(provNote(list.some(function (x) { return x.row && x.row.provisional; }))));

      last.n = n; last.months = months; last.since = lines.map(function (l) { return { id: l.id, values: l.values }; });
      last.comp = list.map(function (x) { return { entity: x.entity, value: x.value, at: Object.keys(x.at).reduce(function (o, k) { o[k] = x.at[k] ? x.at[k].value : null; return o; }, {}) }; });
      last.compReady = ready;
      OPM.page.last = last;
      OPM.page.shown = data.entity + ':' + state.grain + ':' + state.compare.join(',') + ':' + state.since + ':' + state.mix + ':' + g + '|' + data.list.join('+') + (ready ? '|all' : '');
      OPM.shell.refreshDraft();
    }

    /* 4 alone (its From/to range changes nothing else) */
    function drawFlows() {
      var rows = data.rows, g = state.group, suffix = data.entity;
      var picked = OPM.controls.fyRange.pick(AP.timeline(rows, g, state.grain), state.flowsRange);
      fFlows.el.querySelector('h2').textContent = copy.t('shell:appt.flows.title', { group: groupName(g) });
      fFlows.setBands(picked, latest);
      var faded = picked.map(function (r) { return r.provisional === true; });
      fFlows.setData({ labels: picked.map(periodText), fileSuffix: suffix + '-' + g + '-' + state.grain + MK.rangeSuffix(state.flowsRange),
        datasets: [K.barDataset(picked.map(function (r) { return D.value(r, 'hires'); }), faded, '--chart-2', copy.t('hiring-and-departures:chart.flows.series.hires')),
          K.barDataset(picked.map(function (r) { return D.value(r, 'departures'); }), faded, '--chart-3', copy.t('hiring-and-departures:chart.flows.series.departures'))] });
      fFlows.setNotes([{ text: copy.t('shell:shade.note'), flag: 'shade' }, { text: copy.t('shell:appt.note.conversions'), flag: 'conversions' }]
        .concat(groupNotes(g), provNote(faded.some(Boolean))));

      if (OPM.page) OPM.page.flowsShown = picked.map(function (r) { return r.period; });
    }

    /* the files: one per entity, from the meta's files map, cached */
    var files = {};
    function entity(e) {
      if (!files[e]) {
        var f = meta.files && meta.files[e];
        files[e] = !f ? Promise.reject(new Error('doj_appointments meta lists no file for ' + e)) : K.getJson('data/' + f.path).then(function (file) {
          if (file.entity !== e) throw new Error('doj_appointments: file for ' + e + ' holds ' + file.entity);
          byEntity[e] = D.fromCube(file);
          return byEntity[e];
        });
        files[e].catch(function () { delete files[e]; });
      }
      return files[e];
    }
    var ticket = 0;
    function load() {
      var t = ++ticket, list = state.entities.slice(), want = list.length ? list : ['DOJ'];
      return Promise.all(want.map(entity)).then(function () {
        if (t !== ticket) return;
        data = { rows: AP.selected(byEntity, list, meta), entity: !list.length ? 'DOJ' : list.length === 1 ? list[0] : 'SEL', list: list };
        draw();
      }, function (err) {
        if (t !== ticket) return;
        K.unavailable(copy, 'Appointments', err);
      });
    }

    OPM.page = { state: state, meta: meta, frames: { since: fSince, mix: fMix, flows: fFlows, comp: fComp }, toggles: { since: sinceToggle, mix: mixToggle }, pickers: pickers, ranges: { mix: mixRange, flows: flowsRange },
      last: last, draw: draw, ready: false, data: function () { return data; } };
    // the DOJ file (panels 1 to 4) and the admin-only file (panel 5, D-088); no other entity file until a component is chosen
    var adminFile = meta.files && meta.files.admin ? K.getJson('data/' + meta.files.admin.path).then(function (file) {
      if (file.view !== 'admin') throw new Error('doj_appointments: the admin file is not the admin view');
      adminBy = AP.byEntity(D.fromCube(file));
    }) : Promise.reject(new Error('doj_appointments meta lists no admin file'));
    adminFile.catch(function () {}); // reported below, once the DOJ file has drawn
    load().then(function () {
      if (OPM.page.unavailable) return;
      return adminFile.then(function () { draw(); OPM.page.ready = true; }, function (err) { console.info('Appointments: by-component data not available (' + err.message + ')'); OPM.page.ready = true; });
    });
  }
})(typeof self !== 'undefined' ? self : this);
