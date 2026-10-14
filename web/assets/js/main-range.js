/* The From/to fiscal-year range on the main pages' charts that run from October 2011 (D-090; docs/pages/october-2026-changes.md
   section 7): Overview's employees, Departures' hires and departures, Appointments' workforce by type and hires and departures
   by group. Its own file, loaded only by the pages that draw it, so each page's copy audit lists only what it draws.
   Extends OPM.mainKit. Browser only. */
(function (root) {
  'use strict';
  var OPM = root.OPM;

  /* The From/to range of a chart that runs from October 2011 (D-090), in the frame's tools row; onChange(range) gets
     { start, end, from, to, full }. The bounds are the cube's months (meta.range). */
  function rangeControl(frame, copy, meta, L, onChange) {
    frame.tools.hidden = false;
    var ctl = OPM.controls.fyRange.render(frame.tools, {
      bounds: { start: meta.range.first_month, end: meta.range.last_month },
      copy: { from: copy.t('shell:ctl.range.from'), to: copy.t('shell:ctl.range.to'), reset: copy.t('shell:ctl.range.reset') },
      fyLabel: function (fy) { return L.label(fy); }, labelledBy: frame.el.querySelector('h2').id, onChange: onChange
    });
    return ctl;
  }
  /* A chart title's {from} and {to}: the first and last month of its range (the latest month when it runs to the end). */
  function rangeVars(ctl, L) { return OPM.controls.fyRange.fromTo(ctl.get(), L.label); }
  /* The export file name's part for a narrowed range ('' for the full range). */
  function rangeSuffix(range) { return range && !range.full ? '-' + range.from + '-' + range.to : ''; }
  OPM.mainKit.rangeControl = rangeControl;
  OPM.mainKit.rangeVars = rangeVars;
  OPM.mainKit.rangeSuffix = rangeSuffix;
})(typeof self !== 'undefined' ? self : this);
