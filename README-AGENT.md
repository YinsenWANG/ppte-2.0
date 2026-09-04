# PPTe agent 接入

PPTe 的 Agent 入口是本仓库构建出的 stdio MCP server。先在仓库根目录执行：

```sh
pnpm build
```

下面所有路径都应替换成绝对路径。服务器启动时打开指定 `.ppte`，并自动恢复匹配的 Recovery Journal：

```text
node /absolute/path/to/ppte/dist/apps/mcp/index.js /absolute/path/to/deck.ppte
```

`--readonly` 会让 `commit_transaction`、`undo_transaction` 和文件交付工具直接不出现在 `tools/list`；`--scope '<TransactionScope JSON>'` 可进一步限制 Agent scope。

## 完整成功闭环与交付文件

Agent 的成功工作流是：`inspect_document` → 生成/接收 Transaction →
`preview_transaction` → 审核 diff/issues → `commit_transaction` →
`get_validation_issues` → `deliver_presentation`。最后一步省略 `profile`，
由产品交付策略选择默认的 `full-portable`；不要把 `render_slide`、
`renderDocumentHtml` 或手拼 HTML 当作交付物。

| 文件角色 | 文件名 | 接收者如何打开 |
| --- | --- | --- |
| 主交付物 | `<deck>.editable.ppte.html` | 浏览器直接打开；可改字、另存可编辑副本、继续演示 |
| 源项目 | `<deck>.ppte` | 先打开 PPTe Host，再在 Host 中选择 `.ppte`；系统双击关联尚未提供 |
| 只读预览 | 按需的 `*.preview.html` | 仅用于展示/检查，不可当作编辑交付 |

交付结果中的 HTML 是带 source revision 的本地可编辑派生副本，不会与
`.ppte` 自动同步。若渠道只能发送一个附件，发送主交付物
`<deck>.editable.ppte.html`；仍要在回复中说明 `.ppte` 源项目的位置和
“需 PPTe Host 打开”。交付失败时不得把预览 HTML 冒充成功文件。

## Claude Code

命令行注册：

```sh
claude mcp add ppte -- node /absolute/path/to/ppte/dist/apps/mcp/index.js /absolute/path/to/deck.ppte
```

项目级 `.mcp.json` 等价写法：

```json
{
  "mcpServers": {
    "ppte": {
      "command": "node",
      "args": [
        "/absolute/path/to/ppte/dist/apps/mcp/index.js",
        "/absolute/path/to/deck.ppte"
      ]
    }
  }
}
```

装完即验证：

```sh
claude -p "调用 ppte 的 inspect_document，只报告 deck 的页数，不修改文档。"
```

## Codex CLI

在 `~/.codex/config.toml`（或当前 Codex 使用的 config.toml）加入：

```toml
[mcp_servers.ppte]
command = "node"
args = [
  "/absolute/path/to/ppte/dist/apps/mcp/index.js",
  "/absolute/path/to/deck.ppte",
]
```

重启 Codex 后装完即验证：

```sh
codex exec "调用 ppte 的 inspect_document，只报告 deck 的页数，不修改文档。"
```

## Cherry Studio

在 Settings → MCP Server → Add 中选择本地/stdio 服务器，逐字段填写：

```text
Name:    ppte
Command: node
Args[0]: /absolute/path/to/ppte/dist/apps/mcp/index.js
Args[1]: /absolute/path/to/deck.ppte
```

如果使用 JSON 导入，内容就是：

```json
{
  "mcpServers": {
    "ppte": {
      "command": "node",
      "args": [
        "/absolute/path/to/ppte/dist/apps/mcp/index.js",
        "/absolute/path/to/deck.ppte"
      ]
    }
  }
}
```

保存并启用服务器后，在 Cherry Studio 对话中装完即验证：

```text
请调用 ppte 的 inspect_document，只报告 deck 的页数，不修改文档。
```

## pi agent

项目内推荐使用 `.mcp.json`；也可以写到 `~/.pi/agent/mcp.json` 作为用户级配置：

```json
{
  "mcpServers": {
    "ppte": {
      "command": "node",
      "args": [
        "/absolute/path/to/ppte/dist/apps/mcp/index.js",
        "/absolute/path/to/deck.ppte"
      ]
    }
  }
}
```

重启或 reload pi 后装完即验证：

```sh
pi -p "调用 ppte 的 inspect_document，只报告 deck 的页数，不修改文档。"
```

## 边界

这是单文档、单进程的 MCP over stdio server：一个 Agent 进程对应一个 `.ppte` 会话。它不做多路复用、不提供 HTTP/SSE transport，也不做鉴权；这些是明确的产品边界，不是遗漏。语义编辑仍经过 PPTe Session Operation Engine 并由 `writeCheckpoint` 原子写回 `.ppte`；`deliver_presentation` 只从该 checkpoint 的同一 revision 生成 sibling 可编辑 HTML，并以原子方式发布。
