#!/bin/sh
# 双击启动: 卡谋语 Markdown → PDF 网页版. 关闭这个终端窗口即停止.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
# 文稿编辑器的完整中文词库 (雾凇拼音). 第一次运行时下载并编译, 之后直接使用.
[ -f ../../writer/data/rime-index.json ] || python3 ../../writer/scripts/build_rime_ice.py --output-dir ../../writer/data || echo "词库下载失败, 输入法暂用基础字表"
(sleep 1; open http://127.0.0.1:4747) &
exec node server.js
