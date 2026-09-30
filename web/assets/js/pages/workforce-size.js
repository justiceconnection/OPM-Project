/* Workforce size page: currently a stub plus ONE demo chart fed by the FIXTURE file, so the
   shell, controls, legend and SVG export can be seen working. No real cube is in web/ yet.
   The browser only picks rows by grain and range and divides numerator by denominator. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  var FIXTURE_URL = 'data-fixture/FIXTURE_rates_demo.json';
  var SERIES = [
    { id: 'attrition', color: '--chart-1' },
    { id: 'quit', color: '--chart-2' }
  ];

  function pct(v) { return (v * 100).toFixed(1) + '%'; }

  OPM.shell.ready.then(function (ctx) {
    var copy = ctx.copy;
    return fetch(OPM.shell.asset(FIXTURE_URL)).then(function (r) {
      if (!r.ok) throw new Error(FIXTURE_URL + ' ' + r.status);
      return r.json();
    }).then(function (file) { build(copy, file); });
  }).catch(function (e) { console.error(e); });

  function build(copy, file) {
    var rows = OPM.data.fromCube(file);
    var ENTITY = 'DOJ';
    var problems = OPM.data.validateRows(rows);
    if (problems.length) console.warn('fixture rows disagree with their period keys', problems);
    var bounds = OPM.data.monthBounds(rows);
    var fmt = copy.periods;
    var state = {
      grain: OPM.controls.grain.DEFAULT,
      range: OPM.controls.range.defaultRange(bounds),
      method: OPM.controls.rateMethod.DEFAULT
    };

    var body = document.getElementById('page-body');
    var bar = OPM.dom.h('div', { class: 'opm-settings', role: 'group', 'aria-label': copy.controls.label });
    body.appendChild(bar);
    OPM.controls.grain.render(bar, { copy: copy.controls.grain, value: state.grain, onChange: function (g) { state.grain = g; draw(); } });
    OPM.controls.range.render(bar, { copy: copy.controls.range, fmt: fmt, bounds: bounds, value: state.range, onChange: function (r) { state.range = r; draw(); } });
    OPM.controls.rateMethod.render(bar, { copy: copy.controls.rateMethod, value: state.method, onChange: function (m) { state.method = m; draw(); } });

    var frame = OPM.chartFrame.create(body, {
      id: 'demo-rates', title: copy.demo.title, copy: copy.chart, format: pct,
      series: SERIES.map(function (s) { return { id: s.id, color: s.color, label: copy.demo.series[s.id] }; })
    });

    function draw() {
      var picked = OPM.data.selectRows(rows, { entity: ENTITY, grain: state.grain, range: state.range });
      var values = {};
      SERIES.forEach(function (s) {
        values[s.id] = OPM.data.rateSeries(picked, s.id, state.method).map(function (p) { return p.value; });
      });
      frame.update({
        labels: picked.map(function (r) { return OPM.periods.periodLabel(r.period, fmt); }),
        values: values,
        provisional: picked.map(function (r) { return r.provisional === true; }),
        fixture: file.FIXTURE === true,
        grainName: state.grain,
        message: OPM.controls.rateMethod.availableAt(state.method, state.grain) ? '' : copy.chart.noRateAtGrain
      });
    }
    draw();
    OPM.demo = { state: state, frame: frame, draw: draw }; // for the smoke test
  }
})(typeof self !== 'undefined' ? self : this);
