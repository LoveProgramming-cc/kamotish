"""PNG preview of a Kamotish text file (same markup as render.py).  python3 rasterdoc.py in.txt out.png [size]"""
import os, re, sys
from PIL import Image, ImageDraw, ImageFont
import render as R

src, dst = sys.argv[1], sys.argv[2]; SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 64
SS = 3; PAD = 40; LINEH = int(SIZE * 1.5); MARGIN = int(SIZE * 0.1); WIDTH = 1500
font = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', SIZE * SS, index=2)
def polys(path):
    t = open(path, encoding='utf-8').read()
    return [[tuple(float(v) for v in p.split()) for p in poly.split('L')] for poly in re.findall(r'M([^Z]*)Z', t)]
lines = []
for block in open(src, encoding='utf-8').read().split('\n\n'):
    for l in block.strip().split('\n'):
        lines.append(l[2:] if l.startswith('# ') else l)
img = Image.new('L', (WIDTH * SS, (PAD * 2 + LINEH * len(lines)) * SS), 255); dr = ImageDraw.Draw(img)
for ln, line in enumerate(lines):
    x = PAD * SS; y = (PAD + ln * LINEH) * SS; pos = 0
    def text(s):
        global x
        for ch in s:
            dr.text((x, y - int(SIZE * 0.05 * SS)), ch, font=font, fill=30); x += font.getlength(ch)
    for m in R.TOK.finditer(line):
        text(line[pos:m.start()]); pos = m.end()
        name, tone = m.group(1), m.group(2)
        f = os.path.join(R.sdir('glyphs'), name + '.svg')
        sc = SIZE * SS / 100; x += MARGIN * SS
        for poly in polys(f): dr.polygon([(x + px * sc, y + py * sc + SIZE * SS * 0.08) for px, py in poly], fill=30)
        if tone:
            l, t, r, b = R.poly_bbox(f); H = b - t
            ox = x + (r + R.TONES['dx_per_H'] * H) * sc; oy = y + (t + R.TONES['dy_per_H'] * H) * sc + SIZE * SS * 0.08
            for poly in polys(os.path.join(R.sdir('tones'), 't%s.svg' % tone)): dr.polygon([(ox + px * sc, oy + py * sc) for px, py in poly], fill=30)
        x += SIZE * SS + MARGIN * SS
    text(line[pos:])
img.resize((WIDTH, img.size[1] // SS), Image.LANCZOS).save(dst)
