# 模式6：有材料模式（三遍扫描协议）

> 触发词：「学这个」「帮我学」「分析这段」「学习这个」「学这段」「帮我分析」「学一下」「学习这段」
> 必须有关键词才触发，禁止自动识别长文本

## 核心原则：Notion 云端优先

```
权威存储：Notion（无论 CLI 还是 Cloud 环境）
本地 SQLite：仅 CLI 环境，作为会话缓存，以 Notion 为准
断点续传状态：统一存 Notion DWD 页面系统区
```

---

## 三遍扫描协议

### SubAgent 隔离架构（上下文不爆炸的关键）

```
主 Agent（协调者，全程只持有 JSON 摘要，窗口始终轻量）
  ↓
[遍1 SubAgent] 串行，独立上下文
  每块 ~120行（约占50%上下文）→ 滚动更新意图假设
  全部读完 → 返回 IntentMap JSON (~1000字) → SubAgent 销毁
  ↓ 主 Agent 持有 IntentMap（~1000字）
[遍2 SubAgent × N] 并行，各自独立上下文
  每个 SubAgent = IntentMap(1000字) + chunk(120行)
  → 返回知识点 JSON → 各自销毁
  ↓ 主 Agent 合并去重
[遍3 SubAgent × N] 并行，各自独立上下文
  每个 SubAgent = IntentMap + 章节知识点列表
  → 返回原子化知识点 JSON → 各自销毁
  ↓ 主 Agent 得到最终 AtomicKnowledgePoint[]
```

**原文只存在于对应 SubAgent 内，结束即销毁。不需要主动清空——SubAgent 边界天然隔离。**

### 遍1（串行）：滚动意图提炼

```
目标：从全文中提炼稳定的「意图地图」（IntentMap）
方法：每次读一个 ~120行 chunk → 更新意图假设 → 丢弃原文 → 继续

使用 buildRollingIntentPrompt(currentIntent, newChunk, idx, total)
  → LLM 返回新版 IntentMap JSON
  → 更新 state.pass1ChunkIndex + state.intentMapVersion
  → 同步保存到 Notion 系统区（CLI 同时写 SQLite）

产出：稳定的意图地图（500-1500字，按材料规模）
格式：IntentMap { coreThesis, logicChain[], hiddenAssumptions[], domainMap{} }
```

### 遍2（可并行）：知识点填充

```
目标：以意图地图为锚点，从每个 chunk 提取结构化知识点
方法：并行 SubAgent，每个 = IntentMap + 1 chunk

使用 buildKnowledgeExtractionPrompt(intentMap, chunk, idx)
  → LLM 返回 KnowledgePoint[] JSON（带 intentRank + intentRole）
  → 主 Agent 调用 mergeKnowledgePoints(lists) 合并去重
  → 更新 state.pass2ChunkIndex

产出：带意图标注的知识点列表
关键字段：intentRank（服务第几条逻辑链）+ intentRole（具体作用）
```

### 遍3（可并行）：原子化拆分

```
目标：把知识点拆成最小可测单元，补充闪卡元数据
方法：并行 SubAgent，每个 = IntentMap + 一批知识点

使用 buildAtomizationPrompt(intentMap, kpList)
  → LLM 返回 AtomicKnowledgePoint[] JSON
  → 每个原子点：atomic=true + 完整闪卡状态字段
  → 按 intentRank ASC 排序（核心意图在前）
  → 更新 state.pass3Done = true

产出：可直接入库的 AtomicKnowledgePoint[]
```

---

## DWD 页面结构（三遍扫描升级版）

```
【顶部·用户可见】
━━━━━━━━━━━━━━━━━━━━
🗺️ 全景地图
  🧠 核心意图（按重要性排序）
    1. [主命题]（N个知识点支撑）
    2. [逻辑链B]...
  📚 章节覆盖概览（表格）
  📊 掌握进度统计

━━━━━━━━━━━━━━━━━━━━
【系统区·自动维护】（<!-- SYS_START --> ... <!-- SYS_END --> 包裹）
  ⚙️ 断点续传状态（JSON code block）
  🧠 意图地图 v{N}（JSON code block）
```

使用 `DwdWriter.buildIntentLayer()` 生成顶部全景地图
使用 `DwdWriter.buildSystemSection()` 生成系统区 JSON 块

---

## 断点续传协议（以 Notion 为准）

```typescript
// 会话开始时执行
STEP 1: 检测环境（detectEnvironment()）
STEP 2: 从 Notion 拉取 DWD 页面 → parseNotionSystemSection(pageBody)
STEP 3: 若 CLI，加载本地 SQLite → loadLocalState(materialTitle)
STEP 4: reconcileState(localState, notionState)（Notion 更新则覆盖本地）
STEP 5: 从断点继续（state.phase + state.pass1ChunkIndex / pass2ChunkIndex）

// 每个 chunk 处理后立即同步
saveLocalState(state, intentMap)      // CLI 写 SQLite
buildNotionWritePlan(...)             // 生成写 Notion 的指令计划
→ 串行调用 Notion MCP 更新系统区     // 不并行，避免 sibling 错误
```

---

## Notion 写入流程

```
遍1完成后（IntentMap 稳定）：
  → 若 DWD 不存在：notion-create-page（DWD 库）
  → 写入：全景地图占位符 + 系统区（断点续传状态 + 意图地图 v1）

遍2/3完成后（AtomicKnowledgePoint[] 就绪）：
  → notion-update-page（update_content）更新全景地图顶部
  → notion-update-page（update_content）更新系统区 phase→done
  → 批量创建 ADS records（每个原子知识点一条）
    - ADS 字段：title + status + masteryScore + chapter + note（打包额外字段）
    - note 格式："intentRank|intentRole|level|readCount|testCount"

CLI 环境额外操作：
  → saveLocalConcepts(materialTitle, atomicPoints) 写 SQLite concepts 表
```

---

## 铁律

- 必须有触发词才进入模式6，禁止自动识别长文本
- ODS 必须存原始全文（逐字，不截断）
- DWD 存 Claude 分析结果（知识树 + 意图地图 + 系统区），不存原文
- **[CRITICAL/REQUIRED]** 断点续传状态以 Notion 为准，本地仅缓存
- **[CRITICAL/REQUIRED]** SubAgent 串行读取遍1，并行处理遍2/3
- **[CRITICAL/FORBIDDEN]** ODS 丢弃原文只存摘要 = 严重错误（丢失溯源能力）
- **[CRITICAL/FORBIDDEN]** 遍2/3 SubAgent 提取知识点时不得直接复制原文段落
- Notion MCP 并行调用危险：多个调用放同批次 → 一个失败导致全部失败，关键操作串行

---

## 环境检测 & 同步策略

```
CLI 环境（双写）：
  每次学习进展 →
    1. 写 Notion（DWD 页面 + ADS records）[主]
    2. 写本地 SQLite（engine.db）[辅]
  会话开始 →
    1. 从 Notion 拉取最新状态（以 Notion 为准）
    2. 若 Notion 更新 → 覆盖本地

Cloud 环境（只写 Notion）：
  每次学习进展 → 只写 Notion
  断点续传 → 从 Notion 读取 DWD 系统区 JSON
```

---

## 知识点5态

```
⬜ 未接触 → 🔵 了解中 → 🟡 测试过 → 🟢 已掌握 → 🔴 需复习
```

## 与无材料模式的分工

```
无材料模式（探索式）: 知识点来自对话 → 掌握度写 ADS
有材料模式（系统式）: 字幕/文章粘贴  → 掌握度写 DWD（+ ADS 原子点）
评分体系/艾宾浩斯/L1L2L3: 两种模式完全共用
```

## 相关脚本

- `scripts/three_pass_scanner.ts` — 三遍扫描协议数据结构 + Prompt builders
- `scripts/sync_service.ts` — 环境检测 + Notion 读写计划 + SQLite 本地缓存
- `scripts/text_to_notion_writer.ts` — `DwdWriter.buildIntentLayer/buildSystemSection/buildAtomicPointAdsProps`
