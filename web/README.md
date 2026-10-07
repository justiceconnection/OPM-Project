# web/ - the dashboard (static, GitHub Pages, embedded in Framer)

Developer notes, not served copy. Live at https://justiceconnection.github.io/OPM-Project/, deployed from `main` by
the Pages workflow, which runs the unit tests first: if any test fails, nothing deploys and the site stays on the
last good build.

## Changing wording on the site

Every visible string lives in `copy.json`, and every one must be signed off by Cary before it ships. The tests
enforce this: they compare page text word for word with the signed spec in `docs/pages/<page>.md`. Editing
`copy.json` alone always fails the deploy.

**Easiest route:** send the new wording to Cary. Cary signs it and Claude applies it with all the steps below.

**Doing it yourself:**
1. Get Cary's sign-off on the exact new text first.
2. Edit the string in `copy.json`. Keep it valid JSON: every line but the last in a block ends with a comma. Leave
   the key's status as `signed` only once Cary has signed it.
3. Make the same change wherever the signed text is recorded. Find every place with
   `grep -rn '<key or old text>' docs/pages web/tests` and update each match: usually one spec table in
   `docs/pages/` (for Reading the data, `docs/pages/reading-the-data.md`), but strings changed in October 2026 are
   pinned in `docs/pages/october-2026-changes.md`, and `web/tests/smoke.mjs` pins some headings. Component names
   are also checked against `pipeline/crosswalks/components.csv`: leave those to Claude.
4. Refresh the runtime copy lists by running the smoke test (needs Google Chrome): `node web/tests/smoke.mjs`.
   From a plain clone it uses the published data in `web/data`.
5. Bump the stamp: `node web/tools/bump-stamp.js`
6. Run the unit tests, which is what the deploy runs: `node --test 'web/tests/*.test.js'` (from a plain clone, set
   `OPM_NO_LOCAL_DATA=1`; one skip is expected). With the full setup, also run `.venv/bin/python tests/gate.py`.
7. Commit only when everything passes, and commit the `copy.json`, spec, `web/tests/runtime-copy-*.json`,
   `build-stamp.json` and stamped HTML changes together.

**Merging:** if your edit and someone else's touch the same string, resolve the conflict to the signed text, check
the file still parses (`node -e "JSON.parse(require('fs').readFileSync('web/copy.json','utf8'))"`), then repeat
steps 4 to 6 before pushing.

## Developer commands

- Serve: `python3 -m http.server 8000 --directory web`, then open http://127.0.0.1:8000/
- Unit tests: `node --test 'web/tests/*.test.js'` (Node 26, no packages)
- Browser smoke test and screenshots: `node web/tests/smoke.mjs` (headless Chrome over DevTools; writes `web/_screens/`)
- After changing any served file: `node web/tools/bump-stamp.js` (the stamp test fails until you do)

Rules the code keeps: every visible string is in `copy.json`; the browser only picks cube rows by grain and
range, sums columns within a period, and divides numerator by denominator (`assets/js/data.js`); every local
asset URL carries `?v=<stamp>`. Pages read cube files from `data/` (promoted by Cary's approval only). Style values come from `assets/tokens.css` (LIONS visual style only, D-022).
