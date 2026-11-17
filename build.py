import pathlib
import sys

root = pathlib.Path(__file__).parent
s = root / 'src'
t = (s / 'index.html').read_text(encoding='utf-8')
for marker, files in (('/*CORE*/', ['core.js']), ('/*CORE2*/', ['core2.js', 'core3.js', 'storage.js', 'formulas.js', 'workspace.js', 'sessionflow.js']), ('/*UI*/', ['ui.js']), ('/*APP*/', ['app1.js', 'app2.js', 'app3.js', 'app4.js', 'workflow.js', 'studio.js', 'racetools.js'])):
    if t.count(marker) != 1:
        raise SystemExit(f'Expected exactly one {marker} build marker')
    t = t.replace(marker, '\n'.join((s / f).read_text(encoding='utf-8') for f in files))
out = root / 'SailLens.html'
if '--check' in sys.argv:
    if out.read_bytes() != t.encode('utf-8'):
        raise SystemExit('SailLens.html is stale; run python build.py')
else:
    out.write_bytes(t.encode('utf-8'))
print(len(t.encode('utf-8')) // 1024, 'kB')
