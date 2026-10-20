"""Turn the hand-written stroke SVGs (glyphs/, tones/) into a clean 'printed' style (glyphs-print/, tones-print/).

Per stroke: chain pen segments -> resample -> split at corners -> smooth each piece ->
straight pieces become exact lines (near-H/V snapped), curved pieces become Catmull-Rom cubics.
Output: constant stroke width, flat (butt) caps, mitre joins  (sans / 黑体 style).
Usage: python3 typeset.py [stroke_width]
"""
import glob, math, os, sys
import svgstrokes as S

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
WIDTH = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0
STEP = 0.8          # resample spacing (box units)
CORNER_ANGLE = 50   # deg, turn within CORNER_WIN to count as a corner
CORNER_WIN = 5.0
STRAIGHT_DEV = 2.4  # max deviation from chord to call a piece straight
SNAP_DEG = 12       # snap near-H/V lines
KNOT = 8.0          # spacing of spline knots on curved pieces

def dist(a, b): return math.hypot(a[0] - b[0], a[1] - b[1])

def chains(segs):
    out, cur = [], []
    for g in segs:
        pts = S.bez(g['pts'], 6)
        if cur and dist(cur[-1], pts[0]) < 0.05:
            cur += pts[1:]
        else:
            if cur: out.append(cur)
            cur = list(pts)
    if cur: out.append(cur)
    return out

def resample(pts, step=STEP):
    acc = [pts[0]]; rem = step
    for a, b in zip(pts, pts[1:]):
        d = dist(a, b)
        while d >= rem and d > 0:
            t = rem / d
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            acc.append(a); d = dist(a, b); rem = step
        rem -= d
    if dist(acc[-1], pts[-1]) > step * 0.3: acc.append(pts[-1])
    else: acc[-1] = pts[-1]
    return acc

def smooth(pts, win):
    n = len(pts); k = max(1, int(win / STEP / 2))
    out = [pts[0]]
    for i in range(1, n - 1):
        lo, hi = max(0, i - k), min(n - 1, i + k); m = min(i - lo, hi - i)
        lo, hi = i - m, i + m
        out.append((sum(p[0] for p in pts[lo:hi + 1]) / (hi - lo + 1), sum(p[1] for p in pts[lo:hi + 1]) / (hi - lo + 1)))
    out.append(pts[-1])
    return out

def turn(pts, i, k):
    a, b, c = pts[i - k], pts[i], pts[i + k]
    a1 = math.atan2(b[1] - a[1], b[0] - a[0]); a2 = math.atan2(c[1] - b[1], c[0] - b[0])
    d = math.degrees(a2 - a1)
    return abs((d + 180) % 360 - 180)

def corners(pts):
    k = max(1, int(CORNER_WIN / STEP)); idx = []
    ang = [0] * len(pts)
    for i in range(k, len(pts) - k): ang[i] = turn(pts, i, k)
    for i in range(k, len(pts) - k):
        if ang[i] >= CORNER_ANGLE and ang[i] == max(ang[max(0, i - k):i + k + 1]):
            if not idx or i - idx[-1] > k: idx.append(i)
    return idx

def straight(pts):
    a, b = pts[0], pts[-1]; L = dist(a, b)
    if L < 1e-6: return True
    dev = max(abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L for p in pts)
    return dev <= STRAIGHT_DEV

def knots(pts):
    L = sum(dist(a, b) for a, b in zip(pts, pts[1:]))
    n = max(2, round(L / KNOT) + 1)
    step = max(1, (len(pts) - 1) / (n - 1))
    ks = [pts[min(len(pts) - 1, round(i * step))] for i in range(n)]
    ks[-1] = pts[-1]
    return ks

def catmull(ks):
    d = 'M%.2f %.2f' % ks[0]
    for i in range(len(ks) - 1):
        p0 = ks[max(0, i - 1)]; p1 = ks[i]; p2 = ks[i + 1]; p3 = ks[min(len(ks) - 1, i + 2)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += 'C%.2f %.2f %.2f %.2f %.2f %.2f' % (*c1, *c2, *p2)
    return d


FIT_TOL = 2.2       # max deviation of a fitted cubic from the (smoothed) hand stroke
TAN_SNAP = 14       # snap end tangents that are within this many degrees of H/V

def _bz(c, t):
    u = 1 - t
    return (u**3*c[0][0] + 3*u*u*t*c[1][0] + 3*u*t*t*c[2][0] + t**3*c[3][0],
            u**3*c[0][1] + 3*u*u*t*c[1][1] + 3*u*t*t*c[2][1] + t**3*c[3][1])

def fit_cubic(pts):
    """Least-squares cubic with fixed end points, chord-length parametrisation."""
    L = [0.0]
    for a, b in zip(pts, pts[1:]): L.append(L[-1] + dist(a, b))
    ts = [l / L[-1] for l in L]
    p0, p3 = pts[0], pts[-1]
    a11 = a12 = a22 = 0.0; r1 = [0.0, 0.0]; r2 = [0.0, 0.0]
    for t, p in zip(ts, pts):
        b1 = 3 * (1 - t)**2 * t; b2 = 3 * (1 - t) * t * t; b0 = (1 - t)**3; b3 = t**3
        a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2
        for k in (0, 1):
            e = p[k] - b0 * p0[k] - b3 * p3[k]
            r1[k] += b1 * e; r2[k] += b2 * e
    det = a11 * a22 - a12 * a12
    if abs(det) < 1e-9:
        c1 = (p0[0] + (p3[0] - p0[0]) / 3, p0[1] + (p3[1] - p0[1]) / 3)
        c2 = (p0[0] + 2 * (p3[0] - p0[0]) / 3, p0[1] + 2 * (p3[1] - p0[1]) / 3)
    else:
        c1 = tuple((a22 * r1[k] - a12 * r2[k]) / det for k in (0, 1))
        c2 = tuple((a11 * r2[k] - a12 * r1[k]) / det for k in (0, 1))
    c = (p0, c1, c2, p3)
    err = [(dist(p, _bz(c, t)), i) for i, (t, p) in enumerate(zip(ts, pts))]
    return c, max(err)

def fit_curve(pts):
    c, (e, i) = fit_cubic(pts)
    if e <= FIT_TOL or len(pts) < 8:
        return [c]
    i = min(max(i, 3), len(pts) - 4)
    return fit_curve(pts[:i + 1]) + fit_curve(pts[i:])

def unit(a, b):
    d = dist(a, b)
    return ((b[0] - a[0]) / d, (b[1] - a[1]) / d) if d > 1e-9 else (0.0, 0.0)

def regularise(cs):
    """G1 joins between consecutive cubics; snap end tangents to H/V."""
    cs = [list(map(list, c)) for c in cs]
    for i in range(len(cs) - 1):
        a, b = cs[i], cs[i + 1]; j = a[3]
        ua = unit(a[2], j); ub = unit(j, b[1])
        ux, uy = ua[0] + ub[0], ua[1] + ub[1]; n = math.hypot(ux, uy) or 1
        ux, uy = ux / n, uy / n
        la, lb = dist(a[2], j), dist(j, b[1])
        a[2] = [j[0] - ux * la, j[1] - uy * la]; b[1] = [j[0] + ux * lb, j[1] + uy * lb]
    def snap(p, h):
        ux, uy = unit(p, h); L = dist(p, h)
        ang = math.degrees(math.atan2(uy, ux)) % 180
        if min(ang, 180 - ang) < TAN_SNAP: return [p[0] + math.copysign(L, ux or 1), p[1]]
        if abs(ang - 90) < TAN_SNAP: return [p[0], p[1] + math.copysign(L, uy or 1)]
        return h
    cs[0][1] = snap(cs[0][0], cs[0][1]); cs[-1][2] = snap(cs[-1][3], cs[-1][2])
    return cs

def curve_d(pts):
    cs = regularise(fit_curve(pts))
    return ''.join('C%.2f %.2f %.2f %.2f %.2f %.2f' % (*c[1], *c[2], *c[3]) for c in cs)

def stroke_path(chain):
    if sum(dist(a, b) for a, b in zip(chain, chain[1:])) < 3:             # a dot / tick
        a, b = chain[0], chain[-1]
        if dist(a, b) < 1.5: b = (a[0] + 1.5, a[1] + 1.5)
        return 'M%.2f %.2fL%.2f %.2f' % (*a, *b)
    pts = resample(chain)
    cs = corners(pts)
    cuts = [0] + cs + [len(pts) - 1]
    corner_pts = [list(pts[i]) for i in cuts]
    pieces = [smooth(pts[a:b + 1], 10.0) for a, b in zip(cuts, cuts[1:])]
    kinds = [straight(p) for p in pieces]
    for j, (p, st) in enumerate(zip(pieces, kinds)):                     # snap straight pieces to H/V
        if not st: continue
        a, b = corner_pts[j], corner_pts[j + 1]
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180
        if min(ang, 180 - ang) < SNAP_DEG:
            y = (a[1] + b[1]) / 2; a[1] = b[1] = y
        elif abs(ang - 90) < SNAP_DEG:
            x = (a[0] + b[0]) / 2; a[0] = b[0] = x
    d = 'M%.2f %.2f' % tuple(corner_pts[0])
    for j, (p, st) in enumerate(zip(pieces, kinds)):
        a, b = corner_pts[j], corner_pts[j + 1]
        if st:
            d += 'L%.2f %.2f' % tuple(b)
        else:
            d += curve_d([tuple(a)] + p[1:-1] + [tuple(b)])
    return d

def process(src, dst, vb_from_src=True):
    t = open(src, encoding='utf-8').read()
    vb = t.split('viewBox="')[1].split('"')[0]
    ds = [stroke_path(c) for c in chains(S.load_svg(src))]
    body = '\n'.join('<path d="%s"/>' % d for d in ds)
    open(dst, 'w', encoding='utf-8').write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s">\n'
        '<g fill="none" stroke="currentColor" stroke-width="%g" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3">\n%s\n</g>\n</svg>\n'
        % (vb, WIDTH, body))
    return len(ds)

if __name__ == '__main__':
    for kind in ('glyphs', 'tones'):
        os.makedirs(os.path.join(ROOT, kind + '-print'), exist_ok=True)
        for f in sorted(glob.glob(os.path.join(ROOT, kind, '*.svg'))):
            process(f, os.path.join(ROOT, kind + '-print', os.path.basename(f)))
    print('ok')
