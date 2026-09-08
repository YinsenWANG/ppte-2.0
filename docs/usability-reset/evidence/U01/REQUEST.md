# PPTe 实机拒收后重做管道 — Common Rules (usability-reset-1.0)

Repo: /tmp/ppte8, branch work/usability-reset. Base: bad07df (= bf7d6ea + 4097126 audit + bad07df 方案)。
编排者已亲跑基线门禁全绿：pnpm typecheck RC=0、pnpm test RC=0（149 pass / 0 fail / 16 skipped）。

## 用户指令（原话，权威，逐字）
"请读取 audit/main-bf7d6ea 分支提交 bad07df，按 docs/usability-reset/PLAN.md 和 TASKS.json 推进实机拒收后的重做，接续此前未关闭问题；重点完成成稿美学、图片直接操作、可靠保存与 PDF 路线诊断，以真实操作和用户体验为验收标准，完成后提交代码、干净的单 HTML 成稿及逐项证据，涉及 PDF 架构变化时先回交确认。"

## 必读（按序）
1. docs/usability-reset/PLAN.md —— 本轮权威方案（U01-U05 完整交互合同与验收边界）
2. docs/usability-reset/TASKS.json —— 任务清单与验收口径
3. docs/focused-product/PLAN.md / TASKS.json / PDF-AND-CORE-REVIEW.md —— 承接上下文与未关闭项
4. docs/ui-redesign/DESIGN.md —— 视觉语言基准
5. AGENTS.md / README-AGENT.md —— 贡献契约

## 范围与原则（冲突时以 PLAN.md 为准）
- 本轮只做：新成稿美学、图片直接操作、可靠保存、合格 PDF、B2 安全导航。暂停功能扩展。
- 默认阅读/编辑/纯净放映三模式不变；已有文稿和历史数据不删除；继续暂停新增历史。
- 常规实现无需逐项请示；只有架构取舍及用户视觉签收需要回交。
- 可先做不依赖 PDF 的任务，不以 PDF 难点阻塞所有改进。
- 不得用已有绿色测试关闭用户问题；用户已拒收项必须 reopened，不能保留 human pending 淡化拒收。
- 不能虚构故障原因：保存失败路径尚未定位，用户陈述记为体验事实。

## 硬规则
- 每个 acceptance 项要有仓库测试框架内的真实测试（node --test on dist）；每轮结束前自验 `pnpm typecheck && pnpm build && pnpm test` 全绿、无新增红、不弱化或删除既有断言。
- 证据落 docs/usability-reset/evidence/<task>/：IMPLEMENTATION.md + verification/result.json（命令/状态/日志/commit/时间/平台）；真实操作类附截图或视频路径并记 sha256。
- 状态四层：code / automated / real-browser / human；真机与人工拿不到 → pending + 具体原因，禁混谈、禁"代码存在=完成"。
- 提交：`git -c user.name=YinsenW -c user.email=26830614+YinsenW@users.noreply.github.com commit -S --signoff`；任务号前缀（如 `U03: ...`）；一任务一/数提交；**不 push**（编排者统一推送）；结束保持干净树。
- 更新 docs/usability-reset/TASKS.json 的 status/evidence，JSON 保持合法。
- 禁止：整页图片 PDF、透明文字层/OCR 充数、偷偷启动服务或上传、window.print 作为产品 PDF 动作、静默安装重环境、弱化断言/删断言/假证据、复用旧稿换日期宣称美学提升、把复杂参数挪到"更多"菜单。

## 停机门协议（机器可读，必须遵守）
本轮有两个必须回交用户的决策点，不得自行决定：
1. **U01 美学签收**：三个代表页完成后，在 TASKS.json 的 U01 项写入 `"awaiting-user-decision"` 状态，并在 docs/usability-reset/DECISIONS.md 记录（三页截图路径、设计说明、待确认项）。**用户确认前不得生成全稿。**
2. **U04 PDF 架构取舍**：诊断完成后，若结论指向架构变化（外部工具/独立可选依赖）或仍无合格路线，在 TASKS.json 的 U04 项写入 `"awaiting-user-decision"`，并在 DECISIONS.md 记录（候选实测数据、各选项代价、推荐项）。**不得自选架构、不得直接进入产品集成。**

管道检测到标记即停止后续依赖轮次，等待用户裁决。U01 标记不阻塞 U04（诊断可独立进行）。

# PIPELINE TASK U01
Task JSON (authoritative, from docs/usability-reset/TASKS.json):
{
 "id": "U01",
 "title": "重新设计成稿并修正Skill",
 "status": "pending",
 "acceptance": "三个新代表页及完整稿；不复用旧设计冒充提升；用户视觉确认；源码与安装说明一致",
 "evidence": []
}

Implement task U01 fully per its acceptance items; every item needs a real test or (for real-browser/human layers) an explicit pending entry with reason. Read docs/usability-reset/PLAN.md section U01 as the binding interaction contract. Update TASKS.json status/evidence honestly.