# PPTe v2.3 ADR 冻结摘要

1. 不采用 Slidev；不允许任意 HTML/CSS/JSX 作为内容真源。
2. `document.json` 是唯一内容真源，Slide IR、DOM、Journal 都不是。
3. 整页生成主要输出 Slide IR；局部编辑输出 Typed Operations。
4. `elementId` 是实例身份；`semanticKey` 是 Slide 内业务身份；Fact ID 负责跨页数据身份。
5. Scope 限制位置和领域；Change Contract 限制操作种类、变化规模和必须保持的 Invariant。
6. Group v1 是扁平逻辑关系，不渲染、不嵌套、不创建坐标系。
7. Text v1 不支持 Run 级字体和字号，不隐藏 Auto Fit。
8. Theme 使用 Token + Style Preset + Typed Override，并诊断 Override Debt。
9. Fact/Source 为显式引用；同步必须产生可审阅 Transaction。
10. `.ppte` 是 Checkpoint；Recovery Journal 只做高频崩溃保护。
11. `.ppte.html` 为派生 Viewer/Quick Fix/Light Edit，首个 GA 只承诺 Viewer 与 Quick Fix。
12. Quick Fix 必须检查 Glyph Coverage，缺字不静默 fallback。
13. 文件级协作优先 Compare Revised Copy + `.ppte.patch`，不做 CRDT。
14. 80% Layout Recipe 使用声明式 Spec；特殊 Recipe 才允许受控代码。
15. 独立版本通过 Compatibility Profile 组合发布。
16. 不稳定的 Chart、Widget、PPTX、Portable 不得阻塞已稳定的 Core GA。
