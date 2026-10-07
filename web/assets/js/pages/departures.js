/* Departures (docs/pages/redesign.md section 4.2; D-071, D-072): Hiring and departures merged with Who is leaving,
   around Trump II against earlier administrations at the same point in office. Reads data/doj_core.json and its meta
   (timeline, component list), data/doj_admin.meta.json and the component's doj_admin file (tiles, Charts A and B at
   months in office N), data/doj_leaving.meta.json and the component's doj_leaving file (Chart C, grain "admin_n", the
   first N months), and for a job series the doj_core_series and doj_leaving_series files. Pick and divide only.
   Panels: tiles; A departures since taking office; B why people left, first N months (seven reasons, DRP first, D-080); C who is leaving, first N months
   (one chart with a Group by selector, rates per 100 employees per year, D-090); D hires and departures timeline with
   administration shading and its own From/to range (D-090). No "Explore full history" (D-090). */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var fmtInt = K.fmt.int, fmtRate = K.fmt.rate;
  // DRP first (D-080, olive: apart from the six reasons and every administration color), then as on Hiring and
  // departures, except Termination: brown, not Obama II's purple (L-103)
  var REASON_COLORS = ['--chart-16', '--chart-2', '--chart-3', '--chart-4', '--chart-6', '--chart-15', '--chart-11'];

  K.load('Departures', build, ['data/doj_core.json', 'data/doj_core.meta.json']);

  function build(copy, cube, meta) {
    var h = OPM.dom.h, D = OPM.data, A = OPM.admin, R = OPM.redesign, MK = OPM.mainKit, SR = OPM.series, LV = OPM.leaving, token = OPM.chartFrame.token;
    var SD = OPM.seriesData.create({ doj_admin: 'data/doj_admin.meta.json', doj_core_series: 'data/doj_core_series.meta.json',
      doj_leaving: 'data/doj_leaving.meta.json', doj_leaving_series: 'data/doj_leaving_series.meta.json' });
    var coreRows = D.fromCube(cube);
    var L = K.labels(copy), label = L.label, periodText = L.periodText;
    var none = copy.t('shell:num.none');
    var latest = meta.range.last_month;
    var state = { entities: [], series: SR.ALL, compare: R.COMPARE.slice(), grain: 'month', dim: 'los', range: null }; // dim: Chart C's Group by; range: Chart D's From/to (null = full)
    var data = { admin: [], timeline: coreRows, leaving: null, group: SR.ALL, entity: 'DOJ' };
    function name(id) { return MK.adminName(copy, id); }

    OPM.moved.show(copy, copy.t('shell:nav.departures'));
    var body = document.getElementById('page-body');
    var ctl = MK.controlBar(body, copy, meta, state, L, {
      entities: function (list) { state.entities = list; load(); },
      series: function (v) { state.series = v; load(); },
      compare: function (list) { state.compare = list; draw(); },
      view: function (g) { state.grain = g; draw(); }
    });
    var seriesNote = h('p', { class: 'opm-series-none', role: 'status', hidden: true });
    body.appendChild(seriesNote);

    /* tiles: departures, quits, retirements and DRP departures since January 2025 */
    var tiles = h('section', { class: 'opm-tiles opm-tiles--four', 'aria-label': copy.t('shell:nav.departures') });
    body.appendChild(tiles);
    var TILES = [
      { col: 'departures', name: copy.t('shell:tile.departuresSince'), cls: 'opm-tile--departures' },
      { col: 'sep_quit', name: copy.t('shell:tile.quitsSince'), cls: 'opm-tile--quits' },
      { col: 'sep_retirement', name: copy.t('shell:tile.retirementsSince'), cls: 'opm-tile--retirements' },
      { col: 'sep_drp', name: copy.t('shell:tile.drpSince'), cls: 'opm-tile--drp', noAt: true } // no "at this point": the program began in 2025 (D-076)
    ];
    TILES.forEach(function (t) { t.el = h('div', { class: 'opm-tile ' + t.cls }); tiles.appendChild(t.el); });
    var tilesNotes = h('div', { class: 'opm-chart__notes opm-tiles__notes' });
    body.appendChild(tilesNotes);

    /* Chart A: running departures by months in office */
    var fRunning = MK.monthsFrame(body, copy, { id: 'departures-since-taking-office', title: copy.t('shell:dep.running.title'), format: fmtInt, zero: true });

    /* Chart B: why people left, first N months (one 100% bar per administration) */
    var fReasons = OPM.chartFrame.create(body, {
      id: 'why-people-left-first-n', title: '', copy: copy, type: 'bar', format: fmtRate,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'index', axis: 'y', intersect: false }, layout: { padding: { right: 8 } }, // every reason's share in the tooltip
        scales: { x: { stacked: true, min: 0, max: 1, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return (v * 100).toFixed(0) + '%'; } } },
          y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } }
      },
      exportExtra: function () { return { title: fReasons.el.querySelector('h2').textContent, notes: [copy.t('shell:reasons.drpNote')] }; }
    });

    /* Chart C: who is leaving, first N months (grain admin_n): one grouped-bar chart, its dimension picked by "Group by"
       (D-090): for each group one bar per administration shown, to scale, the rate as a number per 100 employees per year */
    var per100 = function (v) { return (v * 100).toFixed(1); }; // the rate as a share, read per 100 employees (the same number)
    var whoLabels = [];
    var fWho = OPM.chartFrame.create(body, {
      id: 'who-is-leaving-first-n', title: '', copy: copy, type: 'bar', format: per100,
      plotClass: 'opm-chart__plot opm-chart__plot--snapshot',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 64 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 6, callback: function (v) { return String(+(v * 100).toFixed(1)); } },
          title: { display: true, text: copy.t('shell:dep.who.axis'), color: token('--color-muted'), font: { size: 12, family: token('--font-sans') } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', color: token('--color-ink'), font: token('--font-sans') },
          tooltip: { callbacks: { label: function (c) {
            var x = (c.dataset._cells || [])[c.dataIndex];
            if (!x || x.rate === null) return '';
            return copy.t('shell:dep.who.tip', { admin: c.dataset.label, rate: per100(x.rate), count: x.departures === null ? none : fmtInt(x.departures) });
          } } } }
      },
      exportExtra: function () {
        var out = [];
        fWho.chart.data.datasets.forEach(function (ds, i) {
          if (!fWho.chart.isDatasetVisible(i)) return;
          var m = fWho.chart.getDatasetMeta(i), xs = fWho.chart.scales.x;
          m.data.forEach(function (el, j) { var t = ds._labels && ds._labels[j]; if (t) out.push({ x: (ds.data[j] == null ? xs.getPixelForValue(0) : el.x) + 4, y: el.y + 4, text: t }); });
        });
        return { title: fWho.el.querySelector('h2').textContent, labels: out,
          notes: [whoNote.textContent].concat([].map.call(fWho.notes.querySelectorAll('p'), function (p) { return p.textContent; })) };
      }
    });
    fWho.el.classList.add('opm-who');
    var whoTitle = fWho.el.querySelector('h2');
    // copy-audit: shell:dep.who.dim.los shell:dep.who.dim.age shell:dep.who.dim.sup shell:dep.who.dim.occ
    var dimName = LV.DIMS.reduce(function (o, d) { o[d.key] = copy.t('shell:dep.who.dim.' + d.key); return o; }, {});
    var dimSelect = h('select', { id: OPM.dom.id('who-dim') });
    fWho.tools.hidden = false;
    fWho.tools.appendChild(h('div', { class: 'opm-field opm-field--who-dim' }, [h('label', { for: dimSelect.id, class: 'opm-field__name', text: copy.t('shell:dep.who.dim') }), dimSelect]));
    function paintDims(bySeries) { // Occupation is left out while a job series is chosen (as before)
      dimSelect.textContent = '';
      LV.DIMS.forEach(function (d) { if (!(bySeries && d.id === 'occupation')) dimSelect.appendChild(h('option', { value: d.key, text: dimName[d.key] })); });
      if (bySeries && state.dim === 'occ') state.dim = 'los';
      dimSelect.value = state.dim;
    }
    dimSelect.addEventListener('change', function () { state.dim = dimSelect.value; drawWho(); });
    var whoNote = h('p', { class: 'opm-field__note opm-who__note' });
    fWho.el.insertBefore(whoNote, fWho.tools);
    var whoUnavailable = h('p', { class: 'opm-unavailable', role: 'status', hidden: true, text: copy.t('shell:data.unavailable') });
    fWho.el.insertBefore(whoUnavailable, fWho.plot);
    var dimText = { los: copy.t('who-is-leaving:dim.los'), age: copy.t('who-is-leaving:dim.age'), sup: copy.t('who-is-leaving:dim.sup') };
    var notApplicable = copy.t('who-is-leaving:notApplicable');
    function groupName(dim, value) { var g = LV.groupLabel(dim, value); return copy.t(g.ref.replace(/^page:/, 'who-is-leaving:'), g.vars); } // copy-audit: who-is-leaving:group.los.lt1 who-is-leaving:group.los.1_4 who-is-leaving:group.los.5_9 who-is-leaving:group.los.10_19 who-is-leaving:group.los.20_24 who-is-leaving:group.los.25_29 who-is-leaving:group.los.30plus who-is-leaving:group.age.under25 who-is-leaving:group.age.65plus who-is-leaving:group.age.range who-is-leaving:group.sup.supervisor who-is-leaving:group.sup.other who-is-leaving:group.occ.0905 who-is-leaving:group.occ.1811 who-is-leaving:group.occ.0007 who-is-leaving:group.occ.other

    /* Chart D: hires and departures timeline, shaded by administration, with its own From/to range (D-090) */
    var fTimeline = MK.timelineFrame(body, copy, { id: 'hires-departures-timeline', type: 'bar', format: fmtInt, legend: true });
    var rangeCtl = MK.rangeControl(fTimeline, copy, meta, L, function (r) { state.range = r.full ? null : r; drawTimeline(); });

    var last = {};
    function draw() {
      var e = data.entity, g = data.group, rows = data.admin;
      var cur = R.current(rows, e, g);
      var empty = !cur || A.noStaff(cur.row), n = cur ? cur.n : MK.calendarN(latest); // no one in the series (L-109): the calendar N
      seriesNote.hidden = !empty; seriesNote.textContent = copy.t('shell:series.none');
      var at = R.atOrder(state.compare), shownIds = R.shown(state.compare);
      var prov = !empty && cur.row.provisional === true;
      var suffix = e + (g !== SR.ALL ? '-series-' + g : '');

      // tiles at month N, with each compared administration at the same month
      var atRows = empty ? [] : R.atPoint(rows, e, g, at, n);
      TILES.forEach(function (t) {
        var v = empty ? null : D.value(cur.row, t.col);
        MK.tile(copy, t.el, { name: t.name, badges: prov ? [K.provisionalBadge(copy)] : [], value: v === null ? none : fmtInt(v),
          at: t.noAt ? [] : atRows.map(function (x) { var w = x.row && !A.noStaff(x.row) ? D.value(x.row, t.col) : null; return { id: x.id, text: w === null ? none : fmtInt(w) }; }) });
      });
      tilesNotes.textContent = '';
      if (prov) tilesNotes.appendChild(MK.provNote(copy));

      // A: running departures
      var maxN = empty ? 0 : Math.max.apply(null, shownIds.map(function (id) { return A.months(rows, e, g, id); }));
      var months = empty ? [] : R.monthsShown(maxN, state.grain, n);
      var lines = empty ? [] : shownIds.map(function (id) { return Object.assign({ id: id }, R.lineAt(rows, e, g, id, months, 'departures')); });
      fRunning.draw({ months: months, lines: lines, n: n, suffix: suffix + '-' + state.grain });
      var anotes = [];
      if (lines.some(function (l) { return l.provisional.some(Boolean); })) anotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fRunning.setNotes(anotes);

      // B: why people left, first N months
      fReasons.el.querySelector('h2').textContent = copy.t('shell:dep.reasons.title', { n: n === null ? none : n });
      var reasonItems = empty ? [] : shownIds.map(function (id) { var r = A.rowAt(rows, e, g, id, n); return { id: id, s: r && !A.noStaff(r) ? A.reasonShares(r) : null }; })
        .filter(function (x) { return x.s && !x.s.none; });
      fReasons.plot.style.height = (Math.max(reasonItems.length, 1) * K.barRowHeight() + 40) + 'px';
      fReasons.setData({ labels: reasonItems.map(function (x) { return name(x.id); }), fileSuffix: suffix + '-first-' + n,
        datasets: A.CHART_REASONS.map(function (c, i) { // seven reasons, DRP first (D-080)
          var col = token(REASON_COLORS[i]);
          return { type: 'bar', label: copy.t('series:' + A.reasonLabelCol(c)), data: reasonItems.map(function (x) { return x.s.shares[i]; }), backgroundColor: col, borderColor: col, _color: col, stack: 'r', barThickness: 18, _col: c }; // copy-audit: series:sep_drp series:sep_transfer_out series:sep_quit series:sep_retirement series:sep_rif series:sep_termination series:sep_other
        }) });
      fReasons.setNotes([{ text: copy.t('shell:reasons.drpNote'), flag: 'drp' }].concat(prov ? [{ text: copy.t('shell:flag.provisional'), flag: 'provisional' }] : [],
        empty ? [{ text: copy.t('shell:series.none'), flag: 'none' }] : []));

      // C: who is leaving, first N months (admin_n)
      last.who = { empty: empty, n: n, ids: shownIds };
      paintDims(g !== SR.ALL);
      drawWho();

      // D: hires and departures timeline
      drawTimeline();

      last.n = n; last.empty = empty; last.months = months;
      last.tiles = TILES.map(function (t) { return empty ? null : D.value(cur.row, t.col); });
      last.reasons = reasonItems.map(function (x) { return { id: x.id, shares: x.s.shares }; });
      OPM.page.last = last;
      OPM.page.shown = e + ':' + g + ':' + state.grain + ':' + state.compare.join(',') + '|' + (data.list || []).join('+'); // the components chosen, after the bar
      OPM.shell.refreshDraft();
    }

    /* Chart C alone (Group by changes nothing else): the dimension chosen, for the administrations shown */
    function drawWho() {
      var empty = last.who.empty, n = last.who.n, ids = last.who.ids, g = data.group; // Trump II, Biden, Trump I, Obama II (D-077)
      var dim = LV.DIMS.filter(function (d) { return d.key === state.dim; })[0];
      whoTitle.textContent = copy.t('shell:dep.who.title', { n: n === null ? none : n });
      whoNote.textContent = copy.t('shell:dep.who.note', { n: n === null ? none : n });
      var rows = data.leaving;
      var has = !!(rows && rows.some(function (r) { return r.grain === 'admin_n'; }));
      var unavailable = !empty && !has; // the grain is not published yet (or the file failed): this chart only
      whoUnavailable.hidden = !unavailable;
      fWho.plot.hidden = empty || unavailable;
      var bySeries = g !== SR.ALL;
      if (empty || unavailable) {
        fWho.setData({ labels: [], datasets: [] });
        fWho.setNotes(empty ? [{ text: copy.t('shell:series.none'), flag: 'none' }] : []);
        last.who.dim = dim.key; last.who.values = []; last.who.rates = [];
        return;
      }
      var panel = R.leavingPanel(rows, dim.id, ids);
      fWho.plot.style.height = (Math.max(panel.values.length, 1) * (ids.length * 14 + 18) + 64) + 'px';
      var anySmall = false;
      whoLabels = panel.values.map(function (v) { return groupName(dim.id, v); });
      fWho.setData({
        labels: whoLabels, fileSuffix: data.entity + (bySeries ? '-series-' + g : '') + '-' + dim.key + '-first-' + n,
        datasets: ids.map(function (id) {
          var c = token(MK.COLORS[id]);
          var cells = panel.groups.map(function (gr) { return gr.cells[id]; });
          anySmall = anySmall || cells.some(function (x) { return x && x.smallBase && x.rate !== null; });
          return { type: 'bar', label: name(id), data: cells.map(function (x) { return x && !x.na ? x.rate : null; }), _color: c, borderColor: c, barThickness: 11, _cells: cells,
            _faded: cells.map(function (x) { return !!(x && x.smallBase); }),
            backgroundColor: cells.map(function (x) { return x && x.smallBase ? OPM.chartFrame.hatch(c) : c; }), borderWidth: cells.map(function (x) { return x && x.smallBase ? 1 : 0; }),
            _labels: cells.map(function (x) { return !x ? null : x.na ? (id === R.CURRENT ? notApplicable : null) : x.rate === null ? null : per100(x.rate); }) };
        })
      });
      var notes = [];
      // one line per administration shown with any Unknown in this dimension, and its coverage when below 100% (D-074)
      if (dim.unknownLine) ids.forEach(function (id) { // occupation has no Unknown line (as on Who is leaving)
        var u = panel.unknown[id];
        if (u === 1) notes.push({ text: copy.t('shell:dep.who.unknownAdmin1', { admin: name(id), dimension: dimText[dim.key] }), flag: 'unknown' }); // the singular (D-076)
        else if (u) notes.push({ text: copy.t('shell:dep.who.unknownAdmin', { admin: name(id), count: fmtInt(u), dimension: dimText[dim.key] }), flag: 'unknown' });
      });
      if (dim.id === 'los') ids.forEach(function (id) {
        var cov = panel.coverage[id];
        if (cov !== null && cov < 1) notes.push({ text: copy.t('shell:dep.who.coverageAdmin', { admin: name(id), pct: (Math.floor(cov * 1000) / 10).toFixed(1) + '%' }), flag: 'coverage' });
      });
      if (anySmall) notes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      if (panel.provisional) notes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fWho.setNotes(notes);
      last.who.dim = dim.key; last.who.values = panel.values; last.who.unknown = panel.unknown;
      last.who.rates = ids.map(function (id) { return panel.groups.map(function (gr) { return gr.cells[id] ? gr.cells[id].rate : null; }); });
    }

    /* Chart D alone (its From/to range changes nothing else) */
    function drawTimeline() {
      var e = data.entity, g = data.group, suffix = e + (g !== SR.ALL ? '-series-' + g : '');
      var picked = OPM.controls.fyRange.pick(D.selectRows(data.timeline, { entity: e, grain: state.grain }), state.range);
      fTimeline.el.querySelector('h2').textContent = copy.t('shell:dep.timeline.title', MK.rangeVars(rangeCtl, L));
      fTimeline.setBands(picked, latest);
      var faded = picked.map(function (r) { return r.provisional === true; });
      fTimeline.setData({ labels: picked.map(periodText), fileSuffix: suffix + '-' + state.grain + MK.rangeSuffix(state.range),
        datasets: [K.barDataset(picked.map(function (r) { return D.value(r, 'hires'); }), faded, '--chart-2', copy.t('hiring-and-departures:chart.flows.series.hires')),
          K.barDataset(picked.map(function (r) { return D.value(r, 'departures'); }), faded, '--chart-3', copy.t('hiring-and-departures:chart.flows.series.departures'))] });
      var tnotes = [{ text: copy.t('shell:shade.note'), flag: 'shade' }];
      if (picked.some(function (r) { return r.provisional; })) tnotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fTimeline.setNotes(tnotes);
      if (OPM.page) OPM.page.timelineShown = picked.map(function (r) { return r.period; });
    }

    /* the rows for the component and series in view */
    var ticket = 0;
    function load() {
      // the components chosen (D-078): all = the DOJ rows; one = its rows; several = their rows summed per key ('SEL')
      var t = ++ticket, sel = MK.selection(state.entities), g = state.series;
      var timeline = g === SR.ALL ? Promise.resolve({ rows: coreRows, meta: meta }) : SD.group('doj_core_series', sel.load, g);
      // the breakdowns: a failure here (the admin_n grain not yet published, or a missing file) affects Chart C only
      var leaving = (g === SR.ALL
        ? Promise.all([SD.meta('doj_leaving')].concat(sel.load.map(function (e) { return SD.entity('doj_leaving', e); }))).then(function (r) { return { meta: r[0], rows: [].concat.apply([], r.slice(1)) }; })
        : SD.group('doj_leaving_series', sel.load, g))
        .then(function (d) { return MK.combine(d.rows, sel, d.meta, 'leaving'); }, function (err) { console.info('Departures: breakdowns not available (' + err.message + ')'); return null; });
      return Promise.all([SD.group('doj_admin', sel.load, g), timeline, leaving]).then(function (res) {
        if (t !== ticket) return;
        data = { admin: MK.combine(res[0].rows, sel, res[0].meta, 'admin'), timeline: MK.combine(res[1].rows, sel, res[1].meta, 'core'), leaving: res[2], group: g, entity: sel.key, list: sel.list };
        draw();
      }, function (err) {
        if (t !== ticket) return;
        console.info('Departures: data not available (' + err.message + ')');
        if (g !== SR.ALL) { state.series = SR.ALL; ctl.series.set(SR.ALL); load().then(function () { seriesNote.hidden = false; seriesNote.textContent = copy.t('shell:data.unavailable'); }); return; }
        K.unavailable(copy, 'Departures', err);
      });
    }

    OPM.page = { state: state, meta: meta, frames: { running: fRunning, reasons: fReasons, who: fWho, timeline: fTimeline }, whoDim: dimSelect, ranges: { timeline: rangeCtl }, last: last, draw: draw, ready: false,
      data: function () { return data; } };
    load().then(function () { OPM.page.ready = true; });
  }
})(typeof self !== 'undefined' ? self : this);
