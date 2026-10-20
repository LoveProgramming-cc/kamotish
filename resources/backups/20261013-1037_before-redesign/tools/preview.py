"""Render a contact sheet (../preview.png) of all glyphs and the tone marks overlaid on sample glyphs."""
import json, os
from PIL import Image, ImageDraw
import svgstrokes as S
import make_glyphs as M

K = 4  # supersample
def draw(dr, segs, ox, oy, sc):
    for g in segs:
        pts = S.bez(g['pts'])
        r = g['w'] * sc / 2
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            dr.line([(ox + x0 * sc, oy + y0 * sc), (ox + x1 * sc, oy + y1 * sc)], fill='black', width=max(1, int(2 * r)))
        for x, y in (pts[0], pts[-1]):
            dr.ellipse([ox + x * sc - r, oy + y * sc - r, ox + x * sc + r, oy + y * sc + r], fill='black')

def load(path):
    import re
    t = open(path).read()
    return S_parse_out(t)

def S_parse_out(t):
    import re
    segs = []
    for w, d in re.findall(r'stroke-width="([\d.]+)" d="([^"]+)"', t):
        n = [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
        segs.append({'w': float(w), 'pts': list(zip(n[0::2], n[1::2]))})
    return segs

cell, cols = 150, 8
meta = json.load(open(os.path.join(M.OUT, 'tones', 'tones.json')))
n = 31 + 4
rows = (n + cols - 1) // cols
img = Image.new('RGB', (cols * cell, rows * cell), 'white'); dr = ImageDraw.Draw(img)
sc = (cell - 20) / 100
for i in range(31):
    ox, oy = (i % cols) * cell + 10, (i // cols) * cell + 10
    dr.rectangle([ox, oy, ox + 100 * sc, oy + 100 * sc], outline=(255, 120, 120))
    draw(dr, load(os.path.join(M.OUT, 'glyphs', '%02d.svg' % (i + 1))), ox, oy, sc)
    dr.text((ox + 2, oy + 2), str(i + 1), fill=(0, 0, 255))
# tones on glyph 7, 13, 18, 4 (tall/narrow/wide mix)
for k, gi in enumerate([7, 13, 4, 18]):
    i = 31 + k
    ox, oy = (i % cols) * cell + 10, (i // cols) * cell + 10
    dr.rectangle([ox, oy, ox + 100 * sc, oy + 100 * sc], outline=(255, 120, 120))
    g = load(os.path.join(M.OUT, 'glyphs', '%02d.svg' % gi)); draw(dr, g, ox, oy, sc)
    l, t, r, b = S.bbox(g); H = b - t
    tn = load(os.path.join(M.OUT, 'tones', 't%d.svg' % (k + 1)))
    draw(dr, tn, ox + (r + meta['dx_per_H'] * H) * sc, oy + (t + meta['dy_per_H'] * H) * sc, sc)
img.save(os.path.join(M.OUT, 'preview.png')); print(img.size)
