---
name: notion-writer
description: >-
  Notion统一写入路由器，按用户意图自动分流到ADS或DWS。
  ADS路径触发词：「新需求」「有个需求」「提需求」「建个档」「维护文档」「扫描ADS」。
  DWS路径触发词：「归档」「沉淀」「📦」「存入Notion」「记录到DWS」。
  自动触发：强肯定语气或对话超5轮有新认知→DWS归档。
  不触发：闪卡/测试→learning-engine；目录整理→notion-organizer。
allowed-tools: Read, Write, Bash, Glob, Grep
---

# notion-writer（Notion统一写入路由器）

合并 auto-filing + requirement-tracker + notion-ops，一个入口，按意图自动分流。

---

## 一、路由决策树

```
用户消息
  ↓
含「需求」「ADS」「建档」「维护文档」？ ──→ 🅰️ ADS路径（需求文档）
  ↓ 否
含「归档」「沉淀」「📦」「存Notion」「DWS」？ ──→ 🅱️ DWS路径（对话归档）
  ↓ 否
含「扫描ADS」「看看看板」「查一下ADS」「To-Do改了」？ ──→ 🅰️ ADS路径·Phase 0.5扫描
  ↓ 否
自动触发（强肯定/超5轮有新认知）？ ──→ 🅱️ DWS路径（静默归档）
  ↓ 否
新对话+用户有具体需求/想法 ──→ 🅰️ ADS路径（第一轮建骨架）
```

> 📌 **【冲突解决·CRITICAL】** 消息同时含「ADS」+任何Notion写入词 → 100%走🅰️ADS路径

> 📌 **【排除条件】** initialization就绪卡输出后的肯定回复 → 不触发自动归档

> 📌 **数据库UUID集中管理** — 所有UUID定义见 `_shared/config.ts`（单一来源），本技能引用同一组ID

---

## 写入前 Schema 验证铁律 [CRITICAL]

每次 `notion-create-pages` / `notion-update-page` 前**必须**：
1. `notion-fetch(id=<data_source_id>)` 获取实时 schema（只拉元数据，不拉页面内容）
2. 对比要写入的 properties，**过滤掉目标库不存在的列**
3. 再执行写入

> ⚠️ `config.ts` 是缓存快照，可能与 Notion 实际 schema 不一致。**永远不要盲信缓存列名**。
> 可用 `schema_resolver.ts` 的 `validateProps(db, props)` 自动过滤无效列。

---

## 二、🅰️ ADS路径（需求文档）

### 定位

> 📌 ADS/DWS双轨需求文档维护器
>> 📌 📚学习内化类 → 默认ADS（长期看·直到学会）
>> 📌 🔧工程实践类 → 默认DWS（实施监控·断点续传）
>> 📌 焊忠说了算，Claude善意提醒但不阻拦
>> 📌 维护闪卡知识点数据（L1/L2/L3格式·供learning-engine读取出题）
>> 📌 备注字段 = 扫描时唯一可见摘要，每次状态变化必须同步更新

### 触发细分

> 🔴 **【最高优先级·立刻创建文档】** 「新需求」「有个需求」「我想要」→ 当场提取关键词，当场创建，不问不等
> 🟢 **【主动触发】** 「ADS文档」「新建ADS」「建个档」「写ADS」「写到DWS」「实施文档」
> 🟠 **【扫描触发】** 「扫描ADS」「看看看板」「列出任务」「我改了」「To-Do改了」→ Phase 0.5属性扫描
> 🟡 **【自动触发·对话中】** 💡新发现 / 新结论 / 对话>3轮有实质进展 → 追加进展+断点

### 执行流程

```typescript
// Phase 0: Schema动态检测（每次写入前必做）
import { parseSchemaFromState, getOptionNames } from "./template_builder.ts"
import { ADS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID } from "../../_shared/config.ts"
ads_db = notion_fetch(ADS_DATA_SOURCE_ID)  # ✅轻量·Schema级
ads_schema = parse_schema_from_state(ads_db["schema"])
status_options = get_option_names(ads_schema, "状态")

# Phase 0.5: 智能扫描+To-Do检测（新对话必做）
# 0.5a: ADS属性扫描（只读属性·不读内容）
in_progress = notion_search(query="进行中", data_source_url=f"collection://{ADS_DATA_SOURCE_ID}")
# 0.5b: 指挥台To-Do检测（有相关文档时）
# 0.5c: To-Do智能拆解→映射到📊进度

# Phase 0.6: 跨库查重（创建新文档前必做）
for db_id in [ADS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID]:
    results = notion_search(query=关键词, data_source_url=f"collection://{db_id}")

# Phase 1: 分类+创建/定位文档
timestamp = bash("TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M'")
view("references/ads-template.md")  # 每次新建必须读模板
classification = classify_requirement(用户消息, 上下文)
# → 告知焊忠分类结果，焊忠可指定放哪里
markdown = build_ads_document(topic=..., skeleton=True, doc_type=...)
notion_create_pages(parent={"data_source_id": target_db}, ...)

# Phase 2: 对话中持续维护
# CHECK1: 💡新发现→追加思维链+闪卡+进展
# CHECK2: 新结论→告知焊忠获同意→更新结论+行动+断点+备注
# CHECK3: 一致性同步（11条）
# CHECK4: 更新断点（含To-Do映射快照）

# Phase 3: 对齐指挥台（每次写入后必做）
# 读指挥台→To-Do diff→语义对齐11条→更新备注→追加📊进度
```

### ADS文档结构

```
# 📌 焊忠指挥台（Claude不可动·最高标准·含To-Do）
# ❓ 问题
## 结论 + 行动
# 📊 进度（时间线·To-Do映射）
# 🔍 洞察
# 💡 思维链
# 🔧 核心铁律
# 📝 对话进展记录（只追加）
# 🎴 闪卡知识点库（L1/L2/L3）
# ⏭️ 断点续传（含To-Do映射快照）
# 📄 原始内容（粘贴区）
```

### ADS路径CRITICAL规则

> ⛔ 不用replace_content覆盖（用update_content + content_updates数组追加）
> ⛔ 不动焊忠一级标题区
> ⛔ 不催焊忠做事
> ⛔ 第一轮就必须创建骨架文档（先有骨架再长肉）
> ⛔ 不硬编码数据库选项值（必须先fetch Schema）
> 🔧 结论/行动/洞察 = 更新前先告知焊忠获同意再写
> 🔧 进展/思维链/闪卡/断点/备注 = 可自动追加不用告知
> 🔧 备注格式：[当前阶段] 核心结论 | 最近进展 | 下一步
> 🔧 大更新四步同步：①📊进度标✅ ②断点追加新版本 ③备注更新 ④DB属性更新

---

## 三、🅱️ DWS路径（对话归档）

### 定位

> 📌 DWS层对话归档器：对话沉淀、知识归档、认知记录

### 触发细分

> 🟢 **【主动触发】** 「📦」「归档」「存Notion」「记录到DWS」「写入Notion」「沉淀」
> 🟡 **【自动触发】** 强肯定语气 / 对话超5轮有新认知

### 执行流程（10步·顺序不可跳过）

```python
# Step 1: 时间戳
timestamp = bash("TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M'")

# Step 2: 写前查重
notion_search(query=关键词, data_source_url="collection://{ADS_DATA_SOURCE_ID}")  # UUID见config.ts
# 有进行中任务→问用户：追加还是新建？

# Step 3: fetch STARTT模板
notion_fetch(id=STARTT_TEMPLATE_ID)  # UUID见config.ts

# Step 4: 确定写入目标（auto-filing只写DWS）
# DWS data_source_id = DWS_DATA_SOURCE_ID（见config.ts）

# Step 5: 语义去重搜索
# 标题相似度>70%且同周→追加(Step 6a)；无匹配→新建(Step 6b)

# Step 6a: 追加到已存在页面（update_content + content_updates）
# Step 6b: 新建DWS页面（STARTT完整骨架）
# 标题格式：YY-MMDD-DWS-[分类]-[主题名称]

# Step 7: ADS联动（内容有任务属性时）
# Step 8: DWS开档确认（open_archive_if_needed）
# Step 9: 完成确认（一行）
```

### DWS路径附加：实时ODS写入

```typescript
import { buildOdsRow, buildNotionProperties, buildPageBody } from "./ods_realtime_writer.ts"

# 触发：每轮有实质进展时（完成任务/解决问题/学到新知识）
# Claude语义判断是否有进展，禁止关键词匹配
row = build_ods_row(title=..., activity_type=..., friction_points=..., ...)
# → Notion写入ODS，失败降级write_to_local_buffer()
```

---

## 四、Notion操作规范

### Notion MCP 防坑指南 [CRITICAL]

> ⛔ **【大页面分页拉取】** `notion-fetch` 返回内容可能超过 token 上限（实测 54k+ 字符会被截断保存到临时文件）。大页面（ADS/DWS 长文档）必须用 `offset` + `limit` 参数分页拉取，避免一次性加载整页
> ⛔ **【串行调用关键操作】** 并行工具调用时，一个失败会导致同批次所有兄弟调用也失败（`Sibling tool call errored`）。对 Notion MCP 的关键读写操作（fetch/create/update），应串行执行而非并行
> ⛔ **【MCP Server 名称格式】** Notion MCP 的 server 参数使用冒号分隔：`plugin:Notion:notion`，不是下划线 `plugin_Notion_notion`。`readMcpResource` 等底层调用必须用冒号格式

### fetch决策流程

> 📌 每次Notion操作前过「fetch前三问」：
>> 📌 ①我需要什么信息？②search能拿到吗？③真的需要读content吗？
>> 📌 查重/扫描/统计 → 用search；断点恢复/模板/出题 → 用fetch
>> 📌 一轮对话页面级fetch不超过5次；同轮已fetch结果复用不重复
>> 📌 大页面（内容可能超 50k 字符）→ 用 offset + limit 分页拉取

### 工具调用速查

```javascript
// 读页面/DB
Notion:notion-fetch(id="UUID")

// 搜索（轻量）
Notion:notion-search(query="关键词", data_source_url="collection://UUID")

// 写DB（data_source_id传纯UUID，不带collection://前缀）
Notion:notion-create-pages(
  parent={"type":"data_source_id","data_source_id":"纯UUID"},
  pages=[{properties:{...}}]
)

// ⛔ notion-update-page 只有5个合法command，不要臆造：
// update_properties | update_content | replace_content | apply_template | update_verification

// 改属性
Notion:notion-update-page(
  command="update_properties",
  page_id="UUID",
  properties={"状态": "🟢 已完成", "备注": "xxx"}
)

// 追加内容（搜索替换式·找到锚点文本，在其后追加）
Notion:notion-update-page(
  command="update_content",
  page_id="UUID",
  content_updates=[{old_str: "锚点文本", new_str: "锚点文本\n新追加内容"}]
)
// ⛔ content_updates 必须是数组，不能传字符串
// ⛔ command 必填，不能省略
```

### 四层分工

| 层级 | 定位 | 写什么 |
|------|------|--------|
| ADS | 目标驱动知识库（用户看） | 属性+索引链接+学习/知识点 |
| DWD | 材料驱动拆解笔记 | 字幕/文章系统学习笔记 |
| DWS | 工程实践归档（Claude看） | STARTT/工程实施/进展跟踪 |
| ODS | 原始资料原样保存 | 原始字幕/文章不加工 |

> ⛔ 同一内容禁止同时写ADS正文+DWS（零重复）
> ⛔ 一文档一主题

### 父页面路由

| 目标 | parent参数 |
|------|-----------|
| DWS数据库 | data_source_id: `DWS_DATA_SOURCE_ID`（见config.ts） |
| ADS数据库 | data_source_id: `ADS_DATA_SOURCE_ID`（见config.ts） |
| 子页面 | page_id: 父页面UUID |

> ⛔ 禁止直接把新页面挂在根目录或 claudeMem 主目录下（散落=严重错误）

### 写操作授权

```
选项编号（1/2/3）→ 直接执行
模糊符号（嗯/ok）+ 实质内容 → 按实质内容执行
模糊符号 + 无内容 → 搜索最近会话 → 输出任务列表
其他重大写操作 → 需明确说「执行/开始/确认执行」
```

### 三Agent协作

| Agent | 职责 |
|-------|------|
| 🔵 Reader | 读页面/搜索/查重 |
| 🟢 Writer | 创建页面/写入内容 |
| 🟡 StateManager | 回写状态/更新备注/DWS断点 |

> 📌 复杂任务默认开启子Agent

---

## Schema 漂移协议

> 📖 详见 `_shared/schema-drift-protocol.md`

---

## 五、通用铁律（三技能共享·只写一次）

> ⛔ **【时间戳】** `TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M'` 获取UTC+8，禁止估算
> ⛔ **【写前查重】** 新建任何文档前必须先search ADS，有进行中任务必须问「追加还是新建」
> ⛔ **【Notion禁令】** 禁止web_fetch访问notion.so URL
> ⛔ **【目录写入禁令·CRITICAL】** 禁止在根目录（Notion workspace根）或 claudeMem 主目录下直接创建任何页面；所有新建内容必须写入已存在的数据库（ADS/DWS/DWD/ODS）；无对应数据库→先告知用户，等确认后才创建
> ⛔ **【持久化】** 写入/mnt/skills/user/只在当前session有效，必须present_files
> ⛔ **【无代码=未完成】** 优化/重写必须产出scripts/*.ts
> ⛔ **【输出顺序】** 正文→推荐下一步→📌目的→静默写入→✅/❌一行
> 🔧 **【原话优先】** 80%用用户原词，20%从更高视角补充
> 🔧 **【先回文字再操作Notion】** 不让焊忠等

---

## 六、写入前核查清单

```
□ 查重已执行？有进行中任务已问用户？
□ 时间戳用bash获取？
□ 模板已fetch（新建时）？
□ 所有区块有实质内容（无占位符）？
□ 每行emoji开头？
□ 备注字段已同步？
□ 状态默认🔵进行中？
□ ADS+DWS状态变更同轮原子执行？
```

---

## 七、与其他技能的关系

>> 📌 **learning-engine**：本技能提供闪卡数据（知识点+挖词依据），learning-engine读取出题
>> 📌 **notion-organizer**：跨库移动/分类整理/列同步由notion-organizer负责

---

## 八、参考资源

>> 📌 所有 UUID 定义见 `_shared/config.ts`（单一来源）
>> 📌 ADS模板：`references/ads-template.md`（创建新文档前必读）
>> 📌 STARTT模板：`templates/startt_template.md`
>> 📌 核心脚本：`scripts/template_builder.ts`（骨架生成+To-Do映射+扫描+一致性检查）
>> 📌 ODS写入：`scripts/ods_realtime_writer.ts`
>> 📌 Agent路由：`scripts/notion_agent_router.ts`
>> 📌 Schema解析：`_shared/schema_resolver.ts`
