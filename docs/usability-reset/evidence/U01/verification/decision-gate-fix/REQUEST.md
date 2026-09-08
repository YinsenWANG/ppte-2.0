# PIPELINE TASK U01-FULL — 扩展完整稿（用户已签收三页方向）

## 用户签收（2026-09-08 20:13，权威）
Yinsen：「可以，先这么做吧」→ 认可三页样稿（封面/图文页/信息密集页）的整体视觉方向、封面大字与留白、图文比例、密集页可读性，同意据此扩展完整稿。记录见 docs/usability-reset/DECISIONS.md。

## 本轮范围
按已签收的三页方向生成**完整稿**：
- 保持同一视觉语言（纸白/墨色/少量朱红/系统中文字体），整稿一致；内容与页面构图要有变化，不得复用旧稿换日期
- 继承主题和必要事实，事实有变化须查项目一手来源；不用未经验证的实时数字
- 图片仅在能帮助叙事时使用，实际查看素材、理解主体与合适裁切，标明概念图，不假冒产品截图
- 保持文字可编辑，不能截图整页；不用大量装饰补空，也不每页换背景色制造变化
- 区分成稿审美与编辑器 UI；轻量 Skill 提醒只含视觉中心/留白/层级对齐/字体色彩，不设固定色板/字数/布局模板或审美评分门禁

## 验收（U01 acceptance 剩余项）
- 完整稿：单个 .ppte.html
- 三代表页截图保留为开发证据
- 记录一次增强/必要局部修复的耗时与调用数；不得为验收反复整稿再生成
- 最终完整稿必须由用户认可，未认可保持待验

## 硬规则
- 门禁全绿：pnpm typecheck && pnpm build && pnpm test，无新增红、不弱化/删除既有断言
- 证据落 docs/usability-reset/evidence/U01/（IMPLEMENTATION.md + verification/result.json + 截图 + SHA256SUMS）
- 状态四层：code/automated/real-browser/human；真机与人工拿不到→pending+具体原因
- 提交：git -c user.name=YinsenW -c user.email=26830614+YinsenW@users.noreply.github.com commit -S --signoff；U01 前缀；不 push；结束干净树
- 更新 TASKS.json U01 的 status/evidence，JSON 保持合法；全稿完成但用户未最终认可 → 不得标 done
- 禁止：复用旧稿冒充提升、截图整页、假证据、弱化断言、恢复 Office/旧格式


## Fix round 1: gate failed
```text
✖ failing tests:
✖ U04 decision gate: no qualified route, no product integration, explicit native/human pending (1.178ms)
```
Reproduce and fix without weakening assertions. Full log: /tmp/ppte8/gate-fail-U01.log
