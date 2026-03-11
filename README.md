# jack-skills

Notion 知识管理系统的 Claude Code 技能集。

## Skills

| Skill | 说明 |
|-------|------|
| `shared-modules` | 共享基础模块（Schema 缓存、漂移自愈、路径、常量） |
| `chat-mode` | 深度认知教练·情绪陪伴与认知突破 |
| `learning-engine` | 学习引擎（闪卡/测试/材料学习/面试陪练/辩论） |
| `notion-organizer` | Notion 目录整理管家 |
| `notion-writer` | Notion 统一写入路由 |

## 安装

```bash
# 查看可用 skills
npx skills add YuanHanzhong/jack-skills --list

# 全量安装（推荐）
npx skills add YuanHanzhong/jack-skills --all -g -y

# 单独安装（需先装 shared-modules）
npx skills add YuanHanzhong/jack-skills -s shared-modules -s chat-mode -g
```

## 技术栈

- **Runtime**: bun (首选) / node+tsx (保底)
- **Language**: TypeScript
- **依赖**: Notion MCP Server

## 架构

```
├── _shared/           # 共享基础模块（其他 skill 的依赖）
├── chat-mode/         # 深度认知教练
├── learning-engine/   # 学习引擎
├── notion-organizer/  # 目录整理
└── notion-writer/     # 写入路由
```

每个 skill 目录包含 `SKILL.md`（元数据+说明）和 `scripts/`（实现脚本）。
