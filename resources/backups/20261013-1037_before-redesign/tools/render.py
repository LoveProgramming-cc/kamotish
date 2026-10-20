"""Render a Kamotish text file to HTML.

Markup:  \\name        a grapheme (file glyphs/name.svg), e.g. \\mou  \\mou2  \\te'
         \\name\\N      the same grapheme with tone N (1-4), e.g. \\mou\\1
         '# ' heading, blank line = new paragraph; everything else is plain text (汉字 etc.).
Usage:   python3 render.py input.txt output.html [print|hand]
"""
import html, json, os, re, sys
import svgstrokes as S

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TOK = re.compile(r"\\([a-z][a-z']*\d?)(?:\\([1-4]))?")
TONES = json.load(open(os.path.join(ROOT, 'tones', 'tones.json')))
_cache = {}

FONTS = {'print': '"Noto Sans CJK SC",sans-serif', 'hand': '"LXGW Marker Gothic","Noto Sans CJK SC",sans-serif'}
STYLE = 'print'   # 'print' -> glyphs-print/, tones-print/ ; 'hand' -> glyphs/, tones/
G_RE = re.compile(r'<g\b.*?</g>', re.S)

def group_of(path):
    return G_RE.search(open(path, encoding='utf-8').read()).group(0)

def sdir(kind):
    return os.path.join(ROOT, kind if STYLE == 'hand' else kind + '-print')

def glyph_svg(name, tone):
    key = (STYLE, name, tone)
    if key in _cache:
        return _cache[key]
    f = os.path.join(sdir('glyphs'), name + '.svg')
    if not os.path.exists(f):
        out = '<span class="missing">\\%s</span>' % html.escape(name)
    else:
        body = group_of(f)
        if tone:
            l, t, r, b = S.bbox(S.load_svg(os.path.join(ROOT, 'glyphs', name + '.svg')))   # anchor from the hand version
            H = b - t
            body += '<g transform="translate(%.2f %.2f)">%s</g>' % (
                r + TONES['dx_per_H'] * H, t + TONES['dy_per_H'] * H,
                group_of(os.path.join(sdir('tones'), 't%s.svg' % tone)))
        out = ('<svg class="g" viewBox="0 0 100 100" aria-label="%s%s">%s</svg>'
               % (html.escape(name), '\\' + tone if tone else '', body))
    _cache[key] = out
    return out

def inline(line):
    out, pos = [], 0
    for m in TOK.finditer(line):
        out.append(html.escape(line[pos:m.start()]))
        out.append(glyph_svg(m.group(1), m.group(2)))
        pos = m.end()
    out.append(html.escape(line[pos:]))
    return ''.join(out)

CSS = """
@font-face{font-family:"LXGW Marker Gothic";src:url("../fonts/LXGWMarkerGothic-Regular.ttf")}
body{max-width:42em;margin:2em auto;padding:0 1em;font:28px/2 %(font)s;color:#222;background:#fbf8ef}
h1{font-size:1.4em;font-weight:normal;margin:.6em 0}p{margin:.4em 0;text-align:justify}
svg.g{display:inline-block;width:1em;height:1em;vertical-align:-.14em;overflow:visible;margin:0 .1em}
.missing{color:#c00;font-family:monospace}
"""

def main(src, dst):
    global STYLE
    if len(sys.argv) > 3: STYLE = sys.argv[3]
    parts = []
    for block in open(src, encoding='utf-8').read().split('\n\n'):
        block = block.strip()
        if not block:
            continue
        if block.startswith('# '):
            parts.append('<h1>%s</h1>' % inline(block[2:]))
        else:
            parts.append('<p>%s</p>' % '<br>'.join(inline(l) for l in block.split('\n')))
    open(dst, 'w', encoding='utf-8').write(
        '<!doctype html><meta charset="utf-8"><title>卡谋语</title><style>%s</style>\n%s\n' % (CSS % {'font': FONTS[STYLE]}, '\n'.join(parts)))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
