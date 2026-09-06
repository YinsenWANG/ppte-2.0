# S05：轻量审美与图片理解工作流

结论：**partial**。Skill 与 Agent 指南已实现，仓库截图演练已实际选图、生成单文件并在 Chrome headless 离线打开。用户上传图片和人工内容/裁切确认缺失，不能标 done。

依据：已读取指定提交 `9856db3cef4da0d6ea6aca5a46b7039a166b995c` 的 HANDOFF、当前 PLAN/TASKS 和 ea260ce 审查。S00 的边界沿用；本轮只实施 S05，没有修改历史证据或替其他任务关闭 F01–F05、R03。

|状态层|本轮结果|
|---|---|
|代码实现|Skill 新增一段审美提醒、一段条件化视觉提醒；README-AGENT 说明相同工作流。不改运行时或依赖，不引入固定媒体 schema。|
|自动化|Skill 校验；独立证据探针检查原图哈希、尺寸、CSS 裁切、源目录删除后离线解码，以及复用 CLI 的纯文本两次生成。完整仓库检查见 verification。|
|真实浏览器|实际安装 Chrome headless 的 file:// 演练通过；这是自动化驱动的真实浏览器，不是人工操作。Safari、原生选择器和实际目标设备本轮未测试。|
|人工确认|pending；没有用户图片或人工内容/裁切评审，不能用 Agent 看图替代。|

主验收文件：[review.ppte.html](review.ppte.html)，两页，单文件，非 localhost 链接。工作源稿、联系表和截图仅作仓库审查材料。

|S05 验收项|实际证据与边界|
|---|---|
|没有新增固定模板、配色/字数/版式或美学分数拒绝机制|[skill.diff](skill.diff)：两段提醒，无新门禁或主题覆盖。source.html 的尺寸/颜色是此演练的局部设计，不是 Skill 配方。旧断言及其它规则未删除。|
|每张使用图实际查看、记录未查看与不确定事实|[选图记录](mixed-image-selection-record.md)：联系表 5 图，使用 2 图均看原图，3 张未选图仅看联系表，成品 2 页均看截图。真实用户上传批次 pending。|
|不机械使用全部附件，不用联系表裁块|选 2/5；[probe.json](verification/probe.json) 逐图检查原始哈希；I02 只用 CSS 裁切，保留 1440×1000 原始像素。|
|只使用当前 Agent 视觉，无额外模型密钥|本会话使用 view_image 看图；[选图记录](mixed-image-selection-record.md) 区分模型观察与脚本检查。无第二模型、密钥或图像服务；[skill.diff](skill.diff) 不增加该依赖。|
|文本-only 热路径无图片空转或预处理安装|[verify.mjs](verify.mjs) 复用现有构建连续运行两次纯文本 CLI，禁止子进程和网络连接，mediaBytes=0。无依赖安装或图像工具调用。Skill 的图片段仅在提供图片时触发；没有 Agent/provider 遥测，不能将 CLI 时间称为模型端到端时间或证明未来所有模型均遵循。|

requiredEvidence 映射：`skill-diff` → skill.diff；`mixed-image-selection-record` → 同名 md + inputs.json + contact.png + source.html + review.ppte.html + page-1/2.png + verification/probe.json；`human-content-and-crop-review` → 同名 md（**pending，不是通过证据**）。

测试变化：既有测试文件/断言零修改、零删除；新增一个可复现独立证据探针 verify.mjs，未将文本措辞匹配或美学评分加入门禁。图片预处理/浏览器代码只在此仓库验收探针中，不进入 Skill 的普通生成路径或分发运行时。

复现：先完成 `pnpm typecheck && pnpm build && pnpm test`，再运行 `node docs/single-file-first/evidence/s05/verify.mjs`；需要仓库已有开发依赖及已安装 Chrome。Skill 格式校验使用本机 skill-creator 的 quick_validate.py。结果日志见 [verification/result.json](verification/result.json)。探针可重建图片/单文件，但不能伪造一次新的 Agent 看图或人工评审。

未完成：真实用户混合图片批次；人工语义/主体/裁切及设备可读性确认；本轮没有 Safari、原生权限、低性能设备、模型 tokens/调用计数。S06 的图片 UI、恢复/资源生命周期以及 S08 的九对比较保持各自待验收状态。
