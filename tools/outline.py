"""Build filled outlines (a real glyph shape, not a stroked line) from the centre-line SVGs in glyphs-print/ and tones-print/.

Design rules: horizontal strokes are thinner than vertical ones (CONTRAST), stroke ends are cut flat on a
horizontal or vertical line (like a 黑体 terminal), corners get a mitre join.
Usage: python3 outline.py [stem_width] [contrast]   -> glyphs-outline/, tones-outline/
"""
import glob, math, os, re, sys
import svgstrokes as S

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
W = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0      # vertical stem width
K = float(sys.argv[2]) if len(sys.argv) > 2 else 0.16     # horizontal strokes are K thinner
CORNER = 25.0                                              # deg: tangent break that starts a new piece
MITRE_LIMIT = 2.6

def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

def parse_d(d):
    """M/L/C path (absolute) -> list of dense sub-polylines split at tangent breaks."""
    toks = re.findall(r'([MLC])([^MLC]*)', d)
    cur = None; segs = []
    for cmd, args in toks:
        n = [float(v) for v in args.replace(',', ' ').split()]
        if cmd == 'M': cur = (n[0], n[1])
        elif cmd == 'L':
            segs.append([cur, (n[0], n[1])]); cur = (n[0], n[1])
        else:
            for i in range(0, len(n), 6):
                segs.append(S.bez([cur, (n[i], n[i+1]), (n[i+2], n[i+3]), (n[i+4], n[i+5])], 24)); cur = (n[i+4], n[i+5])
    # dense-sample straight segments too
    dense = []
    for sg in segs:
        pts = [sg[0]]
        if len(sg) == 2:
            L = dist(sg[0], sg[1]); k = max(1, int(L / 0.8))
            pts = [(sg[0][0] + (sg[1][0] - sg[0][0]) * i / k, sg[0][1] + (sg[1][1] - sg[0][1]) * i / k) for i in range(k + 1)]
        else: pts = sg
        dense.append(pts)
    def tan_out(p): return math.atan2(p[-1][1] - p[-2][1], p[-1][0] - p[-2][0])
    def tan_in(p): return math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0])
    pieces = [list(dense[0])]
    for prev, nxt in zip(dense, dense[1:]):
        a = math.degrees(tan_in(nxt) - tan_out(prev)); a = abs((a + 180) % 360 - 180)
        if a > CORNER: pieces.append(list(nxt))
        else: pieces[-1] += nxt[1:]
    return pieces

def tangents(pts):
    out = []
    for i in range(len(pts)):
        a = pts[max(0, i - 2)]; b = pts[min(len(pts) - 1, i + 2)]
        d = dist(a, b) or 1
        out.append(((b[0] - a[0]) / d, (b[1] - a[1]) / d))
    return out

def width_at(t): return W * (1 - K * abs(t[0]))

def offsets(pts, ts):
    L, R = [], []
    for p, t in zip(pts, ts):
        w = width_at(t) / 2; n = (-t[1], t[0])
        L.append((p[0] + n[0] * w, p[1] + n[1] * w)); R.append((p[0] - n[0] * w, p[1] - n[1] * w))
    return L, R

def cut_end(L, R, p, t, forward):
    """Replace the end of both offset chains by a flat cut through p on a H or V line."""
    s = 1 if forward else -1
    c = (s * (1 if t[0] * s > 0 else -1), 0) if abs(t[0]) >= abs(t[1]) else (0, (1 if t[1] * s > 0 else -1) * s)
    def fix(chain):
        ch = list(chain) if forward else list(reversed(chain))
        # chain is ordered along the stroke direction when forward, against it otherwise
        tt = t if forward else (-t[0], -t[1])
        cc = (c[0], c[1]) if forward else (c[0], c[1])
        cdir = (1 if tt[0] > 0 else -1, 0) if abs(tt[0]) >= abs(tt[1]) else (0, 1 if tt[1] > 0 else -1)
        while len(ch) > 2 and ((ch[-1][0] - p[0]) * cdir[0] + (ch[-1][1] - p[1]) * cdir[1]) > 0: ch.pop()
        q = ch[-1]; tc = tt[0] * cdir[0] + tt[1] * cdir[1]
        u = -((q[0] - p[0]) * cdir[0] + (q[1] - p[1]) * cdir[1]) / (tc or 1e-6)
        ch[-1] = (q[0] + tt[0] * u, q[1] + tt[1] * u)
        return ch if forward else list(reversed(ch))
    return fix(L), fix(R)

def mitre(p, t_in, t_out):
    """Outer-side join polygon at a corner p between directions t_in -> t_out."""
    cross = t_in[0] * t_out[1] - t_in[1] * t_out[0]
    if abs(cross) < 1e-3: return None
    side = -1 if cross > 0 else 1                 # outer side is opposite to the turn
    def off(t, w): n = (-t[1], t[0]); return (p[0] + side * n[0] * w / 2, p[1] + side * n[1] * w / 2)
    w1, w2 = width_at(t_in), width_at(t_out)
    a, b = off(t_in, w1), off(t_out, w2)
    # intersection of the two outer edges
    d1, d2 = t_in, t_out
    det = d1[0] * d2[1] - d1[1] * d2[0]
    u = ((b[0] - a[0]) * d2[1] - (b[1] - a[1]) * d2[0]) / det
    m = (a[0] + d1[0] * u, a[1] + d1[1] * u)
    if dist(m, p) > MITRE_LIMIT * max(w1, w2) / 2: return [p, a, b]
    return [p, a, m, b]

def area(poly): return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1])) / 2

def polygon_d(poly):
    if area(poly) < 0: poly = poly[::-1]
    return 'M' + 'L'.join('%.2f %.2f' % p for p in poly) + 'Z'

def stroke_outline(d):
    ds = []
    pieces = parse_d(d)
    for k, pts in enumerate(pieces):
        if len(pts) < 2: continue
        ts = tangents(pts)
        L, R = offsets(pts, ts)
        # ends: flat cut only at free ends; interior joints keep the perpendicular end (covered by mitre polygon)
        if k == 0: L, R = cut_end(L, R, pts[0], ts[0], False)
        if k == len(pieces) - 1: L, R = cut_end(L, R, pts[-1], ts[-1], True)
        ds.append(polygon_d(L + R[::-1]))
        if k < len(pieces) - 1:
            m = mitre(pts[-1], ts[-1], tangents(pieces[k + 1])[0])
            if m: ds.append(polygon_d(m))
    return ds

TONE_W = 5.0

def process(src, dst):
    t = open(src, encoding='utf-8').read()
    vb = t.split('viewBox="')[1].split('"')[0]
    ds = []
    for d in re.findall(r'<path d="([^"]+)"', t): ds += stroke_outline(d)
    open(dst, 'w', encoding='utf-8').write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s">\n<g fill="currentColor" stroke="none" fill-rule="nonzero">\n<path d="%s"/>\n</g>\n</svg>\n'
        % (vb, ''.join(ds)))

if __name__ == '__main__':
    SRC = sys.argv[3] if len(sys.argv) > 3 else 'print'; DST = sys.argv[4] if len(sys.argv) > 4 else 'outline'
    for kind in ('glyphs', 'tones'):
        W = TONE_W if kind == 'tones' else float(sys.argv[1]) if len(sys.argv) > 1 else 8.0
        os.makedirs(os.path.join(ROOT, kind + '-' + DST), exist_ok=True)
        for f in sorted(glob.glob(os.path.join(ROOT, kind + '-' + SRC, '*.svg'))):
            process(f, os.path.join(ROOT, kind + '-' + DST, os.path.basename(f)))
    print('ok')
