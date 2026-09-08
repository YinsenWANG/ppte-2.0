# DLV — 最新运行时的单文件九页交付

基线 f0322bc，承接 FOLLOWUP 第 5 项；R02 实现 73c7906、R01 实现 ffe888d、R03 实现 1ebf560 已在当前分支。本轮不更换设计、不修改九页作者源稿、不改变 PDF 裁决。

## 交付与本地安装

唯一交付文件：[Cherry Studio · 开源之路](delivery/Cherry-Studio-开源之路.ppte.html)。delivery 目录只有此 HTML。诊断操作只发生在 artifacts 的测试副本，测试结束断言交付文件字节未变。

执行 `node scripts/prepare-audit-delivery.mjs`：按 README-AGENT.md 打包，npm offline/ignore-scripts 安装到独立本地目录，运行安装版 CLI 的 skill-install，再用同一 CLI 对 U01/source/full-deck.html 增强一次。没有重写成稿或生成图片，无局部修复轮次。已逐页查看九张实际放映截图：保留纸白/墨色/朱红、可编辑文字和原有概念图；无诊断标题或测试插图。此检查不代替用户九页签收。

当前应使用的安装目录、CLI 和 Skill 绝对路径见 verification/installation.json；新目录带 audit-followup 版本后缀，旧安装保留。让本地 Agent 读取该 receipt 的 skill 路径下 SKILL.md，并使用 cli 字段指定的命令。源码 Skill、包内 Skill、安装 Skill 完全等值；包内 README 与 README-AGENT.md 完全等值，摘要已记录。现有 HTML 不会随安装自动更新，因此本次显式交付重新增强的文件。脚本拒绝覆盖现有成稿；再次打包前须为新一轮指定新的交付目录，不删除旧稿绕过保护。

## 验收映射

- tests/audit-delivery.test.ts 经 dist/node --test 执行：交付正文（包括原图资源）严格等于当前增强器处理原九页源稿的正文；运行时脚本严格等于当前构建。目录只能有一个成稿，安装回执中的成稿/源稿/Skill/README 摘要均匹配。
- 同文件九页离线阅读/纯净放映，逐个文本元素与 Range 真实边界框检查无页面溢出，作者页为 1280×720；图片解码为 640×440、contain，概念图说明保留。PDF 入口保持禁用。截图前后正文严格相等。
- 实际编辑标题、撤销/重做、一次真实下载，检查下载正文与编辑正文严格相等；退出 headless 浏览器进程后新进程重开，九页、文字和图片保留；原交付字节不变。
- tests/u05-delivery.test.ts 保留原 U05 样本及全部断言，新增 DLV 成稿参数，同样执行九页→改文字→插图→拖动/缩放/裁切→撤销/重做→磁盘桥写入→退出进程→重开→放映。真实文件字节和裁切模型保留断言不变。磁盘桥替代的是选择器和句柄，只属 automated；不冒充原生写回。
- R01/R02/R03 的完整合同矩阵随全仓门禁重跑，旧断言未删除/弱化。各项原生和用户状态继续 pending，细目仍见各任务证据。

四层最终状态、命令/时间/平台/提交/日志见 verification/result.json。真机与人工未通过，整体仍未验收；PDF 按 U04 选项 1 维持未完成。原生第 4 项交回 [本地步骤](NATIVE-VALIDATION.md)。
