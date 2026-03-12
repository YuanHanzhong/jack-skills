---
name: claude-learn
description: >-
  学习引擎 v8 完整实施蓝图：TypeScript+Bun+SQLite 架构，状态机驱动，8层依赖，20张表，8个子Agent，10个MCP工具。
  这是 learning-engine 的加强版，包含完整的并行 Agent 实施计划、断点续传、双轨验收体系。
  触发词：「执行学习引擎计划」「实施v8」「建学习系统」「搭学习引擎」「claude-learn」「开始建引擎」「继续建引擎」。
  当用户讨论学习引擎的架构设计、数据层、状态机、Hook系统、子Agent实现、MCP工具开发时，务必使用本技能。
  不触发：日常闪卡/测试/复习（用 learning-engine）、Notion写入（用 notion-writer）。
  [LOCAL-ONLY] 本技能仅在 Claude Code CLI (本地终端) 环境下使用，不支持 Claude.ai 云端。
  原因：依赖 Bash/文件系统/Git/子Agent/bun 运行时，这些在云端不可用。
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task
---

# claude-learn（学习引擎 v8 实施蓝图）

> learning-engine 的加强版：从"用技能学习"升级为"构建整个学习系统"。
> **[LOCAL-ONLY]** 仅限 Claude Code CLI 本地环境，不支持 Claude.ai 云端。

---

## 与 learning-engine 的关系

| 维度 | learning-engine（现有） | claude-learn（本技能） |
|------|------------------------|----------------------|
| 定位 | 学习教练·日常使用 | 系统构建蓝图·开发实施 |
| 用途 | 闪卡/测试/复习/面试陪练 | 架构搭建/代码实现/集成测试 |
| 使用者 | 学习者（最终用户） | 开发者（构建系统的人） |
| 环境 | 本地+云端均可 | **仅限本地**（依赖 Bash/bun/Git/子Agent） |
| 数据层 | Notion MCP 直连 | SQLite(bun:sqlite) + Drizzle ORM → Notion 同步 |
| 状态管理 | 无状态（每次对话独立） | 状态机驱动（9态主链 + 断点续传） |

---

## 技术栈

```
TypeScript + Bun + SQLite(bun:sqlite) + Drizzle ORM + Zod + Pino
执行环境：Claude Code CLI + Git Bash (Windows)
```

## 整体架构

```
状态机：INGEST → MAP_REVIEW → AUDIT → TEST → BACKFILL → CARD_GEN → PACK → REVIEW_SCHEDULE → DONE
数据库：20张表（8核心+8辅助+2双轨+1快照+1异步任务）
子Agent：8个（material-extractor, coverage-auditor, quiz-generator, answer-scorer,
             card-generator, story-linker, interview-pack-builder, interview-coach）
Hook：8个事件（SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
              Stop, SubagentStop, PreCompact, SessionEnd）
MCP Tools：10个域内工具
```

---

## 依赖关系图（8层）

```
Layer 0: Foundation ─── Bun环境 + 目录结构 + bun-runner.sh
    ↓
Layer 1: Data Layer ─── Drizzle Schema(20表) + DB初始化 + 14个Repository
    ↓
Layer 2: Core Engine ── 状态机 + 策略引擎(5类规则) + Zod校验(5模型)
    ↓
Layer 3: Hook System ── Dispatcher + 8个Hook Handler
    ↓  ↑(依赖4.3 resume-service)
Layer 4: Services ───── 双轨对象 + 掌握度引擎 + 12个Service + 上下文管理器
    ↓
Layer 5: Agent System ─ 8个子Agent契约+实现 + Daemon守护进程
    ↓
Layer 6: Integration ── 10个MCP Tools + 15个CLI命令 + Notion同步 + E2E测试
    ↓
Layer 7: Polish ─────── 面试陪练完善 + 复习调度 + DB生命周期 + 文档清洗
```

---

## Gate 0：启动前拍板（必须先定）

开始实施前，确认以下决策（未拍板会导致实现口径分叉）：

- 覆盖审计默认策略：默认 `静默执行`（建议），可配置切换为展示模式
- target_tier 默认分配：默认 `核心→DWS，高频/高价值→ADS，其余→DWD`
- 若启动时仍未拍板：按上述默认值执行并写入 `config` 表，禁止实现期再口头改口径

---

## 实施路由

根据用户意图分流到对应 Layer 的详细参考文档：

```
IF user_wants("从零开始搭建" OR "初始化项目"):
  → 读 references/layer0-foundation.md → 执行 Layer 0

IF user_wants("数据层" OR "表结构" OR "Repository"):
  → 读 references/layer1-data.md → 执行 Layer 1

IF user_wants("状态机" OR "策略引擎" OR "Zod校验"):
  → 读 references/layer2-core.md → 执行 Layer 2

IF user_wants("Hook" OR "钩子系统"):
  → 读 references/layer3-hooks.md → 执行 Layer 3

IF user_wants("Service层" OR "双轨" OR "掌握度引擎"):
  → 读 references/layer4-services.md → 执行 Layer 4

IF user_wants("子Agent" OR "Daemon" OR "后台任务"):
  → 读 references/layer5-agents.md → 执行 Layer 5

IF user_wants("MCP工具" OR "CLI命令" OR "Notion同步" OR "E2E测试"):
  → 读 references/layer6-integration.md → 执行 Layer 6

IF user_wants("面试陪练完善" OR "复习调度" OR "收尾打磨"):
  → 读 references/layer7-polish.md → 执行 Layer 7

IF user_wants("继续" OR "断点续传" OR "上次到哪了"):
  → 读 references/execution-matrix.md → 检查断点续传检查点 → 继续未完成 Layer

IF user_wants("全景" OR "看看整体进度"):
  → 读 references/execution-matrix.md → 输出并行矩阵 + 里程碑状态
```

---

## 并行执行策略

本蓝图设计为多 Agent 并行实施，每个 Layer 内标记了可并行拆分的 Agent 组：

| 时间段 | Agent 1 | Agent 2 | Agent 3 | Agent 4 |
|--------|---------|---------|---------|---------|
| T0 | Layer 0 全部（顺序） | — | — | — |
| T1 | 1.1+1.2 DB Schema | 1.3+1.4 Repositories | — | — |
| T2 | 2.1 状态机 | 2.2 策略引擎 | 2.3 Zod Schema | — |
| T3 | 4.1 双轨对象 | 4.2 掌握度引擎 | 4.4 上下文管理器 | 5.1 Agent契约 |
| T4 | 4.3 核心服务 | 3.1+3.2 Hook系统 | 5.2 子Agent实现 | 5.3 Daemon |
| T5 | 6.1 MCP Tools | 6.2 CLI Commands | 6.3 Notion Sync | 集成联调 |
| T6 | 6.4 E2E Test | E2E缺陷修复 | 回归测试 | 发布门槛核验 |
| T7 | 7.1 面试陪练 | 7.2 复习调度 | 7.3+7.4 DB+文档 | 7.5 Skill打包 |

预估：单Agent约20小时，4 Agent并行约7-9小时。

---

## 版本里程碑

### V1（主链路跑通）
Layer 0-3 + Layer 4.3(核心Service) + Layer 5基础 + 基础E2E
- 能投入材料走完 INGEST → DONE
- SQLite 20表完整，Hook 5个核心可用，4个核心Agent可调用

### V2（质量提升）
Layer 4 完整 + Layer 5 完整 + Layer 6 完整
- 双轨验收、五维升降级、中断路由、复习队列、面试陪练、Notion同步

### V3（生态增强）
Layer 7 全部
- 完整策略引擎、DB完整生命周期、统计看板、Skill Creator打包、文档零残留

---

## 关键风险与防坑

| # | 风险 | 防护 |
|---|------|------|
| P1 | UserPromptSubmit 输出纯文本静默失效 | stdout 必须 JSON |
| P2 | 裸 bun 因 PATH 问题失效 | 统一 bun-runner.sh |
| P3 | 只读连接重复执行 WAL pragma | 代码审计确认 readonly 无 WAL |
| P4 | Hook 递归调用 | MEMORY_INJECT_ACTIVE 守卫 |
| P5 | Hook 启动目录漂移 | 统一从仓库根执行 + settings 固定路径 |
| P6 | 进程强杀 WAL 未收敛 | SIGINT/SIGTERM 拦截 + checkpoint |
| P7 | 大模型控制轮询烧 Token | check_job_status 内部 Bun.sleep 阻塞 |
| P8 | 短命进程后台任务丢失 | Daemon 独立守护进程 |
| P9 | 跨进程 SQLITE_BUSY | withBusyRetry 指数退避 |

---

## 断点续传检查点

每完成一个 Layer，更新此处状态（实施时在 references/execution-matrix.md 中维护）：

- [ ] Layer 0: Foundation
- [ ] Layer 1: Data Layer
- [ ] Layer 2: Core Engine
- [ ] Layer 3: Hook System
- [ ] Layer 4: Services
- [ ] Layer 5: Agent System
- [ ] Layer 6: Integration
- [ ] Layer 7: Polish
- [ ] V1 里程碑: 主链路跑通
- [ ] V2 里程碑: 质量提升
- [ ] V3 里程碑: 生态增强

---

## 核心规则

- **[LOCAL-ONLY]** 本技能依赖 Bash/bun/Git/子Agent，仅在 Claude Code CLI 本地终端使用
- **bun 优先**：所有脚本用 bun 运行，不用 npm/pnpm/npx
- **每 Layer 必须有验收门槛**：通过才能进入下一层
- **并行 Agent 各自独立**：通过 SQLite 共享数据，不共享内存状态
- **防坑表中的每条必须在实现时落地**：不是参考建议，是硬性要求
