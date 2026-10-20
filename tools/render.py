"""Render a Kamotish text file to HTML.

Markup:  1. \\name  \\name2  \\name\\N   one grapheme (the 31 standalone ones), optional tone N (1-4):  \\mou  \\mou2  \\mou\\1
         2. latin letters = pronunciation, rendered as syllable blocks (A B C D, rings for s/h/t/ng):  ma-tas-jian su-kun-liang
            '-' separates syllables, '--' shows a literal '-', a space is shown as a gap, an optional tone follows a syllable: ma\\1-tas\\2
         3. everything else (汉字, punctuation, digits) is shown as is.
         '# ' heading, blank line = new paragraph.
Usage:   python3 render.py input.txt output.html [design|outline|print|hand]
"""
import html, json, os, re, sys
import svgstrokes as S

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
TOK = re.compile(r"\\([a-z][a-z']*\d?)(?:\\([1-4]))?")
TONES = {'dx_per_H': -0.14, 'dy_per_H': -0.02}   # tone mark top-left relative to the glyph's top-right corner
_cache = {}

FONTS = {'design': '"Noto Sans CJK SC",sans-serif', 'outline': '"Noto Sans CJK SC",sans-serif', 'print': '"Noto Sans CJK SC",sans-serif', 'hand': '"LXGW Marker Gothic","Noto Sans CJK SC",sans-serif'}
STYLE = 'design'   # 'outline' -> glyphs-outline/ ; 'print' -> glyphs-print/ (strokes) ; 'hand' -> glyphs/
G_RE = re.compile(r'<g\b.*?</g>', re.S)

def group_of(path):
    return G_RE.search(open(path, encoding='utf-8').read()).group(0)

def sdir(kind):
    return os.path.join(ROOT, {'hand': kind, 'print': kind + '-print', 'outline': kind + '-outline', 'design': kind + '-final'}[STYLE])

def poly_bbox(path):
    t = open(path, encoding='utf-8').read()
    pts = [tuple(float(v) for v in p.split()) for poly in re.findall(r'M([^Z]*)Z', t) for p in poly.split('L')]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

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
            l, t, r, b = poly_bbox(f)
            H = b - t
            body += '<g transform="translate(%.2f %.2f)">%s</g>' % (
                r + TONES['dx_per_H'] * H, t + TONES['dy_per_H'] * H,
                group_of(os.path.join(sdir('tones'), 't%s.svg' % tone)))
        out = ('<svg class="g" viewBox="0 0 100 100" aria-label="%s%s">%s</svg>'
               % (html.escape(name), '\\' + tone if tone else '', body))
    _cache[key] = out
    return out

SYL = re.compile(r"[A-Za-z]+")
_syl_cache = {}

def syllable_html(text, tone):
    key = (text, tone)
    if key not in _syl_cache:
        try:
            import syllables as SY
            svg = SY.syllable_svg(text, tone=tone)
            _syl_cache[key] = '<svg class="g" viewBox="0 0 100 100" aria-label="%s">%s</svg>' % (html.escape(text), re.search(r'<g\b.*?</g>', svg, re.S).group(0))
        except Exception as e:
            _syl_cache[key] = '<span class="missing" title="%s">%s</span>' % (html.escape(str(e)), html.escape(text))
    return _syl_cache[key]

def inline(line):
    out, i, n = [], 0, len(line)
    while i < n:
        c = line[i]
        if c == '\\':
            m = TOK.match(line, i)
            if m: out.append(glyph_svg(m.group(1), m.group(2))); i = m.end(); continue
            out.append('\\'); i += 1
        elif c.isascii() and c.isalpha():
            m = SYL.match(line, i); i = m.end(); tone = None
            if any(ch.isupper() for ch in m.group(0)): out.append(html.escape(m.group(0))); continue
            t = re.match(r"\\([1-4])", line[i:])
            if t: tone = t.group(1); i += 2
            out.append(syllable_html(m.group(0), tone))
        elif c == '-':
            if line[i:i + 2] == '--': out.append('-'); i += 2
            else: i += 1                                   # separator between syllables: nothing is shown
        elif c == ' ':
            out.append('<span class="sp"></span>'); i += 1
        else:
            out.append(html.escape(c)); i += 1
    return ''.join(out)

CSS = """
@font-face{font-family:"LXGW Marker Gothic";src:url("../fonts/LXGWMarkerGothic-Regular.ttf")}
body{max-width:42em;margin:2em auto;padding:0 1em;font:28px/2 %(font)s;color:#222;background:#fbf8ef}
h1{font-size:1.4em;font-weight:normal;margin:.6em 0}p{margin:.4em 0;text-align:justify}
svg.g{display:inline-block;width:1em;height:1em;vertical-align:-.14em;overflow:visible;margin:0 .1em}
.missing{color:#c00;font-family:monospace}\n.sp{display:inline-block;width:.45em}
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
