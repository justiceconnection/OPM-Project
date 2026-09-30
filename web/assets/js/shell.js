/* The page shell: loads copy.json, draws the header, navigation and footer, fills every
   [data-copy] element, and starts the Framer height reporter. Page scripts wait on
   OPM.shell.ready, which resolves to { copy, stamp, page }.
   Every visible string comes from copy.json; this file holds none. */
(function (root) {
  'use strict';
  var OPM = root.OPM = root.OPM || {};

  /* The planned pages, in nav order. Titles live in copy.json under pages.<id>.title. */
  var PAGES = [
    { id: 'workforce-size', href: 'index.html' },
    { id: 'hiring-and-departures', href: 'hiring-and-departures.html' },
    { id: 'who-is-leaving', href: 'who-is-leaving.html' },
    { id: 'components-compared', href: 'components-compared.html' },
    { id: 'workforce-lookup', href: 'workforce-lookup.html' },
    { id: 'reading-the-data', href: 'reading-the-data.html' }
  ];

  function stamp() {
    var m = document.querySelector('meta[name="opm-build"]');
    return m ? m.getAttribute('content') : '';
  }

  /* Every fetched asset carries the build stamp, like every <script> and <link> does. */
  function asset(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(stamp()); }

  function lookup(obj, path) {
    return path.split('.').reduce(function (o, k) { return o && o[k] !== undefined ? o[k] : undefined; }, obj);
  }

  function text(copy, path) {
    var v = lookup(copy, path);
    if (typeof v !== 'string') { console.warn('copy.json has no string at', path); return ''; }
    return v;
  }

  function renderHeader(copy, page) {
    var h = OPM.dom.h;
    var nav = h('nav', { class: 'opm-nav', 'aria-label': text(copy, 'nav.label') }, [
      h('ul', null, PAGES.map(function (p) {
        return h('li', null, [h('a', { href: p.href, class: 'opm-nav__link', 'aria-current': p.id === page ? 'page' : null, text: text(copy, 'pages.' + p.id + '.title') })]);
      }))
    ]);
    var el = document.getElementById('site-header');
    el.appendChild(h('div', { class: 'opm-brand' }, [
      h('span', { class: 'opm-brand__name', text: text(copy, 'site.publisher') }),
      h('span', { class: 'opm-brand__draft', text: text(copy, 'site.draftNotice') })
    ]));
    el.appendChild(nav);
  }

  function renderFooter(copy) {
    var h = OPM.dom.h, el = document.getElementById('site-footer');
    el.appendChild(h('p', { text: text(copy, 'footer.source') }));
    el.appendChild(h('p', { class: 'opm-footer__meta', text: OPM.periods.fill(text(copy, 'footer.build'), { stamp: stamp() }) }));
  }

  function fillCopy(copy) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (el) {
      el.textContent = text(copy, el.getAttribute('data-copy'));
    });
  }

  function init() {
    var page = document.body.getAttribute('data-page');
    return fetch(asset('copy.json'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('copy.json ' + r.status); return r.json(); })
      .then(function (copy) {
        var title = text(copy, 'pages.' + page + '.title');
        document.title = OPM.periods.fill(text(copy, 'site.documentTitle'), { page: title });
        renderHeader(copy, page);
        fillCopy(copy);
        renderFooter(copy);
        var reporter = OPM.height.createHeightReporter({ win: root, target: document.getElementById('page'), page: page });
        reporter.start();
        OPM.shell.reporter = reporter;
        return { copy: copy, stamp: stamp(), page: page };
      });
  }

  OPM.shell = { PAGES: PAGES, stamp: stamp, asset: asset, text: text };
  OPM.shell.ready = new Promise(function (resolve, reject) {
    function go() { init().then(resolve, function (e) { console.error(e); document.body.classList.add('opm-shell-failed'); reject(e); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  });
})(typeof self !== 'undefined' ? self : this);
