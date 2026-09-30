/* The settings bar with the component selector, for the pages that have one (Workforce size, Hiring
   and departures, Who is leaving). Components compared shows every component and does not load it, so
   each page's copy audit lists only the controls it draws. handlers: { entity(v) } */
(function (root) {
  'use strict';
  var OPM = root.OPM;
  function render(body, copy, meta, state, L, handlers) {
    var h = OPM.dom.h, W = OPM.workforce;
    var bar = h('div', { class: 'opm-settings', role: 'group', 'aria-label': copy.t('shell:controls.label') });
    body.appendChild(bar);
    OPM.controls.component.render(bar, {
      label: copy.t('shell:ctl.component'), value: state.entity,
      options: W.componentOptions({
        // copy-audit: components:*
        entities: meta.entities, names: meta.entities.reduce(function (o, e) { if (e !== 'DOJ') o[e] = copy.t('components:' + e); return o; }, {}),
        entityLastMonth: meta.entity_last_month, latest: meta.range.last_month, allLabel: copy.t('shell:ctl.component.all'),
        endedLabel: function (n, m) { return copy.t('shell:ctl.component.ended', { name: n, month: L.label(m) }); }
      }),
      onChange: handlers.entity
    });
    return bar;
  }

  OPM.componentBar = { render: render };
})(typeof self !== 'undefined' ? self : this);
