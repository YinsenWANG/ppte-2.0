# H03 门禁修复：等待窗口布局完成后检查焦点

依据仍为 `bbcd46bde2c608b5a56e617f316c5dcb5534857e` 中的 README、PLAN、TASKS 和 REVIEW_DISPOSITION；不修改总体方案。此前 H03 实现在 `4f1838f7df7d6a1fdcac7e6a59f1a6984cb524e5`，本轮只修正测试驱动的窗口缩放同步，增加新版编辑器回归，不增加旧格式功能。

## 真实复现与根因

- 默认 Node 22.23.2：`pnpm test` 为 433/433；H03 + H02 单独复跑 24/24。首次跑绿没有被算作修复。
- Node 24.19.0（`PATH=/opt/homebrew/bin:$PATH pnpm test`）：433 项中 432 通过、1 失败，见 [node24-before.log](verification/fix/node24-before.log)。失败为 `dist/tests/table-editing-journey.test.js` 的 `F02 A13/A21 real Host and file Portable table selection, paste, styles, structure, save/reopen/undo journey`，缩窄窗口后的焦点检查得到 `false !== true`。
- 在同一实际浏览器旅程中连续切换 700/1600 px，记录 resize/focus 事件与断言时的 DOM 状态，复现 `focused:false, connected:false, active:"单元格值", liveFocused:true`。见 [resize-detached.log](verification/fix/resize-detached.log)。页面中当前的输入框有焦点；Playwright 断言持有的是刚被 resize 替换的旧节点。
- `setViewportSize` 的协议完成不等于页面已处理 resize。旧 Portable 的 `fit → show → renderTableEditor` 会替换属性控件，浏览器事件与 locator 解析/执行的协议往返之间存在竞态。诊断补丁 [resize-probe.patch](verification/fix/resize-probe.patch) 以 `bc55a83` 为基准，仅用于复现；未作为产品代码合入。

## 修正与验证方法

`tests/helpers/browser-viewport.ts` 在改变窗口前监听真实 resize，确认目标宽高，并等待随后两个 animation frame，使本轮布局与 ResizeObserver 工作完成。等待有 10 秒上限，并清理监听和帧回调；没有固定睡眠、重新聚焦或重试焦点断言。

旧旅程仅将两个 `setViewportSize` 调用替换为该辅助函数。原 `n === n.ownerDocument.activeElement` 严格断言、窄屏截图、编辑/保存/重开/撤销断言全部保留，没有跳过测试或更改通过条件。

新增 H03 测试先聚焦字号输入框并设置文本选区，连续四次改变窗口宽度；不重新聚焦，检查原输入节点仍连接且持有焦点、选区范围相同、标题和页面节点引用不变、撤销栈无新增条目。测试在仓库框架内编译为 `dist/tests/html-editor.test.js`。

重点运行 `node --test dist/tests/html-editor.test.js dist/tests/table-editing-journey.test.js` 为 14/14，见 [focused.log](verification/fix/focused.log)。另外用 [resize-stress.patch](verification/fix/resize-stress.patch) 增加 40 次实际窗口切换及同一严格焦点断言，表格旅程 6/6 通过，见 [resize-stress-fixed.log](verification/fix/resize-stress-fixed.log)；压力补丁在最终门禁前撤回，常规测试没有额外循环。补丁中的旧测试用于重现/验证通用测试驱动竞态，不是新的 Portable 功能承诺。

## 四项 acceptance 对应

| 条目 | 仓库实际测试 |
|---|---|
| 统一对象、空选、多选、混合值 UI | `dist/tests/html-editor.test.js: H03 acceptance 1`；实际运行时截图 |
| 普通文字 ≥4.5:1、键盘与焦点 | 同上 `H03 acceptance 2`；新增 `H03 acceptance 2/3: viewport changes retain focused format control, selection and original DOM without edits` |
| 局部编辑、不重建页、Grid/Flex 保持流式 | 同上 `H03 acceptance 3`、native typing history、guarded SVG/hash race；新增缩放节点身份检查 |
| 原路径保存重开保留内容/格式/布局/资源/锁定，失败不假成功 | 同上 `H03 acceptance 4`、original-file persisted range、guarded SVG；H02 保存测试同时由完整门禁回归 |

修复提交为 `bec13dc14f4f01e09211d513dfaa90e8c8d3cedd`（GPG 签名并 signoff）。Node 24.19.0 下最终 `pnpm typecheck`、`pnpm build`、`pnpm test` 均以 0 退出，434/434 通过、0 失败、0 跳过；完整日志为 [test.log](verification/fix/test.log)。最终完整门禁结果与实际提交号记录于 [verification/fix/result.json](verification/fix/result.json)。历史 7 个 H03 测试全部保留，本轮新增 1 个：全套由 433 增至 434，删除 0；H03 由 7 增至 8。

## 范围与剩余边界

新 CLI/runtime 的 esbuild 实际输入图由 `dist/tests/html-document.test.js: H01 acceptance 4` 校验；新路径仅依赖 html-document/html-save/html-editor，不调用 Portable、旧 editor-dom、Core 或 Office。原始输入图保存在本轮验证目录的 `imports-and-drafts.json`。

按“范围退休”处置旧 Portable 属性面板重建策略，不将其作为 H03 新产品开发义务；本轮没有修复或扩充旧产品实现，也没有删除其现存门禁。尚未完成的 H05 发行包整体剥离不在此声称已完成。

R02 以新版 UI、对比度、键盘/焦点实测承接；R01 完整放映仍属于 H04。H02 的 Safari 远程自动化与原生授权/撤回仍未验证；H00/H06 同模型、人工盲评、真实设备证据不变。此次浏览器自动化不能代替这些证据。撤销栈仍仅限本次会话，复杂 SVG 的编辑边界不变。未改 blackbox 或发布脚本，未增加 Office/PPTX/.ppte/CAS 交付工作。
