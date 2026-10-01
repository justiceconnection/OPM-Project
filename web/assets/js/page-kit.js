/* Shared parts of the data pages (Workforce size, Hiring and departures): number formats,
   loading the cube, the "data not available" state, the standard controls (component, view,
   range), period labels, dataset builders and flag notes. Browser only. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  var NUM = new Intl.NumberFormat('en-US');

  var fmt = {
    int: function (v) { return NUM.format(v); },
    signed: function (v) { return (v > 0 ? '+' : '') + NUM.format(v); },
    pctChange: function (v) { return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'; },
    rate: function (v) { return (v * 100).toFixed(1) + '%'; }
  };

  function getJson(url) {
    return fetch(OPM.shell.asset(url)).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  function unavailable(copy, pageName, err) {
    console.info(pageName + ': data not available (' + (err && err.message) + ')');
    document.getElementById('page-body').appendChild(OPM.dom.h('p', { class: 'opm-unavailable', role: 'status', text: copy.t('shell:data.unavailable') }));
    OPM.shell.refreshDraft();
    OPM.page = { unavailable: true };
  }

  /* Load the files a page names (its first two are the core cube and its meta), then build(copy, cube, meta,
     extras); on failure show the signed "data not available" state. Each page names its own data files,
     so the copy audit sees exactly what the page reads. */
  function load(pageName, build, urls) {
    OPM.shell.ready.then(function (ctx) {
      return Promise.all(urls.map(getJson)).then(function (res) {
        build(ctx.copy, res[0], res[1], res.slice(2));
      }, function (err) { unavailable(ctx.copy, pageName, err); });
    }).catch(function (e) { console.error(e); });
  }

  /* Period labels from the signed formats. */
  function labels(copy) {
    var P = OPM.periods;
    var f = {
      months: copy.raw('shell:period.months'), month: copy.raw('shell:period.month'),
      fiscalQuarter: copy.raw('shell:period.quarter'), fiscalYear: copy.raw('shell:period.fy')
    };
    function label(period) { return P.periodLabel(period, f); }
    return {
      fmt: f, label: label
    };
  }

  /* A long axis name wraps onto lines of at most max characters instead of being clipped. */
  function wrapLabel(text, max) {
    if (text.length <= max) return text;
    var lines = [''];
    text.split(' ').forEach(function (w) {
      var cur = lines[lines.length - 1];
      if (cur && (cur + ' ' + w).length > max) lines.push(w); else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
    });
    return lines;
  }
  /* The category-axis tick callback for horizontal bar charts: group names, wrapped on narrow charts. */
  function categoryTicks(v, i) { return wrapLabel(this.getLabelForValue(i), this.chart.width < 520 ? 20 : 40); }
  /* Row height for horizontal bar charts: taller on narrow screens, where names wrap onto three lines. */
  function barRowHeight() { return root.innerWidth < 600 ? 46 : 30; }

  OPM.pageKit = { fmt: fmt, load: load, getJson: getJson, unavailable: unavailable, wrapLabel: wrapLabel, categoryTicks: categoryTicks, barRowHeight: barRowHeight, labels: labels };
})(typeof self !== 'undefined' ? self : this);
