# 模式6：有材料模式（系统式学习）

> 触发词：「学这个」「帮我学」「分析这段」「学习这个」「学这段」「帮我分析」「学一下」「学习这段」
> 必须有关键词才触发，禁止自动识别长文本

```python
from scripts.config import ODS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, ADS_DATA_SOURCE_ID  # [FIX-UUID]
from scripts.ods_learning import (
    is_material_mode_trigger,
    build_ods_content, write_next_ods_chunk,
    build_probe_questions, mark_probe_results,
    build_compact_overview, parse_branch_selection,
    get_pending_branches, calculate_new_score,
    score_to_status, build_score_feedback,
    MaterialSession, make_material_id,
)
from scripts.dwd_builder import build_dwd_content, build_dwd_properties, update_dwd_after_test
```

## 完整6步流程

```
Step 1 — ODS存档（后台静默，增量写）
  ↓ 优先回答用户 → 空闲时写一段 → 中断就停 → 下次从cursor续写
  # [FIX-G] 不再需要传入 chunks，自动从 session.raw_text 切块
  result = write_next_ods_chunk(session)  # chunks 参数已可选，默认自动生成
  # [CRITICAL/REQUIRED] 调用方必须把 result["chunk"] 写入 Notion：
  # if result["status"] == "in_progress":
  #     notion_append_block(session.ods_page_id, result["chunk"])

Step 2 — 摸底测试（轻量，不计时）
  questions = build_probe_questions(knowledge_tree, count=4)
  # 直接出题，用户随意回答，AI判断 known/partial/blank
  # 用户不想学 → 以用户为准，不强制，不自动修改掌握度

Step 3 — 概览图输出（对话精简版）
  overview = build_compact_overview(title, chapters, probe_results, user_context)
  # ❓ 你对哪个部分最好奇？放最上边
  # 树状缩进，status标注，个性化悬念问题

Step 4 — DWD建档（详细版，Notion写入）
  content = build_dwd_content(title, chapters, source_url, summary)
  props = build_dwd_properties(title)
  # DWD data_source_id: 78cb3687-2ebf-47f3-8e66-76f1a07f1da0
  # 结构：[顶]汇总表 → [中]1-5层知识树(标题+缩进) → [中下]SQ3R学习Checklist → [底]来源信息

  # [NEW] SQ3R Checklist 自动附加到 DWD 文档底部（每次建档都带）
  sqr3_checklist = build_sqr3_checklist(title)
  # 格式见 DWD文档结构·Checklist区

Step 5 — 用户选路
  selected = parse_branch_selection(user_message, chapters)
  pending = get_pending_branches(chapters)
  # 未选分支保留清单，下次自动推荐，用户说「学」也触发

Step 6 — 费曼教练循环（每知识点）
  new_score, new_cons = calculate_new_score(cur_score, consecutive, result)
  # result: "correct"|"partial"|"wrong"|"hinted"
  # 评分标准：闪卡评分（NOT费曼评分）
  feedback = build_score_feedback(kp_title, old, new, result, new_cons)
  # 测完静默更新DWD（不写ADS）
  updated_content = update_dwd_after_test(dwd_content, kp_title, new_score, emoji, date)

Step 7 — 学习完成后·反向提示（可选）
  # 每次 Mode 6 完成一个知识点后，在推荐下一步中加入：
  # 「🔄 倒推模板：把刚才学的内容倒推成可复用的 Prompt 模板」
  # 不强制，只作为推荐选项出现一次
  reverse_prompt_option = "🔄 倒推模板：把这份材料的学习结构倒推成 Prompt 模板，反哺以后的学习"
```

## DWD文档结构

```
【顶部】掌握度汇总表
| 状态 | 知识点 | 分数% | 上次测试 |

【中部】知识树（标题层级 + 缩进 bullet，1-5层，Notion原生）
# 第一章
## 小节A
### 子节a
  - ⬜ 知识点1 | 0% | —
  - 🟢 知识点2 | 85% | 03-04

【中下部】SQ3R 学习 Checklist（每次建档自动附加）
## 📋 SQ3R 学习 Checklist
- [ ] S — Survey 全局预览：扫完目录+摸底测试，知道全貌
- [ ] Q — Question 问题生成：对每个分支提出「我想搞懂什么？」
- [ ] R1 — Read 深入阅读：选一个分支，费曼循环学透
- [ ] R2 — Recite 主动复述：不看材料，用自己的话把这个分支讲出来
- [ ] R3 — Review 系统回顾：全部分支完成后，做一次 L2/L3 综合测试
📌 进度：已完成 N/5 步 | 上次更新：YYYY-MM-DD

【底部】来源信息
🔗 来源 / 📝摘要 / 📊总N点/已学/未学
```

## 知识点5态

```
⬜ 未接触 → 🔵 了解中 → 🟡 测试过 → 🟢 已掌握 → 🔴 需复习
```

## 与无材料模式的分工

```
无材料模式（探索式）: 知识点来自对话 → 掌握度写 ADS
有材料模式（系统式）: 字幕/文章粘贴  → 掌握度写 DWD
评分体系/艾宾浩斯/L1L2L3: 两种模式完全共用
```

## 铁律

- 必须有触发词才进入模式6，禁止自动识别长文本
- 摸底后用户不想学 → 以用户为准，不强制修改掌握度
- **[CRITICAL/REQUIRED]** ODS必须存原始全文（材料全文逐字存档）；摘要只能作为补充附加在原文之后，不得替代原文
- **[CRITICAL/FORBIDDEN]** ODS丢弃原文只存摘要 = 严重错误（丢失溯源能力）
- 掌握度写DWD，不写ADS（有材料模式专属）
- 知识点每行一句话，不超过一行，emoji开头
- Notion写入用标题层级+缩进bullet，不是引用块
- 层级支持1-5层，视材料复杂度决定
