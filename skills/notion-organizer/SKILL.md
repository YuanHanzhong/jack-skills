---
name: notion-organizer
description: >-
  Notion目录整理管家：安全跨库移动、分类整理、列变更审批、字段同步、Schema健康检查。
  触发词：「整理」「归类」「清理一下」「看看哪些该移走了」「字段改了」「Schema检查」。
  新对话自动扫描ADS汇报可整理条目，说「整理」才真正执行移动。
  不触发：新需求/创建文档→notion-writer；闪卡/测试→learning-engine。
allowed-tools: Read, Glob, Grep
---

# notion-organizer（Notion目录整理管家）

扫描四个数据库 → 安全跨库移动 → 分类整理 → 列变更授权审批 → 字段同步 → 每次整理自动建DWS工程文档记录过程。

---

## 一、核心定位

> 📌 **【做什么】**
>> 📌 安全跨库移动：收集属性→move→回写属性（不读页面内容·省token）
>> 📌 分类整理：ADS中已完成/已放弃的按分类规则移到DWS/DWD
>> 📌 列变更申请：发现某库缺列→汇报给焊忠→等待明确授权→才执行（默认禁止擅自增删改列）
>> 📌 字段值同步：焊忠改了某库选项值→同步到所有库
>> 📌 Schema健康检查：四库列是否对齐
>> 📌 每次整理自动创建DWS工程文档记录全过程

> 📌 **【不做什么】**
>> 📌 不创建新文档（requirement-tracker负责）
>> 📌 不校验API格式（notion-ops负责）
>> 📌 不改ADS页面的状态字段（只有焊忠改）

> 📌 **【动态Schema设计】**
>> 📌 数据库ID可硬编码（很少变），列名和选项值动态fetch
>> 📌 每次执行时fetch数据库Schema获取最新列定义
>> 📌 你随便改列名/选项值，下次fetch就自动用新值

---

## 二、触发条件

> 🟠 **【手动触发·执行整理·CRITICAL】**
>> 📌 「整理Notion目录」「整理分类」「整理一下」「归类一下」「清理一下」
>> 📌 「看看哪些该移走了」「Notion整理」「目录整理」

> 🟢 **【自动触发·轻量扫描·只汇报不移动】**
>> 📌 每次新对话初始化时，扫描ADS属性（只读标题/状态/分类）
>> 📌 发现有已完成/已放弃的→汇报「发现N条可整理」
>> 📌 不自动移动，等焊忠说「整理」才真正执行

> 🟡 **【字段同步触发】**
>> 📌 「字段改了」「我改了选项」「列名改了」「改了字段值」

> 🔵 **【健康检查触发】**
>> 📌 「Schema检查」「数据库健康检查」「列对齐吗」「检查一下数据库」

---

## 三、执行流程

### 执行流程概要

```
Phase -1: 插件更新（bash _shared/update_plugins.sh·拉取最新marketplace）
Phase 0: 动态Schema获取（每次必做·fetch四库最新列定义）
Phase 1: 整理扫描（只读属性·不读内容·search ADS）
Phase 2: 安全移动（收集属性→move→回写属性·原子操作）
Phase 3: 整理汇报 + 创建DWS工程文档
Phase 4: 字段同步（触发词「字段改了」）
```

> 详细流程见 `references/organizer-phases.md`

---

## Notion MCP 防坑指南 [CRITICAL]

> ⛔ **【大页面分页拉取】** `notion-fetch` 返回内容可能超 token 上限（54k+ 字符）。大页面必须用 `offset` + `limit` 分页拉取
> ⛔ **【串行调用】** 并行 Notion MCP 调用时一个失败会导致同批次全部失败（`Sibling tool call errored`）。关键操作（fetch/move/update）串行执行
> ⛔ **【MCP Server 名称】** server 参数用冒号：`plugin:Notion:notion`，不是下划线

---

## 四、CRITICAL规则

> ⛔ **【绝不能犯】**
>> 📌 ⛔ ADS页面状态只有焊忠改·Claude在任何情况下都不改ADS状态字段
>> 📌 ⛔ 扫描时不读页面内容，只读属性字段（标题/状态/分类/备注）
>> 📌 ⛔ 进行中/收集中的页面绝不移动（焊忠对未完成的事要心里有数）
>> 📌 ⛔ 不硬编码任何常量——列名/选项值/DB ID全部动态fetch
>> 📌 ⛔ **【目录写入禁令·CRITICAL】** 禁止在根目录或 claudeMem 主目录下直接创建任何页面；整理工程文档只能写入已存在的 DWS 数据库（`DWS_DATA_SOURCE_ID` from _shared/config.ts）

> 🔧 **【安全移动铁律·CRITICAL】**
>> 📌 移动前必须收集源页面所有属性值
>> 📌 移动用 `notion_move_pages` 一步完成，不读内容
>> 📌 移动后立即用 `notion_update_page(update_properties)` 回写属性
>> 📌 列名映射靠Claude语义判断（类型+选项值相似度），不靠硬编码
>> 📌 入乡随俗：属性名用目标库的列名
>> 📌 回写失败→重试一次→仍失败→告警不丢页面

> 🔧 **【分类规则·CRITICAL】**
>> 📌 手册/参考文档类 → DWD
>> 📌 优化工具/专业技术/工程类 → DWS
>> 📌 个人成长/知识学习 → 保留ADS
>> 📌 以上是默认规则，Claude根据实际分类字段语义判断，不硬编码
>> 📌 只移动已完成/已放弃的，进行中必须留ADS

> 🔧 **【列变更铁律·CRITICAL】**
>> 📌 ⛔ **默认禁止一切列变更**（新增列/删除列/改列名/改选项值）
>> 📌 发现缺列/Schema不一致 → 只汇报，不自动执行
>> 📌 必须等焊忠明确说「可以加」「授权补列」「同意改」才执行
>> 📌 每次列变更操作前复述变更内容 → 焊忠二次确认 → 才执行
>> 📌 Schema健康检查只输出报告，不自动修复任何不一致

> 🔧 **【工程文档铁律·CRITICAL】**
>> 📌 每次整理自动创建DWS工程文档：🧹 Notion整理·YYYY-MM-DD
>> 📌 逐条记录：移了什么、从哪到哪、URL、时间戳
>> 📌 整理完自动标状态"🟢 已完成"（DWS的状态Claude可以改，ADS的不行）

> 🔧 **【汇报铁律·CRITICAL】**
>> 📌 每条移动都要逐条汇报，不能只汇总
>> 📌 每条必须有：文档名+方向（ADS→DWS）+URL+时间戳
>> 📌 跳过的也要列出（标明原因：进行中）

> 🔧 **【数据库模式铁律·CRITICAL】**
>> 📌 新建数据库一律用inline视图模式
>> 📌 给焊忠的用URL链接，不用data_source_id

---

## Schema 漂移协议

> 📖 详见 `_shared/schema-drift-protocol.md`

---

## 五、与其他技能的关系

>> 📌 **notion-writer**：notion-writer创建文档，本技能整理移动文档。不冲突。
>> 📌 **notion-writer**：notion-writer校验API格式（高频守卫），本技能执行运维操作（低频管家）。不合并。
>> 📌 **notion-writer**：notion-writer写DWS归档，本技能移动文档位置。不冲突。

---

## 六、参考资源

>> 📌 脚本：`scripts/organizer.ts`（流程描述+格式化函数）
>> 📌 claudeMem根目录：315bad10f05a80928d51e21275eb4b84
