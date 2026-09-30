/* The standard View (Yearly, Quarterly, Monthly) and date-range controls, added to the settings bar
   by the pages that show them (Workforce size, Hiring and departures). Who is leaving has its own
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
    // Preset strings are read (and so count toward the draft badge) only when there are presets to show.
    // copy-audit: if-nonempty shell:ctl.range.presets then shell:ctl.range.presetsLabel shell:ctl.range.presets
    var hasPresets = (copy.peek('shell:ctl.range.presets') || []).length > 0;
    OPM.controls.range.render(bar, {
      copy: { from: copy.t('shell:ctl.range.from'), to: copy.t('shell:ctl.range.to'),
        presetsLabel: hasPresets ? copy.t('shell:ctl.range.presetsLabel') : '', presets: hasPresets ? copy.raw('shell:ctl.range.presets') : [] },
      fmt: L.fmt, bounds: { start: meta.range.first_month, end: meta.range.last_month }, value: state.range, onChange: handlers.range
    });
    return bar;
  }
  OPM.pageControls = { viewAndRange: viewAndRange };
})(typeof self !== 'undefined' ? self : this);
