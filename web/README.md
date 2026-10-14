# web/ - the dashboard (static, GitHub Pages, embedded in Framer)

Developer notes, not served copy. Live at https://justiceconnection.github.io/OPM-Project/, deployed from `main` by
the Pages workflow, which runs the unit tests first: if any test fails, nothing deploys and the site stays on the
last good build.

## Changing wording on the site

Every visible string lives in `copy.json`, each with a status (`signed` once approved for publication). The tests
compare page text word for word with the approved text recorded in `docs/pages/<page>.md`, so editing `copy.json`
alone fails the deploy.

1. Edit the string in `copy.json`. Keep it valid JSON: every line but the last in a block ends with a comma.
2. Make the same change wherever the approved text is recorded. Find every place with
   `grep -rn '<key or old text>' docs/pages web/tests` and update each match: usually one spec table in
   `docs/pages/`, but strings changed in October 2026 are pinned in `docs/pages/october-2026-changes.md`, and
   `web/tests/smoke.mjs` pins some headings. Component names are also checked against
   `pipeline/crosswalks/components.csv`.
3. Refresh the runtime copy lists by running the smoke test (needs Google Chrome): `node web/tests/smoke.mjs`.
   From a plain clone it uses the published data in `web/data`.
4. Bump the stamp: `node web/tools/bump-stamp.js`
5. Run the unit tests, which is what the deploy runs: `node --test 'web/tests/*.test.js'` (from a plain clone, set
   `OPM_NO_LOCAL_DATA=1`; one skip is expected). With the full data setup, also run `.venv/bin/python tests/gate.py`.
6. Commit the `copy.json`, spec, `web/tests/runtime-copy-*.json`, `build-stamp.json` and stamped HTML changes
   together.

**Merging:** pull before you edit. If two edits touch the same string, resolve the conflict to the approved text,
check the file still parses (`node -e "JSON.parse(require('fs').readFileSync('web/copy.json','utf8'))"`), then
repeat steps 3 to 5 before pushing.

## Developer commands

- Serve: `python3 -m http.server 8000 --directory web`, then open http://127.0.0.1:8000/
- Unit tests: `node --test 'web/tests/*.test.js'` (Node 22 or later, no packages)
- Browser smoke test and screenshots: `node web/tests/smoke.mjs` (headless Chrome over DevTools; writes `web/_screens/`)
- After changing any served file: `node web/tools/bump-stamp.js` (the stamp test fails until you do)
- Copy sheets (every string, one page per section, for review): `node web/tools/copy-sheet.js` (writes `copy-sheets/`)

Rules the code keeps: every visible string is in `copy.json`; the browser only picks cube rows by grain and
range, sums columns within a period, and divides numerator by denominator (`assets/js/data.js`); every local
asset URL carries `?v=<stamp>`. Pages read cube files from `data/`, which only `pipeline/promote.py` writes.
