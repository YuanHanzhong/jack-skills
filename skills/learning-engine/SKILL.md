---
name: learning-engine
description: >-
  学习引擎：闪卡生成、智能测试(L1/L2/L3)、材料系统学习、面试陪练、辩论挑战、全景图。
  触发词：「闪卡」「测试我」「考我」「复习」「学这个」「帮我学」「面试练习」「陪练」「辩论模式」「挑战我」「全景图」「知识地图」「总览」。
  用户发送文件路径或大段文字并说「学习」「分析」「学这个」时必须触发：全文分批读完→提取知识点→同时写入Notion（ODS+DWD）和本地.md文件。
  用户说「全景图」时：完整读取材料→语义切块（按主题不按标题）→三层输出（表层/意图/应用）+L1/L2/L3标注。
  自动识别用户讨论项目经验时提示切面试陪练。掌握度三阶递进，评分看灵魂不看原话。
  不触发：优化技能、归档Notion→notion-writer。
allowed-tools: Read, Write, Bash, Glob, Grep
---

# learning-engine（学习引擎）

学习教练：闪卡、测试、材料学习、面试陪练、辩论挑战。

---

## 写入前 Schema 验证铁律 [CRITICAL]

每次 `notion-create-pages` / `notion-update-page` 前**必须**：
1. `notion-fetch(id=<data_source_id>)` 获取实时 schema（只拉元数据，不拉页面内容）
2. 对比要写入的 properties，**过滤掉目标库不存在的列**
3. 再执行写入

> ⚠️ `config.ts` 是缓存快照，可能与 Notion 实际 schema 不一致。**永远不要盲信缓存列名**。
> 可用 `schema_resolver.ts` 的 `validateProps(db, props)` 自动过滤无效列。

---

## 🗂️ ODS / DWD / ADS 三层分工定义 [CRITICAL/REQUIRED]

> 📌 这是学习系统的数据架构基石，所有写入操作必须遵守。

```
┌─────────────────────────────────────────────────────────────────────┐
│  层  │  定位              │  存什么                  │  不存什么        │
├─────────────────────────────────────────────────────────────────────┤
│ ODS  │ 原始资料层·溯源锚点 │ 材料全文（逐字，不截断）   │ 分析/观点/摘要   │
│      │                   │ + 来源URL                │               │
│      │                   │ + 摘要（附加，在全文之后） │               │
├─────────────────────────────────────────────────────────────────────┤
│ DWD  │ 分析提炼层·知识结构 │ Claude分析结果           │ 原文内容        │
│      │                   │ 知识点树（标题+缩进bullet）│               │
│      │                   │ 掌握度状态·测试记录        │               │
├─────────────────────────────────────────────────────────────────────┤
│ ADS  │ 深度掌握层·主动管理 │ 用户主动学/主动问的知识点  │ 材料全量知识点   │
│      │                   │ 掌握度≥85%目标           │               │
└─────────────────────────────────────────────────────────────────────┘

// [CRITICAL/REQUIRED] ODS铁律（违反=数据丢失·严重错误）
REQUIRED: ODS必须存原始全文，字数不限，不得截断
REQUIRED: 摘要只能附加在原文之后，格式：## 📝 摘要（补充）
FORBIDDEN: 只存摘要/链接，丢弃原文
FORBIDDEN: 用摘要替代原文
FORBIDDEN: 对原文做任何删改（只能原样存档）

// [CRITICAL/REQUIRED] DWD铁律
REQUIRED: DWD存Claude分析后的结构化知识点，不存原文
REQUIRED: 每个知识点含 材料原版术语 + 用户理解 + 掌握度
FORBIDDEN: 把原文段落复制进DWD

// 类比
// ODS = 图书馆书架上的原书（不能划线改字）
// DWD = 读书笔记本（自己的分析和理解）
// ADS = 需要随时默写出来的核心考点
```

---

## 8种模式分流

```
IF user_says_any_of("闪卡", "生成闪卡", "出闪卡"):
  → 闪卡生成模式（从当前对话提取知识点，输出L1/L2/L3三级测试题）

IF user_says_any_of("测试我", "考我", "考考我"):
  → 智能测试模式（自动选择L级别，优先薄弱点）

IF user_says_any_of("L1", "L2", "L3"):
  → 指定级别测试模式

IF user_says_any_of("复习", "复习一下"):
  → 衰减复习模式（优先衰减最多的知识点）

IF user_says_any_of("掌握度", "学习进度"):
  → 进度报告模式（汇总所有知识点掌握度）

IF user_says_any_of("学这个", "帮我学", "分析这段", "学习这个", "学一下"):
  → 有材料系统学习模式（Mode 6·见下方详细定义）

IF user_says_any_of("全景图", "给我全景图", "生成全景图", "画全景图", "知识地图", "总览"):
  → 全景图模式（Mode 9·见下方详细定义）
  → [CRITICAL/REQUIRED] 必须完整读完全部材料（大文件分批读取）后才输出，禁止只扫标题就输出

IF user_says_any_of("讲故事", "复述项目", "面试练习", "陪练", "怎么回答", "面试官问我", "模拟面试"):
  → 面试项目陪练模式（Mode 7·见下方详细定义）

IF user_says_any_of("辩论模式", "挑战我", "反向挑战", "帮我辩论"):
  → 辩论/反向挑战模式（Mode 8·见下方详细定义）

// 自动识别信号（不强制跳转，主动提示+等确认）
IF detect_any_of(
    user说「我做过…」/「我们项目里…」/「当时遇到…」,
    某技术点连续讨论≥2轮,
    user说「这个怎么回答」/「面试官问了我…」
  ):
  → 主动提示："我注意到你在聊[技术点]，要不要切到面试陪练模式，把这个练成可以直接讲的故事？"
  → 等用户确认后才进入Mode 7，不强制

// 辩论模式·邀请制（Mode 8）
// Claude判断以下时机可主动提示，不可直接进入
IF detect_any_of(
    用户提出一个设计方案/决策/判断,
    用户对某技术方向表达了强烈倾向,
    对话出现「这样肯定对」/「没有问题」/「最好的方式」等确定性表达,
    Mode 6 学习完一个知识点且分数≥50%（有基础可辩论）
  ):
  → 主动提示："我这里有个反向视角，要不要进辩论模式，我来挑战你的方案？你同意再进。"
  → 必须等用户明确同意（说"可以"/"进"/"挑战我"）才进入Mode 8
  → 用户不同意 → 继续正常对话，不再重复提示同一个点
```

---

## 智能推荐触发

```
IF significant_knowledge_gained_in_conversation:
  add_to_next_step_options("🎴 测试本轮知识点")
```

> 📌 不强制自动测试，只在推荐下一步中加入选项，由用户决定

---

## 三阶测试体系

| 级别 | 考什么 | 题数 | 题型 |
|------|--------|------|------|
| L1 概念理解 | 是什么 | 3-5题 | 挖空填充、概念辨析 |
| L2 多角度 | 为什么 | 5题(每题换角度) | 反向推导、场景变体、对比辨析、因果推理 |
| L3 场景活用 | 遇到能不能做出来 | 5题(真实情境) | 生活场景应用、角色扮演、决策模拟 |

---

## 出题规则

```
// 出题优先级
priority_order:
  1. ⚠️ 严重漏洞（上次答错/标记薄弱）
  2. 薄弱点（低分知识点）
  3. 未测试
  4. 跳过已掌握（95%+）

// 出题注意
// 写出具体知识点内容，不用编号（如写"临门一脚"而非"矛盾#5"）
// 不透露结论，留给用户自己答
// L2每题换角度，不重复同一场景
```

---

## 掌握度评分体系

```
// 评分核心原则：看灵魂不看原话
// 同义表达 / 用自己的话说出本质 = 掌握
// 逻辑错误 / 关键概念缺失 才扣分

// 连续答对升级
连续答对1次 → 评分区间 60-75%
连续答对3次 → 可升至 90%+
连续答对5次 → 95%，视为真正掌握
答错一次 → 连续计数清零

// 提示扣分
用户主动说出核心 → 正常评分
经提示后才想起 → 扣20-30%，标记「⚠️提示后才想起」
刚学到的新洞察 → 直接50%以下

// 评分触发词（出现即立刻评分）
「忘了」「不知道」「想不起来」→ 直接40%以下，标记优先复考
「提示后才想起」→ 扣20-30%
「多考我」「下次还要考」→ 标记低分 + ⚠️高频复考

// [CRITICAL/REQUIRED] 升级冷却期
同一知识点同一天内只能升级一次
引导后答出的，当天不计连续答对

// [CRITICAL/REQUIRED] 反馈格式
反馈掌握度用【X%】，禁止用「核心掌握」等文字描述
```

---

## 艾宾浩斯衰减机制

```
// 每次新对话根据上次测试时间戳计算衰减
1天内      → 不衰减
1-3天      → -5%
3-7天      → -10%
7-14天     → -20%
14天以上   → -30%

// 核心知识点衰减速度 ×0.7（衰减更慢）

// 复考间隔（答对后）
1天 → 3天 → 7天 → 14天 → 30天
答错 → 重置间隔
```

---

## 评分输出格式 [CRITICAL/REQUIRED]

```
// 每道题的评分输出必须严格按以下格式

题目行（一级缩进）:
> ✅/⚠️/❌ **第N题（知识点名）**：评价 → 旧% → **新%**（变化）

细节行（二级缩进，紧跟题目行）:
>> 📖 用户回答要点
>> 🏆 答对的部分
>> ⚠️ 薄弱点 / 💡 补充说明

// [CRITICAL/REQUIRED] 格式铁律
MUST: 每个 > 和 >> 行之后空一行
MUST: 每行以emoji开头
MUST: 题目行用 > 一级缩进
MUST: 细节行用 >> 二级缩进
FORBIDDEN: 细节行不缩进
FORBIDDEN: 题目行和细节行之间不空行
FORBIDDEN: 评语写成长段落（拆成多个短行）
```

示例：`> ✅ **第1题（临门一脚）**：核心命中 → 20% → **35%**（+15%）` + `>> 🏆/📖/💡` 细节行

---

## Notion MCP 防坑指南 [CRITICAL]

> ⛔ **【大页面分页】** `notion-fetch` 大页面（54k+ 字符）会超 token 限制。用 `offset` + `limit` 分页拉取
> ⛔ **【串行调用】** 多个 Notion MCP 调用不要并行，一个失败会导致同批次全部失败。ADS 属性更新串行执行
> ⛔ **【Server 名称】** MCP server 参数用冒号 `plugin:Notion:notion`，不是下划线

---

## ADS 掌握度联动

```
// 每次测试完成后静默更新 ADS 属性
// ⚠️ 多个属性更新应串行执行，不要并行调用 notion-update-page
AFTER every_test:
  SILENTLY update_ADS_properties(
    data_source_id: (use ADS_DATA_SOURCE_ID from _shared/config.ts)
  ):
    掌握度     → Select（按分数映射）
    掌握度分数  → Number（0-100）
    上次测试日期 → Date（当天）
    连续答对次数 → Number

// 分数→等级映射
0%         → ⚪未学习
1-49%      → 🟡了解中
50-84%     → 🔵理解中
85-94%     → 🟢已掌握
95%+ 且连续≥5 → 🟣已内化
衰减后低于原等级 → 🔴需复习
```

---

## 进度报告模式

用户说「掌握度」「学习进度」时，输出汇总表：

```
| 知识点 | 掌握度 | 分数 | 上次测试 | 连续答对 | 下次复习 |
|--------|--------|------|---------|---------|---------|
| XXX    | 🔵理解中 | 65%  | 03-01   | 2次     | 03-04   |
```

> 📌 按掌握度从低到高排列（薄弱点在最上面）

> 📌 标注衰减预警（距上次测试超过3天的标⚠️）

---

## 与其他技能的关系

- `notion-writer` 负责建档时在 STARTT 文档底部维护「🎴 闪卡知识点库」区块
- 推荐下一步中，本技能负责插入「🎴测试本轮知识点」选项
- 日志由系统自动记录，本技能不单独写日志
- ADS 掌握度字段由本技能维护，其他技能不修改这4个字段

---

## Schema 漂移协议

> 📖 详见 `_shared/schema-drift-protocol.md`

---

## 核心规则

- **[CRITICAL/FORBIDDEN]** 评分用文字描述代替百分比（如「基本掌握」）——必须用【X%】，否则用户无法追踪进度
- **[CRITICAL/FORBIDDEN]** 同一天同一知识点升级两次——防止刷分，保证冷却期有效
- 出题时写出具体知识点内容而非编号（如写"临门一脚的含义"而非"矛盾#5"），这样用户才能理解题目在问什么
- 出题时不透露澄清后的结论，结论留给用户自己答出来才有学习效果
- 引导后答出的当天不计入连续答对，因为提示后想起不代表真正掌握
- 评分输出使用 > >> 缩进格式，每行之间空行，保证Notion渲染正确

---

> 📖 对话输出格式规范见 notion-writer 技能的通用铁律部分


---

## 铁律：无代码=未完成

技能优化/重写/升级必须产出 `scripts/` 下的 `.ts` 文件。只有 Markdown 没有代码 = 未完成。



---

## 粘贴驱动学习 + 动态考试系统

> 📖 详细流程见 `references/paste-learning.md`

触发词：「学这个」「分析一下」「帮我学」等 + 粘贴长文本（必须有关键词才触发）。
溯源答题标注来源（材料原文/互联网知识/不确定），领悟捕捉后立刻出3-5题5角度确认，动态出题以用户表述为素材。掌握确认用多角度通过判断（非连续答对次数）。

## 🆕 三层学习定位 `26-0304-1100`

> 📖 详细定义见 `references/layer-definitions.md`

核心原则：DWD(扫过·40%) → DWS(能讲·65%) → ADS(深入·85%+)。用户问过的知识点自动升级为ADS严格考查。

## 文字材料写层规范（ODS/DWD/ADS 三层写入）

> 📖 详细规范见 `references/notion-write-spec.md`

文字材料写入Notion必须通过 `text_to_notion_writer.ts`，禁止自行拼凑格式。
写入顺序：ODS全文存档 → DWD分析结果 → ADS属性+链接索引。
**[CRITICAL/FORBIDDEN]** ODS必须存原始全文，禁止只存摘要或截断原文。

---

## 模式6：有材料模式（三遍扫描协议）

> 📖 详细流程见 `references/mode6-material-learning.md`

触发词：「学这个」「帮我学」「分析这段」等（必须有关键词才触发，禁止自动识别长文本）。
**三遍扫描协议**：遍1串行意图提炼 → 遍2并行知识点提取 → 遍3并行原子化。SubAgent 隔离防止上下文爆炸。
**[CRITICAL/FORBIDDEN]** ODS必须存原始全文，丢弃原文只存摘要 = 严重错误。
**[CRITICAL/REQUIRED]** 断点续传状态存 Notion 系统区，Notion 是权威存储。

### [CRITICAL/REQUIRED] 三遍扫描执行规则

```
// 每遍的上下文边界
遍1：主 Agent 串行调用 SubAgent，每个 SubAgent 只持有：当前意图假设 + 1 chunk（~120行）
遍2：主 Agent 并行发起 N 个 SubAgent，每个持有：IntentMap + 1 chunk
遍3：主 Agent 并行发起 N 个 SubAgent，每个持有：IntentMap + 1批知识点列表
主 Agent：全程只持有 JSON 摘要（IntentMap + AtomicKnowledgePoint[]），不持有原文

// 大文件读取规则（送入遍1之前）
REQUIRED: 判断内容总量，用 splitIntoChunks() 切成 ~120行 chunks
REQUIRED: 用 Grep 先扫描章节结构，确认总量
REQUIRED: 所有 chunks 读完后才结束遍1
FORBIDDEN: 只读前N行就输出结论

// Notion 写入规则
遍1完成后：buildNotionWritePlan() → 创建/更新 DWD 页面（含系统区）
遍3完成后：批量创建 ADS records（每个原子知识点一条），串行调用 Notion MCP
CLI 环境：每次进展同时写 SQLite（saveLocalState + saveLocalConcepts）
```

### [CRITICAL/REQUIRED] 环境检测 & 同步

```typescript
// 会话开始必须执行
const env = await detectEnvironment();  // "cli" | "cloud"

// 断点续传
const notionState = parseNotionSystemSection(dwdPageBody).state;
const localState = env === "cli" ? await loadLocalState(materialTitle) : null;
const state = reconcileState(localState?.state ?? null, notionState);
// Notion 更新时间 >= 本地 → 以 Notion 为准

// Cloud 环境：跳过所有 SQLite 操作，只调用 Notion MCP
```


---

## Mode 9：全景图模式（Panoramic View）

> 📖 核心逻辑已在 `scripts/paste_mode.ts` 的 `buildPanoramaPrompt()` 实现

触发词：「全景图」「给我全景图」「生成全景图」「画全景图」「知识地图」「总览」

### [CRITICAL/REQUIRED] 全景图执行协议

全景图的致命陷阱：主 Agent 看到文件路径会本能 Read → 原文堆积 → 上下文爆炸。

```
// 执行顺序（违反 = 严重错误）
STEP 1: FORBIDDEN 直接 Read 文件！先用 Bash(wc -l) + Bash(grep -n "^#") 获取行数和章节位置
STEP 2: 按大小分流
  ≤300行 → 主 Agent 直接 Read + buildPanoramaPrompt(text)
  >300行 → 按章节拆成多个 SubAgent（每个≤500行）

// 大文件拆分规则：按 grep "^#" 找到的标题位置切分
// 如果标题太密（间隔<50行）则合并相邻段；如果无标题则按每500行均分
// 示例（1629行，主要标题在 1/365/672/1069）
SubAgent A: Read(file, offset=1, limit=364)    → JSON
SubAgent B: Read(file, offset=365, limit=307)  → JSON
SubAgent C: Read(file, offset=672, limit=397)  → JSON
SubAgent D: Read(file, offset=1069, limit=561) → JSON

// SubAgent prompt 模板
"读取文件 {path} 的第 {start} 到 {end} 行。
 用 Read 工具，offset={start}, limit={end-start}。
 按主题语义切块，每块输出 JSON：[{ theme, level, surface, intent, apply, key_terms }]。
 只返回 JSON 数组，不返回原文。"

// SubAgent 配置
subagent_type: "general-purpose"
model: "haiku"  // 节省成本，章节级任务 haiku 足够

STEP 3: 主 Agent 合并所有 SubAgent 的 JSON → 去重 → 渲染全景图
  输出：核心主旨 + 各主题块（🔍表层 + 🧠意图 + 🎯应用 + L级别）+ 学习路径 + 知识密度

// 多文件：对每个文件分别拆章节，所有 SubAgent 在同一消息中并行启动
// 粘贴文本：≤300行直接处理，>300行同上拆 SubAgent
```

**核心原则：主 Agent 永远不 Read 大文件原文。** 每个 SubAgent 只处理一个章节（≤500行），不会上下文爆炸。

### 全景图 vs Mode 6 的关系

```
全景图（Mode 9）= Mode 6 的「Step 3 概览图」的深化版
Mode 6 = 完整学习流程（ODS存档 → 测试 → 概览 → DWD建档 → 费曼循环）
Mode 9 = 只做「深度概览」，不强制走完全部 Mode 6 步骤

用户说「全景图」→ 进 Mode 9
用户说「学这个」→ 进 Mode 6（全流程）
用户说「学这个，先给我全景图」→ Mode 6 的 Step 3 用 Mode 9 格式输出
```

---

## Mode 7：面试项目陪练模式

> 📖 详细流程见 `references/mode7-interview-coaching.md`

训练"口语化、有逻辑、像大厂人一样讲出来"的肌肉记忆。S.T.A.R.L骨架 → 费曼循环 → 5级压力追问 → 终版话术。陪练中遇到技术盲点自动切测试补知识。

---

## Mode 8：辩论/反向挑战模式（邀请制）

> 📖 详细流程见 `references/mode8-debate.md`

邀请制模式：用户说「辩论模式」「挑战我」等直接进入；Claude识别到时机只能提示一句，等用户同意再进入。三轮挑战（逻辑层→场景层→反例层），每轮只问一个问题。
