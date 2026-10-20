# resources/ · 中间产物与额外资源

这里放的是制作卡谋语字形过程中的**原稿、中间产物、检查图和旧备份**。日常使用 (输入卡谋语、浏览器插件、Markdown 转 PDF) **不需要**这里的任何文件；只有重新生成字形、修改字形设计时，`tools/` 里的 Python 脚本才会读写这里。

最终给用户的成品不在这里，而在：`web/kamotish.js` (渲染库)、`extension/` 与 `dist/` (浏览器插件)、`tools/md2pdf/` (Markdown 转 PDF)、`site/` (在线版)。

## 目录说明

| 路径 | 内容 | 谁生成 / 谁使用 |
|---|---|---|
| `sources/` | 手写原稿 PDF：`基本55音.pdf` (字素)、`音调实例.pdf` (音调)、`音素.pdf` (辅音 A/D 形)、`元音.pdf` (元音 B/C 位)、`mou.pdf` | 原始资料；`make_glyphs.py`、`read_consonants.py`、`read_vowels.py` 读取 |
| `glyphs/`、`tones/` | 从原稿描出来的手写字素、音调 (SVG) 和 `tones.json` | `make_glyphs.py` 生成 |
| `glyphs-shape/`、`tones-shape/` | 按 `tools/shapes.py` 里手工构造的骨架画出的单线字形 | `shapes.py` 生成 |
| `glyphs-sout/`、`tones-sout/` | 骨架加粗后的轮廓 (竖画 8，横画细 16%) | `outline.py 8 0.16 shape sout` 生成 |
| `glyphs-final/`、`tones-final/` | 轮廓移到汉字中心后的**最终字形** SVG | `align.py` 生成；`syllables.py`、`test_js_parity.py` 使用 |
| `glyphs-outline/`、`glyphs-print/`、`glyphs-design/`、`glyphs-dout/` 及对应的 `tones-*` | 早期试验过的几种字形风格 (手写描边、印刷体、设计体等) | `outline.py`、`typeset.py`、`design.py` 生成；目前不用于成品 |
| `consonants/` | 从 `音素.pdf` 读出的辅音笔画 `raw.json`、元音 `vowels_raw.json`，以及 A/D 形草图 | `read_consonants.py`、`read_vowels.py`、`deform.py` |
| `consonants-final/` | 辅音 A/D 形的最终轮廓、每个辅音在音节块中的位置 **`geometry.json`**、预览图 | `compose_consonants.py` 生成；**`export_js.py` 和 `syllables.py` 需要 `geometry.json`** |
| `fonts/` | 霞鹜漫黑 (LXGW Marker Gothic)，只用于早期的排版样张；**SIL OFL 1.1 协议**，见 `OFL-LxgwMarkerGothic.txt` | `render.py`、`samples/*.html` |
| `samples/` | 排版样张、风格对比图、测试文本 (`test*.txt`/`.html`/`.png`、`sheet_*`) | 开发过程中的检查材料 |
| `preview.png` | 早期全部字素的总览图 | 旧的 `preview.py` 生成 |
| `backups/` | 2026-10-13 重新设计字形之前的完整备份 | 仅存档 |

## 重新生成字形和渲染库

需要 Python 3 和 Pillow (`pip install pillow`)；从 PDF 原稿重新读取笔画还需要 `pdftocairo` (poppler)。

```sh
cd tools
sh build.sh                  # shapes.py -> outline.py -> align.py, 生成 resources/glyphs-final/ tones-final/
python3 export_js.py         # 生成 web/kamotish.js
python3 build_extension.py   # 复制到 extension/，打包 dist/*.zip
python3 test_js_parity.py    # 对比 JS 与 Python 的结果 (需要 Chrome；可用 CHROME=/路径 指定)
```

说明：`preview.py` 是早期脚本，依赖已经不存在的 `glyphs/01.svg` 这种编号文件名，目前不能运行，仅作存档。
