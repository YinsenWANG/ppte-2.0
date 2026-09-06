# 新版 Skill 的实际生成记录

本轮 Agent 读取仓库 `skills/ppte/SKILL.md`，以 HANDOFF、PLAN、TASKS、S04 原始性能比较为材料，选择深绿/米白的文字叙事方向，直接编写四页原生 HTML/CSS。没有用户图片，故跳过图片分析、联系表与预处理安装。没有下载字体、安装工具、额外模型或服务。本文是行为记录，不是 provider 遥测。

主成品：[把作品带走.ppte.html](delivery/把作品带走.ppte.html)。源稿：[source.html](source.html)。增强复用现有 `dist/apps/html-cli/index.js`：

```sh
node dist/apps/html-cli/index.js enhance docs/single-file-first/evidence/s08/source.html --out /新目录/把作品带走.ppte.html
node docs/single-file-first/evidence/s08/verify.mjs
```

增强器拒绝覆盖已有文件；复现生成应使用新输出路径。探针验证仓库当前交付文件，不重新生成它；它会更新本轮截图与下载验证副本，复跑时应另存新证据，不覆盖已提交的历史记录。

原始首稿与增强输出保留在 verification/first-draft.*。第一次探针发现 h1 的 scrollHeight 超出 clientHeight；第一轮仅增加封面标题行高。第二次探针发现 h2 同类问题；第二轮仅增加副标题行高。对应 correction-1.*、probe-first-failure.log、probe-second-failure.log、全部 enhance JSON 均保留。未删事实、未缩小文字、未放宽任何探针断言。

**快速路径不合格**：实际进行了两轮局部修正，超过 Skill 的一次必要修正快速路径（未超过两轮绝对上限）。本次开发验收样本不能被称为一次增强/一次修正成功，也不计入九对受控生成统计。这一过程偏差仍需后续真实生成验收；不改 Skill 来迁就结果。

最终 probe.log 对应成功运行，final-single-file.json 记录哈希、浏览器、四页边界、隔离目录离线请求、真实下载与新浏览器进程重开、每次仅一页放映及 Esc 返回。用户目录只放一个成品；下载测试副本在 verification，不是第二个默认交付物。现行全套测试通过后未修改产品代码。

Agent 实际查看 page-1.png 至 page-4.png：标题与正文可读，页码和注脚可见，两列未相互覆盖。第 3 页明确写入性能未达标，第 4 页列出未验收项。这只是当前模型的视觉观察，不是人工审美、Safari 或真实用户设备证明。四页无位图，不声称验证了图片理解/裁切能力。

本轮没有 provider 模型身份/逐次 usage/端到端计时回执；这些字段为 unavailable。日志中的 CLI 摘要和测试墙钟不能代替生成 tokens 或模型等待时间。
