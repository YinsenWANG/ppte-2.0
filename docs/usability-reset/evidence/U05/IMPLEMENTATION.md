# U05 本轮附加项 B2

修复原 source-with-links 的双重拦截：content.ts 允许 a/area 的显式绝对 http/https 网页 href；runtime.ts 只处理受信任用户点击，在父运行时以 noopener,noreferrer 打开新标签，当前稿不被导航覆盖。作者 iframe 仍只有 allow-same-origin，没有脚本或弹窗能力；CSP 继续阻止自动外部图片、字体、CSS、连接等。危险/相对/带控制字符/反斜杠/凭证 URL 不放行，事件、ping、自动资源继续拒绝。编辑文本时点击不跳走。

新增三个仓库 node --test 测试：原 10 页 source-with-links（未删链接）增强与序列化保留两个链接；安全反例清洗拒绝；Chrome file:// 真鼠标点击及 Enter 导航，新页 opener=null，原稿保留，保存重开后链接仍可用，合成 click 不触发导航。对外目标由 Playwright 拦截返回本地测试内容，验证导航目的地但不向真实网站发送请求。navigation.png 与 journey.json 是 headless 自动化证据，不冒充目标机实测。

旧 F06 的“B2 必须复现删除”的断言与修复后行为冲突。未删或弱化断言：测试用 git show bad07df 的原清洗器构建并运行，仍断言 CONTENT_URL_REMOVED；同时增加当前实现无 issue 且保留真实链接的断言。历史验收报告仍保留 B2 未关闭记录，新状态由本轮覆盖。此迁移不改变旧安全断言。

B2 code/automated 通过不代表 U05 整体验收：新完整成稿、原生保存退出重开、合格 PDF 及用户全旅程重验仍待相关任务完成。目标桌面链接点击体验 pending（本会话只有 headless 操作）；human=reopened，未收到此次修复的人工重验。此轮不把历史链接样本另当新审美成稿交付。
