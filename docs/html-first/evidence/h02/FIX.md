# H02 修复轮：partial

代码及回归证据提交：`24fb1861fd57c378be1e8bb0acfe00d587467338`（GPG 签名及 signoff）。依据仍为 `bbcd46bde2c608b5a56e617f316c5dcb5534857e`；[原实现与边界](README.md)保留为前一轮记录。

## 复现与修复

流水线 Bash 使用 Node 24.19.0 / npm 12.0.2；交互 Zsh 使用 Node 22.23.2 / npm 10.9.8。修改前 Node 22 全量 424/424 通过，但相同流水线环境全量 422/424 通过。完整日志保存在 verification/fix，未再截断错误详情。

H02 安装测试在 npm 12 稳定失败：`npm pack --json` 的输出由数组变为按包名索引的对象，`[0].filename` 抛 TypeError。现使用 Object.values 读取两种实际输出，新增恰好一个包、包名和安全 tarball 文件名断言；实际 npm pack、隔离安装、安装后的 ppte edit、原文件写入、进程重启及多文件映射断言全部保留。npm 10 和 npm 12 实际安装均通过。

另用新增测试复现跨窗口草稿删除：A 发起保存，B 写入相同路径的恢复草稿，A 的旧确认无条件删除 B 的草稿。控制器现记住自己最近写入的草稿值，仅在存储仍与该值一致时清理。契约测试验证他人草稿保留、重新打开显示冲突、自己的已保存草稿仍正常清除；真实浏览器双窗口测试验证 B 保存失败后关页、A 确认后，重开仍可取得 B 的恢复内容。

此修复针对迟到确认删除更新草稿的已复现场景；同一路径仍只有一个草稿槽，不承诺保存任意多个并发窗口的全部编辑历史，localStorage 的比较与删除也不构成跨进程原子 CAS。

修改前 Node 24 全量另出现一次旧 F02 Portable 窄屏表格焦点断言失败。该旧模块不在新 HTML 调用图，按范围退休不开展旧 Portable 修理；未删除测试或弱化断言，也不宣称旧发行包已退出仓库。原测试独立重跑 6/6、最终全量原断言通过；偶发焦点时序仍属旧路径风险。H03/H04 的新版交互验收不因此关闭。

## 最终门禁与逐项 acceptance

实际流水线环境执行 `pnpm typecheck && pnpm build && pnpm test` 对应三步均退出 0，最终 426/426、零失败、零跳过。H01/H02 聚焦 26/26；本轮增加 2 个测试、删除 0，H02 累计 17 个测试。发布脚本未修改，H02 安装测试实际执行 stage-html.mjs、npm pack 与安装入口。

| acceptance | 状态 | 本轮证据（dist/tests/html-save.test.js） |
| --- | --- | --- |
| 原路径修改、关闭重开、进程重启 | passed（自动化） | original path autosave；packaged npm install，npm 10/12 均通过 |
| 满盘、只读、撤权、中断、双窗口、Agent | partial | 实际 HFS+ ENOSPC、只读、SIGKILL、外部修改、双窗口及新增草稿回归通过；真实原生撤权仍未验收 |
| 写入确认与草稿明确区分 | passed（自动化） | IME/800ms、延迟确认、失败重试及两个新增回归通过 |
| loopback、跨站、令牌、路径穿越 | passed（自动化） | loopback bind 安全拒绝测试及安装入口通过 |
| Safari 与 file 直开 | partial | installed Chrome file URL 限制通过；真实 Safari 再次因未开启远程自动化拒绝会话，未当作 Safari 保存通过 |

[机器可读结果及完整日志](verification/fix/result.json) · [当前运行时的单 HTML 样稿](verification/fix/example.html)。日志中 Safari 检查通过仅代表记录了真实阻塞，并非产品 acceptance 通过。

剩余：Safari 原路径旅程、真实 Chrome 原生选择器授权/撤权/重新授权；物理断电与跨系统耐久性；不合作外部进程的最终摘要检查与 rename 之间的竞争窗口；多窗口共享草稿槽的更广泛限制。H02 保持 partial，H03/H04/H06 未冒充完成。不 push，不修改 main 或其他分支。新增文件为本报告及 verification/fix 下的完整复现/通过日志、样稿与环境证据；源码只修改 html-editor 保存控制器及 html-save 测试。
