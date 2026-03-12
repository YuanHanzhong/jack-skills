# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Notion 知识管理系统的 Claude Code 技能集（skills）。包含 4 个技能：
- **chat-mode**: 深度认知教练
- **learning-engine**: 学习引擎（闪卡/测试/材料学习）
- **notion-organizer**: Notion 目录整理
- **notion-writer**: Notion 统一写入路由

## Build & Run

### Runtime 优先级 [CRITICAL]

```
bun (首选) → node/tsx (保底) → python (最后手段·极少使用)
```

- **优先 bun**：项目所有脚本为 TypeScript，bun 原生支持 `.ts` 直接运行
- **保底 node**：bun 不可用时，用 `npx tsx` 或 `node` 执行
- **Python 仅限万不得已**：只有当 JS/TS 生态完全无法解决时才用 Python

### 常用命令

```bash
# 测试
bun test ./learning-engine/scripts/ods_learning.ts    # 单文件测试
bun test                                                # 全量测试

# 类型检查
bunx tsc --noEmit                    # 首选
npx --package typescript tsc --noEmit # 保底（npx 直接 tsc 会装错包）

# 注意：npx tsc 会安装错误的 tsc 包，必须用 bunx tsc 或 npx --package typescript tsc
```

## Architecture

```
.claude/skills/
├── _shared/                # 共享模块
│   ├── config.ts           # UUID + Schema 缓存（单一来源）
│   ├── schema_resolver.ts  # Schema 漂移自愈层
│   ├── paths.ts            # 跨平台路径定义
│   ├── constants.ts        # Status/signal 常量集中管理
│   └── schema-drift-protocol.md  # Schema 漂移协议文档
├── chat-mode/              # 深度认知教练
├── learning-engine/        # 学习引擎
│   └── references/         # 提取的参考文档（mode6/7/8 等）
├── notion-organizer/       # 目录整理
├── notion-writer/          # 写入路由
│   └── references/         # ADS 模板等参考文档
├── tsconfig.json
└── package.json
```

### Schema 架构

- `config.ts` 缓存 ODS/DWD/DWS/ADS 四库的 Notion 列名映射
- `schema_resolver.ts` 提供 `resolve(db, key)` 和 `buildProps(db, values)` 将语义 key 转为中文列名
- Schema 漂移时自动 fetch + 重试 + 提示用户更新 config.ts
