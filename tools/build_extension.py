"""Build the browser extension:  extension/  (load unpacked)  +  dist/kamotish-chrome.zip  +  dist/kamotish-firefox.zip.
Copies web/kamotish.js into extension/, draws the icons, writes a Firefox manifest (adds the add-on id)."""
import json, os, re, shutil, sys, zipfile
sys.argv = sys.argv[:1]
from PIL import Image, ImageDraw
import syllables as SY

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
EXT = os.path.join(ROOT, 'extension'); DIST = os.path.join(ROOT, 'dist')

def icons():
    svg = SY.syllable_svg('ka')
    polys = [[tuple(float(v) for v in p.split()) for p in q.split('L')] for q in re.findall(r'M([^Z]*)Z', svg)]
    os.makedirs(os.path.join(EXT, 'icons'), exist_ok=True)
    for size in (16, 32, 48, 128):
        S = 8 * size
        img = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=(30, 58, 72, 255))
        sc = S / 100 * 0.82; off = S * 0.09
        for q in polys: d.polygon([(off + x * sc, off + y * sc) for x, y in q], fill=(250, 246, 235, 255))
        img.resize((size, size), Image.LANCZOS).save(os.path.join(EXT, 'icons', 'icon%d.png' % size))

def main():
    shutil.copy(os.path.join(ROOT, 'web', 'kamotish.js'), os.path.join(EXT, 'kamotish.js'))
    icons()
    man = json.load(open(os.path.join(EXT, 'manifest.json'), encoding='utf-8'))
    fx = dict(man); fx['browser_specific_settings'] = {'gecko': {'id': 'kamotish@kamotish.local', 'strict_min_version': '115.0'}}
    json.dump(fx, open(os.path.join(EXT, 'manifest.firefox.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    os.makedirs(DIST, exist_ok=True)
    files = ['kamotish.js', 'content.js', 'popup.html', 'popup.js'] + ['icons/icon%d.png' % s for s in (16, 32, 48, 128)]
    for name, manifest in (('chrome', 'manifest.json'), ('firefox', 'manifest.firefox.json')):
        with zipfile.ZipFile(os.path.join(DIST, 'kamotish-%s.zip' % name), 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(os.path.join(EXT, manifest), 'manifest.json')
            for f in files: z.write(os.path.join(EXT, f), f)
    print('extension/ ready;', ', '.join(os.listdir(DIST)))

if __name__ == '__main__':
    main()
