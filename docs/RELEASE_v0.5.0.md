# PPTe 0.5.0 发布验收报告

- 日期：2026-09-03
- 版本：`0.5.0`
- 发布类型：bounded release（有意限定范围）
- 标签：`v0.5.0` annotated tag，创建于本地，未 push
- 权威审计输入：[`REVIEW_v2.3_GA_AUDIT.md`](REVIEW_v2.3_GA_AUDIT.md)

## 完成清单

- [x] §41 A–J 已转为独立 blackbox cases；`--milestone final` 与 `--report` 均为 52 green / 0 red。
- [x] §41-A 使用真实 Playwright Chromium `file://` Host 路径：New → Agent 生成 10 页 → 双击改字 → 指针拖图 → 加页 → Present/方向键 → 保存 `.ppte` → 重开 → Undo。
- [x] Host 的文本、图片、页面编辑都经过 typed Operation、inverse、revision 与 recent History；重开后 Undo 可用。
- [x] README Quick Start 可执行，包含 Host 构建、可双击入口、CLI、final blackbox 与六档 E2E/性能命令。
- [x] CHANGELOG 记录 0.5.0 实际范围及明确未做项。
- [x] typecheck、test、validate、Host build、blackbox、六档 E2E、性能容量预算均已执行。
- [x] `npm run` 脚本清单无缺失入口；`contract-deck` CLI 真实生成了 `artifacts/contract-deck.html`。
- [x] 本地 annotated tag `v0.5.0`，不 push。

## 最终门禁

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `npm run typecheck` | PASS | `tsc --noEmit` |
| `npm test` | PASS | 85 tests passed, 0 failed, 0 skipped |
| `npm run validate` | PASS | 15 schemas/examples、semantic checks、operation parity、markdown/source guards |
| `npm run host:build` | PASS | Vite 50 modules；产出 `apps/host/dist/index.html` |
| `npm run blackbox:final` | PASS | 52 green / 0 red |
| `npm run blackbox:report` | PASS | 11/11 groups green，52 green / 0 red |
| `npm run contract-deck` | PASS | 生成 derived CLI preview |

## §41 A–J 结果

| 场景 | 最终观测 |
| --- | --- |
| A | created 1；generated 10；`agentGenerated=true`；改字为 `R7 真人路径标题`；真实拖图；加页后 11；演示前页索引 1、ArrowLeft 后为 0；重开 11 页/History 5；Undo 后 10 页/History 4 |
| B | IME composition 期间 History 仍为 0；结束后保存/重开文本为 `B 场景输入法标题`；Undo 恢复默认标题 |
| C | flat Group create/move/resize/undo 全通过，geometry exact |
| D | 非目标 Agent mutation 被 `SLIDE_UPDATE_FIELD_NOT_ALLOWED` 拒绝 |
| E | mixed-content reflow 返回并通过 10-operation Transaction |
| F | selection-directed redesign 返回并通过 2-operation Transaction |
| G | 真实 child-process SIGKILL 后 recovery 通过 |
| H | Portable Quick Fix 编辑路径通过 |
| I | revised-copy deletion 返回 1 个 review conflict |
| J | PDF/PPTX 语义检查通过；PNG golden `uniqueColors=47`、`darkPixels=2` |

## Blackbox 分组自评

| 分组 | 结果 |
| --- | --- |
| core-basic | 7 green / 0 red |
| agent-scope | 7 green / 0 red |
| lock-undo | 2 green / 0 red |
| host | 2 green / 0 red |
| pages-notes-animation | 2 green / 0 red |
| compiler-quality | 1 green / 0 red |
| portable | 5 green / 0 red |
| export | 3 green / 0 red |
| recovery | 4 green / 0 red |
| review-patch | 9 green / 0 red |
| section-41 | 10 green / 0 red |

## 六档 E2E 与性能

以下命令均以 `npm run` 真实执行并通过：

- `e2e:vertical-slice`：Stable Core、Journal、Checkpoint、scope、边界通过。
- `e2e:milestone`：31 个 Agent tools、IR/Recipe、确认、undo/视觉 diff 通过。
- `e2e:beta`：Portable Viewer/Quick Fix、Glyph、Patch、PDF/PNG 通过。
- `e2e:ga-a`：30 slides / 900 elements / 120 groups / 50 MiB assets / 20 fonts，容量和 P95 通过。
- `e2e:ga-b`：Bar/Line/Pie、Fact/Source、Review/Patch、Image PPTX 通过。
- `e2e:ga-c`：GA-C Area/Donut、controlled Widgets、Poster、Light Edit、semantic PPTX，并包含 final blackbox，全部通过。
- `perf:ga-a`：所有指标和 bundle 限额通过。最近一次 P95 观测如下：

| 指标 | P95 | 预算 |
| --- | ---: | ---: |
| open-to-interactive | 9.109 ms | 2000 ms |
| page-switch | 1.441 ms | 100 ms |
| selection | 0.024 ms | 50 ms |
| human-commit | 92.755 ms | 100 ms |
| text-commit | 95.744 ms | 150 ms |
| journal-append | 14.820 ms | 100 ms |
| undo / redo | 78.589 / 89.126 ms | 100 ms each |
| checkpoint-50mb | 561.154 ms | 3000 ms |
| Portable Viewer / Quick Fix first screen | 333.507 / 315.641 ms | 2000 / 2500 ms |
| viewer / Quick Fix bundle gzip | 125544 / 124830 bytes | 1200000 / 2000000 bytes |

## 仍未完成清单

以下不是隐藏能力，也不属于 0.5.0 验收承诺：

- Video Widget；
- 原生 PPTX Chart authoring；
- 完整 Portable 编辑器；
- CRDT；
- 多人/实时协作；
- Slidev、Markdown content source、DOM reverse parsing；
- nested Group、Group Rotate、Run-level font/size；
- full legacy markup/runtime import；
- 绕过 Operation Engine 的 direct writes。

这些边界已同步记录在 [`README.md`](../README.md)、[`CHANGELOG.md`](../CHANGELOG.md)、[`DECISIONS.md`](DECISIONS.md) 与冻结 ADR/启动清单中。

## 本轮曾出现的失败原文

以下是 R7 调试期间实际出现、随后修复的失败输出；它们没有被改成绿，也不是最终残留：

```text
操作未提交 · slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.; slide.duplicate.slideId must be a non-empty string.
```

```text
Error: VERTICAL_SLICE_FAILED: sync_fact_references returns a guarded transaction
Error: VERTICAL_SLICE_FAILED: regenerate_selection preserves the selected anchor
```

```text
python-pptx did not return JSON evidence.
Unexpected token 'I', "Installed "... is not valid JSON
{"slides": 1, "paragraphs": ["", "年度经营回顾", "第二段：😀", "Product education module"], "styledRuns": 3, "rotations": [0, 12.0, 0, 0]}
Installed 5 packages in 23ms
```

```text
Chromium could not execute the Product Host file:// journey.
page.waitForFunction: Timeout 30000ms exceeded.
```

```text
Pointer drag did not commit image geometry.
{"created":"1","generatedSlides":10,"agentGenerated":"true","editedText":"R7 真人路径标题","imageDragged":false,"addedPage":11,"presenterSlideBeforeNavigation":1,"presenting":"true","presenterSlide":0,"savedFilename":"季度经营回顾_PPTe_演示.ppte","reopenedSlides":11,"reopenedHistory":5,"undoEnabled":true,"afterUndoSlides":10,"afterUndoHistory":4}
```

根因与修复：`slide.duplicate` 校验移除了错误的 legacy `slideId` 要求；Contract Deck 历史断言改为验证“安全拒绝的 Fact sync”和“选中对象 replacement”；PPTX harness 忽略 `uv` 安装进度噪声但保留 Python 语义断言；Host journey 等待真实 History/语义 frame 更新，最终重复跑和 `--report` 均为全绿。
