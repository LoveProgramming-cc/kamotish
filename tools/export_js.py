"""Build web/kamotish.js (browser component) from the same skeleton data the Python tools use."""
import json, os, sys
sys.argv = sys.argv[:1]
import shapes as SH, forms as F
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
geom = json.load(open(os.path.join(ROOT, 'resources', 'consonants-final', 'geometry.json')))
data = {'shapes': SH.SHAPES, 'aliases': SH.ALIASES, 'tones': SH.TONES, 'forms': {'A': F.A, 'D': F.D},
        'geom': {L: {'A': {k: v for k, v in g['A'].items() if k in 'xwh'}, 'D': {k: v for k, v in g['D'].items() if k in 'xwh'}} for L, g in geom.items()}}
tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kamotish.template.js'), encoding='utf-8').read()
out = tpl.replace('/*DATA*/', json.dumps(data, ensure_ascii=False, separators=(',', ':')))
os.makedirs(os.path.join(ROOT, 'web'), exist_ok=True)
open(os.path.join(ROOT, 'web', 'kamotish.js'), 'w', encoding='utf-8').write(out)
print('web/kamotish.js', len(out) // 1024, 'KB')
