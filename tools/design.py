"""Rebuild every grapheme from the hand-written glyphs/ with ONE set of design rules  ->  glyphs-design/, tones-design/ (centre lines).

Rules (see RULES below):
  1. skeleton lives in the box [LO, HI]; glyph is fitted uniformly (height-equal, width-limited if wide)
  2. strokes split at corners; straight pieces are exact lines, near-H/V ones snapped
  3. curved pieces are split at their x/y extrema, and the tangent there is forced horizontal/vertical
  4. anchors (ends, corners, extrema) are clustered per glyph so near-equal heights/widths become equal,
     and anchors near the box edge sit exactly on the edge
  5. every curve segment is ONE cubic fitted with those fixed tangents
Then outline.py turns the centre lines into shapes.
Usage: python3 design.py
"""
import glob, math, os, sys
sys.argv = sys.argv[:1]
import svgstrokes as S
import typeset as T

ROOT = T.ROOT
LO, HI = 8.0, 92.0                 # skeleton box (stroke half-width keeps ink inside 4..96)
CLUSTER = 3.2                      # anchors closer than this (per axis) become equal
EDGE = 5.0                         # anchors closer than this to the box edge sit on the edge
EXT_THR = 4.0                      # an extremum needs this much travel on both sides
FIT_TOL = 2.0
dist = T.dist

def extrema(pts):
    """Indices of significant x / y extrema of a smoothed polyline -> list of (index, axis) axis 0=x,1=y."""
    out = []
    for ax in (0, 1):
        v = [p[ax] for p in pts]
        lo_i = hi_i = 0; direction = 0; last = []
        for i in range(1, len(v)):
            if v[i] > v[hi_i]: hi_i = i
            if v[i] < v[lo_i]: lo_i = i
            if direction >= 0 and v[hi_i] - v[i] >= EXT_THR and (direction == 1 or hi_i - 0 >= 1):
                if direction == 1 or v[hi_i] - v[0] >= EXT_THR or direction == 0:
                    if hi_i > 0: last.append(hi_i)
                direction = -1; lo_i = i; hi_i = i
            elif direction <= 0 and v[i] - v[lo_i] >= EXT_THR:
                if direction == -1 or direction == 0:
                    if lo_i > 0: last.append(lo_i)
                direction = 1; hi_i = i; lo_i = i
        for i in last:
            if 9 < i < len(pts) - 10: out.append((i, ax))
    out.sort()
    merged = []
    for i, ax in out:
        if merged and i - merged[-1][0] < 22: continue
        merged.append((i, ax))
    return merged

def solve(M, r):
    n = len(r); A = [row[:] + [r[i]] for i, row in enumerate(M)]
    for c in range(n):
        piv = max(range(c, n), key=lambda k: abs(A[k][c]))
        if abs(A[piv][c]) < 1e-9: return None
        A[c], A[piv] = A[piv], A[c]
        for k in range(n):
            if k != c:
                f = A[k][c] / A[c][c]
                for j in range(c, n + 1): A[k][j] -= f * A[c][j]
    return [A[i][n] / A[i][i] for i in range(n)]

def fit_fixed(pts, d0, d3):
    """Cubic from pts[0] to pts[-1]; d0/d3 = fixed unit tangent (out of start / into end) or None (free)."""
    L = [0.0]
    for a, b in zip(pts, pts[1:]): L.append(L[-1] + dist(a, b))
    ts = [l / L[-1] for l in L]
    p0, p3 = pts[0], pts[-1]
    vars_ = []   # (which handle 1|2, vec)
    if d0: vars_.append((1, d0))
    else: vars_ += [(1, (1.0, 0.0)), (1, (0.0, 1.0))]
    if d3: vars_.append((2, (-d3[0], -d3[1])))
    else: vars_ += [(2, (1.0, 0.0)), (2, (0.0, 1.0))]
    n = len(vars_); M = [[0.0] * n for _ in range(n)]; r = [0.0] * n
    for t, p in zip(ts, pts):
        B = {0: (1 - t)**3, 1: 3 * (1 - t)**2 * t, 2: 3 * (1 - t) * t * t, 3: t**3}
        base = tuple(B[0] * p0[k] + B[3] * p3[k] + B[1] * p0[k] + B[2] * p3[k] for k in (0, 1))
        for j, (wj, vj) in enumerate(vars_):
            r[j] += B[wj] * (vj[0] * (p[0] - base[0]) + vj[1] * (p[1] - base[1]))
            for k, (wk, vk) in enumerate(vars_):
                M[j][k] += B[wj] * B[wk] * (vj[0] * vk[0] + vj[1] * vk[1])
    sol = solve(M, r) or [dist(p0, p3) / 3] * n
    h1 = list(p0); h2 = list(p3)
    for (w, v), a in zip(vars_, sol):
        if (w == 1 and d0) or (w == 2 and d3): a = max(a, 0.05 * dist(p0, p3))
        tgt = h1 if w == 1 else h2
        tgt[0] += a * v[0]; tgt[1] += a * v[1]
    c = (p0, tuple(h1), tuple(h2), p3)
    err = max((dist(p, T._bz(c, t)), i) for i, (t, p) in enumerate(zip(ts, pts)))
    return c, err

def fit_seq(pts, d0, d3):
    c, (e, i) = fit_fixed(pts, d0, d3)
    if e <= FIT_TOL or len(pts) < 9: return [c]
    i = min(max(i, 4), len(pts) - 5)
    return fit_seq(pts[:i + 1], d0, None) + fit_seq(pts[i:], None, d3)

def glyph_strokes(src):
    return fit_chains(T.chains(S.load_svg(src)))

def fit_chains(chains):
    # fit to the skeleton box
    allp = [p for c in chains for p in c]
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    l, t, r, b = min(xs), min(ys), max(xs), max(ys)
    w, h = r - l, b - t
    s = min((HI - LO) / h, (HI - LO) / w)
    ox = 50 - (l + r) / 2 * s
    oy = (LO - t * s) if (HI - LO) / h <= (HI - LO) / w else (50 - (t + b) / 2 * s)
    return [[(x * s + ox, y * s + oy) for x, y in c] for c in chains]

class A(list):          # anchor [x, y]  + .tan (unit vector or None)
    tan = None

def build(strokes):
    """strokes -> list of stroke dicts {anchors:[A], pieces:[(i0, i1, pts, kind)]}"""
    out = []
    for chain in strokes:
        length = sum(dist(a, b) for a, b in zip(chain, chain[1:]))
        if length < 3:
            a, b = chain[0], chain[-1]
            if dist(a, b) < 1.5: b = (a[0] + 1.5, a[1] + 1.5)
            out.append({'anchors': [A(a), A(b)], 'pieces': [(0, 1, [a, b], 'line')]}); continue
        pts = T.resample(chain)
        T.CORNER_ANGLE, T.CORNER_WIN = 62, 6.0
        cs = []
        for i in T.corners(T.smooth(pts, 3.0)):
            if (not cs or i - cs[-1] > 14) and 10 < i < len(pts) - 10: cs.append(i)
        cuts = [0] + cs + [len(pts) - 1]
        anchors = []; pieces = []
        for a_i, b_i in zip(cuts, cuts[1:]):
            seg = T.smooth(pts[a_i:b_i + 1], 10.0)
            kind = 'line' if T.straight(seg) else 'curve'
            idxs = [(0, None)]
            if kind == 'curve': idxs += [(i, ax) for i, ax in extrema(seg)]
            idxs.append((len(seg) - 1, None))
            if not anchors: anchors.append(A(seg[0]))
            for (i0, _), (i1, ax1) in zip(idxs, idxs[1:]):
                sub = seg[i0:i1 + 1]
                if ax1 is not None:
                    an = A(seg[i1]); a_prev = seg[i1 - 1]; a_next = seg[min(len(seg) - 1, i1 + 1)]
                    if ax1 == 1: an.tan = (1.0 if a_next[0] - a_prev[0] >= 0 else -1.0, 0.0)
                    else: an.tan = (0.0, 1.0 if a_next[1] - a_prev[1] >= 0 else -1.0)
                else:
                    an = A(seg[i1])
                    if i1 == len(seg) - 1 and b_i != cuts[-1]: pass
                anchors.append(an)
                pieces.append((len(anchors) - 2, len(anchors) - 1, sub, kind))
            # joint between consecutive pieces at a corner is the shared last anchor (already appended)
        out.append({'anchors': anchors, 'pieces': pieces})
    return out

def snap_axis(anchors, ax):
    vals = sorted(anchors, key=lambda a: a[ax])
    cl = []
    for a in vals:
        if cl and a[ax] - cl[-1][-1][ax] <= CLUSTER: cl[-1].append(a)
        else: cl.append([a])
    for c in cl:
        m = sum(a[ax] for a in c) / len(c)
        if m - LO < EDGE: m = LO
        elif HI - m < EDGE: m = HI
        for a in c: a[ax] = m

def design(src):
    return design_chains(T.chains(S.load_svg(src)))

def design_chains(chains):
    strokes = build(fit_chains(chains))
    # H/V snap of straight pieces
    for st in strokes:
        for i0, i1, pts, kind in st['pieces']:
            if kind != 'line': continue
            a, b = st['anchors'][i0], st['anchors'][i1]
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180
            if min(ang, 180 - ang) < T.SNAP_DEG: a[1] = b[1] = (a[1] + b[1]) / 2
            elif abs(ang - 90) < T.SNAP_DEG: a[0] = b[0] = (a[0] + b[0]) / 2
    allanch = [a for st in strokes for a in st['anchors']]
    before = {id(a): (a[0], a[1]) for a in allanch}
    for ax in (0, 1): snap_axis(allanch, ax)
    for st in strokes:                      # carry the anchor moves into the pieces (smooth warp)
        warped = []
        for i0, i1, pts, kind in st['pieces']:
            a, b = st['anchors'][i0], st['anchors'][i1]
            d0 = (a[0] - before[id(a)][0], a[1] - before[id(a)][1]); d1 = (b[0] - before[id(b)][0], b[1] - before[id(b)][1])
            L = [0.0]
            for u, v in zip(pts, pts[1:]): L.append(L[-1] + dist(u, v))
            warped.append((i0, i1, [(p[0] + (1 - l / L[-1]) * d0[0] + l / L[-1] * d1[0], p[1] + (1 - l / L[-1]) * d0[1] + l / L[-1] * d1[1]) for p, l in zip(pts, L)], kind))
        st['pieces'] = warped
    ds = []
    for st in strokes:
        an = st['anchors']; d = 'M%.2f %.2f' % tuple(an[0])
        for i0, i1, pts, kind in st['pieces']:
            a, b = an[i0], an[i1]
            if kind == 'line':
                d += 'L%.2f %.2f' % tuple(b)
            else:
                sub = [tuple(a)] + pts[1:-1] + [tuple(b)]
                cs = T.regularise(fit_seq(sub, a.tan, b.tan)) if not (a.tan or b.tan) else fit_seq(sub, a.tan, b.tan)
                d += ''.join('C%.2f %.2f %.2f %.2f %.2f %.2f' % (*c[1], *c[2], *c[3]) for c in cs)
        ds.append(d)
    return ds

def write(src, dst):
    t = open(src, encoding='utf-8').read()
    vb = t.split('viewBox="')[1].split('"')[0]
    body = '\n'.join('<path d="%s"/>' % d for d in design(src))
    open(dst, 'w', encoding='utf-8').write(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s">\n<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="3">\n%s\n</g>\n</svg>\n' % (vb, body))

if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'glyphs-design'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ROOT, 'glyphs', '*.svg'))):
        write(f, os.path.join(ROOT, 'glyphs-design', os.path.basename(f)))
    print('ok')
