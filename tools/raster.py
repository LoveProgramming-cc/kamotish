"""Rasterise outline SVGs (our own M/L/Z polygon paths) to a PNG contact sheet for quick checking.
Usage: python3 raster.py out.png cols cell dir [names...]"""
import glob, os, re, sys
from PIL import Image, ImageDraw
out, cols, cell, d = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
names = sys.argv[5:] or sorted(os.path.basename(f)[:-4] for f in glob.glob(os.path.join(d, '*.svg')))
SS = 3; rows = (len(names) + cols - 1) // cols
img = Image.new('L', (cols * cell * SS, rows * cell * SS), 255); dr = ImageDraw.Draw(img)
for i, n in enumerate(names):
    t = open(os.path.join(d, n + '.svg'), encoding='utf-8').read()
    ox, oy = (i % cols) * cell * SS, (i // cols) * cell * SS; sc = cell * SS / 100
    dr.rectangle([ox, oy, ox + cell * SS - 1, oy + cell * SS - 1], outline=225)
    for poly in re.findall(r'M([^Z]*)Z', t):
        pts = [tuple(float(v) for v in p.split()) for p in poly.split('L')]
        dr.polygon([(ox + x * sc, oy + y * sc) for x, y in pts], fill=0)
    dr.text((ox + 4, oy + 2), n, fill=150)
img.resize((cols * cell, rows * cell), Image.LANCZOS).save(out); print(out)
