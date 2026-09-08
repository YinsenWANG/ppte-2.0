# R01 — 固定顶栏公共动作与保存槽位

本轮仅修复 REPORT.md 的 R01，承接当前分支 R02（747c03b），未改变 R03/PDF/原生验收边界。

## 实现与合同对应

- `shell-components.ts`：桌面标题弹性占剩余空间；保存按钮 140px、状态 142px 独立保留，模式/PDF/放映按右侧固定位置排列。阅读态使用 `visibility:hidden` 保留保存槽位，隐藏控件退出焦点导航与可访问树，不使用透明覆盖或动画。
- 去除 pristine 状态伪元素替换和下载状态换行引起的宽高变化。状态单行截断，完整文本仍在状态可访问内容、title 与保存面板 `.save-detail` 内。
- 390px 下明确两行三列 `repeat(3,minmax(0,1fr))`，第一行标题/保存/状态，第二行模式/放映/PDF；主动作保持有界宽度，下载中文标签完整可见。阅读和编辑顶栏分别保持同样 100px 高度，桌面保持 56px。
- `accessibility.ts`：保存面板在整个顶栏下展开，并按可用视口高度滚动。错误仍可展开说明，但不参与顶栏布局，不遮挡第二行公共动作。
- `index.ts`：关联按钮因关联成功而隐藏前，将其焦点移交主保存按钮；成功关闭面板时同样避免焦点落到隐藏内容。用户在保存期间主动移到正文的焦点不会被抢回。
- 画布仍按编辑工具条适配；测试断言编辑态 iframe 顶部高于阅读态，并未冻结整页。

## 仓库内真实断言

`tests/audit-r01.test.ts` 经 build 后由 `node --test dist/tests/*.test.js` 执行，六组（1440/1024/390 × 写回/下载），各八个状态快照。

每一状态用 `getBoundingClientRect()` 核对公共按钮以及标题、保存按钮、状态槽全部 x/y/width/height 相对阅读态变化 ≤1 CSS px，检查可见顶栏控件两两无重叠、无水平溢出、展开面板位于顶栏下且在视口内。检查 `document.activeElement`、Tab/Enter、隐藏保存控件无法 focus 且不出现在角色查询中、完整下载标签的 scroll/client 宽高。不是以 CSS 类或截图存在替代断言。

写回：注入 File System Access 句柄桥接真实本地文件，点击首次说明及关联按钮，阻塞 close 捕获保存中，释放后验证字节与重开正文；后续真实桥接写入失败、外部追加字节触发 hash 冲突，并验证修改保留。没有调用原生选择器，不作为原生保存验收。

下载：移除 picker 能力，点击真实下载并检查完整 HTML 字节、原文件不变、独立页面重开正文。下载本来没有磁盘保存中/成功确认语义；saving/failed/conflict 由控制器注入作**布局渲染夹具**，清楚记录在测试与截图内，不声称这些是下载落盘结果。success 指真实下载字节接收。

证据 `verification/*-positions.json` 包含真实坐标、平台、浏览器版本、时间及重开文件 SHA256；`screenshots/` 是实际 Chrome headless 截图。旧复现仍保留在上级目录（包括 390-dirty.png、positions.json），供前后对照。

## 交付与分层状态

最终命令、返回码、日志、实现提交见 `verification/result.json`；文件摘要见 `SHA256SUMS`。`Cherry-Studio-开源之路.ppte.html` 从未改动的九页 full-deck.html 重新增强，未使用测试修改后的文件，没有诊断标题或插图。

- code：passed。
- automated：以 result.json 的最终门禁为准，包含真实 Chrome headless 自动化。
- real-browser：pending。当前工具目录无原生桌面输入/系统选择器控制通道；headless 与模拟句柄不能证明真实授权、原文件手动/自动写回、退出整个桌面浏览器后重开。
- human：pending。未获得目标设备操作与用户体验确认。

本地交接：用交付文件副本在桌面 Chrome 于三个视口执行阅读→编辑→修改→保存中→成功/失败/冲突→阅读，检查按钮稳定、焦点、面板；分别测真实写回及实际不支持写回的下载环境。原生授权、手动/自动写回、完全退出重开与录屏/摘要沿用 FOLLOWUP 第4项。R03 留给后续任务，PDF 继续未完成，不新增服务或放宽验收。

## 首轮门禁与测试迁移

`verification/first-run/` 保留首轮完整门禁失败记录。S02 原测试在阅读态通过 `innerText` 读取保存状态：旧 `display:none` 下返回隐藏 DOM 文字，`visibility:hidden` 下返回空串。按 R01 合同，阅读态不应呈现或朗读该状态。

`tests/single-file-save.test.ts` 保留原正文与“发现匹配草稿”正则断言，新增阅读态不可见/不可访问断言，再真实点击编辑后执行原状态文字断言。没有删除、弱化或跳过既有断言；最终全仓重跑日志与首轮分开保存。
