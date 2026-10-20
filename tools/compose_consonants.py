"""Consonant A-forms and D-forms (forms.py, hand-constructed from 音素.pdf) -> outlines, in the user's own block geometry.

For every letter the page geometry is measured (consonants/raw.json): where the A-form, the vertical vowel B, the
horizontal vowel C and the D-form sit, and how big they are.  The whole stack is then stretched to one 汉字 (84 x 84 in the
100 box, centred), the skeletons are outlined with the same rules as the 31 graphemes (flat cut ends, horizontals thinner).
B and C are placeholders 'I' (a vertical / a horizontal stroke) until the vowels are drawn.
Also writes geometry.json (per-letter A / D boxes in block-width units) for composing mixed syllables like  h + o u + l.
Usage: python3 compose_consonants.py [stem]   -> ../consonants-final/{A,D,blocks}/X.svg, preview.html, geometry.json
"""
import json, os, re, sys
STEM = float(sys.argv[1]) if len(sys.argv) > 1 else 5.0
sys.argv = sys.argv[:1]
import outline as O, shapes as SH, forms as F, svgstrokes as S

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
OUT = os.path.join(ROOT, 'consonants-final')
LO, SIZE = 8.0, 84.0

def bb(strokes):
    xs = [p[0] for s in strokes for p in s]; ys = [p[1] for s in strokes for p in s]
    return min(xs), min(ys), max(xs), max(ys)

def nums(d): return [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
def affine(d, f):
    def g(m):
        v = nums(m.group(2)); out = []
        for i in range(0, len(v), 2): out += list(f(v[i], v[i + 1]))
        return m.group(1) + ' '.join('%.2f' % t for t in out)
    return re.sub(r'([MLC])([^MLC]*)', g, d)

def outline_polys(ds):
    O.W = STEM; polys = []
    for d in ds: polys += O.stroke_outline(d)
    return polys

def svg_of(polys):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g fill="currentColor" stroke="none" fill-rule="nonzero">\n<path d="%s"/>\n</g>\n</svg>\n' % ''.join(polys)

def inner(svg): return re.search(r'<g\b.*?</g>', svg, re.S).group(0)

if __name__ == '__main__':
    raw = json.load(open(os.path.join(ROOT, 'consonants', 'raw.json')))
    for k in ('A', 'D', 'blocks'): os.makedirs(os.path.join(OUT, k), exist_ok=True)
    cells, geom = [], {}
    for L, v in raw.items():
        A, B, C, D = (bb(v[k]) for k in 'ABCD')
        x0 = min(A[0], C[0], D[0]); x1 = max(B[2], C[2], D[2]); y0 = min(A[1], B[1]); y1 = D[3]
        Wp, Hp = x1 - x0, y1 - y0
        to_em = lambda x, y: (LO + (x - x0) / Wp * SIZE, LO + (y - y0) / Hp * SIZE)       # page -> hanzi box
        def form(table, box):
            l, t, r, b = box
            return [affine(SH.compile_path(p), lambda x, y: to_em(l + x / 100 * (r - l), t + y / 100 * (b - t))) for p in table[L]]
        fa, fd = form(F.A, A), form(F.D, D)
        bx, (b0, b1) = (B[0] + B[2]) / 2, (B[1], B[3]); cy = (C[1] + C[3]) / 2
        vow = ['M%.2f %.2fL%.2f %.2f' % (*to_em(bx, b0), *to_em(bx, b1)), 'M%.2f %.2fL%.2f %.2f' % (*to_em(C[0], cy), *to_em(C[2], cy))]
        for k, ds in (('A', fa), ('D', fd)):
            open(os.path.join(OUT, k, L + '.svg'), 'w', encoding='utf-8').write(svg_of(outline_polys(ds)))
        blk = svg_of(outline_polys(fa + vow + fd))
        open(os.path.join(OUT, 'blocks', L + '.svg'), 'w', encoding='utf-8').write(blk)
        cells.append('<div class=c><b>%s</b><svg viewBox="0 0 100 100">%s</svg></div>' % (L, inner(blk)))
        u = lambda b: dict(x=round((b[0] - x0) / Wp, 3), y=round((b[1] - y0) / Wp, 3), w=round((b[2] - b[0]) / Wp, 3), h=round((b[3] - b[1]) / Wp, 3))
        geom[L] = {'A': u(A), 'B': u(B), 'C': u(C), 'D': u(D), 'H': round(Hp / Wp, 3)}
    json.dump(geom, open(os.path.join(OUT, 'geometry.json'), 'w'), indent=1)
    open(os.path.join(OUT, 'preview.html'), 'w', encoding='utf-8').write(
        '<!doctype html><meta charset=utf-8><style>body{margin:10px;font:12px sans-serif;background:#fff}.c{display:inline-block;width:170px;margin:4px;border:1px solid #ddd;position:relative}'
        'svg{width:170px;height:170px;display:block}svg g{fill:#111}b{position:absolute;left:4px;top:2px;color:#08c}</style>' + ''.join(cells))
    print('ok', len(cells))
