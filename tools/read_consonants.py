"""Read 音素.pdf (pages 2-22 = consonants B C D F G H J K L M N P Q R S T V W X Y Z).
Each page: a Latin label, and a stack:  A-form (black, top) | red vertical bar (B = I) | red horizontal bar (C) | D-form (black, bottom).
Output: ../consonants/raw.json  {letter: {A:[[pts]], B:[..], C:[..], D:[..]}}  (page points, y down)  + a check sheet.
Usage: python3 read_consonants.py [pdf]
"""
import json, os, sys
import svgpaths as P, svgstrokes as S

PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'sources', '音素.pdf')
LETTERS = list('BCDFGHJKLMNPQRSTVWXYZ')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'consonants')

def cluster(strokes, gap=12.0):
    boxes = [P.bbox([s]) for s in strokes]; parent = list(range(len(strokes)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(len(strokes)):
        for j in range(i + 1, len(strokes)):
            a, b = boxes[i], boxes[j]
            if a[0] <= b[2] + gap and b[0] <= a[2] + gap and a[1] <= b[3] + gap and b[1] <= a[3] + gap: parent[find(i)] = find(j)
    g = {}
    for i, s in enumerate(strokes): g.setdefault(find(i), []).append(s)
    return list(g.values())

def read_page(page):
    ss = P.parse_paths(S.page_svg(PDF, page))
    groups = cluster(ss)
    stack = next(g for g in groups if any(s['kind'] == 'red' for s in g))
    label = [s for g in groups if g is not stack for s in g]
    reds = [s for s in stack if s['kind'] == 'red']
    def is_vert(s): l, t, r, b = P.bbox([s]); return (b - t) > 1.2 * (r - l)
    B = [s for s in reds if is_vert(s)]; C = [s for s in reds if not is_vert(s)]
    cy = sum(P.bbox([s])[1] for s in C) / len(C) if C else None
    blacks = [s for s in stack if s['kind'] == 'black']
    A = [s for s in blacks if sum(p[1] for p in s['pts']) / len(s['pts']) < cy]
    D = [s for s in blacks if s not in A]
    return {'label': label, 'A': A, 'B': B, 'C': C, 'D': D}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True); data = {}
    for i, L in enumerate(LETTERS):
        r = read_page(i + 2)
        data[L] = {k: [[(round(x, 2), round(y, 2)) for x, y in s['pts']] for s in r[k]] for k in 'ABCD'}
        bb = {k: [round(v, 1) for v in P.bbox(r[k])] if r[k] else None for k in 'ABCD'}
        print(L, {k: len(r[k]) for k in 'ABCD'}, 'A', bb['A'], 'B', bb['B'], 'C', bb['C'], 'D', bb['D'])
    json.dump(data, open(os.path.join(OUT, 'raw.json'), 'w'))
