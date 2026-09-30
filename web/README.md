# web/ - the dashboard (static, GitHub Pages, embedded in Framer)

Developer notes, not served copy. Status: shell only (L-012). Copy in `copy.json` is UNSIGNED.

- Serve: `python3 -m http.server 8000 --directory web`, then open http://127.0.0.1:8000/
- Unit tests: `node --test 'web/tests/*.test.js'` (Node 26, no packages)
- Browser smoke test and screenshots: `node web/tests/smoke.mjs` (headless Chrome over DevTools; writes `web/_screens/`)
- After changing any served file: `node web/tools/bump-stamp.js` (the stamp test fails until you do)
- Rebuild the demo fixture: `node web/tools/make-fixture.js`

Rules the code keeps: every visible string is in `copy.json`; the browser only picks cube rows by grain and
range, sums columns within a period, and divides numerator by denominator (`assets/js/data.js`); every local
asset URL carries `?v=<stamp>`; `data-fixture/` holds invented numbers and the chart shows a FIXTURE badge
whenever it draws them. Style values come from `assets/tokens.css` (LIONS visual style only, D-022).
