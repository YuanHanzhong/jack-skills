---
name: notion-writer
description: >-
  Notion统一写入路由器，按用户意图自动分流到ADS或DWS。必须触发场景：①用户消息含notion.so URL（任何形式）②用户说"Notion"+"看/读/查/打开/这个页面"等查看意图③用户说"Notion"+"写/存/记/归档/建"等写入意图。
  ADS路径触发词：「新需求」「有个需求」「提需求」「建个档」「维护文档」「扫描ADS」。
  DWS路径触发词：「归档」「沉淀」「📦」「存入Notion」「记录到DWS」。
  URL路径：消息含notion.so链接→自动提取UUID→判断读/写意图→路由执行。
  候选触发：强肯定语气或对话超5轮有新认知→只提示可沉淀或等待明确保存指令，不静默归档。
  不触发：闪卡/测试→learning-engine；目录整理→notion-organizer。
---

# notion-writer（Notion统一写入路由器）

合并 auto-filing + requirement-tracker + notion-ops，一个入口，按意图自动分流。

---

## 一、路由决策树

```
用户消息
  ↓
含 notion.so URL？ ──→ 🅄 URL路径（自动提取UUID→判断意图→读/写路由）
  ↓ 否
含「Notion」+查看意图（看/读/查/打开/这个页面/帮我看）？ ──→ 🅄 URL路径·fetch模式
  ↓ 否
含「需求」「ADS」「建档」「维护文档」？ ──→ 🅰️ ADS路径（需求文档）
  ↓ 否
含「归档」「沉淀」「📦」「存Notion」「DWS」？ ──→ 🅱️ DWS路径（对话归档）
  ↓ 否
含「扫描ADS」「看看看板」「查一下ADS」「To-Do改了」？ ──→ 🅰️ ADS路径·Phase 0.5扫描
  ↓ 否
自动触发（强肯定/超5轮有新认知）？ ──→ 候选沉淀（先最小回复；不自动查重/写入）
  ↓ 否
新对话+用户有具体需求/想法 ──→ 先对话澄清；只有明确建档/ADS/维护文档才创建骨架
```

> 📌 **【URL路径·CRITICAL】** notion.so URL → 立即提取UUID，**禁止web_fetch** → 必须用 `Notion:notion-fetch(id="UUID")`

> 📌 **【冲突解决·CRITICAL】** 消息同时含「ADS」+任何Notion写入词 → 100%走🅰️ADS路径

> 📌 **【排除条件】** initialization就绪卡输出后的肯定回复 → 不触发自动归档

> 📌 **数据库UUID集中管理** — 所有UUID定义见 `_shared/config.ts`（单一来源），本技能引用同一组ID

---

## 一点五、🅄 URL路径（Notion链接自动处理）

### UUID提取规则

```python
# notion.so URL格式变体：
# https://www.notion.so/PageTitle-{32位hex}
# https://www.notion.so/{32位hex}
# https://www.notion.so/{标准UUID带横杠}

import re
def extract_uuid(url: str) -> str:
    m = re.search(r'([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})', url, re.I)
    if m:
        raw = m.group(1).replace('-', '')
        return f"{raw[0:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
    return None
```

### 意图→操作路由

```
URL + 写/存/归档/记录意图 ──→ 写入该页面（update-page）
URL + 读/看/查/打开意图   ──→ fetch → 输出摘要
URL + 无明确意图          ──→ fetch → 识别类型 → 告知内容+询问下一步
URL + 新建子页意图        ──→ create-pages(parent=page_id)
```

### 执行步骤

```python
# 1: 提取UUID
uuid = extract_uuid(url)

# 2: fetch页面
page = Notion:notion-fetch(id=uuid)

# 3: 判断类型
# collection → 数据库，可写新记录 / 搜索
# page       → 普通页面，可读取 / 追加

# 4: 按意图执行
# 读  → 输出标题/状态/核心内容摘要
# 写  → 路由到ADS/DWS逻辑
# 无  → 摘要 + 询问「读 / 追加 / 归档？」
```

> ⛔ **【URL禁令·CRITICAL】** 禁止对 notion.so URL 使用 web_fetch → 100%报 PERMISSIONS_ERROR
> 🔧 UUID提取失败 → 告知用户URL格式异常，请粘贴完整链接

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

> 🔴 **【明确建档·立刻创建文档】** 「新需求」「有个需求」「建个档」「写ADS」→ 当场提取关键词并创建；普通「我想要」先澄清，不自动建档
> 🟢 **【主动触发】** 「ADS文档」「新建ADS」「建个档」「写ADS」「写到DWS」「实施文档」
> 🟠 **【扫描触发】** 「扫描ADS」「看看看板」「列出任务」「我改了」「To-Do改了」→ Phase 0.5属性扫描
> 🟡 **【候选触发·对话中】** 💡新发现 / 新结论 / 对话>3轮有实质进展 → 先判断是否需要落盘；未形成阶段结论或恢复点时，只继续最小回复

### 执行流程

```typescript
// Phase 0: Schema动态检测（每次写入前必做）
import { parseSchemaFromState, getOptionNames } from "./template_builder.ts"
import { ADS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID } from "../../_shared/config.ts"
ads_db = notion_fetch(ADS_DATA_SOURCE_ID)  # ✅轻量·Schema级
ads_schema = parse_schema_from_state(ads_db["schema"])
status_options = get_option_names(ads_schema, "状态")

# Phase 0.5: 智能扫描+To-Do检测（进入ADS写入路径时执行）
# 0.5a: ADS属性扫描（只读属性·不读内容）
in_progress = notion_search(query="进行中", data_source_url=f"collection://{ADS_DATA_SOURCE_ID}")
# 0.5b: 指挥台To-Do检测（有相关文档时）
# 0.5c: To-Do智能拆解→映射到📊进度

# Phase 0.6: 跨库查重（创建新文档前必做）
for db_id in [ADS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID]:
    results = notion_search(query=关键词, data_source_url=f"collection://{db_id}")

# Phase 1: 分类+创建/定位文档（仅当用户明确建档/写入/维护，或已经形成必须保存的阶段结论）
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

> ⛔ 不用replace_content覆盖（只用insert_content_after追加）
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
> 🟡 **【候选触发】** 强肯定语气 / 对话超5轮有新认知：只提示可沉淀或等待用户明确要求，不静默跑查重、时间戳和写入

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

# Step 6a: 追加到已存在页面（insert_content_after）
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

### fetch决策流程

> 📌 每次Notion操作前过「fetch前三问」：
>> 📌 ①我需要什么信息？②search能拿到吗？③真的需要读content吗？
>> 📌 查重/扫描/统计 → 用search；断点恢复/模板/出题 → 用fetch
>> 📌 一轮对话页面级fetch不超过5次；同轮已fetch结果复用不重复

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

// 更新页面
Notion:notion-update-page(command="insert_content_after", page_id="UUID", ...)
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

> ⛔ **【时间戳】** 只有即将真实写入时才调用 `TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M'` 获取UTC+8，禁止为普通回复取时间
> ⛔ **【写前查重】** 新建任何文档前必须先search ADS；但未进入写入流程时不要为了聊天续轮而查重
> ⛔ **【Notion禁令】** 禁止web_fetch访问notion.so URL
> ⛔ **【目录写入禁令·CRITICAL】** 禁止在根目录（Notion workspace根）或 claudeMem 主目录下直接创建任何页面；所有新建内容必须写入已存在的数据库（ADS/DWS/DWD/ODS）；无对应数据库→先告知用户，等确认后才创建
> ⛔ **【持久化】** 写入/mnt/skills/user/只在当前session有效，必须present_files
> ⛔ **【无代码=未完成】** 优化/重写必须产出scripts/*.ts
> ⛔ **【输出顺序】** 写入任务才使用：正文→推荐下一步→📌目的→静默写入→✅/❌一行；普通聊天不套此格式
> 🔧 **【原话优先】** 80%用用户原词，20%从更高视角补充
> 🔧 **【先回文字再操作Notion】** 不让焊忠等；若没有必要写入，就只回文字

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
