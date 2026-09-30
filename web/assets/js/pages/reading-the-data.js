/* Reading the data page (docs/pages/reading-the-data.md; container D-048, layout and copy D-050).
   Text only: a contents list and four sections with anchors (#source, #counting, #rates,
   #known-gaps). No charts, no controls and no data reads; the figures are fixed, signed text. */
(function (root) {
  'use strict';
  var OPM = root.OPM;

  OPM.shell.ready.then(function (ctx) { build(ctx.copy); }).catch(function (e) { console.error(e); });

  function build(copy) {
    var h = OPM.dom.h;
    var body = document.getElementById('page-body');
    function p(text) { return h('p', { class: 'opm-doc__p', text: text }); }
    function section(id, title, children) {
      return h('section', { class: 'opm-doc__section', 'aria-labelledby': id }, [h('h2', { id: id, class: 'opm-doc__h2', text: title })].concat(children));
    }
    function sub(title, paras) { return h('div', { class: 'opm-doc__sub' }, [h('h3', { class: 'opm-doc__h3', text: title })].concat(paras.map(p))); }

    var sections = [
      section('source', copy.t('page:source.title'), [
        p(copy.t('page:source.p1')), p(copy.t('page:source.p2')), p(copy.t('page:source.p3')), p(copy.t('page:source.p4')), p(copy.t('page:source.p5'))
      ]),
      section('counting', copy.t('page:counting.title'), [
        p(copy.t('page:counting.p1')), p(copy.t('page:counting.p2')), p(copy.t('page:counting.p3')), p(copy.t('page:counting.p4')), p(copy.t('page:counting.p5'))
      ]),
      section('rates', copy.t('page:rates.title'), [
        p(copy.t('page:rates.p1')), p(copy.t('page:rates.p2')),
        h('ul', { class: 'opm-doc__list' }, [h('li', { text: copy.t('page:rates.list.a') }), h('li', { text: copy.t('page:rates.list.b') }), h('li', { text: copy.t('page:rates.list.c') })]),
        p(copy.t('page:rates.p3')), p(copy.t('page:rates.p4')),
        // reason (signed series label) and what it covers (the spec row's description, split per reason)
        h('table', { class: 'opm-doc__table', 'aria-label': copy.t('page:rates.title') }, [h('tbody', null, [
          [copy.t('series:sep_transfer_out'), copy.t('page:rates.reasons.sep_transfer_out')],
          [copy.t('series:sep_quit'), ''],
          [copy.t('series:sep_retirement'), copy.t('page:rates.reasons.sep_retirement')],
          [copy.t('series:sep_rif'), copy.t('page:rates.reasons.sep_rif')],
          [copy.t('series:sep_termination'), ''],
          [copy.t('series:sep_other'), '']
        ].map(function (r) { return h('tr', null, [h('th', { scope: 'row', text: r[0] }), h('td', { text: r[1] })]); }))]),
        p(copy.t('page:rates.p5')), p(copy.t('page:rates.p6')), p(copy.t('page:rates.p7'))
      ]),
      section('known-gaps', copy.t('page:gaps.title'), [
        sub(copy.t('page:gaps.drp.title'), [copy.t('page:gaps.drp.p1')]),
        sub(copy.t('page:gaps.los.title'), [copy.t('page:gaps.los.p1')]),
        sub(copy.t('page:gaps.occ.title'), [copy.t('page:gaps.occ.p1')]),
        sub(copy.t('page:gaps.redact.title'), [copy.t('page:gaps.redact.p1')]),
        sub(copy.t('page:gaps.revisions.title'), [copy.t('page:gaps.revisions.p1')])
      ])
    ];

    var tocId = OPM.dom.id('toc');
    var toc = h('nav', { class: 'opm-doc__toc', 'aria-labelledby': tocId }, [
      h('p', { id: tocId, class: 'opm-field__name', text: copy.t('page:toc.label') }),
      h('ul', null, sections.map(function (s) { var hd = s.querySelector('h2'); return h('li', null, [h('a', { href: '#' + hd.id, text: hd.textContent })]); }))
    ]);
    body.appendChild(toc);
    sections.forEach(function (s) { body.appendChild(s); });
    OPM.shell.refreshDraft();

    // the sections are built after load, so a link such as reading-the-data.html#known-gaps is honored here
    function toHash() {
      var id = decodeURIComponent((root.location.hash || '').slice(1));
      var el = id && document.getElementById(id);
      if (el) el.scrollIntoView({ block: 'start' });
    }
    toHash();
    root.addEventListener('hashchange', toHash);
    OPM.page = { ready: true, sections: sections.map(function (s) { return s.querySelector('h2').id; }) };
  }
})(typeof self !== 'undefined' ? self : this);
