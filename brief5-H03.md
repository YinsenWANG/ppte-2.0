# PPTe HTML-first Implementation — Common Rules (pipeline v5)

You are one round of an autonomous implementation pipeline for the PPTe HTML-first
redesign. Repo: /tmp/ppte5, branch design/html-first-reset.

## 用户指令（原话，权威）
"从提交 bbcd46bde2c608b5a56e617f316c5dcb5534857e 读取 docs/html-first/README.md、PLAN.md、TASKS.json 和 REVIEW_DISPOSITION.md，按 H00–H06 实施。无需重新制定总体方案；必要的局部技术选择自行验证并记录。优先打通『直接生成一个 HTML → 编辑 → 自动保存原文件 → 关闭重开 → 干净放映』。不要继续实现已废止的 PPTX／Office 和旧多文件交付目标。每阶段提交代码与真实验证结果；未验证的能力保持未完成。"
## 硬规则
- 禁止实现已废止范围：PPTX/PPT/Office 适配、导出映射、兼容矩阵、旧多文件交付
  （.ppte/CAS/Portable profile 相关新工作）、旧 D07/P01/Q01/Q02 遗留义务。
  已完全退出新调用链的旧代码缺陷按 REVIEW_DISPOSITION.md「范围退休」处理并记录。
- 禁止弱化/删除既有断言来通过门禁；禁止假证据：TASKS.json 改 done 必须附真实
  commit 与通过的测试路径；未验证的能力保持 planned/partial 并写明缺口。
- 每个 acceptance 条目要有仓库测试框架内的真实测试（node --test on dist）。
- 完成前自验：pnpm typecheck && pnpm build && pnpm test 全绿；若本任务涉及
  blackbox/发布脚本，跑对应脚本且无新增红。
- 提交：git -c user.name=YinsenW -c user.email=26830614+YinsenW@users.noreply.github.com
  commit -S --signoff（GPG 不可用则 --signoff 并注明）。提交信息带任务号，如
  "feat(H01): ..."。每任务一提交（或每模块一提交）。
- 不 push（远程推送由管道外的跟推器统一做）、不动 main/其他分支、结束时工作树干净。
- 任务结束时更新 docs/html-first/TASKS.json 的 status/evidence，保持 JSON 合法
  （python3 -c "import json;json.load(open('docs/html-first/TASKS.json'))" 自检）。
- 最终输出：逐项 acceptance 的证据、测试数量增减、新增文件、剩余风险；
  做不完如实报 partial + 缺口，不许虚报。

# PIPELINE TASK H03
Task JSON (authoritative, from docs/html-first/TASKS.json):
{
 "id": "H03",
 "title": "统一设计过的 UI 与日常编辑",
 "status": "planned",
 "dependsOn": [
  "H02"
 ],
 "targetAreas": [
  "packages/html-editor（新）",
  "docs/html-first/UI_PROTOTYPE.html"
 ],
 "deliverables": [
  "先按原型实现顶栏、缩略图、画布、浮动格式栏和上下文面板",
  "完成文字/选区格式、图片/形状、背景、基础表格和对象锁定",
  "DOM 局部撤销重做；绝对定位与 Grid/Flex 用不同变换策略",
  "Agent 局部编辑使用稳定 ID 和 expected hash，保留人工保护对象"
 ],
 "acceptance": [
  "三种对象选择和空/多选/混合值有统一样式；无原始表单墙",
  "普通文字对比度至少 4.5:1、键盘可达、焦点清晰",
  "修改一句话不重建整页；Grid/Flex 重排不偷偷 absolute 化",
  "保存重开保持内容、格式、布局、资源与锁定；操作失败不假成功"
 ]
}

Read PLAN.md/README.md/REVIEW_DISPOSITION.md yourself for full context (do not rely on any paraphrase). Implement task H03 completely per its acceptance list; every criterion gets a real test.
