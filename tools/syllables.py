"""Compose a syllable block  A(consonant, A-form) + B(vowel, vertical) + C(vowel, horizontal) + D(consonant, D-form).
Geometry is in block-width units W (x: 0..1, y downwards).  A-form and D-form sit in the boxes the user drew them in
(consonants-final/geometry.json); B and C vowels are straight-line shapes read from 元音.pdf.  The whole block is then stretched to
one 汉字 (84 x 84, centred) and outlined with the same rules as the graphemes.
    from syllables import syllable;  svg = syllable('H', 'o', 'u', 'L')     # h o u l
    e has two shapes in each place: B 'T' (⊤) / 'B' (⊥), C 'L' (⊢) / 'R' (⊣):  syllable('N','e','e','N', e_b='B', e_c='R')
"""
import json, os, re, sys
STEM_DEFAULT = 6.0
_argv = sys.argv; sys.argv = sys.argv[:1]
import outline as O, shapes as SH, forms as F
sys.argv = _argv

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
GEOM = json.load(open(os.path.join(ROOT, 'consonants-final', 'geometry.json')))
LO, SIZE = 8.0, 84.0
G1, G2 = 0.13, 0.20          # gap A -> C line, gap C line -> D  (medians measured from 音素.pdf)
XB = 0.82                    # centre of the B column;  C runs from XC0 to XC1
XC0, XC1 = 0.04, 0.96
HALF = 0.12                  # half width of a B / half height of a C vowel bar

def nums(d): return [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
def affine(d, f):
    def g(m):
        v = nums(m.group(2)); out = []
        for i in range(0, len(v), 2): out += list(f(v[i], v[i + 1]))
        return m.group(1) + ' '.join('%.3f' % t for t in out)
    return re.sub(r'([MLC])([^MLC]*)', g, d)

def line(x0, y0, x1, y1): return 'M%.3f %.3fL%.3f %.3f' % (x0, y0, x1, y1)

VHALF = {'i': 0.0, 'a': 0.08, 'u': 0.08, 'o': 0.11, 'e': 0.12}     # half width of each B vowel

def vowel_B(v, hB, e_b='T', XB=XB):
    """strokes of the vertical vowel, centred on x = XB, spanning y 0..hB"""
    h = HALF; y0, y1 = 0.02, hB
    if v == 'i': return [line(XB, y0, XB, y1)]
    if v == 'a': return [line(XB - 0.08, y0, XB - 0.08, y1), line(XB + 0.08, y0, XB + 0.08, y1)]
    if v == 'o': return [line(XB, y0, XB, y1), line(XB - h * .9, y0, XB + h * .9, y0), line(XB - h * .9, y1, XB + h * .9, y1)]
    if v == 'u': return [line(XB - 0.08, y0, XB - 0.08, y1), line(XB + 0.08, y0, XB + 0.08, y1), line(XB - 0.08, (y0 + y1) / 2, XB + 0.08, (y0 + y1) / 2)]
    if v == 'e':
        return [line(XB, y0, XB, y1), line(XB - h, y0, XB + h, y0)] if e_b == 'T' else [line(XB, y0, XB, y1), line(XB - h, y1, XB + h, y1)]
    raise ValueError(v)

def vowel_C(v, yc, e_c='L'):
    """strokes of the horizontal vowel, centred on y = yc, spanning x XC0..XC1"""
    h = HALF; a, b = XC0, XC1
    if v == 'i': return [line(a, yc, b, yc)]
    if v == 'a': return [line(a, yc - 0.08, b, yc - 0.08), line(a, yc + 0.08, b, yc + 0.08)]
    if v == 'o': return [line(a, yc, b, yc), line(a, yc - h * .9, a, yc + h * .9), line(b, yc - h * .9, b, yc + h * .9)]
    if v == 'u': return [line(a, yc - 0.08, b, yc - 0.08), line(a, yc + 0.08, b, yc + 0.08), line((a + b) / 2, yc - 0.08, (a + b) / 2, yc + 0.08)]
    if v == 'e':
        return [line(a, yc, b, yc), line(a, yc - h, a, yc + h)] if e_c == 'L' else [line(a, yc, b, yc), line(b, yc - h, b, yc + h)]
    raise ValueError(v)

import svgstrokes as S
def sample(d, n=10):
    pts = []; cur = None
    for cmd, args in re.findall(r'([MLC])([^MLC]*)', d):
        v = nums(args)
        if cmd in 'ML':
            new = (v[0], v[1])
            if cmd == 'L' and cur: pts += [(cur[0] + (new[0] - cur[0]) * t / n, cur[1] + (new[1] - cur[1]) * t / n) for t in range(n + 1)]
            cur = new; pts.append(cur)
        else:
            for i in range(0, len(v), 6):
                pts += S.bez([cur, (v[i], v[i+1]), (v[i+2], v[i+3]), (v[i+4], v[i+5])], n); cur = (v[i+4], v[i+5])
    return pts

def clearance(strokes, others):
    """smallest distance between the sampled points of `strokes` and of `others`"""
    a = [p for d in strokes for p in sample(d)]; b = [p for d in others for p in sample(d)]
    return min(((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** .5 for p in a for q in b)

def form_paths(table, letter, x, y, w, h):
    return [affine(SH.compile_path(p), lambda px, py: (x + px / 100 * w, y + py / 100 * h)) for p in table[letter]]

def ii_paths(x, w, h):
    """no A: the grapheme ii stands in the A slot, keeping its own proportions, centred in the slot"""
    d = [SH.compile_path(p) for p in SH.SHAPES['ii']]
    pts = [p for q in d for p in sample(q)]; l = min(p[0] for p in pts); r = max(p[0] for p in pts); t = min(p[1] for p in pts); bt = max(p[1] for p in pts)
    sc = min(w / (r - l), h / (bt - t)); ox = x + (w - (r - l) * sc) / 2 - l * sc; oy = (h - (bt - t) * sc) / 2 - t * sc
    return [affine(q, lambda px, py: (px * sc + ox, py * sc + oy)) for q in d]

DEFAULT_A = dict(x=0.01, w=0.61, h=0.67)       # medians measured from 音素.pdf (used when there is no A)

def block_paths(a, vb, vc, d, e_b='auto', e_c='auto', ring_a=False):
    """a / vc / d may be None (missing).  Returns (paths, block height) in block-width units."""
    ga = GEOM[a]['A'] if a else DEFAULT_A
    A = form_paths(F.A, a, ga['x'], 0.0, ga['w'], ga['h']) if a else ii_paths(ga['x'], ga['w'], ga['h'])
    yc = ga['h'] + G1; yD = yc + G2
    gd = GEOM[d]['D'] if d else None
    D = form_paths(F.D, d, gd['x'], yD, gd['w'], gd['h']) if d else []
    if gd: Hh = yD + gd['h']
    else:                                         # no D: stretch what is left to the full 汉字 height (down to the C vowel, or to A / B)
        Hh = yc + 0.11 if vc else max(ga['h'], max(0.45, ga['h'] - 0.08)) + 0.03
    hB = max(0.45, ga['h'] - 0.08)
    xb = max(XB, min(0.90, ga['x'] + ga['w'] + 0.04 + VHALF[vb] + (0.05 if ring_a else 0)))
    rest = A + D
    if vb == 'e' and e_b == 'auto':
        e_b = max('TB', key=lambda k: clearance(vowel_B('e', hB, k, xb), rest))
    B = vowel_B(vb, hB, e_b, xb)
    C = []
    if vc:
        if vc == 'e' and e_c == 'auto':
            e_c = max('LR', key=lambda k: clearance(vowel_C('e', yc, k), rest + B))
        C = vowel_C(vc, yc, e_c)
    return A + B + C + D, Hh, bool(a and vc and d), A, D, yD

def ink_box(polys):
    pts = [tuple(float(v) for v in p.split()) for poly in polys for p in poly[1:-1].split('L')]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

RING_R, RING_W = 5.4, 3.0     # outer radius and stroke of the small circle (box units)

def ring_polys(cx, cy, n=36):
    import math
    ro, ri = RING_R, RING_R - RING_W
    outer = [(cx + ro * math.cos(2 * math.pi * k / n), cy + ro * math.sin(2 * math.pi * k / n)) for k in range(n)]
    inner = [(cx + ri * math.cos(2 * math.pi * k / n), cy + ri * math.sin(2 * math.pi * k / n)) for k in range(n)][::-1]
    return ['M' + 'L'.join('%.2f %.2f' % p for p in q) + 'Z' for q in (outer, inner)]

def top_right(paths, f):
    pts = [f(*p) for d in paths for p in sample(d)]
    return max(p[0] for p in pts), min(p[1] for p in pts)

def tone_polys(tone, x, y, scale=0.75):
    t = open(os.path.join(ROOT, 'tones-final', 't%s.svg' % tone), encoding='utf-8').read()
    out = []
    for poly in re.findall(r'M([^Z]*)Z', t):
        out.append('M' + 'L'.join('%.2f %.2f' % (x + float(a) * scale, y + float(b) * scale) for a, b in (p.split() for p in poly.split('L'))) + 'Z')
    return out

def syllable(a, vb, vc, d, e_b='auto', e_c='auto', stem=STEM_DEFAULT, ring_a=False, ring_d=False, tone=None):
    paths, Hh, complete, A, D, yD = block_paths(a, vb, vc, d, e_b, e_c, ring_a and bool(a))
    f = lambda x, y: (LO + x * SIZE, LO + y / Hh * SIZE)
    O.W = stem; polys = []
    for p in paths: polys += O.stroke_outline(affine(p, f))
    if ring_a and a:
        r, t = top_right(A, f); polys += ring_polys(r + 3.0, t + RING_R - 1.0)
    if ring_d and d:
        r, t = top_right(D, f); polys += ring_polys(r + 3.0, t + RING_R - 1.0)
    if not complete:                                  # something is missing: keep the scale, recentre the ink on the 汉字 centre
        l, t, r, b = ink_box(polys); dx, dy = 50 - (l + r) / 2, 50 - (t + b) / 2
        polys = [re.sub(r'(-?\d+\.?\d*) (-?\d+\.?\d*)', lambda m: '%.2f %.2f' % (float(m.group(1)) + dx, float(m.group(2)) + dy), q) for q in polys]
    if tone: polys += tone_polys(tone, 86, 2)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g fill="currentColor" stroke="none" fill-rule="nonzero">\n<path d="%s"/>\n</g>\n</svg>\n' % ''.join(polys)

V = 'aeiou'
def parse_syllable(text):
    """romanised syllable -> kwargs for syllable().  [initial][vowel(s)][final];  ° (ring) rules follow the 入门单元:
       ring on a consonant = + s (ts), on A: s/c/z -> sh/ch/zh ; on D: n -> ng, s -> st."""
    s = text.lower(); i = 0; init = ''; vow = ''
    while i < len(s) and s[i] not in V: init += s[i]; i += 1
    while i < len(s) and s[i] in V: vow += s[i]; i += 1
    fin = s[i:]
    bad = ValueError('cannot read syllable %r' % text)
    if not vow or not s.isalpha(): raise bad
    kw = dict(a=None, vb=vow[0], vc=None, d=None, ring_a=False, ring_d=False)
    if init:
        if len(init) == 1: kw['a'] = init.upper()
        elif init in ('sh', 'ch', 'zh'): kw['a'] = init[0].upper(); kw['ring_a'] = True
        elif len(init) == 2 and init[1] == 's' and init[0] not in 'scz': kw['a'] = init[0].upper(); kw['ring_a'] = True
        else: raise bad
    if len(vow) == 2: kw['vc'] = vow[1]
    elif len(vow) > 2: raise bad
    if fin:
        if len(fin) == 1: kw['d'] = fin.upper()
        elif fin == 'ng': kw['d'] = 'N'; kw['ring_d'] = True
        elif fin == 'st': kw['d'] = 'S'; kw['ring_d'] = True
        elif len(fin) == 2 and fin[1] == 's': kw['d'] = fin[0].upper(); kw['ring_d'] = True
        else: raise bad
    for k in ('a', 'd'):
        if kw[k] and kw[k] not in GEOM: raise bad
    return kw

def syllable_svg(text, tone=None, **extra):
    return syllable(tone=tone, **parse_syllable(text), **extra)

def inner(svg): return re.search(r'<g\b.*?</g>', svg, re.S).group(0)

if __name__ == '__main__':
    words = ['houl', 'ma', 'tas', 'jian', 'su', 'kun', 'liang', 'shao', 'xing', 'moist', 'oits', 'tsao',
             'an', 'a', 'in', 'e', 'ma1', 'neen', 'chang', 'zhi']
    cells = []
    for w in words:
        tone = None
        if w[-1].isdigit(): w, tone = w[:-1], w[-1]
        svg = syllable_svg(w, tone=tone)
        open(os.path.join(ROOT, 'consonants-final', 'blocks', w + '.svg'), 'w', encoding='utf-8').write(svg)
        cells.append('<div class=c><b>%s</b><svg viewBox="-10 -10 120 120"><path d="M0 50H100M50 0V100" stroke="#eef" fill="none"/>%s</svg></div>' % (w + (tone or ''), inner(svg)))
    open(os.path.join(ROOT, 'consonants-final', 'syllables.html'), 'w', encoding='utf-8').write(
        '<!doctype html><meta charset=utf-8><style>body{margin:10px;font:12px sans-serif;background:#fff}.c{display:inline-block;width:160px;margin:4px;border:1px solid #ddd;position:relative}'
        'svg{width:160px;height:160px;display:block}svg g{fill:#111}b{position:absolute;left:4px;top:2px;color:#08c}</style>' + ''.join(cells))
    print('ok')
