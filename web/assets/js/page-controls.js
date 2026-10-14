/* The standard View (Yearly, Quarterly, Monthly) and date-range controls (with the administration presets),
   added to the settings bar by the pages that show them (Workforce size, Hiring and departures). Who is leaving has its own
   View and Period controls and does not load this file. */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  /* handlers: { view(g), range(r) } */
  function viewAndRange(bar, copy, meta, state, L, handlers) {
    OPM.controls.grain.render(bar, {
      copy: { label: copy.t('shell:ctl.grain'), options: { fy: copy.t('shell:ctl.grain.fy'), quarter: copy.t('shell:ctl.grain.quarter'), month: copy.t('shell:ctl.grain.month') }, note: copy.t('shell:ctl.grain.note') },
      value: state.grain, onChange: handlers.view
    });
    // Administration presets (docs/pages/administrations.md section 2, D-065): Obama II, Trump I, Biden, Trump II, All;
    // Trump II and All end at the latest month. The windows come from OPM.admin; only the labels are copy.
    var names = { obama2: copy.t('shell:admin.obama2'), trump1: copy.t('shell:admin.trump1'), biden: copy.t('shell:admin.biden'), trump2: copy.t('shell:admin.trump2'), all: copy.t('shell:admin.all') };
    var bounds = { start: meta.range.first_month, end: meta.range.last_month };
    var range = OPM.controls.range.render(bar, {
      copy: { from: copy.t('shell:ctl.range.from'), to: copy.t('shell:ctl.range.to'), presetsLabel: copy.t('shell:ctl.presets.label'), presets: OPM.admin.presets(names, bounds) },
      fmt: L.fmt, bounds: bounds, value: state.range, onChange: handlers.range
    });
    bar.range = range;
    return bar;
  }
  OPM.pageControls = { viewAndRange: viewAndRange };
})(typeof self !== 'undefined' ? self : this);
