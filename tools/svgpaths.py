"""Read coloured pen strokes (one <path> per stroke, many cubic segments) from pdftocairo SVG."""
import re, subprocess
import svgstrokes as S

def parse_paths(svg_text, min_width=1.0):
    out = []
    for tag in re.findall(r'<path\b[^>]*>', svg_text):
        w = re.search(r'stroke-width="([\d.]+)"', tag); d = re.search(r' d="([^"]+)"', tag)
        c = re.search(r'stroke="rgb\(([\d.]+)%, ([\d.]+)%, ([\d.]+)%\)"', tag)
        if not (w and d and c) or float(w.group(1)) < min_width: continue      # grid lines are 0.5 wide
        toks = re.findall(r'([MLC])([^MLC]*)', d.group(1)); cur = None; pts = []
        for cmd, args in toks:
            n = [float(v) for v in args.split()]
            if cmd == 'M': cur = (n[0], n[1]); pts.append(cur)
            elif cmd == 'L': cur = (n[0], n[1]); pts.append(cur)
            else:
                for i in range(0, len(n), 6):
                    seg = S.bez([cur, (n[i], n[i+1]), (n[i+2], n[i+3]), (n[i+4], n[i+5])], 6)
                    pts += seg[1:]; cur = (n[i+4], n[i+5])
        col = tuple(float(v) / 100 for v in c.groups())
        kind = 'red' if col[0] > .6 and col[1] < .5 else 'blue' if col[2] > .6 and col[0] < .5 else 'black'
        out.append({'kind': kind, 'width': float(w.group(1)), 'pts': pts})
    return out

def bbox(strokes, pad=0.0):
    xs = [p[0] for s in strokes for p in s['pts']]; ys = [p[1] for s in strokes for p in s['pts']]
    return min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad

def load_page(pdf, page):
    return parse_paths(S.page_svg(pdf, page))
