#!/bin/sh
# 双击启动: 卡谋语 Markdown → PDF 网页版. 关闭这个终端窗口即停止.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
(sleep 1; open http://127.0.0.1:4747) &
exec node server.js
