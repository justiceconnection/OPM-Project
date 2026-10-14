/* The page shell: loads copy.json, draws the header, navigation and footer, fills every
   [data-copy] element, and starts the Framer height reporter. Page scripts wait on
   OPM.shell.ready, which resolves to { copy, stamp, page }, where copy is OPM.copy's accessor.
   Every visible string comes from copy.json; this file holds none. */
(function (root) {
  'use strict';
  var OPM = root.OPM = root.OPM || {};

  /* The navigation (docs/pages/redesign.md section 1, D-072; Appointments, D-084): the four main pages, then two secondary links.
     The old pages live on as history-*.html, shown inside "Explore full history"; the old addresses open the new pages. */
  var PAGES = [
    { id: 'overview', href: 'index.html', nav: 'shell:nav.overview' },
    { id: 'departures', href: 'departures.html', nav: 'shell:nav.departures' },
    { id: 'components-view', href: 'components.html', nav: 'shell:nav.components' },
    { id: 'appointments', href: 'appointments.html', nav: 'shell:nav.appointments' },
    { id: 'workforce-lookup', href: 'workforce-lookup.html', nav: 'shell:nav.lookup', secondary: true },
    { id: 'reading-the-data', href: 'reading-the-data.html', nav: 'shell:nav.reading', secondary: true }
  ];
  /* the main page each old page now lives in ("Explore full history") */
  var PARENT = { 'workforce-size': 'overview', 'hiring-and-departures': 'departures', 'who-is-leaving': 'departures', 'components-compared': 'components-view' };
  var DRAFT_REF = 'shell:site.draftNotice';
  var SOURCE_URL = 'https://data.opm.gov/get-data/api-access'; // the source name in the footer links here

  function stamp() {
    var m = document.querySelector('meta[name="opm-build"]');
    return m ? m.getAttribute('content') : '';
  }

  /* Every fetched asset carries the build stamp, like every <script> and <link> does. */
  function asset(url) { return url + (url.indexOf('?') < 0 ? '?' : '&') + 'v=' + encodeURIComponent(stamp()); }

  var draftEl = null, brandEl = null, sourceEl = null, copy = null;

  function renderHeader(page) {
    var h = OPM.dom.h;
    var current = PARENT[page] || page; // an old page opened directly marks the main page that holds it (L-103)
    function link(p) {
      // copy-audit: shell:nav.overview shell:nav.departures shell:nav.components shell:nav.appointments shell:nav.lookup shell:nav.reading
      return h('a', { href: p.href, class: 'opm-nav__link' + (p.secondary ? ' opm-nav__link--secondary' : ''), 'aria-current': p.id === current ? 'page' : null, text: copy.t(p.nav) });
    }
    // the main pages, then the two secondary links together in one item, so they never split across rows
    var items = PAGES.filter(function (p) { return !p.secondary; }).map(function (p) { return h('li', { class: 'opm-nav__item' }, [link(p)]); });
    items.push(h('li', { class: 'opm-nav__item opm-nav__item--secondary opm-nav__group' }, PAGES.filter(function (p) { return p.secondary; }).map(link)));
    var nav = h('nav', { class: 'opm-nav', 'aria-label': copy.t('shell:nav.label') }, [h('ul', null, items)]);
    var el = document.getElementById('site-header');
    // copy-audit: exempt shell:site.draftNotice
    draftEl = h('span', { class: 'opm-brand__draft', text: copy.t(DRAFT_REF) });
    // no publisher name above the tabs (D-110): the row holds only the draft badge and shows only with it
    brandEl = h('div', { class: 'opm-brand' }, [draftEl]);
    el.appendChild(brandEl);
    el.appendChild(nav);
  }

  function renderFooter() {
    var h = OPM.dom.h, el = document.getElementById('site-footer');
    sourceEl = h('p');
    setSource(copy.t('shell:footer.source'));
    el.appendChild(sourceEl);
    // last updated: the build stamp's date, and the latest month of the promoted data (D-106)
    // it holds a line's height while the meta loads, so a #anchor scroll is not moved; without data it stays blank
    var meta = h('p', { class: 'opm-footer__meta', text: '\u00a0' });
    el.appendChild(meta);
    fetch(asset('data/doj_core.meta.json'))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { if (m && m.range) meta.textContent = updatedText(stamp(), m.range.last_month) || '\u00a0'; })
      .catch(function () {});
  }

  /* stamp 'YYYYMMDD-HHMMSS', month 'YYYY-MM' -> the footer.updated sentence */
  function updatedText(st, month) {
    var names = copy.raw('shell:footer.months'), d = /^(\d{4})(\d{2})(\d{2})/.exec(st), m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!d || !m) return '';
    return copy.t('shell:footer.updated', { mon: names[+d[2] - 1], day: +d[3], year: d[1], dataMon: names[+m[2] - 1], dataYear: m[1] });
  }

  function fillCopy() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (el) {
      // copy-audit: data-copy
      var text = copy.t(el.getAttribute('data-copy'));
      if (el.classList.contains('opm-intro')) introText(el, text); else el.textContent = text;
    });
  }

  /* The draft badge shows while any string this page has used is unsigned. Pages call this
     again after drawing, because they use more keys than the shell does. */
  function refreshDraft() {
    if (!draftEl) return [];
    var list = copy.unsignedUsed([DRAFT_REF]);
    draftEl.hidden = list.length === 0;
    if (brandEl) brandEl.hidden = draftEl.hidden;
    return list;
  }

  /* Fills el with text, the first mention of each phrase linked to its url. links is a list of
     { phrase, url, newTab }, or (phrase, url) for one link in a new tab (the site is framed in Framer). */
  function linkText(el, text, links, url) {
    if (typeof links === 'string') links = [{ phrase: links, url: url, newTab: true }];
    var found = (links || []).map(function (l) { return { l: l, at: l.phrase ? text.indexOf(l.phrase) : -1 }; })
      .filter(function (f) { return f.at >= 0; }).sort(function (a, b) { return a.at - b.at; });
    el.textContent = '';
    var pos = 0;
    found.forEach(function (f) {
      if (f.at < pos) return; // overlaps a link already made
      el.appendChild(document.createTextNode(text.slice(pos, f.at)));
      el.appendChild(OPM.dom.h('a', { href: f.l.url, target: f.l.newTab ? '_blank' : null, rel: f.l.newTab ? 'noopener' : null, text: f.l.phrase }));
      pos = f.at + f.l.phrase.length;
    });
    el.appendChild(document.createTextNode(text.slice(pos)));
    return el;
  }

  /* A page intro (D-108): OPM's name links to OPM's data page, the Reading the data page's name to that page. */
  function introText(el, text) {
    return linkText(el, text, [{ phrase: copy.t('shell:link.opm'), url: SOURCE_URL, newTab: true },
      { phrase: copy.t('shell:nav.reading'), url: 'reading-the-data.html' }]);
  }

  /* The source line, with the source's name linked to OPM's data page. */
  function setSource(text) { if (sourceEl) linkText(sourceEl, text, copy.t('shell:footer.sourceName'), SOURCE_URL); }

  function init() {
    var page = document.body.getAttribute('data-page');
    // inside "Explore full history" an old page is framed with ?embed=1: no header or footer of its own
    if (/[?&]embed=1(&|$)/.test(root.location.search)) document.documentElement.classList.add('opm-embedded');
    // the Framer height reporter starts at once (as LIONS's does at load), before the copy arrives (D-060)
    var reporter = OPM.height.createHeightReporter({ win: root, doc: document, target: document.getElementById('page'), page: page });
    reporter.start();
    OPM.shell.reporter = reporter;
    return fetch(asset('copy.json'), { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('copy.json ' + r.status); return r.json(); })
      .then(function (json) {
        copy = OPM.copy.createCopy(json, page);
        renderHeader(page);
        fillCopy();
        // the document title names the page as its h1 does (pages.<id>.page.title, or shell:nav.* on the main pages)
        var h1 = document.querySelector('h1');
        document.title = copy.t('shell:site.documentTitle', { page: h1 ? h1.textContent : '' });
        renderFooter();
        refreshDraft();
        return { copy: copy, stamp: stamp(), page: page };
      });
  }

  OPM.shell = { PAGES: PAGES, SOURCE_URL: SOURCE_URL, stamp: stamp, asset: asset, updatedText: updatedText, linkText: linkText, introText: introText, refreshDraft: refreshDraft, setSource: setSource, usedCopy: function () { return copy ? copy.used().sort() : []; } };
  OPM.shell.ready = new Promise(function (resolve, reject) {
    function go() { init().then(resolve, function (e) { console.error(e); document.body.classList.add('opm-shell-failed'); reject(e); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  });
})(typeof self !== 'undefined' ? self : this);
