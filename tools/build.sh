#!/bin/sh
# Rebuild everything from the hand-constructed skeletons in shapes.py.
set -e
cd "$(dirname "$0")"
python3 shapes.py                       # skeletons  -> resources/glyphs-shape/, tones-shape/
python3 outline.py 8 0.16 shape sout    # outlines   -> resources/glyphs-sout/, tones-sout/  (stem 8, horizontals 16% thinner)
python3 align.py > /dev/null            # centre on the 汉字 centre -> resources/glyphs-final/, tones-final/
echo "built: resources/glyphs-final/ resources/tones-final/"
