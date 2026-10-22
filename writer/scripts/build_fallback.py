#!/usr/bin/env python3
"""Bundle a ready-to-use, full open-source Hanzi reading fallback from xpinyin (LPPL-1.3c+)."""
import json
import re
import unicodedata
from pathlib import Path

source = Path('/usr/share/texlive/texmf-dist/tex/latex/xpinyin/xpinyin-database.def')
if not source.exists():
    raise SystemExit('TeX Live xpinyin database is required to regenerate fallback; a built fallback.json is included.')
text = source.read_text()
rows = re.findall(r'\\XPYU\{([^}]+)\}\{[^}]+\}\{([^}]+)\}', text)
d = {}
for han, accented in rows:
    py = ''.join(ch for ch in unicodedata.normalize('NFD', accented.lower().replace('ü', 'v')) if unicodedata.category(ch) != 'Mn')
    if re.fullmatch('[a-z]+', py):
        d.setdefault(py, []).append(han)
# Make ordinary modern simplified characters precede Hanzi in Ext A or Ext B.
for py, values in d.items():
    values.sort(key=lambda x: (not (len(x) == 1 and '\u4e00' <= x <= '\u9fff'), x))
out = Path(__file__).resolve().parent.parent / 'data' / 'xpinyin-fallback.json'
out.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print('xpinyin:', len(rows), 'characters,', len(d), 'pronunciations,', out.stat().st_size, 'bytes')
