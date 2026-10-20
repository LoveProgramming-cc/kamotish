"""Centre-line check: python3 rastercl.py out.png cols cell dir names...  (draws paths + anchor dots)"""
import os, re, sys
from PIL import Image, ImageDraw
import svgstrokes as S
out, cols, cell, d = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
names = sys.argv[5:]
rows = (len(names) + cols - 1) // cols
img = Image.new('RGB', (cols * cell, rows * cell), 'white'); dr = ImageDraw.Draw(img); sc = cell / 100
for i, n in enumerate(names):
    t = open(os.path.join(d, n + '.svg'), encoding='utf-8').read()
    ox, oy = (i % cols) * cell, (i // cols) * cell
    dr.rectangle([ox, oy, ox + cell - 1, oy + cell - 1], outline=(180, 180, 180))
    for g in range(10, 100, 10):
        col = (200, 200, 255) if g != 50 else (150, 150, 255)
        dr.line([(ox + g * sc, oy), (ox + g * sc, oy + cell)], fill=col); dr.line([(ox, oy + g * sc), (ox + cell, oy + g * sc)], fill=col)
    dr.rectangle([ox + 8 * sc, oy + 8 * sc, ox + 92 * sc, oy + 92 * sc], outline=(255, 190, 190))
    for g in range(10, 100, 10):
        dr.text((ox + g * sc + 1, oy + 1), str(g), fill=(90, 90, 200)); dr.text((ox + 1, oy + g * sc + 1), str(g), fill=(90, 90, 200))
    for dd in re.findall(r'<path d="([^"]+)"', t):
        cur = None
        for cmd, args in re.findall(r'([MLC])([^MLC]*)', dd):
            v = [float(x) for x in args.split()]
            if cmd == 'M': cur = (v[0], v[1])
            elif cmd == 'L':
                dr.line([(ox + cur[0] * sc, oy + cur[1] * sc), (ox + v[0] * sc, oy + v[1] * sc)], fill=(0, 0, 0), width=2); cur = (v[0], v[1])
            else:
                for k in range(0, len(v), 6):
                    pts = S.bez([cur, (v[k], v[k+1]), (v[k+2], v[k+3]), (v[k+4], v[k+5])], 30)
                    dr.line([(ox + x * sc, oy + y * sc) for x, y in pts], fill=(200, 0, 0), width=2)
                    cur = (v[k+4], v[k+5])
                    r = 3; dr.ellipse([ox + cur[0] * sc - r, oy + cur[1] * sc - r, ox + cur[0] * sc + r, oy + cur[1] * sc + r], fill=(0, 0, 255))
    dr.text((ox + 3, oy + 2), n, fill=(120, 120, 120))
img.save(out)
