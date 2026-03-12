# Layer 2: Core Engine（可并行·约3小时）

## 可并行拆分为 3 个 Agent

### Agent-StateMachine（2.1）

#### 2.1 状态机核心
- [ ] `src/core/state-machine/types.ts`
  - 主状态链枚举：INGEST → MAP_REVIEW → AUDIT → TEST → BACKFILL → CARD_GEN → PACK → REVIEW_SCHEDULE → DONE
  - 辅助状态：PAUSED / FAILED
  - PENDING 子状态：TEST_PENDING / CARD_GEN_PENDING / PACK_PENDING
  - 面试陪练状态流：INTERVIEW_PREP → STARL_BUILD → FEYNMAN_LOOP → PRESSURE_TEST → FINALIZE
  - session_type: LEARNING / INTERVIEW
  - current_phase_scope: MATERIAL / MODULE
- [ ] `src/core/state-machine/transitions.ts`
  - 状态迁移函数
  - 模块级子循环：TEST → BACKFILL → CARD_GEN → PACK → (下一模块回TEST)
  - module_cursor 推进逻辑
  - PAUSED ↔ 原状态 双向迁移
  - FAILED 回退到上一稳定状态
- [ ] `src/core/state-machine/guards.ts`
  - 模块完成 = 双轨都达标（覆盖轨 + 薄弱点轨）
  - Session完成 = 所有模块双轨达标 + pending处理 + 复习入库 + 输出包落库
  - PENDING 状态孤儿回收逻辑
- [ ] `src/core/state-machine/machine.ts`
  - 内存状态机运行时
  - withSessionLock(sessionId, fn) 互斥锁
  - 状态迁移事件发射
- [ ] `src/core/state-machine/interview-states.ts`
  - 面试陪练独立状态流
  - STARL_BUILD / FEYNMAN_LOOP / PRESSURE_TEST 迁移

**测试**：状态迁移全路径覆盖、PENDING回收、模块子循环、乐观锁冲突

### Agent-PolicyEngine（2.2）

#### 2.2 策略引擎
- [ ] `src/core/policy/engine.ts`
  - 主入口：`evaluate(session, state, hookEvent, toolInfo) → allow|deny|ask|transform|trigger`
  - **原生工具白名单**：非 LEARNING_ENGINE_TOOLS 的工具无条件放行
  - LEARNING_ENGINE_TOOLS 常量（10个域内工具）
- [ ] `src/core/policy/rules/flow-rules.ts`
  - 每个状态允许/禁止的动作清单（见ADS第五章A类）
  - INGEST允许：创建材料、切chunk、调concept-map Agent
  - TEST允许：出题、记录回答、调score Agent
  - PENDING状态：仅允许 execute_pending_tasks + check_job_status
- [ ] `src/core/policy/rules/resource-rules.ts`
  - 禁止Agent/Hook直接写SQLite文件
  - 禁止删除原始材料
  - 禁止无状态写入Notion
- [ ] `src/core/policy/rules/quality-rules.ts`
  - 卡片写入前必须过dedup
  - 输出包必须五段齐全
  - concept map必须有core+confusion+application
  - Agent输出必须过Zod校验
- [ ] `src/core/policy/rules/interrupt-rules.ts`
  - 同模块追问：立即处理
  - 跨模块相关：写入pending pool
  - 项目表达中断：临时调story-linker
  - 完全无关：PAUSED + 新session
- [ ] `src/core/policy/rules/trigger-rules.ts`
  - scoring result → weakness card
  - 模块完成 → pack
  - 五维达标 → 表达卡
  - aha moment → 优先级升级

**测试**：每类规则至少3个test case（allow + deny + edge case）

### Agent-ZodSchema（2.3）

#### 2.3 Zod 校验模型
- [ ] `src/schemas/concept-map.schema.ts`
  - modules[], problems[], concepts[], relations[], confusions[], applications[], interviewHotspots[]
- [ ] `src/schemas/audit-result.schema.ts`
  - auditResult{chunkId, classification, mappedTo, reason}
- [ ] `src/schemas/card-candidate.schema.ts`
  - cardCandidates[] — 5类卡定义（覆盖卡/卡点卡/应用卡/表达卡/项目证据卡）
- [ ] `src/schemas/score-result.schema.ts`
  - 五维分数(0/1/2) + overallStatus + mastery_score + 触发建议 + 判分理由
- [ ] `src/schemas/interview-pack.schema.ts`
  - {oneLiner, mechanism, scenarioJudgement, projectHook, followupFramework}

**测试**：每个schema至少一个valid + 一个invalid case
