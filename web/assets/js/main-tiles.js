/* Parts of Overview and Departures only (docs/pages/redesign.md section 4): the tiles (a figure at month N with one
   "{admin} at this point: {value}" line per compared administration) and the months-in-office line chart. Components has
   neither and does not load this file, so its copy audit lists only what it draws. */
(function (root) {
  'use strict';
  var OPM = root.OPM, K = OPM.pageKit;
  /* A tile: name, value, an optional sub line, then one "{admin} at this point: {value}" line per compared administration. */
  function tile(copy, el, parts) {
    var subs = (parts.subs || []).concat((parts.at || []).map(function (x) {
      return { text: copy.t('shell:tile.atThisPoint', { admin: OPM.mainKit.adminName(copy, x.id), value: x.text }), cls: 'opm-tile__at' };
    }));
    K.fillTile(el, { name: parts.name, badges: parts.badges, value: parts.value, subs: subs });
    Array.prototype.forEach.call(el.querySelectorAll('.opm-tile__at'), function (p, i) { p.setAttribute('data-admin', parts.at[i].id); });
  }

  /* The provisional note under a tile row, keyed by the tiles' badge glyph at its start (L-103; the glyph is decorative,
     the sentence says it). */
  function provNote(copy) {
    var b = K.provisionalBadge(copy);
    b.setAttribute('aria-hidden', 'true'); b.removeAttribute('role'); b.removeAttribute('aria-label'); b.removeAttribute('title');
    return OPM.dom.h('p', { class: 'opm-chart__note opm-chart__note--provisional' }, [b, copy.t('shell:flag.provisional')]);
  }

  /* A months-in-office line chart frame (Overview Chart A, Departures Chart A); a rule marks month N. */
  function monthsFrame(container, copy, opts) {
    var token = OPM.chartFrame.token, ruleAt = [];
    var ruleLabel = '';
    var frame = OPM.chartFrame.create(container, {
      id: opts.id, title: opts.title, copy: copy, type: 'line', format: opts.format,
      options: { scales: { y: { beginAtZero: !!opts.zero } },
        plugins: { opmMarkers: { flags: [], glyph: '', color: token('--color-ink'), font: token('--font-sans'), width: 1, dash: [3, 3], label: '' },
          // the tooltip names the month in office (adm.tipMonth)
          tooltip: { callbacks: { title: function (items) { return items.length ? copy.t('shell:adm.tipMonth', { n: items[0].label }) : ''; } } } } },
      exportExtra: function () {
        var xs = frame.chart.scales.x;
        // the month-N rule, dashed as on screen, with its label (adm.ruleN)
        return { title: frame.el.querySelector('h2').textContent, markers: ruleAt.map(function (on, i) { return on ? { x: xs.getPixelForValue(i), kind: 'rule', dash: true, label: ruleLabel } : null; }).filter(Boolean) };
      }
    });
    /* data: { months, lines: [{ id, values, provisional }], n, suffix } */
    frame.draw = function (data) {
      ruleAt = data.months.map(function (m) { return m === data.n; });
      ruleLabel = data.n ? copy.t('shell:adm.ruleN', { n: data.n }) : '';
      frame.chart.options.plugins.opmMarkers.flags = ruleAt;
      frame.chart.options.plugins.opmMarkers.label = ruleLabel;
      frame.setData({
        labels: data.months.map(String), fileSuffix: data.suffix,
        datasets: data.lines.map(function (l) {
          var ds = K.lineDataset(l.values, OPM.mainKit.COLORS[l.id], OPM.mainKit.adminName(copy, l.id), l.provisional, l.provisional.map(function (p) { return p ? 'provisional' : null; }));
          ds.borderWidth = l.id === 'trump2' ? 3 : 2; // Trump II emphasized
          ds.order = l.id === 'trump2' ? -1 : 0;
          return ds;
        })
      });
    };
    return frame;
  }

  OPM.mainKit.tile = tile;
  OPM.mainKit.monthsFrame = monthsFrame;
  OPM.mainKit.provNote = provNote;
})(typeof self !== 'undefined' ? self : this);
