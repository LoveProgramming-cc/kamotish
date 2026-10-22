#!/usr/bin/env python3
"""Compile the GPL-3.0-only Rime Ice annotated dictionaries for static web serving.

The generated data is separately licensed GPL-3.0-only (iDvel/rime-ice).
This is a dictionary importer, NOT librime or a full Rime IME implementation.
"""
import argparse
import json
import math
import re
import urllib.request
from collections import defaultdict
from pathlib import Path

BASE = 'https://raw.githubusercontent.com/iDvel/rime-ice/{ref}/cn_dicts/{filename}.dict.yaml'
FILES = ('8105', 'base', 'ext', 'others')  # all have explicit reading for relevant entries
VALID_CODE = re.compile(r'^[a-zvü ]+$')


def parse_lines(raw, name):
    """Yield (concatenated_pinyin, Chinese_word, int_weight) from Rime YAML TSV."""
    within = False
    for ln in raw.splitlines():
        if not within:
            if ln.strip() == '...':
                within = True
            continue
        ln = ln.strip()
        if not ln or ln.startswith('#'):
            continue
        cells = ln.split('\t')
        if len(cells) < 2:
            continue
        word, code = cells[:2]
        code = code.strip().lower().replace('ü','v')
        if not VALID_CODE.fullmatch(code):
            continue
        sylls = code.split()
        if not sylls or any(len(x) > 7 for x in sylls) or len(sylls) > 12:
            continue
        if len(word) > 14 or not word:
            continue
        # Base/ext can contain named entities, digits etc, which don't belong in normal Chinese suggestions.
        if not any('\u3400' <= ch <= '\u9fff' for ch in word):
            continue
        weight = 1
        if len(cells) >= 3:
            try:
                weight = int(float(cells[2].split('#')[0].strip()))
            except (ValueError, OverflowError):
                pass
        yield (''.join(sylls), word, max(1, weight))


def compile_dict(texts, dest, minimum=0):
    groups = defaultdict(dict)
    lines = 0
    for name, data in texts.items():
        for key, word, weight in parse_lines(data, name):
            previous = groups[key].get(word)
            if previous is None or weight > previous:
                groups[key][word] = weight
            lines += 1
    if lines < minimum:
        raise RuntimeError(f'Only {lines} entries parsed; source might have changed its schema')
    output_dir = Path(dest)
    subdir = output_dir / 'rime-ice'
    subdir.mkdir(parents=True, exist_ok=True)
    shards = defaultdict(dict)
    kept = 0
    for key, words in groups.items():
        # Different files use different absolute weight ranges. Sort by relative weight per code.
        # Keep 12 candidates per reading to bound download and parse time.
        top = sorted(words.items(), key=lambda x: (-x[1], len(x[0]), x[0]))[:12]
        shards[key[0]][key] = [[word, weight] for word, weight in top]
        kept += len(top)
    for first, shard in shards.items():
        (subdir / f'{first}.json').write_text(json.dumps(shard, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    index = {'source': '雾凇拼音 Rime Ice (iDvel/rime-ice)',
             'license': 'GPL-3.0-only', 'files': list(texts), 'characters': sorted(shards),
             'pinyinKeys': len(groups), 'candidates': kept,
             'shardRoot': 'data/rime-ice/'}
    (output_dir / 'rime-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Rime Ice dictionary keys:', len(groups), 'candidates:', kept, 'shards:', len(shards))
    return index


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--ref', default='main', help='Git ref (default main; prefer pinned commit for reproducibility)')
    ap.add_argument('--input-dir', help='Use local Rime YAML files for offline testing')
    ap.add_argument('--output-dir', default='data')
    ap.add_argument('--min-entries', type=int, default=100000)
    args = ap.parse_args()
    texts = {}
    for filename in FILES:
        if args.input_dir:
            data = (Path(args.input_dir) / (filename + '.dict.yaml')).read_text(encoding='utf-8')
        else:
            url = BASE.format(ref=args.ref, filename=filename)
            req = urllib.request.Request(url, headers={'User-Agent': 'KamotishWriterDictionaryBuilder/1.0'})
            print('Downloading:', url, flush=True)
            with urllib.request.urlopen(req, timeout=180) as response:
                data = response.read().decode('utf-8-sig')
        texts[filename] = data
        print(filename, 'bytes:', len(data.encode('utf-8')), flush=True)
    compile_dict(texts, args.output_dir, minimum=args.min_entries)

if __name__ == '__main__':
    main()
