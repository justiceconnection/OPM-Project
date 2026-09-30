"""Promote a staged cube from warehouse/cubes/ into web/data/ (the site's data). Needs Cary's approval, cited as a
decision heading in ops/DECISIONS.md.

    .venv/bin/python pipeline/promote.py doj_core --decision D-036

Refuses unless:
  * the decision's own ops/DECISIONS.md entry (heading to next heading) names the cube and a form of 'promote';
  * that decision has not already promoted this cube with different content (promotions.json history, L-038);
  * the staged meta matches its cube file (cube_sha256);
  * the gate (tests/gate.py) is green, and the staged files are unchanged after it ran (re-hashed). Planned checks print PLAN, not FAIL, so they do not block. The one failure
    allowed is promoted_matches_staged reporting only 'stale: <this cube>', which is what promotion fixes.
Then copies <cube>.json and <cube>.meta.json into web/data/ (atomically) and records the promotion in
web/data/promotions.json: per cube the decision, cube and meta sha256, manifest hash and time, plus an
append-only history. Idempotent: if web/data/ already holds the staged files and promotions.json records them,
nothing is written.
After a real copy (never on a no-op) it runs the frontend's stamp tool, `node web/tools/bump-stamp.js --dir <web>`
(files in web/data/ are served files), then re-runs the whole gate. If the bump or that final gate fails, it says so
loudly and exits 1, leaving the files in place so the gate shows what is wrong.
The web/data location can be redirected with OPM_WEB_DATA (used only by tests; the gate prints any override).
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STAGED = os.path.join(ROOT, 'warehouse', 'cubes')
DECISIONS = os.path.join(ROOT, 'ops', 'DECISIONS.md')


def web_data():
    return os.environ.get('OPM_WEB_DATA') or os.path.join(ROOT, 'web', 'data')


def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def decision_entry(did):
    """The text of one decision, from its '## D-nnn' heading to the next '## ' heading ('' if absent)."""
    m = re.search(rf'^## {re.escape(did)}\b.*?(?=^## |\Z)', open(DECISIONS, encoding='utf-8').read(), re.M | re.S)
    return m.group(0) if m else ''


def decision_approves(did, cube):
    """Only a decision whose own entry names the cube and says promot(e/ion/ed) approves promoting it."""
    text = decision_entry(did)
    return bool(text) and cube in text and re.search(r'promot', text, re.I) is not None


def gate_green(cube):
    """(ok, reason). Runs the whole gate and reads its PASS/FAIL lines."""
    py = os.path.join(ROOT, '.venv', 'bin', 'python')
    r = subprocess.run([py if os.path.exists(py) else sys.executable, os.path.join(ROOT, 'tests', 'gate.py')],
                       capture_output=True, text=True, cwd=ROOT)
    fails = [l for l in r.stdout.splitlines() if l.startswith('FAIL')]
    blocking = []
    for l in fails:
        name = l.split()[1]
        if name == 'promoted_matches_staged':
            detail = re.sub(r'( \[override [^\]]*\])? \(\d+\.\ds\)$', '', l.split('] ', 1)[1])
            if all(p == f'stale: {cube}' for p in detail.split('; ')):
                continue
        blocking.append(l)
    if not re.search(r'^\d+ of \d+ checks pass', r.stdout, re.M):
        return False, 'the gate did not finish:\n' + (r.stderr or r.stdout)[-800:]
    return not blocking, '\n'.join(blocking)


def loud(msg):
    bar = '!' * 78
    print(f'\n{bar}\n{msg}\n{bar}', file=sys.stderr)


def finish(cube, final_gate):
    """Bump the web build stamp for the web dir that holds web/data, then re-run the gate. Exit 1 on failure."""
    web = os.path.dirname(os.path.abspath(web_data()))
    tool = os.path.join(ROOT, 'web', 'tools', 'bump-stamp.js')
    try:
        r = subprocess.run(['node', tool, '--dir', web], capture_output=True, text=True, cwd=ROOT)
    except OSError as e:
        r = type('R', (), {'returncode': 1, 'stdout': '', 'stderr': str(e)})
    if r.returncode != 0:
        loud(f'PROMOTED FILES ARE IN PLACE BUT THE STAMP BUMP FAILED (exit {r.returncode}):\n{(r.stderr or r.stdout).strip()}')
        sys.exit(1)
    print(f'bump-stamp ({web}): {r.stdout.strip()}')
    ok, why = final_gate(cube)
    if not ok:
        loud(f'{cube} WAS PROMOTED BUT THE GATE IS NOW RED. Files left in place; fix what it names:\n{why}')
        sys.exit(1)
    print('final gate: green')


def promote(cube, decision, check_gate=gate_green, final_gate=gate_green):
    src = {f: os.path.join(STAGED, f) for f in (f'{cube}.json', f'{cube}.meta.json')}
    missing = [p for p in src.values() if not os.path.exists(p)]
    if missing:
        sys.exit(f'refused: staged file missing: {missing}')
    if not decision_approves(decision, cube):
        sys.exit(f'refused: {decision} is not an ops/DECISIONS.md entry that approves promoting {cube} '
                 f'(its own text must name {cube} and a form of "promote")')
    meta = json.load(open(src[f'{cube}.meta.json']))
    cube_sha, meta_sha = sha(src[f'{cube}.json']), sha(src[f'{cube}.meta.json'])
    if meta.get('cube_sha256') != cube_sha:
        sys.exit(f'refused: {cube}.meta.json does not describe {cube}.json (cube_sha256 differs); rebuild the cube')
    dest = web_data()
    rec_path = os.path.join(dest, 'promotions.json')
    recs = json.load(open(rec_path)) if os.path.exists(rec_path) else {'cubes': {}, 'history': []}
    same_files = all(os.path.exists(os.path.join(dest, f)) and sha(os.path.join(dest, f)) == sha(p) for f, p in src.items())
    cur = recs['cubes'].get(cube, {})
    if same_files and cur.get('cube_sha256') == cube_sha and cur.get('meta_sha256') == meta_sha:
        print(f'{cube}: web/data already equals the staged files (promoted under {cur.get("decision")}); nothing to do')
        return False
    used = {(h.get('cube_sha256'), h.get('meta_sha256')) for h in recs.get('history', [])
            if h.get('cube') == cube and h.get('decision') == decision}
    if used - {(cube_sha, meta_sha)}:   # L-038: one decision, one content per cube
        sys.exit(f'refused: {decision} already promoted {cube} with different content; a refresh needs its own decision')
    ok, why = check_gate(cube)
    if not ok:
        sys.exit(f'refused: the gate is not green:\n{why}')
    if (sha(src[f'{cube}.json']), sha(src[f'{cube}.meta.json'])) != (cube_sha, meta_sha):
        sys.exit(f'refused: the staged {cube} files changed while the gate ran; run promote again')
    os.makedirs(dest, exist_ok=True)
    for f, p in src.items():
        tmp = os.path.join(dest, f + '.tmp')
        shutil.copyfile(p, tmp)
        os.replace(tmp, os.path.join(dest, f))
    entry = {'decision': decision, 'cube_sha256': cube_sha, 'meta_sha256': meta_sha,
             'manifest_sha256': meta.get('manifest_sha256'),
             'promoted_at': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()}
    recs['cubes'][cube] = entry
    recs['history'].append({'cube': cube, **entry})
    tmp = rec_path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(json.dumps(recs, indent=1) + '\n')
    os.replace(tmp, rec_path)
    print(f'{cube}: promoted to {dest} under {decision} (cube {cube_sha[:12]}, manifest '
          f'{str(entry["manifest_sha256"])[:12]})')
    finish(cube, final_gate)
    return True


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Promote a staged cube into web/data/')
    ap.add_argument('cube')
    ap.add_argument('--decision', required=True, help='the approving decision, e.g. D-036')
    a = ap.parse_args()
    promote(a.cube, a.decision)
