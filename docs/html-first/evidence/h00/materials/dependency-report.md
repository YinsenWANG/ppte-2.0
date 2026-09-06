# PPTe 源码依赖实测表

来源：提交 bbcd46bde2c608b5a56e617f316c5dcb5534857e，scripts/html-import-inventory.mjs；单位为静态 import/export/require 边（含 type-only），不是运行调用次数。

| 模块 | 静态边数 |
|---|---:|
| apps/cli | 22 |
| apps/contract-deck | 26 |
| apps/host | 10 |
| apps/mcp | 15 |
| packages/agent-tools | 23 |
| packages/authoring | 6 |
| packages/canonical-json | 1 |
| packages/capability | 9 |
| packages/change-contract | 5 |
| packages/charts | 1 |
| packages/compatibility | 4 |
| packages/core | 20 |
| packages/design-compiler | 33 |
| packages/design-system | 3 |
| packages/diff | 2 |
| packages/editor-controller | 36 |
| packages/editor-dom | 24 |
| packages/editor-react | 78 |
| packages/exporter-pdf | 12 |
| packages/exporter-pptx | 14 |
| packages/facts | 3 |
| packages/file-format | 24 |
| packages/geometry | 1 |
| packages/importer-legacy | 6 |
| packages/layout-recipes | 7 |
| packages/macros | 2 |
| packages/node-runtime | 34 |
| packages/operations | 10 |
| packages/patch-format | 16 |
| packages/performance-budget | 1 |
| packages/portable-runtime | 81 |
| packages/recovery-journal | 13 |
| packages/renderer-react | 7 |
| packages/reviewer | 7 |
| packages/richtext-adapter | 18 |
| packages/schema | 31 |
| packages/semantic-identity | 3 |
| packages/validation | 8 |
| packages/widgets | 8 |

扫描源文件 117；总边 624；CLI 可达文件 86；计算型引用 0。可达集忽略直接 type-only 边，但不等于打包后执行图，也不证明已退休。
