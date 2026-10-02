/* Overview, the home page (docs/pages/redesign.md section 4.1; D-071, D-072). Reads data/doj_core.json and its meta
   (the timeline, the component list), data/doj_admin.meta.json and the selected component's doj_admin file (tiles,
   Charts A and C, at months in office N = Trump II's months so far), and for a job series data/doj_core_series.meta.json
   and the component's doj_core_series file (timeline). Pick and divide only: no sums in the browser.
   Panels: tiles; A change since taking office (with a table at month N); B the employees timeline with administration
   shading; C the departure rate, first N months. "Explore full history" frames the old Workforce size page. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  var fmtInt = K.fmt.int, fmtSigned = K.fmt.signed, fmtPct = K.fmt.pctChange, fmtRate = K.fmt.rate;

  K.load('Overview', build, ['data/doj_core.json', 'data/doj_core.meta.json']);

  function build(copy, cube, meta) {
    var h = OPM.dom.h, D = OPM.data, A = OPM.admin, R = OPM.redesign, MK = OPM.mainKit, SR = OPM.series, token = OPM.chartFrame.token;
    var SD = OPM.seriesData.create({ doj_admin: 'data/doj_admin.meta.json', doj_core_series: 'data/doj_core_series.meta.json' });
    var coreRows = D.fromCube(cube);
    var L = K.labels(copy), label = L.label, periodText = L.periodText;
    var none = copy.t('shell:num.none');
    var latest = meta.range.last_month;
    var state = { entity: 'DOJ', series: SR.ALL, compare: R.COMPARE.slice(), grain: 'month' };
    var data = { admin: [], timeline: coreRows, group: SR.ALL, entity: 'DOJ' }; // the figures in view
    function name(id) { return MK.adminName(copy, id); }

    OPM.shell.setSource(copy.t('workforce-size:source', { latest: label(latest) }));
    var body = document.getElementById('page-body');
    var ctl = MK.controlBar(body, copy, meta, state, L, {
      entity: function (v) { state.entity = v; load(); },
      series: function (v) { state.series = v; load(); },
      compare: function (list) { state.compare = list; draw(); },
      view: function (g) { state.grain = g; draw(); }
    });
    var seriesNote = h('p', { class: 'opm-series-none', role: 'status', hidden: true });
    body.appendChild(seriesNote);

    /* tiles */
    var tiles = h('section', { class: 'opm-tiles opm-tiles--four', 'aria-label': copy.t('shell:nav.overview') });
    body.appendChild(tiles);
    function tileEl(cls) { var el = h('div', { class: 'opm-tile ' + cls }); tiles.appendChild(el); return el; }
    var tEmp = tileEl('opm-tile--employees'), tDeps = tileEl('opm-tile--departures'), tHires = tileEl('opm-tile--hires'), tRate = tileEl('opm-tile--rate');
    var tilesNotes = h('div', { class: 'opm-chart__notes opm-tiles__notes' });
    body.appendChild(tilesNotes);

    /* Chart A: change since taking office, with the table at month N */
    var fChange = MK.monthsFrame(body, copy, { id: 'change-since-taking-office', title: copy.t('shell:ov.change.title'), format: fmtSigned });
    var changeTable = h('div', { class: 'opm-admin__tablebox' });
    fChange.el.insertBefore(changeTable, fChange.notes);

    /* Chart B: employees timeline with administration shading */
    var fTimeline = MK.timelineFrame(body, copy, { id: 'employees-timeline', type: 'line', format: fmtInt, legend: false, options: { scales: { y: { beginAtZero: false } } } });

    /* Chart C: departure rate, first N months */
    var fRate = OPM.chartFrame.create(body, {
      id: 'departure-rate-first-n', title: '', copy: copy, type: 'bar', format: fmtRate, legend: false,
      plotClass: 'opm-chart__plot opm-chart__plot--ranking',
      options: {
        indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false }, layout: { padding: { right: 56 } },
        scales: { x: { beginAtZero: true, grid: { color: token('--color-grid') }, ticks: { maxTicksLimit: 5, callback: function (v) { return fmtRate(v); } } },
          y: { grid: { display: false }, ticks: { autoSkip: false, callback: K.categoryTicks } } },
        plugins: { opmValueLabels: { mode: 'barEnd', format: fmtRate, color: token('--color-ink'), font: token('--font-sans') } }
      },
      exportExtra: function () {
        var m0 = fRate.chart.getDatasetMeta(0), ds = fRate.chart.data.datasets[0];
        return { title: fRate.el.querySelector('h2').textContent, labels: m0.data.map(function (el, j) { return ds.data[j] === null ? null : { x: el.x + 4, y: el.y + 4, text: fmtRate(ds.data[j]) }; }).filter(Boolean) };
      }
    });

    /* Explore full history: the old Workforce size page, unchanged */
    var ex = MK.explore(body, copy, [{ href: 'history-workforce-size.html', title: copy.t('workforce-size:page.title') }], { view: function () { return state.grain; } });

    var last = {};
    function draw() {
      var e = data.entity, g = data.group, rows = data.admin;
      var cur = R.current(rows, e, g);
      var empty = !cur || A.noStaff(cur.row);
      seriesNote.hidden = !empty; seriesNote.textContent = copy.t('shell:series.none');
      var at = R.atOrder(state.compare), shownIds = R.shown(state.compare);
      var c = empty ? null : A.cells(cur.row), n = cur ? cur.n : null;
      var atRows = empty ? [] : R.atPoint(rows, e, g, at, n).map(function (x) { return { id: x.id, c: x.row && !A.noStaff(x.row) ? A.cells(x.row) : null }; });
      function atText(f) { return atRows.map(function (x) { return { id: x.id, text: x.c ? f(x.c) : none }; }); }
      var changeText = function (x) { return x.change === null ? none : fmtSigned(x.change) + (x.changePct === null ? '' : ' (' + fmtPct(x.changePct) + ')'); };
      var prov = !empty && cur.row.provisional === true;
      var badges = function () { return prov ? [K.provisionalBadge(copy)] : []; };

      MK.tile(copy, tEmp, { name: copy.t('shell:tile.employees'), badges: badges(), value: c && c.employees !== null ? fmtInt(c.employees) : none,
        subs: c ? [copy.t('workforce-size:tile.headcount.asof', { month: label(cur.row.month_n) }),
          copy.t('shell:tile.employees.change', { change: c.change === null ? none : fmtSigned(c.change), pct: c.changePct === null ? none : fmtPct(c.changePct) })] : [],
        at: atText(changeText) });
      MK.tile(copy, tDeps, { name: copy.t('shell:tile.departuresSince'), badges: badges(), value: c && c.departures !== null ? fmtInt(c.departures) : none, at: atText(function (x) { return x.departures === null ? none : fmtInt(x.departures); }) });
      MK.tile(copy, tHires, { name: copy.t('shell:tile.hiresSince'), badges: badges(), value: c && c.hires !== null ? fmtInt(c.hires) : none, at: atText(function (x) { return x.hires === null ? none : fmtInt(x.hires); }) });
      MK.tile(copy, tRate, { name: copy.t('shell:tile.rateSince'), badges: badges(), value: c && c.attrition !== null ? fmtRate(c.attrition) : none,
        subs: c && c.smallBase ? [{ text: copy.t('shell:flag.smallBase'), cls: 'opm-tile__flag' }] : [], at: atText(function (x) { return x.attrition === null ? none : fmtRate(x.attrition); }) });
      tilesNotes.textContent = '';
      if (prov) tilesNotes.appendChild(MK.provNote(copy));
      var suffix = e + (g !== SR.ALL ? '-series-' + g : '');

      // Chart A: every administration's own months (Trump II to N), at the View's step
      var maxN = empty ? 0 : Math.max.apply(null, shownIds.map(function (id) { return A.months(rows, e, g, id); }));
      var months = empty ? [] : R.monthsShown(maxN, state.grain, n);
      var lines = empty ? [] : shownIds.map(function (id) { return Object.assign({ id: id }, R.lineAt(rows, e, g, id, months, 'headcount_change')); });
      fChange.draw({ months: months, lines: lines, n: n, suffix: suffix + '-' + state.grain });
      var cnotes = [{ text: copy.t('shell:ov.change.note') }];
      if (lines.some(function (l) { return l.provisional.some(Boolean); })) cnotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fChange.setNotes(cnotes);
      changeTable.textContent = '';
      if (!empty) {
        var tableIds = [R.CURRENT].concat(at);
        var t = h('table', { class: 'opm-admin__table opm-admin__table--change' });
        t.appendChild(h('thead', null, [h('tr', null, [copy.t('shell:compare.pick'), copy.t('shell:compare.change.col'), copy.t('shell:compare.change.pct')].map(function (x, i) { return h('th', { scope: 'col', class: i === 0 ? 'opm-admin__name' : null, text: x }); }))]));
        var tb = h('tbody');
        tableIds.forEach(function (id) {
          var r = A.rowAt(rows, e, g, id, n), x = r && !A.noStaff(r) ? A.cells(r) : null;
          tb.appendChild(h('tr', { 'data-admin': id }, [h('th', { scope: 'row', class: 'opm-admin__name', text: name(id) }),
            h('td', { text: x && x.change !== null ? fmtSigned(x.change) : none }), h('td', { text: x && x.changePct !== null ? fmtPct(x.changePct) : none })]));
        });
        t.appendChild(tb);
        changeTable.appendChild(h('div', { class: 'opm-admin__scroll', tabindex: '0', role: 'region', 'aria-label': copy.t('shell:ov.change.title') }, [t]));
      }

      // Chart B: the timeline at the View's grain, shaded by administration
      var picked = D.selectRows(data.timeline, { entity: e, grain: state.grain });
      fTimeline.el.querySelector('h2').textContent = copy.t('shell:ov.timeline.title', { latest: label(latest) });
      fTimeline.setBands(picked, latest);
      fTimeline.setData({ labels: picked.map(periodText), fileSuffix: suffix + '-' + state.grain,
        datasets: [K.lineDataset(picked.map(function (r) { return D.value(r, 'headcount'); }), '--chart-1', copy.t('shell:tile.employees'), picked.map(function (r) { return r.provisional === true; }), K.pointMarkers(picked))] });
      var tnotes = [{ text: copy.t('shell:shade.note'), flag: 'shade' }];
      if (picked.some(function (r) { return r.provisional; })) tnotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fTimeline.setNotes(tnotes);

      // Chart C: the departure rate, first N months
      fRate.el.querySelector('h2').textContent = copy.t('shell:ov.rate.title', { n: n === null ? none : n });
      var items = empty ? [] : shownIds.map(function (id) { var r = A.rowAt(rows, e, g, id, n); return { id: id, c: r && !A.noStaff(r) ? A.cells(r) : null }; })
        .filter(function (x) { return x.c && x.c.attrition !== null; });
      fRate.plot.style.height = (Math.max(items.length, 1) * K.barRowHeight() + 40) + 'px';
      fRate.setData({ labels: items.map(function (x) { return name(x.id); }), fileSuffix: suffix + '-first-' + n,
        datasets: [{ type: 'bar', label: copy.t('shell:tile.rateSince'), data: items.map(function (x) { return x.c.attrition; }), barThickness: 18, _color: token('--chart-1'),
          borderColor: items.map(function (x) { return token(MK.COLORS[x.id]); }),
          backgroundColor: items.map(function (x) { var col = token(MK.COLORS[x.id]); return x.c.smallBase ? OPM.chartFrame.hatch(col) : col; }),
          borderWidth: items.map(function (x) { return x.c.smallBase ? 1 : 0; }), _faded: items.map(function (x) { return x.c.smallBase; }) }] });
      var rnotes = [{ text: copy.t('shell:admin.rateNote') }];
      if (items.some(function (x) { return x.c.smallBase; })) rnotes.push({ text: copy.t('shell:flag.smallBase'), flag: 'smallBase' });
      if (prov) rnotes.push({ text: copy.t('shell:flag.provisional'), flag: 'provisional' });
      fRate.setNotes(rnotes);

      last = { n: n, empty: empty, months: months, cells: c, at: atRows, rates: items.map(function (x) { return { id: x.id, rate: x.c.attrition }; }) };
      OPM.page.last = last;
      OPM.page.shown = e + ':' + g + ':' + state.grain + ':' + state.compare.join(',');
      OPM.shell.refreshDraft();
    }

    /* the rows for the component and series in view: doj_admin (that group), and doj_core or doj_core_series */
    var ticket = 0;
    function load() {
      var t = ++ticket, e = state.entity, g = state.series;
      var timeline = g === SR.ALL ? Promise.resolve(coreRows) : SD.group('doj_core_series', [e], g).then(function (d) { return d.rows; });
      return Promise.all([SD.group('doj_admin', [e], g), timeline]).then(function (res) {
        if (t !== ticket) return;
        data = { admin: res[0].rows, timeline: res[1], group: g, entity: e };
        draw();
      }, function (err) {
        if (t !== ticket) return;
        console.info('Overview: data not available (' + err.message + ')');
        if (g !== SR.ALL) { state.series = SR.ALL; ctl.series.set(SR.ALL); load().then(function () { seriesNote.hidden = false; seriesNote.textContent = copy.t('shell:data.unavailable'); }); return; }
        K.unavailable(copy, 'Overview', err);
      });
    }

    OPM.page = { state: state, meta: meta, frames: { change: fChange, timeline: fTimeline, rate: fRate }, explore: ex, last: last, draw: draw, ready: false, data: function () { return data; } };
    load().then(function () { OPM.page.ready = true; });
  }
})(typeof self !== 'undefined' ? self : this);
