# S08 总反馈回交：partial

主验收入口：[把作品带走.ppte.html](../../single-file-first/evidence/s08/delivery/把作品带走.ppte.html)。下载此唯一成品并在浏览器直接打开；无需 localhost。四页新稿来自新版仓库 Skill，原稿、失败、修正和成品均留存。**本轮不通过最终验收，不进入下一阶段。**

依据：指定提交 9856db3cef4da0d6ea6aca5a46b7039a166b995c 的 HANDOFF、当前 PLAN/TASKS，以及 ea260ce 对 6091c9a 的独立审查；本轮基线 fa5f2f8。不改写历史审查、不继承旧 done、不恢复 Office/旧 IR。

|层次|本轮结论|
|---|---|
|代码实现|完成 S08 证据组织、22 项问题映射、新稿和独立验收探针；不修改产品运行时。既有 S06 按需媒体解码等实现缺口继续保留。|
|自动化|pnpm typecheck、build、test 全绿，72/72；新稿独立探针通过。现有测试/断言零修改、零删除；新增 1 个独立探针，未新增框架测试。|
|真实浏览器|Chrome 152.0.7977.76 headless：隔离目录 file:// 离线打开、四页布局、编辑、真实下载、整个进程关闭后重开、单页放映及 Esc 通过。Safari 和原生授权不能从这些结果推断。|
|人工确认|pending：无负责人和两名目标用户新评价，无原生 picker/IME/打印、无 Node 目标机和低性能实机操作证据。|

## 逐项证据

|S08 验收|结论与证据|
|---|---|
|1 热端到端 ≤1.25×、tokens ≤1.20×，留存失败与尾部|pending；[九对登记](../../single-file-first/evidence/s08/controlled-nine-pairs.json) 为九对十八次空槽，observedPairs=0，指标 null。未取得受控 provider 回执；[采集协议](../../single-file-first/evidence/s08/collection-protocol.md) 冻结材料和保留要求。新稿不是测量样本。|
|2 九对至少六对人工审美不逊，功能独立否决|pending；[真实用户回执登记](../../single-file-first/evidence/s08/real-user-feedback.json) 三人均未采集，没有投票。事实、裁切、保存分别否决；图片稿单列空组。|
|3 不编造人评、遥测、实机或 Safari|已如实登记缺口；[低性能设备登记](../../single-file-first/evidence/s08/real-low-performance-device.json)、九对、人评均 pending。[本轮 Safari 原始结果](../../single-file-first/evidence/s08/verification/safari.json) 是受阻记录。|
|4 四层分开，不继承旧 done|[闭环矩阵](../../single-file-first/evidence/s08/feedback-closure-matrix.md) 与 [JSON](../../single-file-first/evidence/s08/feedback-closure-matrix.json) 覆盖四项反馈、F01–F05、H00–H06、R01–R06，每行真实修复提交、测试、原始证据及缺口。|
|5 文件主交付，不冒称全部完成|[成品原始证据](../../single-file-first/evidence/s08/final-single-file.json) 及 [生成记录](../../single-file-first/evidence/s08/authoring-record.md)。文件 313598 bytes，四页；下载测试不覆盖原文件。用户实际打开/确认仍 pending。|

requiredEvidence 的五个名称分别映射到 feedback-closure-matrix.json、controlled-nine-pairs.json、real-user-feedback.json、real-low-performance-device.json、final-single-file.json。文件存在不代表对应能力通过：九对、人评和实机采集缺口明示 null/pending，最终文件的自动化通过也不是人工验收。

## 未关闭风险

- S04 原始开发机数据：输入 p95 133.5 ms >50 ms，翻页 133.6 ms >100 ms；保存 852.8 ms 在工程目标内，但不是原生授权保存实机验收。不能由减少重复调用声称总体性能达标。
- S05/S06 真实图片批与主体/关键数据人评仍缺；资源表仍 opt-in，按需解码和媒体内存工作未完全实现。
- Safari、真实原生文件选择/授权撤销/再授权、系统 IME、打印、跨设备恢复仍待实测。开发机无 HTTP 请求不等于已在无 Node 目标机操作。
- 新稿进行了两次行高修正，超出 Skill 一次修正快速路径；全部失败稿已留存，未修改 Skill 或测试来隐藏偏差。新稿可用于文件功能验收，生成快速路径验收仍 partial。
- 没有真实模型遥测、人评或低性能设备数据；不得把 null 当零、增强耗时当端到端时间，也不得把 Agent 看截图当盲评。

## 验证与新增文件

[检查结果](../../single-file-first/evidence/s08/verification/result.json) 与三个完整日志保留了本轮 72 项回归；另有 verify.mjs、新稿 source.html、唯一 delivery 成品、四张截图、生成阶段首稿与失败日志、实际下载重开副本、五类证据、采集协议、生成记录、哈希清单。TASKS.json 仅更新 S08 为 partial 并映射每项 acceptance/requiredEvidence。历史证据未改动。提交号由本轮签名提交及后续 evidenceCommit 绑定提供。
