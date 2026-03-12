# Layer 1: Data Layer（可并行·约2小时）

## 可并行拆分为 2 个 Agent

### Agent-DB-Schema（1.1 + 1.2）

#### 1.1 Drizzle Schema 定义
- [ ] `src/data/schema.ts` — 20张表的 Drizzle 定义：
  - **核心表（8张）**：sessions, materials, modules, concepts, cards, stories, interview_packs, problems
  - **辅助表（8张）**：material_chunks, concept_relations, test_questions, answer_attempts, scoring_results, story_links, review_queue, pending_questions
  - **双轨表（2张）**：coverage_rails, weakness_rails
  - **快照表（1张）**：session_snapshots
  - **异步任务表（1张）**：jobs
- [ ] 所有关键索引（见ADS第二十一章完整列表）
- [ ] 幂等键：materials.checksum UNIQUE, cards.dedup_key UNIQUE, story_links(concept_id, story_id) UNIQUE
- [ ] sessions.version 乐观锁字段
- [ ] coverage_rails UNIQUE(session_id, module_id, concept_id)
- [ ] weakness_rails 联合索引 (session_id, module_id, concept_id, weakness_type, status)
- [ ] mastery_map_view 视图定义

#### 1.2 DB 初始化命令
- [ ] `src/cli/commands/init-db.ts`
- [ ] 创建全部schema + 写入 schema_version + 基础系统配置
- [ ] `src/data/db.ts`：写连接初始化（WAL + busy_timeout + foreign_keys + synchronous）
- [ ] `src/data/db.ts`：只读连接初始化（仅 busy_timeout + foreign_keys）
- [ ] 测试：`bun run db:init` 成功

### Agent-DB-Repo（1.3 + 1.4）

#### 1.3 Repository 基类
- [ ] `src/data/repositories/base-repo.ts`
- [ ] `withBusyRetry<T>(fn, maxRetries=5)`：指数退避 + Jitter（初始50ms，最大2s）
- [ ] `withTransaction(fn)`：小颗粒事务包装
- [ ] 单次事务不超过50条写入

#### 1.4 14个 Repository 实现
- [ ] session-repo.ts（含 version 乐观锁校验）
- [ ] material-repo.ts（含 checksum 幂等）
- [ ] concept-repo.ts
- [ ] card-repo.ts（含 dedup_key 幂等）
- [ ] story-repo.ts
- [ ] question-repo.ts
- [ ] scoring-repo.ts
- [ ] pack-repo.ts
- [ ] review-repo.ts
- [ ] pending-repo.ts
- [ ] coverage-rail-repo.ts
- [ ] weakness-rail-repo.ts（含 `upsertWeaknessRail()` 同类弱点唯一打开规则）
- [ ] snapshot-repo.ts
- [ ] job-repo.ts

**验收门槛**：`bun run db:init` 成功 + `bun run db:verify` 通过 + 每个 repo 有基础 CRUD 测试
