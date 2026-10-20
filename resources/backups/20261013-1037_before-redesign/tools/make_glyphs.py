"""Trace the hand-written 31 graphemes + 4 tone marks from the vector PDF into normalised SVGs.

Box: 100x100 = one 汉字. Glyph is uniformly scaled to fit the 92x92 inner area (height-equal;
width-limited when wider than tall) and centred. Pen width is normalised to PEN.
Usage: python3 make_glyphs.py            -> ../glyphs/NN.svg, ../tones/tN.svg, ../tones/tones.json
"""
import json, os, statistics as st, sys
import svgstrokes as S

PDF = '/home/koen/Desktop/基本55音.pdf'
BOX, INNER, PEN = 100.0, 92.0, 6.0
SRC_PEN = 2.25            # mean pen width of the source strokes (pt)
TONE_REF_H = 30.0         # typical glyph height in 音调实例.pdf (pt) -> tone mark scale
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

def path_d(pts):
    if len(pts) == 2:
        return 'M%.2f %.2fL%.2f %.2f' % (*pts[0], *pts[1])
    return 'M%.2f %.2fC%.2f %.2f %.2f %.2f %.2f %.2f' % tuple(v for p in pts for v in p)

def transform(segs, s, ox, oy):
    return [{'w': g['w'] / SRC_PEN * PEN, 'pts': [(x * s + ox, y * s + oy) for x, y in g['pts']]} for g in segs]

def svg(segs, vb):
    body = '\n'.join('<path stroke-width="%.2f" d="%s"/>' % (g['w'], path_d(g['pts'])) for g in segs)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s">\n'
            '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">\n%s\n</g>\n</svg>\n'
            % (vb, body))

def glyph_in_box(segs):
    """Return (placed segs, (l,t,r,b) of the glyph in the 100 box)."""
    l, t, r, b = S.bbox(segs)
    w, h = r - l, b - t
    s = min(INNER / h, INNER / w)
    ox = (BOX - w * s) / 2 - l * s
    oy = (BOX - INNER) / 2 - t * s if INNER / h <= INNER / w else (BOX - h * s) / 2 - t * s
    placed = transform(segs, s, ox, oy)
    return placed, S.bbox(placed)

def main():
    os.makedirs(os.path.join(OUT, 'glyphs'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'tones'), exist_ok=True)
    for p in range(1, 32):
        placed, _ = glyph_in_box(S.parse(S.page_svg(PDF, p)))
        open(os.path.join(OUT, 'glyphs', '%02d.svg' % p), 'w').write(svg(placed, '0 0 100 100'))
    s_tone = INNER / TONE_REF_H
    meta = {'scale': s_tone, 'dx_per_H': -0.05, 'dy_per_H': -0.03,
            'note': 'mark top-left = glyph (right + dx_per_H*H, top + dy_per_H*H); H = glyph height in the 100 box'}
    for i, p in enumerate(range(32, 36), 1):
        segs = S.parse(S.page_svg(PDF, p))
        l, t, r, b = S.bbox(segs)
        placed = transform(segs, s_tone, -l * s_tone, -t * s_tone)   # top-left at origin
        w, h = (r - l) * s_tone, (b - t) * s_tone
        open(os.path.join(OUT, 'tones', 't%d.svg' % i), 'w').write(svg(placed, '0 0 %.2f %.2f' % (w, h)))
        meta['t%d' % i] = {'w': round(w, 2), 'h': round(h, 2)}
    json.dump(meta, open(os.path.join(OUT, 'tones', 'tones.json'), 'w'), indent=1)

if __name__ == '__main__':
    main()
