# notion-organizer 执行流程详细伪代码

## Phase 0：动态Schema获取（每次执行必做·CRITICAL）

```python
# ⛔ 铁律：不硬编码列名/选项值，但可以硬编码容器页面URL（很少变）
# [FIX 2026-03-08] 容器页面URL硬编码避免每次fetch根目录
# ✅ 轻量操作·Schema级fetch只返回列定义·几百字

# Step 0.1: 直接用硬编码的容器页面/数据库ID（避免每次fetch根目录）
# ADS: 1dbff6c4-966e-4184-80b4-9deaf2ea49ff
# DWS: 0fdba26c-ff3b-45e5-8658-89316783bff2
# DWD: （从根目录获取一次后可缓存）
# ODS: （从根目录获取一次后可缓存）

# Step 0.2: fetch每个数据库的Schema  ✅轻量·Schema级
# Step 0.3: 同一轮整理中Schema只fetch一次，后续移动复用（缓存）
# 结果：四个库的完整Schema，全部是最新的
```

## Phase 1：整理扫描（只读属性·不读内容·CRITICAL）

```python
# ⛔ 扫描时只读属性字段，不读页面内容
# [FIX 2026-03-08] 改用notion-search替代fetch ADS · ✅轻量
# Step 1.1: search ADS中已完成/已放弃的页面
#   notion-search(query="已完成", data_source_url="collection://1dbff6c4...")
#   notion-search(query="已放弃", data_source_url="collection://1dbff6c4...")
# Step 1.2: 找出状态为「已完成」或「已放弃」的页面
# Step 1.3: 按分类判断该移到哪个库：
#   Claude语义判断分类字段 → 对应目标库
#   手册类/参考文档 → DWD
#   优化工具/专业技术/工程类 → DWS
#   个人成长/知识学习/学习类 → 保留ADS（已完成的学习文档留ADS方便复习）
# Step 1.4: 进行中/收集中 → 跳过不动（焊忠对未完成的事要心里有数）
# Step 1.5: 输出列表给焊忠确认
```

## Phase 2：安全移动（核心原子操作·CRITICAL）

```python
# 对每个要移动的页面执行 safe_move_page：

# Step 2.1: fetch源页面所有属性（只读属性，不读内容）⚠️ 中量·API限制返回全页
source_properties = notion_fetch(page_id)["properties"]  # ⚠️ 只读properties·忽略content

# Step 2.2: 复用Phase 0已fetch的Schema，不重复fetch  ✅ 缓存复用
source_schema = cached_schemas[source_db_id]  # 从Phase 0缓存中取
target_schema = cached_schemas[target_db_id]  # 从Phase 0缓存中取

# Step 2.3: Claude语义匹配列名
# 规则：相同类型(select/text/number...) + 选项值相似度高 → 同一字段
# 例如：源库"分类"(select: 个人成长/知识学习) ↔ 目标库"类别"(select: 个人成长/知识学习)
# 入乡随俗：用目标库的列名写入

# Step 2.4: 列变更检查（⛔ 默认禁止）
# 发现目标库缺列 → 立即停止 → 告知焊忠「目标库缺少列：XXX，是否授权补列？」
# 只有焊忠明确说「可以加」「授权」「补列」才执行 DDL
# 焊忠没有明确授权 → 跳过属性回写（保留内容，属性空白告警）

# Step 2.5: notion_move_pages(page_id, new_parent=target_data_source_id)
# ⛔ 不读内容，内容自动跟着走

# Step 2.6: notion_update_page(update_properties)
# 用目标库的列名写回所有属性值
# 状态映射：ADS「📦 归档」→ 其他库用对应的归档状态

# Step 2.7: 失败处理
# 回写失败 → 重试一次 → 仍失败 → 告警（页面在目标库，内容没丢，只是属性空）
```

## Phase 3：整理汇报 + 创建工程文档

```python
timestamp = bash("TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M'")

# Step 3.1: 在DWS创建整理工程文档
# 标题：🧹 Notion整理·YYYY-MM-DD
# 内容：逐条记录
# 状态：自动标"🟢 已完成"

# Step 3.2: 逐条汇报（每条必须有URL+时间）
# 格式：
# ✅ 已移动 N 条：
# 1. 📖 [文档名] ADS → DWD [URL] [时间]
# 2. 🔧 [文档名] ADS → DWS [URL] [时间]
# ⏭️ 跳过（进行中）N 条：
# 1. [文档名] — 状态：🔵 进行中

# Step 3.3: Schema健康检查
# 对比四库Schema，发现不一致→只汇报，不自动补列/修复（须焊忠授权才动列）
```

## Phase 4：字段同步（触发词「字段改了」）

```python
# Step 4.1: 焊忠说「我改了XXX库的YYY字段」
# Step 4.2: Claude fetch该库确认变更
# Step 4.3: 生成其他库需要同步的DDL（ALTER COLUMN SET）
# Step 4.4: 执行同步
# Step 4.5: 汇报结果
```
