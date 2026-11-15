import pathlib
s=pathlib.Path(__file__).parent/'src'
t=(s/'index.html').read_text()
for k,fs in (('/*CORE*/',['core.js']),('/*CORE2*/',['core2.js']),('/*UI*/',['ui.js']),('/*APP*/',['app1.js','app2.js','app3.js'])):
    t=t.replace(k,'\n'.join((s/f).read_text() for f in fs))
(pathlib.Path(__file__).parent/'SailLens.html').write_text(t)
print(len(t)//1024,'kB')
