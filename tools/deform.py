"""Deform the hand-written A-forms and D-forms (consonants/raw.json) into the standard block layout.

Block layout (units of the block width W; medians measured from 音素.pdf):
    A slot  x 0.00-0.64  y 0.00-0.67        B (vertical vowel)  x ~0.88
    C line  y ~0.78                          D slot  x 0.07-0.97  y 0.98-1.45     block height = 1.45 W
The block is 84 high in the 100 box (y 8..92) and centred; W = 84/1.45.
Each form is scaled into its slot (sx, sy independently, but the stretch ratio sx/sy is kept within 0.7..1.4), centred in the slot.
Usage: python3 deform.py   ->  ../consonants/A/X.svg, ../consonants/D/X.svg (skeleton polylines, 100 box), ../consonants/block_preview.html
"""
import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'consonants')
HB = 1.45
W = 84.0 / HB
X0, Y0 = 50 - W / 2, 8.0
SLOT = {'A': (0.00, 0.00, 0.64, 0.67), 'D': (0.07, 0.98, 0.97, 1.45)}      # u0 v0 u1 v1
B_BAR = (0.88, 0.0, 0.88, 0.60)
C_BAR = (0.0, 0.78, 1.0, 0.78)
RATIO = (0.7, 1.4)

def em(u, v): return X0 + u * W, Y0 + v * W

def bbox(strokes):
    xs = [p[0] for s in strokes for p in s]; ys = [p[1] for s in strokes for p in s]
    return min(xs), min(ys), max(xs), max(ys)

def fit(strokes, slot):
    l, t, r, b = bbox(strokes); w, h = max(r - l, 1e-6), max(b - t, 1e-6)
    (ax, ay), (bx, by) = em(slot[0], slot[1]), em(slot[2], slot[3])
    sw, sh = bx - ax, by - ay
    sx, sy = sw / w, sh / h
    if sx / sy > RATIO[1]: sx = RATIO[1] * sy
    elif sx / sy < RATIO[0]: sy = sx / RATIO[0]
    ox = ax + (sw - w * sx) / 2 - l * sx; oy = ay + (sh - h * sy) / 2 - t * sy
    return [[(x * sx + ox, y * sy + oy) for x, y in s] for s in strokes], (sx, sy)

def svg(strokes, extra=''):
    body = ''.join('<path d="M%s"/>' % 'L'.join('%.2f %.2f' % p for p in s) for s in strokes)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">%s</g>%s</svg>' % (body, extra))

def vowels_svg():
    (a, b), (c, d) = em(*B_BAR[:2]), em(*B_BAR[2:]); (e, f), (g, h) = em(*C_BAR[:2]), em(*C_BAR[2:])
    return ('<g fill="none" stroke="#e33" stroke-width="3" stroke-linecap="round"><path d="M%.2f %.2fL%.2f %.2f"/><path d="M%.2f %.2fL%.2f %.2f"/></g>' % (a, b, c, d, e, f, g, h))

if __name__ == '__main__':
    raw = json.load(open(os.path.join(ROOT, 'raw.json')))
    for k in 'AD': os.makedirs(os.path.join(ROOT, k), exist_ok=True)
    cells = []
    for L, v in raw.items():
        A, sa = fit(v['A'], SLOT['A']); D, sd = fit(v['D'], SLOT['D'])
        open(os.path.join(ROOT, 'A', L + '.svg'), 'w').write(svg(A) + '\n')
        open(os.path.join(ROOT, 'D', L + '.svg'), 'w').write(svg(D) + '\n')
        both = svg(A + D, vowels_svg())
        cells.append('<div class=c><b>%s</b>%s<small>A %.1f×%.1f  D %.1f×%.1f</small></div>' % (L, both, sa[0], sa[1], sd[0], sd[1]))
    open(os.path.join(ROOT, 'block_preview.html'), 'w', encoding='utf-8').write(
        '<!doctype html><meta charset=utf-8><style>body{margin:10px;font:12px sans-serif;background:#fff}.c{display:inline-block;width:170px;margin:4px;border:1px solid #ddd;text-align:center}'
        'svg{width:170px;height:170px;display:block}b{float:left;margin:3px}small{color:#888}</style>' + ''.join(cells))
    print('ok')
