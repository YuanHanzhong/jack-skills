# 并行执行矩阵与断点续传

## 并行执行矩阵（Agent 分配建议）

| 时间段 | Agent 1 | Agent 2 | Agent 3 | Agent 4 |
|--------|---------|---------|---------|---------|
| T0 | Layer 0 全部（顺序） | — | — | — |
| T1 | 1.1+1.2 DB Schema | 1.3+1.4 Repositories | — | — |
| T2 | 2.1 状态机 | 2.2 策略引擎 | 2.3 Zod Schema | — |
| T3 | 4.1 双轨对象 | 4.2 掌握度引擎 | 4.4 上下文管理器 | 5.1 Agent 契约 |
| T4 | 4.3 核心服务（含 resume-service） | 3.1+3.2 Hook 系统 | 5.2 子Agent实现 | 5.3 Daemon |
| T5 | 6.1 MCP Tools | 6.2 CLI Commands | 6.3 Notion Sync | 集成联调（6.1~6.3） |
| T6 | 6.4 E2E Test | E2E 缺陷修复 | 回归测试 | 发布门槛核验 |
| T7 | 7.1 面试陪练 | 7.2 复习调度 | 7.3+7.4 DB+文档 | 7.5 Skill打包 |

**预估总工时**：单 Agent 约 20 小时，4 Agent 并行约 7-9 小时

## 版本里程碑

### V1（主链路跑通）
Layer 0-3 + Layer 4.3(ingest/audit/testing/scoring/card/pack) + Layer 5 基础 + 基础E2E
- 能投入材料走完 INGEST → DONE
- SQLite 20表完整
- Hook 5个核心可用
- 4个核心 Agent 可调用

### V2（质量提升）
Layer 4 完整 + Layer 5 完整 + Layer 6 完整
- coverage-audit 子Agent + story-linker
- 五维升降级完善
- 中断路由 + 复习队列
- 面试陪练
- Notion 同步

### V3（生态增强）
Layer 7 全部
- 完整策略引擎
- DB 完整生命周期
- 统计看板
- Skill Creator 打包
- 文档零残留

## 断点续传检查点

每完成一个 Layer，在此标记完成状态：

- [ ] **Layer 0**: Foundation
- [ ] **Layer 1**: Data Layer
- [ ] **Layer 2**: Core Engine
- [ ] **Layer 3**: Hook System
- [ ] **Layer 4**: Services
- [ ] **Layer 5**: Agent System
- [ ] **Layer 6**: Integration
- [ ] **Layer 7**: Polish
- [ ] **V1 里程碑**: 主链路跑通
- [ ] **V2 里程碑**: 质量提升
- [ ] **V3 里程碑**: 生态增强

每个 Agent 完成任务后，在对应 Layer 的 checkbox 打勾，并在此文档底部追加完成日志。

---

## 完成日志

（实施过程中在此追加记录）
