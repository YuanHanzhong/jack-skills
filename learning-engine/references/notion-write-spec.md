# 文字材料写层规范（ODS/DWD/ADS 三层写入）

> 触发条件：收到一段文字（非YouTube URL），且进入 Mode 6 / Mode 7 有材料模式后，必须按此规范写入三层
>
> 任何文字材料写入Notion，必须通过 `text_to_notion_writer.py` 规范，禁止自行拼凑格式

## Notion data_source_id 速查

```python
from scripts.text_to_notion_writer import (
    ODS_DATA_SOURCE_ID,   # "9634cf6c-8c6b-4c19-978a-71c4f33d3294"
    DWD_DATA_SOURCE_ID,   # "78cb3687-2ebf-47f3-8e66-76f1a07f1da0"
    ADS_DATA_SOURCE_ID,   # "1dbff6c4-966e-4184-80b4-9deaf2ea49ff"
)
```

## ODS层写入规范

```python
from scripts.text_to_notion_writer import OdsWriter

# 标题格式
# 文章   → "📄 {标题}｜文章原文"
# 字幕   → "📺 {标题}｜YouTube字幕"
# 录音   → "🎙️ {标题}｜文字转写"
# 其他   → "📝 {标题}｜文字材料"
title = OdsWriter.build_title(material_title, source_hint)

# 内容结构（铁律：全文必须完整存档）
content = OdsWriter.build_content(
    raw_text=full_text,      # [IRON RULE] 必须完整，禁止截断
    title=material_title,
    source_url=url,          # 可选
    timestamp=timestamp,
    summary=summary,         # [IRON RULE] 只能附加在全文之后，禁止替代全文
)

// ODS铁律
FORBIDDEN: 只存摘要/链接，丢弃全文
FORBIDDEN: 用摘要替代全文
FORBIDDEN: 对原文做任何增删改
```

## DWD层写入规范

```python
from scripts.text_to_notion_writer import DwdWriter

# 标题格式
# 视频   → "🔬 {标题}｜视频拆解"
# 录音   → "🔬 {标题}｜录音拆解"
# 文章   → "🔬 {标题}｜拆解笔记"
title = DwdWriter.build_title(material_title, source_hint)

# 知识点折叠块（每个知识点一个）
block = DwdWriter.build_knowledge_point_block(
    point_title="知识点名称",
    original_term="材料原版术语",
    user_understanding="用户自己的理解",
    category_tags=["认知科学"],
    score=0,         # 初始0%，测试后更新
    date="—",
)

# 状态emoji对照
# ⬜ 0%       未接触
# 🔵 1-29%   了解中
# 🟡 30-64%  测试过
# 🟢 65-94%  已掌握
# 🟣 95%+    已内化

// DWD铁律
FORBIDDEN: 把原文段落复制进DWD
FORBIDDEN: DWD存原文（只存分析结果）
```

## ADS层写入规范

```python
from scripts.text_to_notion_writer import AdsWriter

# ADS只写属性+DWD链接，禁止写正文内容
props = AdsWriter.build_properties(
    title=material_title,
    dwd_url=dwd_page_url,
    ods_url=ods_page_url,
    status="🔵 进行中",
    material_type="文字材料",
)

// ADS铁律
FORBIDDEN: 在ADS写任何正文内容
REQUIRED: 只写属性 + DWD链接 + ODS链接
```

## 完整Pipeline调用（推荐）

```python
from scripts.text_to_notion_writer import TextMaterialPipeline

pipeline = TextMaterialPipeline(
    raw_text=full_text,
    material_title="材料标题",
    source_hint="文章",          # 影响标题格式和emoji
    source_url="https://...",
    knowledge_points=[           # Claude分析后生成
        {"title": "知识点A", "original_term": "Point A", "score": 0, "date": "—"},
    ],
    takeaways=["可直接行动的方法1", "方法2"],
    summary="3-5句话概述",
    timestamp=timestamp,         # 用bash获取真实时间
)
plan = pipeline.build_write_plan()
# plan.ods / plan.dwd / plan.ads 包含所有写入所需内容
# 按顺序写入：先ODS → 再DWD → 最后ADS（索引）
```

## 写入顺序

```
Step 1: 验证 OdsWriter.validate(raw_text)
Step 2: 写入 ODS（全文存档）→ 拿到 ods_page_url
Step 3: Claude分析材料 → 生成 knowledge_points + takeaways
Step 4: 验证 DwdWriter.validate(knowledge_points, raw_text_included=False)
Step 5: 写入 DWD（分析结果）→ 拿到 dwd_page_url
Step 6: 写入 ADS（属性+链接索引）
Step 7: 汇报 ✅ ODS存档：[标题](url) | N字 / ✅ DWD建档：[标题](url) | N个知识点
```
