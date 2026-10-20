"""Read 元音.pdf: vowel shapes at the B (vertical) and C (horizontal) positions, in the same frame as consonants/raw.json.
Every block there is  n + vowel pair + n  (naan, noon, nuun, neen variants; niin = the plain I of 音素.pdf).
The black strokes (the consonant n: A-form on top, D-form below) are matched to the N page of raw.json by their A-form box,
so the red vowel strokes can be expressed in W units of the block frame (x from the block's left edge, y from the A-form top)."""
import json, os, sys
import svgpaths as P, svgstrokes as S
import read_consonants as R

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'consonants')
PDF = os.path.join(ROOT, '..', 'sources', '元音.pdf')
raw = json.load(open(os.path.join(ROOT, 'raw.json')))
def bb(strokes):
    xs = [p[0] for s in strokes for p in s]; ys = [p[1] for s in strokes for p in s]
    return min(xs), min(ys), max(xs), max(ys)
nA, nB, nC, nD = (bb(raw['N'][k]) for k in 'ABCD')
x0 = min(nA[0], nC[0], nD[0]); y0 = min(nA[1], nB[1]); Wn = max(nB[2], nC[2], nD[2]) - x0

BLOCKS = {  # name -> (page, cluster bbox left, top)  (approximate positions found by listing the clusters)
    'a': (1, 110, 50), 'o': (2, 150, 108), 'u': (3, 150, 63),
    'e_Tl': (4, 109, 129), 'e_Tr': (4, 145, 129), 'e_Bl': (4, 187, 130), 'e_Br': (4, 250, 130),
}

def blocks_on(page):
    ss = P.parse_paths(S.page_svg(PDF, page)); out = []
    for g in R.cluster(ss, gap=9.0):
        l, t, r, b = P.bbox(g)
        if any(s['kind'] == 'red' for s in g) and (b - t) < 60 and (r - l) < 60: out.append((l, t, g))
    return out

def vowel_in_N_frame(g):
    reds = [s for s in g if s['kind'] == 'red']; blacks = [s for s in g if s['kind'] == 'black']
    ys = sorted(((sum(p[1] for p in s['pts']) / len(s['pts'])), i) for i, s in enumerate(blacks))
    gaps = [(ys[i + 1][0] - ys[i][0], i) for i in range(len(ys) - 1)]; cut = max(gaps)[1]
    top = [blacks[i] for _, i in ys[:cut + 1]]; bot = [blacks[i] for _, i in ys[cut + 1:]]
    a = bb([s['pts'] for s in top]); d = bb([s['pts'] for s in bot])
    sx, sy = (nA[2] - nA[0]) / (a[2] - a[0]), (nA[3] - nA[1]) / (a[3] - a[1]); s = (sx + sy) / 2
    f = lambda p: ((nA[0] + (p[0] - a[0]) * s - x0) / Wn, (nA[1] + (p[1] - a[1]) * s - y0) / Wn)       # -> block units
    strokes = [[f(p) for p in st['pts']] for st in reds]
    return strokes, s

if __name__ == '__main__':
    out = {}
    for name, (page, l0, t0) in BLOCKS.items():
        cand = [(abs(l - l0) + abs(t - t0), g) for l, t, g in blocks_on(page)]
        _, g = min(cand, key=lambda c: c[0])
        strokes, s = vowel_in_N_frame(g)
        out[name] = [[[round(x, 4), round(y, 4)] for x, y in st] for st in strokes]
        print(name, 'red strokes', len(strokes), 'scale vs N page %.2f' % s)
    json.dump(out, open(os.path.join(ROOT, 'vowels_raw.json'), 'w'))
