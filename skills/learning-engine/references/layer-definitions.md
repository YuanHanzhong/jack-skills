# 三层学习定位 — 详细定义

```typescript
import { MasteryRouter, LAYER_DWD, LAYER_DWS, LAYER_ADS } from "./mastery_router.ts"
import { AutoArchiveTrigger, buildDwdAnalysisPrompt } from "./auto_archive.ts"
import { buildExamByUserIntent } from "./insight_tracker.ts"
```

## 三层定义 [CRITICAL/REQUIRED]

```
// DWD · 扫过·知道门在哪
目标：30-40%
含义：认得出、知道大概是什么、遇到问题知道来这里找
复习阈值：分数≥40% → 不再主动复习（下次不考）
实际分数仍然记录
例外：用户主动问过此点 → 自动升级为ADS级别严格考查

// DWS · 能讲出来·能复述
目标：60-65%
含义：能用自己的话讲出来，知道结构是什么
不要求随时复现

// ADS · 深入掌握·随时复现
目标：85%+
含义：深入理解，随时能复现
用户主动学/主动问的知识点 → 必须放这里
L1/L2/L3三阶全部要过
```

## 用户问过 vs 没问过 [CRITICAL/REQUIRED]

```python
// 这是考试系统最重要的区分
// 用户原话：「我没问你的问题，你考我到40分就行了」
//          「我问你的问题，这个还是要严格要求的」

IF user_asked_about_point:
    layer = ADS          // 自动升级
    exam = strict        // L1/L2/L3 + 5角度
    target = 85%
ELSE:
    layer = DWD          // 默认轻量
    exam = light         // 1-2题，认出来就行
    target = 40%         // 到40%不再主动复习

// 实现：MasteryRouter.mark_user_asked(point_id)
// 实现：build_exam_by_user_intent(title, user_asked, score)
```

## 自动建档（首次收到长文本）[CRITICAL/REQUIRED]

```python
// 触发条件：用户发送长文本（≥300字 或 ≥5行），无需任何触发词
// 时机：Claude第一轮回复+提问之后，用户回答之后 → 静默建档

trigger = AutoArchiveTrigger()

// 状态机：
// IDLE → [收到长文本] → WAITING_FOR_USER_REPLY
// WAITING → [用户回答] → 执行建档 → DONE

// 建档内容（同时建两个）：
// 1. ODS页面：原始材料原文存档
// 2. DWD页面：Claude分析材料 → 提取知识点 → 掌握度全0%（非空架子）

// [CRITICAL/FORBIDDEN]
FORBIDDEN: 建空架子DWD（必须先分析材料再填知识点）
FORBIDDEN: 等用户说「归档」才建（自动静默建）
FORBIDDEN: 打断对话流程（必须静默，最后只输出一行提醒）

// 提醒格式（回复末尾一行）：
// ✅ 已静默建档：📥 ODS [标题] + 🔬 DWD [标题]
// 或重复检测到旧记录：
// ⚠️ 找到旧记录：[标题]（[日期]，上次掌握度XX%）——直接进入学习流程
```

## 知识点层级分配原则

```
// Claude分析材料时的分配规则
默认：大部分知识点 = DWD（扫过就行）
核心概念/重点论点 = DWS（能讲出来）
极少数最关键核心 = ADS（深入掌握）

// 用户问了问题 → 涉及的知识点立刻升级为ADS
// 分配存储在 MasteryRouter，跨轮次不重置
```
