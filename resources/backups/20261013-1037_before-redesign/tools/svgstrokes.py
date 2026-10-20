"""Parse pdftocairo SVG output of pressure-sensitive pen strokes."""
import re, subprocess

PATH_RE = re.compile(r'<path\b[^>]*?>')
def _attr(tag, name):
    m = re.search(r'\b%s="([^"]*)"' % name, tag)
    return m.group(1) if m else None

def parse(svg_text):
    """Return list of segments: dict(w, pts) where pts = [(x,y)] 2 or 4 points (line / cubic)."""
    segs = []
    for tag in PATH_RE.findall(svg_text):
        d = _attr(tag, 'd')
        if not d or _attr(tag, 'stroke-width') is None:
            continue
        nums = [float(v) for v in re.findall(r'-?\d+\.?\d*(?:e-?\d+)?', d)]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) not in (2, 4):
            continue
        segs.append({'w': float(_attr(tag, 'stroke-width')), 'pts': pts})
    return segs

def bez(pts, n=8):
    if len(pts) == 2:
        return list(pts)
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*x0 + 3*u*u*t*x1 + 3*u*t*t*x2 + t**3*x3,
                    u**3*y0 + 3*u*u*t*y1 + 3*u*t*t*y2 + t**3*y3))
    return out

def bbox(segs):
    xs = []; ys = []
    for s in segs:
        r = s['w'] / 2
        for x, y in bez(s['pts']):
            xs += [x - r, x + r]; ys += [y - r, y + r]
    return min(xs), min(ys), max(xs), max(ys)

def page_svg(pdf, page):
    return subprocess.run(['pdftocairo', '-svg', '-f', str(page), '-l', str(page), pdf, '-'],
                          capture_output=True, text=True, check=True).stdout

def clusters(segs, gap=3.0):
    """Group segments whose (stroke-inflated) bboxes lie within `gap` of each other."""
    boxes = [bbox([s]) for s in segs]
    parent = list(range(len(segs)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    order = sorted(range(len(segs)), key=lambda i: boxes[i][0])
    for a_i, a in enumerate(order):
        for b in order[a_i + 1:]:
            if boxes[b][0] > boxes[a][2] + gap:
                break
            if boxes[b][1] <= boxes[a][3] + gap and boxes[b][3] >= boxes[a][1] - gap:
                parent[find(a)] = find(b)
    groups = {}
    for i in range(len(segs)):
        groups.setdefault(find(i), []).append(segs[i])
    return list(groups.values())

def load_svg(path):
    """Read one of our normalised glyph/tone SVGs back into segments."""
    t = open(path, encoding='utf-8').read()
    segs = []
    for w, d in re.findall(r'stroke-width="([\d.]+)" d="([^"]+)"', t):
        n = [float(v) for v in re.findall(r'-?\d+\.?\d*', d)]
        segs.append({'w': float(w), 'pts': list(zip(n[0::2], n[1::2]))})
    return segs
