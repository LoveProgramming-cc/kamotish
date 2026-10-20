"""Overlay: user's hand strokes (grey) vs the constructed skeleton (red), both in the form's own 0..100 frame.
python3 formcheck.py A|D out.png [letters]"""
import json, sys
from PIL import Image, ImageDraw
import forms as F, shapes as SH, svgstrokes as S
kind, out = sys.argv[1], sys.argv[2]
raw = json.load(open('../resources/consonants/raw.json')); letters = list(sys.argv[3]) if len(sys.argv) > 3 else list(raw)
table = F.A if kind == 'A' else F.D
cell = 300; cols = 4; rows = (len(letters) + cols - 1) // cols
img = Image.new('RGB', (cols * cell, rows * cell), 'white'); dr = ImageDraw.Draw(img)
def pts_of(d):
    import re
    cur = None; out = []
    for cmd, args in re.findall(r'([MLC])([^MLC]*)', d):
        v = [float(x) for x in args.split()]
        if cmd in 'ML': cur = (v[0], v[1]); out.append([cur]) if cmd == 'M' else out[-1].append(cur)
        else:
            for i in range(0, len(v), 6):
                out[-1] += S.bez([cur, (v[i], v[i+1]), (v[i+2], v[i+3]), (v[i+4], v[i+5])], 16)[1:]; cur = (v[i+4], v[i+5])
    return out
for i, L in enumerate(letters):
    ox, oy = (i % cols) * cell, (i // cols) * cell
    ss = raw[L][kind]; xs = [p[0] for s in ss for p in s]; ys = [p[1] for s in ss for p in s]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys); w, h = x1 - x0, y1 - y0
    sc = min(230 / w, 230 / h); W, H = w * sc, h * sc; bx, by = ox + 35, oy + 30
    for s in ss: dr.line([(bx + (x - x0) * sc, by + (y - y0) * sc) for x, y in s], fill=(170, 170, 170), width=3)
    for d in [SH.compile_path(p) for p in table[L]]:
        for poly in pts_of(d): dr.line([(bx + x / 100 * W, by + y / 100 * H) for x, y in poly], fill=(220, 0, 0), width=2)
    dr.rectangle([bx, by, bx + W, by + H], outline=(210, 210, 255)); dr.text((ox + 4, oy + 4), '%s-%s' % (kind, L), fill=(0, 0, 200))
img.save(out)
