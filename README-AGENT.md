# PPTe agent 接入

PPTe 的 Agent 入口是本仓库构建出的 stdio MCP server。先在仓库根目录执行：

```sh
pnpm build
```

下面所有路径都应替换成绝对路径。服务器启动时打开指定 `.ppte`，并自动恢复匹配的 Recovery Journal：

```text
node /absolute/path/to/ppte/dist/apps/mcp/index.js /absolute/path/to/deck.ppte
```

`--readonly` 会让 `commit_transaction` 和 `undo_transaction` 直接不出现在 `tools/list`；`--scope '<TransactionScope JSON>'` 可进一步限制 Agent scope。

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

这是单文档、单进程的 MCP over stdio server：一个 Agent 进程对应一个 `.ppte` 会话。它不做多路复用、不提供 HTTP/SSE transport，也不做鉴权；这些是明确的产品边界，不是遗漏。所有实际写入仍经过 PPTe Session Operation Engine，并由 `writeCheckpoint` 原子写回同一个 `.ppte` 文件。
