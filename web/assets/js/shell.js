/* The page shell: loads copy.json, draws the header, navigation and footer, fills every
   [data-copy] element, and starts the Framer height reporter. Page scripts wait on
   OPM.shell.ready, which resolves to { copy, stamp, page }, where copy is OPM.copy's accessor.
   Every visible string comes from copy.json; this file holds none. */
(function (root) {
  'use strict';
  var OPM = root.OPM = root.OPM || {};

  /* The planned pages, in nav order. Titles live in copy.json at pages.<id>['page.title']. */
  var PAGES = [
    { id: 'workforce-size', href: 'index.html' },
    { id: 'hiring-and-departures', href: 'hiring-and-departures.html' },
    { id: 'who-is-leaving', href: 'who-is-leaving.html' },
    { id: 'components-compared', href: 'components-compared.html' },
    { id: 'workforce-lookup', href: 'workforce-lookup.html' },
    { id: 'reading-the-data', href: 'reading-the-data.html' }
  ];
  var DRAFT_REF = 'shell:site.draftNotice';

  function stamp() {
    var m = document.querySelector('meta[name="opm-build"]');
    return m ? m.getAttribute('content') : '';
  }

  /* Every fetched asset carries the build stamp, like every <script> and <link> does. */
  function asset(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(stamp()); }

  var draftEl = null, sourceEl = null, copy = null;

  function renderHeader(page) {
    var h = OPM.dom.h;
    var nav = h('nav', { class: 'opm-nav', 'aria-label': copy.t('shell:nav.label') }, [
      h('ul', null, PAGES.map(function (p) {
        // copy-audit: pages:page.title
        return h('li', null, [h('a', { href: p.href, class: 'opm-nav__link', 'aria-current': p.id === page ? 'page' : null, text: copy.t(p.id + ':page.title') })]);
      }))
    ]);
    var el = document.getElementById('site-header');
    // copy-audit: exempt shell:site.draftNotice
    draftEl = h('span', { class: 'opm-brand__draft', text: copy.t(DRAFT_REF) });
    el.appendChild(h('div', { class: 'opm-brand' }, [h('span', { class: 'opm-brand__name', text: copy.t('shell:site.publisher') }), draftEl]));
    el.appendChild(nav);
  }

  function renderFooter() {
    var h = OPM.dom.h, el = document.getElementById('site-footer');
    sourceEl = h('p', { text: copy.t('shell:footer.source') });
    el.appendChild(sourceEl);
    el.appendChild(h('p', { class: 'opm-footer__meta', text: copy.t('shell:footer.build', { stamp: stamp() }) }));
  }

  function fillCopy() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (el) {
      // copy-audit: data-copy
      el.textContent = copy.t(el.getAttribute('data-copy'));
    });
  }

  /* The draft badge shows while any string this page has used is unsigned. Pages call this
     again after drawing, because they use more keys than the shell does. */
  function refreshDraft() {
    if (!draftEl) return [];
    var list = copy.unsignedUsed([DRAFT_REF]);
    draftEl.hidden = list.length === 0;
    return list;
  }

  function setSource(text) { if (sourceEl) sourceEl.textContent = text; }

  function init() {
    var page = document.body.getAttribute('data-page');
    return fetch(asset('copy.json'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('copy.json ' + r.status); return r.json(); })
      .then(function (json) {
        copy = OPM.copy.createCopy(json, page);
        document.title = copy.t('shell:site.documentTitle', { page: copy.t('page:page.title') });
        renderHeader(page);
        fillCopy();
        renderFooter();
        refreshDraft();
        var reporter = OPM.height.createHeightReporter({ win: root, target: document.getElementById('page'), page: page });
        reporter.start();
        OPM.shell.reporter = reporter;
        return { copy: copy, stamp: stamp(), page: page };
      });
  }

  OPM.shell = { PAGES: PAGES, stamp: stamp, asset: asset, refreshDraft: refreshDraft, setSource: setSource, usedCopy: function () { return copy ? copy.used().sort() : []; } };
  OPM.shell.ready = new Promise(function (resolve, reject) {
    function go() { init().then(resolve, function (e) { console.error(e); document.body.classList.add('opm-shell-failed'); reject(e); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  });
})(typeof self !== 'undefined' ? self : this);
