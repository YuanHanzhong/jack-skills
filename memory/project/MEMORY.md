# Project Memory

## User Preferences

- **Runtime**: bun > node/tsx > python (Python only as last resort)
- **Language**: TypeScript first, JavaScript second, Python rarely
- **npx tsc trap**: `npx tsc` installs wrong package; use `bunx tsc` or `npx --package typescript tsc`
- **Autonomy**: When setting up or configuring systems, do it directly — execute commands, edit files, make changes. Never ask the user to manually copy/paste commands. Use Bash/tools to do it myself.
- **Windows 装软件优先级**: `scoop`（已装，Git Bash 直接可用）> `winget`（仅限 PowerShell/CMD 原生环境）> 手动下载。Claude Code 跑在 Git Bash 里，winget/PowerShell 有 PATH 和转义问题，优先用 scoop。
- **Claude Code 管理**: 不要用 `npm` 安装/更新 Claude Code，使用其原生命令（如 `claude update`）。
- **全景图铁律**: 用户说"全景图"时，绝对禁止先 Read 文件。必须先 Bash(wc -l) 获取行数 → 按章节拆成多个 SubAgent（每个≤500行）→ SubAgent 返回 JSON → 主 Agent 合并输出。主 Agent 永远不读大文件原文。

## WSL2 Networking

- **Distro**: `Ubuntu-24.04`（`wsl -d Ubuntu-24.04`）
- **网络模式**: mirrored（`.wslconfig` → `networkingMode=mirrored`）
- **代理**: FlClash，mixed-port `7890`，TUN 模式开启但与 mirrored 不兼容
- **必须用显式代理**：TUN auto-route 无法接管 mirrored 模式下 WSL 流量，直连会超时
- **apt 代理**: `/etc/apt/apt.conf.d/99proxy` → `http://127.0.0.1:7890`
- **shell 代理**: `~/.bashrc` 已配 `http_proxy`/`https_proxy`/`all_proxy` → `127.0.0.1:7890`
- **apt 源**: 用官方 `archive.ubuntu.com`（走代理比国内镜像更快）
- **sudo 技巧**: 从 Windows 调 WSL 时 sudo 无法交互密码，用 `wsl -d Ubuntu-24.04 -u root` 绕过
- **`.wslconfig` 位置**: `C:\Users\jack\.wslconfig`，改后需 `wsl --shutdown` 重启生效

## Project Structure

- Skills root: `.claude/skills/`
- 4 skills: chat-mode, learning-engine, notion-organizer, notion-writer

## Shared Modules (`_shared/`)

| File | Purpose |
|------|---------|
| `config.ts` | Notion DB UUIDs + Schema column-name cache (single source of truth) |
| `schema_resolver.ts` | Schema drift self-healing: `resolve(db, key)` and `buildProps(db, values)` |
| `paths.ts` | Cross-platform path definitions |
| `constants.ts` | Status/signal constants (STATUS_IN_PROGRESS, STATUS_MAP, etc.) |
| `time_utils.ts` | Shared time functions: `getTs()`, `getDisplay()`, `getHhmm()`, `getTsIso()` |
| `jsonl_buffer.ts` | JSONL append/read helpers: `appendJsonl()`, `readJsonl()` |
| `schema-drift-protocol.md` | Shared protocol doc for schema drift handling |
| `sync.sh` | One-way sync from root `_shared/` to each skill's `_shared/` copy |

## Key Patterns

- **schema_resolver usage**: Import `resolve(db, key)` to map semantic keys to Chinese column names; auto-fetches on drift
- **constants.ts centralization**: All status emoji strings and knowledge-status maps live here; scripts import instead of hardcoding
- **`_lastSynced`**: Tracks cache freshness in config.ts; auto-refresh after 7 days
- **_shared/ sync**: Each skill keeps its own `_shared/` copy for independent execution; run `bash _shared/sync.sh` to propagate changes from root

## Reference Files

- `learning-engine/references/mode6-material-learning.md` - Material learning mode spec
- `learning-engine/references/mode7-interview-coaching.md` - Interview coaching spec
- `learning-engine/references/mode8-debate.md` - Debate mode spec
- `learning-engine/references/notion-write-spec.md` - Notion write specification
- `learning-engine/references/paste-learning.md` - Paste learning spec
- `learning-engine/references/layer-definitions.md` - Layer definitions
- `notion-writer/references/ads-template.md` - ADS document template

## Test Locations

Tests are inline in source files (bun:test), embedded at file bottom:
- `learning-engine/scripts/ods_learning.ts`
- `learning-engine/scripts/dwd_builder.ts`
- `learning-engine/scripts/text_to_notion_writer.ts`
- `notion-organizer/scripts/organizer.ts`
- `chat-mode/scripts/output_checker.ts`
- `chat-mode/scripts/chat_engine.ts`

## Schema System

- 4 Notion databases: ODS/DWD/DWS/ADS, schema cached in config.ts
- DWD mastery column: `"掌握程度"`; other 3 use `"掌握度"`
- Schema drift protocol written into all 4 SKILL.md files

## Notion MCP API 规范 [CRITICAL]

`notion-update-page` 只有 5 个合法 command：
- `update_properties` — 改属性（必传 `properties` 对象）
- `update_content` — 搜索替换内容（必传 `content_updates: [{old_str, new_str}]` **数组**）
- `replace_content` — 整页替换（必传 `new_str` 字符串）
- `apply_template` — 应用模板
- `update_verification` — 验证状态

**已踩坑**：
- `insert_content_after` 命令不存在，会导致 validation_error
- `selection_with_ellipsis` 参数不存在
- `content_updates` 必须是数组，传字符串会报 `Expected array, received string`
- `command` 字段是必填的，漏掉会报错
- "追加内容"正确做法：`update_content` + `content_updates: [{old_str: "锚点", new_str: "锚点\n新内容"}]`
- `notion-fetch` 大页面（54k+ 字符）会超 token 限制，被截断保存到临时文件。用 `offset` + `limit` 分页拉取
- 并行 Notion MCP 调用时一个失败会导致同批次全部失败（`Sibling tool call errored`）。关键操作串行执行
- MCP server 参数用冒号 `plugin:Notion:notion`，不是下划线 `plugin_Notion_notion`

## MEMORY.md 管理

- **上限**：Claude Code 只加载前 200 行，201+ 行不可见
- **自动监控**：`.claude/hooks/check-memory-size.sh` SessionStart hook
  - 150 行：提醒注意控制长度
  - 180 行：输出压缩指令，要求按频率/重要性压缩到 120 行以内
- **压缩策略**：高频规则保留原文，中频信息压缩为摘要，低频/过时内容移到 topic 文件
- **topic 文件**：详细内容放 `memory/` 下独立 `.md` 文件，MEMORY.md 保留链接

## Windows 兼容性自动修复

**规则维护位置**：`~/.claude/hooks/fix-compat.sh`（PostToolUse: Edit|Write 自动触发）

发现新的 Windows 兼容性问题时，**直接在该文件里加 Rule N**，不用告诉用户。当前规则：
- Rule 1: MCP stdio server 缺 `cmd /c` 包装 → 自动补
- Rule 2: MCP 错误包名 → 自动替换（已知：`@anthropic/mcp-sqlite` → `mcp-sqlite`）
- Rule 3: hook 脚本 `python` shebang → 自动改 `python3`
- Rule 4: settings.json 反斜杠路径 → 提示检查

`~/.claude/hooks/check-platform-compat.sh` 是 SessionStart 版本（只报告，不修复）。

## 新建/修改 Skills 防坑清单

- **不要凭印象编 MCP API**：不确定参数时先 `ToolSearch` 查工具定义，确认合法 command 和参数名
- **指令对象必须带 `command` 字段**：生成 notion-update-page 指令时 command 不可省略
- **interface 要和真实 API 对齐**：不要在 TypeScript 接口中定义不存在的字段
- **SKILL.md 示例必须可执行**：示例中的工具调用要用真实格式，API 变更后示例必须同步更新
- **改了 API 调用后全局 grep 确认零残留**：修完一个文件不够，要扫描所有 skills 目录
