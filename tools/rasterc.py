"""Overlay check: new outline (black) over the old one (light grey).  python3 rasterc.py out.png cols cell newdir olddir names..."""
import os, re, sys
from PIL import Image, ImageDraw
out, cols, cell, new, old = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
names = sys.argv[6:]
SS = 3; rows = (len(names) + cols - 1) // cols
img = Image.new('L', (cols * cell * SS, rows * cell * SS), 255); dr = ImageDraw.Draw(img)
def polys(path):
    t = open(path, encoding='utf-8').read()
    return [[tuple(float(v) for v in p.split()) for p in poly.split('L')] for poly in re.findall(r'M([^Z]*)Z', t)]
for i, n in enumerate(names):
    ox, oy = (i % cols) * cell * SS, (i // cols) * cell * SS; sc = cell * SS / 100
    dr.rectangle([ox, oy, ox + cell * SS - 1, oy + cell * SS - 1], outline=200)
    for d, fill in ((old, 205), (new, 0)):
        p = os.path.join(d, n + '.svg')
        if os.path.exists(p):
            for poly in polys(p): dr.polygon([(ox + x * sc, oy + y * sc) for x, y in poly], fill=fill)
    dr.text((ox + 4, oy + 2), n, fill=120)
img.resize((cols * cell, rows * cell), Image.LANCZOS).save(out)
