# PIPELINE TASK U05 — 修复 B2 并完成真实交付

## 前置裁决（权威，必须遵守）
U04 裁决（2026-09-08 20:35，用户授权助理代为裁决，见 docs/usability-reset/DECISIONS.md#u04-裁决）：
- 采纳选项 1：**PDF 保持未完成**，不新增依赖、不进入产品集成
- 不得标 done、不得称整体可发布、不得虚构真机证据
- 阅读/编辑/放映三条主路径不依赖任何 PDF 工具

## 本轮范围
1. **B2 修复（必须）**：显式安全网页链接应可作为用户点击导航保留，区别于自动联网资源；继续拒绝危险协议、事件脚本和自动外部资源加载。**使用原 source-with-links 样本验证，不能删链接绕过。**
2. **交付整理**：以新审美稿（九页完整稿 evidence/U01/）走真实旅程：阅读→编辑文字→插图→拖动/缩放/裁切→撤销重做→保存原文件→退出浏览器→重开→放映。PDF 环节按 U04 裁决**不纳入本轮验收**，如实标注未完成。
3. **拒收项重新确认**：用户已拒收的四项（美感未提升 / 图片控件难用 / PDF 不可用 / 保存基本不可用）逐项给出现状（已修复/待真机/仍不可用），不得用 human pending 淡化明确拒收结果。

## 验收（U05 acceptance 原文）
原带链接样本；一个干净成稿；全旅程；用户拒收项逐项重新确认。

## 硬规则
- 门禁全绿：pnpm typecheck && pnpm build && pnpm test，无新增红、不弱化/删除既有断言
- 证据落 docs/usability-reset/evidence/U05/（IMPLEMENTATION.md + verification/result.json + 样本 + SHA256SUMS）
- 状态四层：code/automated/real-browser/human；真机与人工拿不到→pending+具体原因，禁"代码存在=完成"
- 提交：git -c user.name=YinsenW -c user.email=26830614+YinsenW@users.noreply.github.com commit -S --signoff；U05 前缀；不 push；结束干净树
- 更新 TASKS.json U05 的 status/evidence，JSON 保持合法
- 禁止：删链接绕过 B2、整页图片 PDF、静默加服务/上传、弱化断言、假证据


## Fix round 1: gate failed
```text
6edeTkgyXud88+VnJ0+MEbBJcsax/+zaq9TRY0YvmXeRl6en2ZFyzrt5+46UDOMlzYVzZsWOGytgkYxdp1WPPNDc3CTQuaJvNxVs/FQWDo6OE3/7XPCFCywM9gwfGjBtdmn8D3KC3FRd1VBWOnjaBQLqJSSlPLHmBaVedf+9d92+0sLgIYEBy666LCklLft8I1J2ga+9cqmAemcrqz7b8m3L+Y7ZtImxVyxaKGe7nQ12cXaOGj2qrq4u7/yqBtkFjh410t3NTaBzzi6urGTogkzPU/9cq9Tj/u9h/8nTuzzFMywy+p7HlLp4z3cVaUkC6r302jqlkPPcm1Zca80pzz+zemhEuCyOncj88NMNAurtT0xqbm6Wxejhw5bMn2fNKYsumjt25Ail/iHhiEBXiN0uyKmucq1syKyLQuYvsfIs33ExQ5fdpNRntm8WUGn3DwfTMo7LIjIi3EJvoR35b+F7//fnSv3pho0CKtXW1ckOg1L/ZM4c609ccKFxcOrxE/KCm4BFxG4XSg/sUYrwpcvUnCcir1iuFCU/7GpuaBBQY3trb3HFtVepOU8sWXjxuDGjZJGdmy/nvAJqmO6AiBk3dkiAv/Un+g8aNDE6SqlPZOcIWETsWtJYVVGdY/hf1y0waFDMZFXnuvgO8o+bYahamquOpwuoEZ9o7Mws/sl8odK8ucaZ15GUNAE18k6fUYpxI0cKlcaNGtn6Tbh7rQsDdCuc4jNW3V1Tm2Vcn+8zYoxQz2fk2NJ4w8rH4uNH6wPZN8Razc0tcq4qzl8oCwsNUXv6hNZpV/rRY1b+RUNxuvWuszD129yEBRv/poqKS6382H18/dwG5PW3ARq7gUOCrBlWnp+tFC5+ttz7ZDrLw9HByv8ipPKzFUrhP9iWjz2w9V/HDU1NfOyqmG748e5kxZgF3l7GUxr52LtCk8ESB0cnpWhpahTqmc5ycORzVsHJyfixNzba8rGbzjJ9H1jJwcH4g6osZlDFdIqjo4OARcSBJS6DjLOt2qJCoV7t6YLW76Pi6gR8vL3cXF1lkW/THlc5ucZtcQID+NjV8fb0UIrSs2eFSqXl5UrhpX6mPNAQu5Z4Rg5XJqoVR1Na1M+8zrY+eILNGdRSViPU1NQcTlS96vlg61awY0YOF1DD9IsqK1f1jm6mU4L4bdcVYrcLfhOnyj+bGxsKv/tG1Yln05KqThlWnroFBsn4FlBj5rQ4pfjq6y1qzjOsPN3y7XaljpsYK6BGZOuVtNQM1VsYp7Qu+B0aGipgEbHbhYBZFylFzhcfqzlPZH/+gfE7zL5YQKVFFxs/9n+t35Bx/IT1J6792zvnqqtlMWfm9AD/QQJqhAYNMewxJkRe4emkdBWPqkvNOJaTb1h84uXhMZpnLHWF2O1CwAXzPIcabnyszs/JWGvt82NyNnxUctCw4N/B2SXscqtubEVbw4dGXH7JQqV++k8vW3nWjt171/3DuEXkz29jy2NbTJ0wXim27txlatdaVl5R8Z+du5R6SuvpsIDY7VrkituUIn/LFyfefb3L8Xmb1p949w2lHnnHrxzd3AXUu/tnN3udX5N0KD7xngcfbejqTr+de/bdv+oJpV55/XXR42xZao24mOiwYMPyr+qamn9/tam'... 20756 more characters,
    operator: 'strictEqual',
    diff: 'simple'
  }
[ELIFECYCLE] Test failed. See above for more details.
$ node scripts/build-html.mjs && tsc --noEmit
$ node scripts/build-html.mjs --clean && tsc -p tsconfig.build.json
$ pnpm build && node --test dist/tests/*.test.js
$ node scripts/build-html.mjs --clean && tsc -p tsconfig.build.json

```
Reproduce and fix without weakening assertions. Full log: /tmp/ppte8/gate-fail-U05.log
