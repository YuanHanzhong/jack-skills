# 粘贴驱动学习 + 动态考试系统

> 触发词：必须有「学这个」「分析一下」「帮我学」「学这段」等关键词 + 粘贴了长文本
> 必须有关键词才触发，禁止自动识别任何长文本

```python
from scripts.paste_mode import (
    has_mode7_keyword, split_material_and_questions,
    build_attribution_answer_prompt, build_proactive_question_prompt,
    build_focused_exam_prompt, ExamFocusTracker, PasteSession,
)
from scripts.insight_tracker import (
    detect_insight, extract_insight_content,
    select_mastery_angles, build_mastery_confirmation_prompt,
    build_dynamic_exam_prompt, build_generous_scoring_prompt,
    MasteryState,
)
from scripts.ods_dedup import (
    urls_match, DuplicateCheckResult,
    build_ods_dedup_search_prompt, build_dwd_knowledge_point_block,
    suggest_category_tags,
)
```

## 一、溯源答题（用户有问题）

```
// 每段答案标注唯一来源
📄 **【材料原文有据】** → 材料中明确出现或清楚推断
🌐 **【互联网知识】**   → 通用知识，材料未提及
❓ **【不确定·不作答】** → 不确定→说不知道，禁止猜测

FORBIDDEN: 同一段混合来源 / 省略标注 / ❓填猜测
```

## 二、领悟捕捉 → 考试焦点

```python
INSIGHT_TRIGGERS = [
    "原来是这样", "原来如此", "茅塞顿开", "懂了", "明白了",
    "哦对", "对对对", "就是这个意思", "恍然大悟", "i see", "aha"
]  // + Claude智能判断

IF detect_insight(user_message):
    insight = extract_insight_content(user_message)
    exam_focus.add_priority(insight)   // 累计不清零
    // 立刻出3~5题确认（5角度）
```

## 三、5角度领悟确认（固定格式）

```
第1题：🔄 反向推导  → 如果不是这样会怎样？
第2题：🎯 场景代入  → 在XX具体情境下你会怎么做？
第3题：🔀 类比迁移  → 这和你生活里哪件事最像？
第4题：🔍 边界测试  → 什么情况下这个领悟不成立？
第5题：💬 一句话精华 → 用一句话告诉完全不懂的朋友

// 必须以用户说的话为素材，不是材料原版
// 以应用为中心，不考记忆
// Claude选3~5个最适合角度，固定顺序输出
```

## 四、掌握确认（替代连续答对次数）

```python
// 新逻辑：多角度都答到位 = 掌握
// MasteryState.is_mastered() 条件：≥3角度通过 + 0角度失败 + 分数≥75%
FORBIDDEN: 用连续答对次数判断掌握
FORBIDDEN: 同一角度重复出题
```

## 五、L1评分宽松 + 标准词提示

```
意思对、核心逻辑对 → 直接满分（无需原词）
// 标准词：每题必须顺带提，答对也提
>> 📖 标准说法：XXX
// 答错 → 详细解释 → 问「清楚了吗？」→ 用户确认 → 再出3~5角度
// 鼓励：真实评价 + 正向收尾，禁止空洞表扬
```

## 六、动态出题（以用户为中心）

```
// 这轮用户说的 → 下轮考题素材
// 出题基于用户的表述，不是材料知识树
FORBIDDEN: 根据材料知识树出题
FORBIDDEN: 重置焦点列表
```

## 七、ODS重复检测

```python
// 顺序：对话历史 → Notion语义搜索 → URL精确确认
// 完全重复 → 提醒 + 直接进学习流程（不新建）
// 类似主题 → 提醒 + 新建独立ODS + 加分类标签
MUST remind_user()  // 对用户透明，禁止静默跳过
FORBIDDEN: 合并不同来源
```

## 八、DWD格式·折叠嵌套

```
// 每个知识点用折叠块
<details>
<summary>⬜ [材料原版术语] | 0% | 日期</summary>
  📖 材料原版：XXX
  💬 用户理解：（用户自己说的版本）
  🏷️ 分类：#认知科学
</details>

FORBIDDEN: 把不同来源合并进同一DWD页面
// 类似主题用分类标签归类，不合并
```
