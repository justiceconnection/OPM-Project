/* "Explore full history" on Overview, Departures and Components (docs/pages/redesign.md section 5): collapsed by default;
   opening it frames the old pages (history-*.html) unchanged. Its own file, so a main page without it (Appointments) does
   not list its copy. Extends OPM.mainKit. Browser only. */
(function (root) {
  'use strict';
  var OPM = root.OPM;

  /* "Explore full history" (section 5): collapsed by default; opening it frames the old pages unchanged (with their
     own controls), each sized to its content from the height it reports (opm:height). pages: [{ href, title, views }]
     (views: false for a page without Monthly, Quarterly and Yearly: Who is leaving); opts: { view() } */
  function explore(body, copy, pages, opts) {
    var h = OPM.dom.h, regionId = OPM.dom.id('explore');
    var btn = h('button', { type: 'button', class: 'opm-explore__toggle', 'aria-expanded': 'false', 'aria-controls': regionId }, [
      h('span', { class: 'opm-explore__chevron', 'aria-hidden': 'true' }), h('span', { text: copy.t('shell:explore.title') })]);
    var region = h('div', { class: 'opm-explore__body', id: regionId, hidden: true });
    var section = h('section', { class: 'opm-panel opm-explore', 'data-explore': 'history' }, [
      h('h2', { class: 'opm-explore__title' }, [btn]), h('p', { class: 'opm-field__note opm-explore__note', text: copy.t('shell:explore.note') }), region]);
    body.appendChild(section);
    var frames = [];
    function build() {
      pages.forEach(function (p) {
        // the old page opens at this page's View when it has that View (Monthly by default)
        var view = opts && opts.view ? opts.view() : null;
        var f = h('iframe', { class: 'opm-explore__frame', src: p.href + '?embed=1' + (view && p.views !== false ? '&view=' + view : ''), title: p.title, loading: 'eager', 'data-page': p.href });
        region.appendChild(f);
        frames.push(f);
      });
    }
    root.addEventListener('message', function (ev) {
      var d = ev.data;
      if (!d || d.type !== 'opm:height' || !d.height) return;
      frames.forEach(function (f) { if (f.contentWindow === ev.source) f.style.height = Math.ceil(d.height) + 'px'; });
    });
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      region.hidden = !open;
      if (open && !frames.length) build();
    });
    return { el: section, frames: function () { return frames.slice(); }, toggle: btn };
  }

  OPM.mainKit.explore = explore;
})(typeof self !== 'undefined' ? self : this);
