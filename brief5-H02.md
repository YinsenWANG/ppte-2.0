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

# PIPELINE TASK H02
Task JSON (authoritative, from docs/html-first/TASKS.json):
{
 "id": "H02",
 "title": "原文件保存、自动保存与恢复",
 "status": "planned",
 "dependsOn": [
  "H01"
 ],
 "targetAreas": [
  "packages/html-save（新）",
  "apps/html-cli（新）",
  "packages/html-editor（新）"
 ],
 "deliverables": [
  "ppte edit file.html 提供可安装使用的 loopback 编辑/保存入口",
  "绑定文件、冲突检查、串行保存、临时写入替换、版本恢复",
  "浏览器 File System Access 适配，实际能力探测和首次授权流程",
  "IME 收口、800 ms 停顿保存、明确状态、草稿恢复与失败重试"
 ],
 "acceptance": [
  "原路径编辑关闭重开及进程重启保留修改；不是打开下载副本才生效",
  "磁盘满/只读/权限撤回/中断/双窗口/外部 Agent 修改不静默丢失",
  "只有文件写入确认后显示已保存，浏览器缓存单独标识",
  "loopback 之外不可访问，跨站/无令牌/路径穿越写入被拒绝",
  "Safari 本地编辑路径实测；file 直开受限行为也实测并明确展示"
 ]
}

Read PLAN.md/README.md/REVIEW_DISPOSITION.md yourself for full context (do not rely on any paraphrase). Implement task H02 completely per its acceptance list; every criterion gets a real test.
