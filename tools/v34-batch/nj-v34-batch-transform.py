import re, os, sys  # usage: python3 nj-v34-batch-transform.py <tree root>  (edits <root>/test in place)
ROOT = os.path.join(sys.argv[1] if len(sys.argv) > 1 else '/tmp/nj-v34', 'test')
def edit(rel, fn):
    p = os.path.join(ROOT, rel)
    s = open(p).read()
    t = fn(s)
    if t == s: print('UNCHANGED', rel)
    open(p, 'w').write(t)
def must(s, old, new, count=1):
    assert old in s, (old[:80])
    return s.replace(old, new) if count == 0 else s.replace(old, new, count)

# ---- harness -----------------------------------------------------------
def harness(s):
    s = must(s, "const GOLDEN_DIR = path.join(__dirname, '..', 'golden');",
"""const GOLDEN_DIR = path.join(__dirname, '..', 'golden');

/* The v3 layout (§ 4, V3-4): everything only nj needs lives in `.nanojira/`.
 * Every suite that names a bookkeeping path takes it from here, so a layout
 * change is one edit. (`ac/ac-24-legacy-migration.js` spells the v2 paths
 * out itself — its fixtures are the legacy layout on purpose.) */
const CONFIG_REL = '.nanojira/config.json';
const IDS_REL = '.nanojira/ids';
const INDEX_REL = '.nanojira/index.json';
const GITIGNORE = INDEX_REL + '\\n.nj-tmp-*\\n';""")
    s = must(s, "  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.ids']) {",
                "  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', IDS_REL]) {")
    s = must(s, "  fs.writeFileSync(path.join(bl, '.nanojira.json'), o.config || DEFAULT_CONFIG);\n  fs.writeFileSync(path.join(bl, '.gitignore'),\n    '.nanojira-index.json\\n.nj-tmp-*\\n');",
                "  fs.writeFileSync(path.join(bl, CONFIG_REL), o.config || DEFAULT_CONFIG);\n  fs.writeFileSync(path.join(bl, '.gitignore'), GITIGNORE);")
    s = must(s, "    fs.writeFileSync(path.join(bl, '.ids', id), '');", "    fs.writeFileSync(path.join(bl, IDS_REL, id), '');")
    # V3-3 batch (Oracle): the STATUS.md renderer reads the config from STATUS_CONFIG_REL
    s = re.sub(r"(const STATUS_CONFIG_REL = )'\.nanojira\.json'", r"\1'.nanojira/config.json'", s)
    s = must(s, "  NJ, NODE, FIXED_NOW, LATER_NOW, DEFAULT_CONFIG,", "  NJ, NODE, FIXED_NOW, LATER_NOW, DEFAULT_CONFIG,\n  CONFIG_REL, IDS_REL, INDEX_REL, GITIGNORE,")
    return s
edit('lib/harness.js', harness)

# ---- generic rules for suites -----------------------------------------
def generic(s):
    s = s.replace("'.nanojira-index.json\\n.nj-tmp-*\\n'", 'H.GITIGNORE')
    s = s.replace("if (e.name === '.nanojira-index.json') continue;", "if (r === H.INDEX_REL) continue;")
    s = re.sub(r"'\.nanojira\.json'", 'H.CONFIG_REL', s)
    s = re.sub(r"'\.ids'", 'H.IDS_REL', s)
    s = re.sub(r"'\.ids/'", "H.IDS_REL + '/'", s)
    s = re.sub(r"'\.ids/([A-Z]+-\d+)'", r"H.IDS_REL + '/\1'", s)
    # prose (comments, descriptions)
    s = re.sub(r'(?<![\w])\.nanojira\.json', '.nanojira/config.json', s)
    s = re.sub(r'(?<![\w])\.nanojira-index\.json', '.nanojira/index.json', s)
    s = re.sub(r'(?<![\w])(?<!nanojira/)\.ids/', '.nanojira/ids/', s)
    s = re.sub(r'`\.ids`', '`.nanojira/ids`', s)
    return s

import subprocess
files = subprocess.run(['grep', '-rlE', r'\.nanojira\.json|\.ids\b|nanojira-index', ROOT, '--include=*.js'],
                       capture_output=True, text=True).stdout.split()
for f in sorted(files):
    rel = os.path.relpath(f, ROOT)
    # ac-24 and the gaps file spell v2 paths out on purpose (legacy fixtures, layout-neutral lookups)
    if rel in ('lib/harness.js', 'ac/ac-24-legacy-migration.js', 'edge/coverage-v3-gaps.js'): continue
    edit(rel, generic)

# ---- specials ----------------------------------------------------------
def ac01(s):
    s = must(s, "  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', H.IDS_REL]) {",
                "  for (const sub of ['epics', 'tasks', 'subtasks', 'archive', '.nanojira', H.IDS_REL]) {")
    s = must(s, "  T.check('.nanojira/ids/ is never ignored', !gi.split('\\n').some(l => l.trim().startsWith(H.IDS_REL)));",
"""  /* § 4: "`.nanojira/ids/` is never ignored, by design" — neither by name nor
   * by ignoring the whole `.nanojira/` folder. */
  T.check('.nanojira/ids/ is never ignored', !gi.split('\\n').some(l =>
    /^\\/?\\.nanojira\\/?(\\*\\*?)?$/.test(l.trim()) || /^\\/?\\.nanojira\\/ids/.test(l.trim())), JSON.stringify(gi));""")
    s = must(s, """    'sections: ' + JSON.stringify(cfg && cfg.sections));
""", """    'sections: ' + JSON.stringify(cfg && cfg.sections));
  /* § 5: "`init` writes the `layout` block out in full" (from V3-4, DECISIONS
   * 92 Q1). */
  T.eq('config carries the full § 5 layout block', cfg && cfg.layout, {
    group: 'type',
    folders: { epics: 'epics', tasks: 'tasks', subtasks: 'subtasks', archive: 'archive' },
    statusFile: true,
  });
  T.check('init writes no v2 file (.nanojira.json, .ids/) at the top level',
    !exists(d, '.nanojira.json') && !exists(d, '.ids'), JSON.stringify(H.lsOrEmpty(bl(d))));
""")
    return s
edit('ac/ac-01-basic-run.js', ac01)

def ac2223(s):
    s = s.replace(''' * STORAGE STAGING. V3-2 runs before V3-4: the configuration still lives at
 * the v2 place and tombstones in `.nanojira/ids/`. Both paths sit behind CONFIG_REL
 * and IDS_REL below — V3-4 flips them there, in one edit. STATUS.md (V3-3)
 * is not asserted on.''', ''' * STORAGE. Since V3-4 the configuration lives at `.nanojira/config.json`
 * and tombstones in `.nanojira/ids/` — CONFIG_REL and IDS_REL below, taken
 * from the harness. STATUS.md (V3-3) is not asserted on.''')
    s = s.replace(''' * STAGING. V3-3 runs before V3-4: the configuration still lives at the v2
 * place and tombstones in `.nanojira/ids/` — CONFIG_REL / IDS_REL, one edit for V3-4.''', ''' * STORAGE. Since V3-4 the configuration lives at `.nanojira/config.json` and
 * tombstones in `.nanojira/ids/` — CONFIG_REL / IDS_REL, from the harness.''')
    s = re.sub(r"const CONFIG_REL = H\.CONFIG_REL;\s*// V3-4: '\.nanojira/config\.json'", 'const CONFIG_REL = H.CONFIG_REL;', s)
    s = re.sub(r"const IDS_REL = H\.IDS_REL;\s*// V3-4: '\.nanojira/ids'", 'const IDS_REL = H.IDS_REL;', s)
    return s
edit('ac/ac-22-layout.js', ac2223)
edit('ac/ac-23-status-overview.js', ac2223)

def det(s):
    return must(s, r"const isTombstone = p => /[\\/]\.ids[\\/][A-Z]+-\d+$/.test(String(p));",
                   r"const isTombstone = p => /[\\/]\.nanojira[\\/]ids[\\/][A-Z]+-\d+$/.test(String(p));")
edit('fault/det-id-retry.js', det)
print('ok')

def ac21(s):
    return must(s, """ * "Holds a backlog" (§ 4) means `.nanojira/config.json` exists — from V3-4.
 * Until then the v2 marker `.nanojira/config.json` decides (DECISIONS 88,
 * AMBIGUITIES 49). This suite never builds a backlog layout itself: every
 * backlog is made by `H.mkBacklog()` and moved into place, so "a backlog"
 * is whatever the harness builds, and the V3-4 test batch that moves the
 * harness to `.nanojira/` moves this suite with it.""", """ * "Holds a backlog" (§ 4) means `.nanojira/config.json` exists (since V3-4;
 * before it the v2 marker `.nanojira.json` decided — DECISIONS 88,
 * AMBIGUITIES 49). This suite never builds a backlog layout itself: every
 * backlog is made by `H.mkBacklog()` and moved into place, so "a backlog"
 * is whatever the harness builds.""")
edit('ac/ac-21-backlog-location.js', ac21)
def staging(s):
    return must(s, "/* ---- storage staging: the one place V3-4 edits ---------------------- */",
                   "/* ---- storage paths, from the harness (§ 4 v3 layout) ----------------- */")
edit('ac/ac-22-layout.js', staging)
edit('ac/ac-23-status-overview.js', staging)
