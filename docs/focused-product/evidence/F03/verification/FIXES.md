# F03 验证中发现并解决的问题

第一轮完整门禁记录在 first-gate/：131 passed、12 failed、15 skipped。失败证据原样保留，不把那一轮记成通过。

- 10 个原有保存/旅程测试因为新图片读取提示也声明 role=status，原有唯一保存状态选择器命中两个节点而失败。产品读取提示改为局部 aria-live=polite，保持保存状态唯一；原有测试未改。
- 新错误测试把 text/plain 替换图片预期成 UNSUPPORTED_MEDIA，但实际在媒体种类检查处返回 MEDIA_KIND_MISMATCH。补充可理解的中文错误，测试验证准确的分支，以及原图、输入重置和撤销栈。不是删除错误断言。
- 新取消测试最初将两秒延迟定时器装进禁止脚本的作者 iframe，取消可以中止，但之后正常读取的定时器无法运行。改为在外层测试上下文计时；仍使用原生 decode 和真实产品按钮，验证取消插入、离开编辑、取消替换、原稿/dirty/撤销不变。针对性结果见 cancel-and-errors.log。

此前开发阶段还修正了三处测试夹具问题：替换后先等待目标 src 生效再 decode（避免在旧 src 上 decode 被切换打断）；连续插入等待选择 ID 改变（不能把先前选中图当新图）；使用已规范化审查实际源稿而不是 PDF 探针中未经页面标记的原型快照。全文保真断言发现 Playwright 默认截图会临时注入 caret-color；F03 截图设 caret:initial，保留完整作者 DOM/CSS 比较，不过滤该属性来制造通过。

最终完整门禁以本目录 gates.json、typecheck.log、build.log、test.log 和 result.json 为准。无既有断言被删除或减弱，无新增跳过。
