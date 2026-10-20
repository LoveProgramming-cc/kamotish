"""Centre every grapheme's ink box on the same point as the 汉字 (50, 50): glyphs-sout/ -> glyphs-final/, tones-sout/ -> tones-final/.
Usage: python3 align.py [cx cy]"""
import glob, os, re, shutil, sys
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources')   # glyph data and intermediate files
CX = float(sys.argv[1]) if len(sys.argv) > 1 else 50.0
CY = float(sys.argv[2]) if len(sys.argv) > 2 else 50.0

def shift(src, dst):
    t = open(src, encoding='utf-8').read()
    pts = [tuple(float(v) for v in p.split()) for poly in re.findall(r'M([^Z]*)Z', t) for p in poly.split('L')]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    dx, dy = CX - (min(xs) + max(xs)) / 2, CY - (min(ys) + max(ys)) / 2
    def fix(m):
        poly = m.group(1)
        return 'M' + 'L'.join('%.2f %.2f' % (float(a) + dx, float(b) + dy) for a, b in (p.split() for p in poly.split('L'))) + 'Z'
    open(dst, 'w', encoding='utf-8').write(re.sub(r'M([^Z]*)Z', fix, t))
    return dx, dy

if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'glyphs-final'), exist_ok=True)
    for f in sorted(glob.glob(os.path.join(ROOT, 'glyphs-sout', '*.svg'))):
        dx, dy = shift(f, os.path.join(ROOT, 'glyphs-final', os.path.basename(f)))
        print('%-5s dx=%+5.1f dy=%+5.1f' % (os.path.basename(f)[:-4], dx, dy))
    shutil.copytree(os.path.join(ROOT, 'tones-sout'), os.path.join(ROOT, 'tones-final'), dirs_exist_ok=True)
