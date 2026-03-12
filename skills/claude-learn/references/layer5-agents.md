# Layer 5: Agent System（可并行·约3小时）

## 可并行拆分为 2 个 Agent

### Agent-SubAgents（5.1 + 5.2）

#### 5.1 Agent 契约定义
- [ ] 每个 Agent 统一契约：inputSchema(Zod) + outputSchema(Zod) + repairPrompt + maxRetries(3) + fallbackAction + strictPersistence
- [ ] A类严格Agent（禁止部分入库）：material-extractor, coverage-auditor, answer-scorer, interview-pack-builder
- [ ] B类增强Agent（可部分入库）：story-linker, card-generator, quiz-generator, interview-coach

#### 5.2 8个子Agent实现
每个 Agent 使用旁路 API 调用（`@anthropic-ai/sdk`），不走 CLI 内部调度：

- [ ] `agents/material-extractor.md` + 实现
  - 输入：materialText, chunkHints, sessionId
  - 输出：modules[], problems[], concepts[], relations[], confusions[], applications[], interviewHotspots[]
- [ ] `agents/coverage-auditor.md` + 实现
  - 输入：chunk, conceptMap
  - 输出：auditResult{chunkId, classification, mappedTo, reason}
- [ ] `agents/quiz-generator.md` + 实现
  - 输入：moduleOverview, testedInfo, levelRatio, targetTier
  - 输出：questions[]{conceptId, level, angle, questionText, expectedPoints}
- [ ] `agents/answer-scorer.md` + 实现
  - 输入：question, expectedPoints, rawAnswer
  - 输出：五维分数 + overallStatus + mastery_score + 触发建议 + 判分理由
- [ ] `agents/card-generator.md` + 实现
  - 输入：concept, scoringResult, storyCandidates
  - 输出：cardCandidates[]
- [ ] `agents/story-linker.md` + 实现
  - 输入：concept, storyPool
  - 输出：topCandidates[], matchReasons[]
- [ ] `agents/interview-pack-builder.md` + 实现
  - 输入：moduleConcepts, deepInsights, weaknessRecords, storyLinks
  - 输出：{oneLiner, mechanism, scenarioJudgement, projectHook, followupFramework}
- [ ] `agents/interview-coach.md` + 实现
  - 输入：concept, storyPool, currentLevel
  - 输出：STARL骨架/费曼反馈/压力追问

#### API 限流防护
- [ ] 全局任务调度器（p-limit，maxConcurrent: 3）
- [ ] 429 指数退避（不计入 maxRetries）
- [ ] 业务失败才计入 maxRetries

### Agent-Daemon（5.3）

#### 5.3 Daemon 守护进程
- [ ] `src/worker/daemon.ts`
  - 死循环轮询 jobs 表（QUEUED → RUNNING → SUCCEEDED/FAILED）
  - 轮询间隔：默认2s，有任务时500ms
  - 并发上限：maxConcurrent: 3
  - 单任务超时：90s
  - 心跳：每30s写时间戳到config表
  - SIGINT/SIGTERM 优雅退出（回退 RUNNING → QUEUED + WAL收敛）
  - 崩溃自愈：RUNNING超时 → 下次启动回收为QUEUED
- [ ] `execute_pending_tasks` Tool
  - 唯一职责：向 jobs 表插入 QUEUED 记录
  - 1秒内返回 `{"status": "task_queued", "job_id": "xxx"}`
- [ ] `check_job_status` Tool
  - 内部 Bun.sleep() 阻塞循环（2s×20次≈40s）
  - 完成返回 result_summary_json
  - 超时返回 RUNNING

**验收门槛**：Daemon启停测试 + SIGINT回退测试 + 任务执行完整流程
