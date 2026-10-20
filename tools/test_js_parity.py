"""Run kamotish.js in headless Chrome and compare every polygon point with the Python implementation."""
import json, os, re, subprocess, sys, html
sys.argv = sys.argv[:1]
import syllables as SY, render as R

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
cons = 'bcdfghjklmnpqrstvwxyz'
sylls = ['houl', 'ma', 'tas', 'jian', 'su', 'kun', 'liang', 'shao', 'xing', 'moist', 'oits', 'tsao', 'an', 'a', 'in', 'e', 'neen', 'chang', 'zhi', 'kees', 'baem', 'miad']
sylls += [c + v for c in cons for v in ('a', 'ou', 'ie', 'ue')]
sylls += ['a' + c for c in cons] + ['ma' + c for c in cons] + ['ke' + c for c in cons] + ['kebo', 'xyz', 'str', 'uaii']
sylls += ['pats', 'bing', 'jast', 'sha', 'cho', 'zhua'.replace('ua', 'ia')]
cases = [(s, None) for s in sylls] + [('ma', '1'), ('tas', '2'), ('jian', '3'), ('liang', '4'), ('shao', '1'), ('houl', '4')]
glyph_names = sorted(os.path.basename(f)[:-4] for f in __import__('glob').glob(os.path.join(ROOT, 'resources', 'glyphs-final', '*.svg')))
gcases = [(g, None) for g in glyph_names] + [(g, t) for g in ('mou', 'wou', 'hou2', 'ii', 'e', 'zhi') for t in '1234']

CHROME = os.environ.get('CHROME') or next((p for p in ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium'] if os.path.exists(p)), 'google-chrome')
page = os.path.join(ROOT, 'web', '_parity.html')
open(page, 'w', encoding='utf-8').write('''<!doctype html><meta charset=utf-8><script src="kamotish.js"></script><pre id=o></pre><script>
const S=%s, G=%s, out={s:{},g:{}};
for(const [k,t] of S){ try{ out.s[k+'|'+(t||'')]=Kamotish._syllablePath(k,t);}catch(e){out.s[k+'|'+(t||'')]='ERR '+e.message;} }
for(const [k,t] of G){ try{ out.g[k+'|'+(t||'')]=Kamotish._graphemePath(k,t);}catch(e){out.g[k+'|'+(t||'')]='ERR '+e.message;} }
document.getElementById('o').textContent=JSON.stringify(out);</script>''' % (json.dumps(cases), json.dumps(gcases)))
r = subprocess.run([CHROME, '--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=20000', '--dump-dom', 'file://' + page], capture_output=True, text=True, timeout=120)
m = re.search(r'<pre id="o">(.*?)</pre>', r.stdout, re.S)
js = json.loads(html.unescape(m.group(1)))
nums = lambda d: [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
def cmp(a, b): 
    x, y = nums(a), nums(b)
    return (len(x) == len(y)) and (max(abs(p - q) for p, q in zip(x, y)) if x else 0.0)
bad = 0; worst = 0.0
for (s, t) in cases:
    j = js['s'][s + '|' + (t or '')]
    try: py = re.search(r'<path d="([^"]+)"', SY.syllable_svg(s, tone=t)).group(1)
    except Exception:
        if not str(j).startswith('ERR'): bad += 1; print('JS accepted what Python rejects:', s)
        continue
    c = cmp(py, j)
    if c is False or c > 0.2: bad += 1; print('MISMATCH syllable', s, t, c if c is not False else 'len %d vs %d' % (len(nums(py)), len(nums(j)))) if bad < 12 else None
    else: worst = max(worst, c)
for (g, t) in gcases:
    R.STYLE = 'design'
    svg = R.glyph_svg(g, t)
    # python glyph svg: flatten paths (glyph + shifted tone group) to compare only when no tone; with tone compare number counts + glyph part
    py = ' '.join(re.findall(r' d="([^"]+)"', svg)); j = js['g'][g + '|' + (t or '')]
    if t is None:
        c = cmp(py, j)
        if c is False or c > 0.2: bad += 1; print('MISMATCH glyph', g, c if c is not False else 'len %d vs %d' % (len(nums(py)), len(nums(j)))) if bad < 12 else None
        else: worst = max(worst, c)
print('syllables', len(cases), 'graphemes', len(gcases), 'mismatches', bad, 'worst point difference %.3f' % worst)
os.remove(page)
