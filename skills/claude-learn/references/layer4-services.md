# Layer 4: Services（可并行·约4小时）

## 可并行拆分为 4 个 Agent

### Agent-DualRail（4.1）

#### 4.1 双轨对象
- [ ] `src/core/rails/coverage-rail.ts`
  - CoverageRail 类
  - 达标条件：required=1 的 concept → covered=1 且 tested=1 且 backfilled=1
  - 覆盖率统计
  - 与 coverage-rail-repo 集成
- [ ] `src/core/rails/weakness-rail.ts`
  - WeaknessRail 类
  - 同类弱点唯一打开规则 (session_id, module_id, concept_id, weakness_type)
  - 达标条件：HIGH severity → RESOLVED, needs_expression → 表达卡已生成
  - 与 weakness-rail-repo 集成
- [ ] `src/core/rails/joint-scheduler.ts`
  - 联合调度器：覆盖轨缺口 + 薄弱点轨严重度 → 联合优先级

**测试**：覆盖轨达标/未达标、弱点轨去重/升级/降级、联合调度排序

### Agent-Mastery（4.2）

#### 4.2 掌握度引擎
- [ ] `src/core/mastery/mastery-engine.ts`
  - mastery_score 按 target_tier 分层权重计算
  - DWD权重：recognition*20 + explanation*25 + distinction*25 + application*30 + projectExpression*0
  - DWS权重：15 + 20 + 20 + 25 + 20
  - ADS权重：10 + 15 + 15 + 25 + 35
  - 达标判定（DWD≥40, DWS≥65, ADS≥85）
  - 总状态映射：UNTESTED → WRONG → HESITANT → CORRECT → INTERNALIZED → INTERVIEW_READY
  - 升级/降级规则
  - forceDeepIfUserAsked(conceptId) → 强制升ADS
- [ ] `src/core/mastery/angle-checker.ts`
  - 五角度确认（反向推导/场景代入/类比迁移/边界测试/一句话精华）
  - ADS达标：≥3角度通过 + 0失败
- [ ] `src/core/mastery/insight-detector.ts`
  - 洞察信号词检测（原来如此/懂了/明白了/哦这样/我理解了）
  - 触发：优先级升级 + DWD→DWS候选 + 卡点卡候选

**测试**：三层权重计算、达标/未达标边界、升降级流转、洞察触发

### Agent-CoreServices（4.3）

#### 4.3 核心服务层（12个 Service）
- [ ] `src/services/ingest-service.ts`
  - 收材料、切chunk、调 material-extractor Agent
  - 生成 modules/problems/concepts 草稿
- [ ] `src/services/audit-service.ts`
  - 一级程序粗筛（去空段、标记低密度、hash、去重）
  - 二级 Claude 细判（送 coverage-auditor Agent）
  - 维护 checklist、统计覆盖率
- [ ] `src/services/testing-service.ts`
  - 分模块出题（5-7题/轮，L1:50% L2:30% L3:20%）
  - 调 quiz-generator Agent
  - 记录答案
- [ ] `src/services/scoring-service.ts`
  - 调 answer-scorer Agent
  - 五维打分 + mastery_score 计算
  - 触发 weakness card / 表达卡 / 项目证据卡
  - 更新 CoverageRail + WeaknessRail
- [ ] `src/services/card-service.ts`
  - 五类卡路由（覆盖卡/卡点卡/应用卡/表达卡/项目证据卡）
  - dedup / merge / archive
  - 每 concept 限流（总卡数≤6）
  - dedupKey = conceptId:cardType:semanticHash(questionCore)
- [ ] `src/services/story-service.ts`
  - 项目故事池管理
  - 调 story-linker Agent
  - Top3 候选 + 匹配理由
  - is_validated 优先选
- [ ] `src/services/pack-service.ts`
  - 调 interview-pack-builder Agent
  - 五段结构校验（Zod）
  - pack_type: MODULE_PACK / INTERVIEW_SCRIPT
- [ ] `src/services/review-service.ts`
  - P0-P3 优先级队列
  - 艾宾浩斯间隔（当天/1天/3天/7天/14天）
  - 双轨联合调度
- [ ] `src/services/interview-service.ts`
  - 面试陪练模式
  - STARL骨架 / 费曼循环 / 5级压力追问
- [ ] `src/services/rail-service.ts`
  - 双轨状态统一管理
  - 模块完成双轨验收
- [ ] `src/services/resume-service.ts`
  - 从SQLite读 session + module + rails + pending + latest scoring
  - 构建 Resume Context Pack
  - 返回给 SessionStart 注入
- [ ] `src/services/db-lifecycle-service.ts`
  - init / migrate / verify / export / import / snapshot / portable-export

### Agent-ContextManager（4.4）

#### 4.4 上下文管理器
- [ ] `src/core/context/context-manager.ts`
  - `buildMaterialSummary()`：模块列表/核心concept/易混点/应用点/高频面试点/覆盖审计结论
  - `buildModuleSummary()`：核心concept/卡点摘要/五维掌握/pack/未解决weakness
  - `buildResumeContextPack()`：恢复上下文包（供resume-service调用）
  - `buildCompactSummary()`：PreCompact 摘要
  - 6个清理节点实现：
    1. AUDIT→TEST前（材料级结束）
    2. 模块PACK完成后（模块闭环）
    3. 中断处理完成后（轻清理）
    4. 进入面试陪练前
    5. PreCompact（正式压缩）
    6. SessionStart（瘦恢复）
  - 模块内阈值清理（≥10题 或 ≥20轮 或 ≥2次追问分叉）
- [ ] `src/core/interrupt/router.ts`
  - 4类中断路由：同模块追问 / 跨模块相关 / 项目表达 / 完全无关

**验收门槛**：每个 Service 有基础集成测试 + 双轨验收逻辑测试
