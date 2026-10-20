"""Enlarged view of the hand-written A / D forms in their own bbox (0..100 %) for reading coordinates.
python3 formsheet.py A|D out_prefix"""
import json, sys
from PIL import Image, ImageDraw
raw = json.load(open('../resources/consonants/raw.json')); kind = sys.argv[1]; pre = sys.argv[2]
letters = list(raw)
def sheet(ls, name):
    cw = ch = 330; cols = 3; rows = (len(ls) + cols - 1) // cols
    img = Image.new('RGB', (cols * cw, rows * ch), 'white'); dr = ImageDraw.Draw(img)
    for i, l in enumerate(ls):
        ox, oy = (i % cols) * cw, (i // cols) * ch; ss = raw[l][kind]
        xs = [p[0] for s in ss for p in s]; ys = [p[1] for s in ss for p in s]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys); w, h = x1 - x0, y1 - y0
        sc = min(250 / w, 250 / h); W, H = w * sc, h * sc; bx, by = ox + 40, oy + 36
        for g in range(0, 101, 10):
            dr.line([(bx + g / 100 * W, by), (bx + g / 100 * W, by + H)], fill=(200, 200, 255)); dr.text((bx + g / 100 * W - 6, by + H + 3), str(g), fill=(90, 90, 200))
            dr.line([(bx, by + g / 100 * H), (bx + W, by + g / 100 * H)], fill=(200, 200, 255)); dr.text((bx - 24, by + g / 100 * H - 5), str(g), fill=(90, 90, 200))
        for k, s in enumerate(ss):
            pts = [(bx + (x - x0) * sc, by + (y - y0) * sc) for x, y in s]
            dr.line(pts, fill=(0, 0, 0), width=2)
            dr.ellipse([pts[0][0] - 4, pts[0][1] - 4, pts[0][0] + 4, pts[0][1] + 4], outline=(0, 160, 0))   # green = pen down
        dr.text((ox + 4, oy + 4), '%s-%s  w:h = %.2f' % (kind, l, w / h), fill=(200, 0, 0))
    img.save(name)
for n in range(0, 21, 6): sheet(letters[n:n + 6], '%s%d.png' % (pre, n // 6 + 1))
