"""Hand-constructed skeletons (centre lines) for every grapheme, in the 100x100 box (ink box 6..94 with stroke 8).

Mini path language (absolute coordinates, space separated):
  M x y | L x y | H x | V y | C x1 y1 x2 y2 x y
  U x y   quarter ellipse, start tangent horizontal -> end tangent vertical
  N x y   quarter ellipse, start tangent vertical   -> end tangent horizontal
Design rules: horizontals are exactly horizontal, verticals exactly vertical, curves are quarter ellipses
(or cubics whose handles are horizontal/vertical at the extrema), one skeleton per shape; aliases share a skeleton.
Usage: python3 shapes.py   -> ../glyphs-shape/NAME.svg
"""
import os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
K = 0.5523

def compile_path(s):
    t = s.split(); i = 0; out = []; cur = (0.0, 0.0)
    def num(): nonlocal i; v = float(t[i]); i += 1; return v
    while i < len(t):
        c = t[i]; i += 1
        if c == 'M': cur = (num(), num()); out.append('M%.2f %.2f' % cur)
        elif c == 'L': cur = (num(), num()); out.append('L%.2f %.2f' % cur)
        elif c == 'H': cur = (num(), cur[1]); out.append('L%.2f %.2f' % cur)
        elif c == 'V': cur = (cur[0], num()); out.append('L%.2f %.2f' % cur)
        elif c == 'C':
            v = [num() for _ in range(6)]; out.append('C%.2f %.2f %.2f %.2f %.2f %.2f' % tuple(v)); cur = (v[4], v[5])
        elif c in 'UN':
            x, y = num(), num(); x0, y0 = cur
            if c == 'U': c1, c2 = (x0 + K * (x - x0), y0), (x, y - K * (y - y0))
            else: c1, c2 = (x0, y0 + K * (y - y0)), (x - K * (x - x0), y)
            out.append('C%.2f %.2f %.2f %.2f %.2f %.2f' % (*c1, *c2, x, y)); cur = (x, y)
        else: raise ValueError(c)
    return ''.join(out)

SHAPES = {
 # name: [strokes]
 'a':   ['M 16 32 H 84', 'M 52 10 V 58 C 52 78 62 88 76 88 C 82 88 87 85 90 80',
         'M 52 56 U 20 72 N 38 90 U 52 76 V 62', 'M 74 57 H 86'],
 'bi':  ['M 34 16 H 70 C 70 32 36 56 10 70', 'M 22 36 L 90 57', 'M 24 84 H 78'],
 'bou': ['M 14 32 H 74', 'M 38 10 V 90',
         'M 22 48 C 42 48 54 62 64 80 C 68 88 76 92 90 90',
         'M 22 48 U 8 62 N 30 90 U 52 72 V 58', 'M 64 46 C 64 54 62 62 58 68'],
 'chi': ['M 58 20 C 54 14 48 10 42 10 U 10 58 N 30 90 C 48 90 64 82 70 62', 'M 60 48 L 90 90'],
 'e':   ['M 8 47 C 20 49 36 50 50 50 U 82 32 N 56 10 U 24 40 N 56 90 C 70 90 82 88 90 82'],
 'ga':  ['M 22 28 H 78', 'M 52 10 L 66 56',
         'M 66 56 C 58 56 50 50 42 50 U 24 66 N 46 90 C 60 90 74 88 84 82'],
 'ha':  ['M 10 26 C 8 44 10 62 18 74', 'M 36 10 C 33 26 32 38 32 52 N 62 90 C 74 90 84 88 90 86',
         'M 18 30 H 62 U 68 36 V 58'],
 'hou': ['M 22 10 V 90', 'M 32 44 H 42 U 52 54 V 66 N 62 90 C 70 90 76 88 84 82'],
 'hou2':['M 10 82 C 26 76 40 54 43 14 L 46 74 C 50 56 58 34 64 20 L 77 74', 'M 16 54 H 90'],
 'i':   ['M 26 10 V 70 N 56 90 H 72', 'M 72 74 V 90'],
 'ii':  ['M 10 48 C 15 56 22 64 30 67', 'M 56 28 U 90 68'],
 'ka':  ['M 16 18 H 64', 'M 16 48 H 40 C 40 66 28 76 10 84', 'M 52 54 C 66 62 78 72 90 74'],
 'kou': ['M 10 16 L 14 84', 'M 32 28 H 90',
         'M 54 14 C 58 30 60 44 60 56 N 48 78 U 34 64 N 48 54 C 64 54 80 58 90 72'],
 'ku':  ['M 58 10 L 32 50 L 62 90'],
 'le':  ['M 22 30 V 66', 'M 50 10 V 90', 'M 30 46 C 42 36 52 30 62 30 U 76 42 N 62 60'],
 'lou': ['M 38 10 V 46', 'M 38 32 L 62 24 C 64 32 64 42 64 52 N 38 90'],
 'mou': ['M 38 22 H 56', 'M 22 42 H 76',
         'M 52 10 V 46 N 38 66 U 30 58 N 42 52 U 54 64 C 54 76 50 84 38 90'],
 'mou2':['M 10 62 C 36 58 64 56 90 54', 'M 24 82 L 44 22',
         'M 44 36 C 48 30 52 28 58 28 U 70 44 N 54 72 U 44 54 V 34'],
 'no':  ['M 56 10 U 76 28 C 76 54 54 76 22 90'],
 'ou':  ['M 20 30 H 78', 'M 38 10 V 26 C 38 52 24 72 10 86', 'M 48 52 H 72',
         'M 38 70 N 58 90 C 70 90 82 88 90 86'],
 'pou': ['M 62 20 C 58 13 52 10 46 10 U 28 28 N 46 38 C 54 38 60 34 64 28', 'M 64 28 V 90'],
 'sei': ['M 10 44 L 90 32', 'M 62 10 V 58', 'M 31 18 V 56 N 60 90 C 70 90 78 86 86 80'],
 'shi': ['M 10 46 L 74 35 U 90 60 N 62 90 H 52', 'M 44 10 C 44 40 36 70 22 90'],
 "te": ['M 10 18 H 70', 'M 68 16 C 52 24 40 38 40 54 N 72 86 C 80 86 86 85 90 82',
         'M 78 30 L 88 36', 'M 70 42 L 80 52'],
 'tou': ['M 50 10 V 20', 'M 28 44 C 40 42 50 40 60 40 U 72 50 C 72 68 52 82 28 90'],
 'wou': ['M 10 24 V 52 N 22 76 C 36 76 49 58 49 34 N 43 26 U 37 34 V 52 N 51 76 C 66 76 79 58 79 34 N 73 26 U 67 34 V 52 N 82 76 H 90'],
 'wu':  ['M 28 14 V 52 N 45 70 U 62 52 V 14', 'M 10 90 H 90'],
 'xi':  ['M 10 60 L 38 38 L 90 62'],
 'yu':  ['M 32 10 L 46 36 L 60 10', 'M 32 46 L 46 68 L 60 46', 'M 16 90 H 76'],
 'zhi': ['M 10 10 H 68 C 68 30 40 60 10 90', 'M 10 90 H 90', 'M 28 32 L 68 66'],
}
TONES = {   # drawn in their own box, top-left at (0,0); stroke 5
 't1': ['M 3 3 L 11 16'],
 't2': ['M 3 3 L 9 14', 'M 17 3 L 23 14'],
 't3': ['M 3 3 L 14 16 L 25 3'],
 't4': ['M 3 14 C 3 28 25 28 25 14', 'M 14 2 V 6'],
}
ALIASES = {'mi': 'hou2', 'ri': 'mou2', 'sou': 'le'}   # same shape, different reading

def write_all(outdir=None):
    outdir = outdir or os.path.join(ROOT, 'glyphs-shape'); os.makedirs(outdir, exist_ok=True)
    names = dict(SHAPES); names.update({a: SHAPES[b] for a, b in ALIASES.items()})
    for n, strokes in names.items():
        body = '\n'.join('<path d="%s"/>' % compile_path(s) for s in strokes)
        open(os.path.join(outdir, n + '.svg'), 'w', encoding='utf-8').write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3">\n%s\n</g>\n</svg>\n' % body)
    tdir = os.path.join(ROOT, 'tones-shape'); os.makedirs(tdir, exist_ok=True)
    for n, strokes in TONES.items():
        body = '\n'.join('<path d="%s"/>' % compile_path(x) for x in strokes)
        open(os.path.join(tdir, n + '.svg'), 'w', encoding='utf-8').write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">\n<g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3">\n%s\n</g>\n</svg>\n' % body)
    return sorted(names)

if __name__ == '__main__':
    print(len(write_all()), 'shapes')
