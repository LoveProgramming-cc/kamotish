# 卡谋语渲染（浏览器插件）

把网页里**任意文字**中的 `\kamotish{ … }` 渲染成卡谋语文字。纯本地运行，不联网，不需要任何服务器；
安装后可以脱离这台电脑单独使用（把安装包拷到别的电脑照样装）。

## 怎么写

```
我叫 \kamotish{ma-tas-jian}，他叫 \kamotish{su-kun-liang}。
```

括号里面的写法就是《卡谋语书写说明》里的写法（拼读、`\字素名`、音调 `\1`…）。

括号里要写 `{`、`}`、`\` 这三个字符本身时，用转义：

| 想要 | 写成 |
|---|---|
| `{` | `\{` |
| `}` | `\}` |
| `\` | `\\` |

其余的反斜杠原样交给渲染器，所以 `\kamotish{\mou\1}`（字素 mou 带音调 1）直接就能用；
`\\mou` 转义后得到 `\mou`，同样是字素 mou。

- 括号可以跨格式：`\kamotish{ma-<加粗>tas</加粗>-<链接>jian</链接>}` 也会被整体识别（括号内部的格式会被去掉）。
- 括号里换行、`<br>` 都可以，换行会显示成换行。
- 没有写 `}` 结尾的，保持原样，不处理。括号不能嵌套。
- 不会处理：代码（`<code>`、`<pre>`）、输入框、可编辑区域、脚本。
- 动态加载出来的内容（滚动加载、单页应用）也会处理。
- 点工具栏上的插件图标，可以整体开关，或只在当前网站关闭；关闭时已渲染的内容会还原成原来的文字。

## 安装

**Chrome / Edge / Brave 等（Chromium 内核）**

1. 把 `kamotish-chrome.zip` 解压成一个文件夹（或直接用本目录 `extension/`）。
2. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开右上角“开发者模式”。
3. 点“加载已解压的扩展程序”，选那个文件夹。

**Firefox**

- 临时加载：打开 `about:debugging#/runtime/this-firefox`，点“临时载入附加组件”，选解压后文件夹里的 `manifest.json`
  （用 `kamotish-firefox.zip`）。重启浏览器后需要重新载入。
- 长期安装：需要 Mozilla 的签名（在 addons.mozilla.org 上传 `kamotish-firefox.zip` 选“仅自行分发”即可自动签名，
  不用公开发布），或使用 Firefox 开发者版 / Nightly 并把 `xpinstall.signatures.required` 设为 `false`。

> 本地的 `file://` 网页：Chrome 需要在插件详情页打开“允许访问文件网址”才会处理。

## 文件

| 文件 | 作用 |
|---|---|
| `manifest.json` | 插件清单（Chrome / Edge） |
| `manifest.firefox.json` | Firefox 用的清单（多了插件 id） |
| `content.js` | 在网页里找 `\kamotish{…}` 并替换 |
| `kamotish.js` | 渲染库（字素、音节、圈、音调） |
| `popup.html` / `popup.js` | 工具栏弹窗（开关） |
| `icons/` | 图标 |

重新打包：`python3 tools/build_extension.py`，生成 `dist/kamotish-chrome.zip` 和 `dist/kamotish-firefox.zip`。

## 输入框实时预览
在文本框、输入框或可编辑区里输入 `\kamotish{…}` 时，输入框上方（空间不够则下方）会出现一条预览条，实时显示括号里的渲染结果；还没写 `}` 时以淡色显示。发送后，页面上的文字会被正式渲染。
