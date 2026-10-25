# 卡谋语 Kamotish

卡谋语 (Kamotish) 是一种人造语言。本仓库是它的**文字渲染工具**：把用拉丁字母和 `\字素名` 写成的输入，渲染成卡谋语文字。

```
\kamotish{\mi\wou\3中国人\mou\2}      →  渲染成卡谋语文字
```

**在线使用**：<https://loveprogramming-cc.github.io/kamotish/>，可以试写卡谋语，预览、修改 Markdown 并导出 PDF，不用安装任何东西。

## 包含什么

| 工具 | 用途 | 位置 |
|---|---|---|
| **渲染库** | 一个 JS 文件，没有依赖；网页引入后用 `<kamo-text>` 或 `Kamotish.render()` 显示卡谋语 | [`web/kamotish.js`](web/kamotish.js) |
| **浏览器插件** | 任何网页 (聊天、文档、论坛) 里的 `\kamotish{…}` 自动显示成卡谋语；输入框里实时预览 | [`extension/`](extension/)、安装包在 [`dist/`](dist/) |
| **文档工具** | Markdown (含卡谋语和数学公式) 预览、定位并修改写错的卡谋语、导出 PDF。在线版打开即用；本地版另外支持按路径载入、批量导出、自动页码 | 页面 [`site/`](site/)，本地服务 [`tools/md2pdf/`](tools/md2pdf/) |
| **文稿编辑器** | 仿 Google Docs 的文稿编辑：菜单栏、格式工具栏与快捷键、查找替换、链接、表格、图片；卡谋语输入法与逐字素编辑；直接导入 Markdown（含本地插图），导出 `.kamodoc` / MD / PDF | [`writer/`](writer/) |
| **markdown-it 插件** | 在自己的 markdown-it 项目里支持 `\kamotish{…}` | [`web/markdown-it-kamotish.js`](web/markdown-it-kamotish.js) |
| **字形制作工具** | 从手写原稿到最终字形、再到渲染库的全部 Python 脚本 | [`tools/`](tools/) |

## 文档

- **[使用手册](docs/使用手册.md)**：输入方法、插件安装、Markdown 转 PDF、在自己的网页里使用、重新生成字形。
- **[卡谋语书写说明](docs/卡谋语书写说明.md)**：完整的输入格式规范。这份文档是写给 AI 读的，把它交给 AI，AI 就能写出可以渲染的卡谋语。

## 快速开始

**本地版文档工具**：需要 [Node.js](https://nodejs.org/) 18 以上和 Google Chrome (或 Edge / Chromium)。

```sh
cd tools/md2pdf
npm install
npm start            # 打开 http://127.0.0.1:4747
```

在 macOS 上也可以直接双击 `tools/md2pdf/启动.command`。

## 目录结构

```
web/            渲染库 kamotish.js、markdown-it 插件、共用的 Markdown 设置、演示页
extension/      浏览器插件源码
dist/           浏览器插件安装包 (zip)
tools/          Python 字形工具 (生成 kamotish.js)
tools/md2pdf/   文档工具的本地服务 + 命令行
site/           文档工具页面 (在线版和本地版共用)
docs/           使用手册、书写说明
resources/      原稿、中间产物、样张、备份 (见 resources/README.md)
```

## 协议

[MIT](LICENSE)。例外：`resources/fonts/` 里的霞鹜漫黑字体使用 SIL Open Font License 1.1。

## Markdown、插图与页码

- 在线版与本地版都可选择或拖入包含 Markdown 和图片的整个文件夹，按相对路径加载插图。单独选择 `.md` 无法授权读取旁边的图片。
- 主页面的“文稿编辑”是同页工作区。文档预览中的“编辑文稿”会带入源码与图片，编辑后切回“文档 → PDF”可继续排版。编辑器的“文件”菜单提供单文件导入、文件夹导入、原生文稿保存与 Markdown 导出。
- 编辑器与试写模式共用 `web/kamotish.js`，字素使用 `\nou`。编辑器读取旧文稿时迁移旧字素 `\no`。
- PDF 可设置是否加入页码、格式（当前页 / 总页数、仅页码、第 N 页）、底部对齐与字号。在线打印建议使用新版 Chrome / Edge，并关闭浏览器自带“页眉和页脚”，避免重复。默认文件名采用当前 Markdown 文件名。
- 编辑器中的插图会保存在 `.kamodoc` 中；导出 MD 保留原相对图片路径，分享时须同时带上图片文件夹。

本地统一运行：`npm ci --prefix tools/md2pdf`，然后 `node tools/md2pdf/server.js`。打开 `http://127.0.0.1:4747/`，点击“文稿编辑”；旧 `/writer/` 地址会转到主页面。编辑器使用的词库及许可说明见 [writer/README.md](writer/README.md)。

## 文稿库与插入

进入“文稿编辑”先显示“我的文稿”。可新建、搜索、打开、重命名、创建副本、关闭和删除文稿；关闭后内容仍保存在列表中，刷新不会直接打开上次的正文。旧版单份自动缓存会迁移为列表中的一份文稿。文稿与图片使用此浏览器的 IndexedDB 保存，`⌘/Ctrl+S` 立即保存到文稿库；下载备份请用“文件 → 下载原生文稿”。

“插入”菜单可插入本机图片、指定行列数与表头的表格、分隔线和卡谋语。插入的图片会嵌入原生文稿；表格和图片也可传回 PDF 工作区继续排版。

文档 → PDF 的“导出报错”可一键下载所有已载入 Markdown 的卡谋语渲染错误报告（UTF-8 `.txt`），包含文档名、错误数量、行列位置、完整源码、错误片段和原因；报告使用当前编辑内容。
