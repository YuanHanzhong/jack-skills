/**
 * ods_dedup.ts — ODS/DWD Duplicate Detection & Smart Routing
 * Version: 2026-03-04-1049
 *
 * Handles:
 *   1. Multi-layer duplicate detection (conversation history -> Notion semantic -> URL exact)
 *   2. User-transparent reminder when duplicate found
 *   3. Similar-topic tagging in DWD (no merging, just classification)
 *   4. DWD format: collapsible blocks (material title -> expand -> user understanding)
 */

import {
  ODS_DATA_SOURCE_ID,
  DWD_DATA_SOURCE_ID,
  ADS_DATA_SOURCE_ID,
} from "../../_shared/config.ts";

// ── URL normalization ───────────────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  let u = url.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/^www\./, "");
  u = u.replace(/\/$/, "");
  // Remove common tracking params
  u = u.replace(/\?utm_[^&]*(&|$)/, "");
  u = u.replace(/[?&](ref|source|via)=[^&]*/g, "");
  return u;
}

export function urlsMatch(url1: string, url2: string): boolean {
  return normalizeUrl(url1) === normalizeUrl(url2);
}

// ── Duplicate detection result ──────────────────────────────────────────────

export interface DuplicateCheckResult {
  isExactDuplicate: boolean;
  isSimilarTopic: boolean;
  existingPageTitle: string;
  existingPageId: string;
  existingDate: string;
  existingMastery: string;
  sourceLayer: string; // "conversation" | "ODS" | "DWD" | "ADS" | "DWS"
  suggestedAction: string; // "continue_old" | "new_with_tag" | "new"
}

export function createDuplicateCheckResult(
  overrides: Partial<DuplicateCheckResult> = {},
): DuplicateCheckResult {
  return {
    isExactDuplicate: false,
    isSimilarTopic: false,
    existingPageTitle: "",
    existingPageId: "",
    existingDate: "",
    existingMastery: "",
    sourceLayer: "",
    suggestedAction: "",
    ...overrides,
  };
}

export function buildDuplicateReminder(
  result: DuplicateCheckResult,
): string {
  if (result.isExactDuplicate) {
    return (
      `⚠️ 找到旧记录：**【${result.existingPageTitle}】** ` +
      `（${result.existingDate}，上次掌握度 ${result.existingMastery}）` +
      `——直接进入学习流程，从上次中断处继续。`
    );
  } else if (result.isSimilarTopic) {
    return (
      `💡 发现相似主题：**【${result.existingPageTitle}】** ` +
      `（${result.existingDate}，${result.sourceLayer}）` +
      `——本次作为独立记录，已标记同类标签，两者自然归类在一起。`
    );
  }
  return "";
}

export function shouldCreateNew(result: DuplicateCheckResult): boolean {
  return !result.isExactDuplicate;
}

// ── Detection flow (prompt builders for Notion search) ──────────────────────

export function buildOdsDedupSearchPrompt(
  materialTitle: string,
  sourceUrl: string,
): string {
  return `
执行ODS重复检测，顺序如下：

Step 1 — 对话历史检查
  在当前对话中搜索是否出现过相同或类似主题。

Step 2 — Notion语义搜索
  用主题关键词搜索以下数据库：
  - ODS原始资料（data_source_id: ${ODS_DATA_SOURCE_ID}）
  - DWD拆解笔记（data_source_id: ${DWD_DATA_SOURCE_ID}）
  - ADS任务看板（data_source_id: ${ADS_DATA_SOURCE_ID}）
  关键词：「${materialTitle}」

Step 3 — URL精确确认
  如果Step 2找到候选，检查来源URL是否与「${sourceUrl}」匹配。
  使用normalize后的URL对比（去掉https://www.，去掉trailing /，忽略UTM参数）。

判断结果：
  - URL完全匹配 → is_exact_duplicate=True → 不新建ODS，直接进入学习流程，提醒用户
  - 主题相似但URL不同 → is_similar_topic=True → 新建ODS，加分类标签，提醒用户
  - 全无匹配 → 正常新建ODS流程

提醒格式（必须对用户透明）：
  完全重复：「⚠️ 找到旧记录：[标题]（[日期]，上次掌握度XX%）——直接进入学习流程。」
  类似主题：「💡 发现相似主题：[标题]（[日期]）——本次独立记录，已标记同类标签。」
`;
}

// ── DWD format: collapsible user-understanding blocks ───────────────────────

export function buildDwdKnowledgePointBlock(
  materialTerm: string,
  materialDescription: string,
  userUnderstanding: string | null = null,
  score = 0.0,
  lastTested = "—",
  statusEmoji = "⬜",
  categoryTags: string[] | null = null,
): string {
  const tagsStr = (categoryTags ?? []).map((t) => `#${t}`).join(" · ");
  const tagsLine = tagsStr ? `\n  🏷️ 分类：${tagsStr}` : "";

  const userBlock = userUnderstanding
    ? `\n  💬 **用户理解**：${userUnderstanding}`
    : "\n  💬 **用户理解**：（待记录）";

  return `<details>
<summary>${statusEmoji} **${materialTerm}** | ${score.toFixed(0)}% | ${lastTested}</summary>

  📖 **材料原版**：${materialDescription}${userBlock}${tagsLine}

</details>`;
}

export function buildDwdSection(
  chapterTitle: string,
  knowledgePoints: Array<Record<string, any>>,
): string {
  const lines: string[] = [`## ${chapterTitle}\n`];
  for (const kp of knowledgePoints) {
    const block = buildDwdKnowledgePointBlock(
      kp.term ?? "",
      kp.description ?? "",
      kp.user_understanding ?? null,
      kp.score ?? 0.0,
      kp.last_tested ?? "—",
      kp.status_emoji ?? "⬜",
      kp.tags ?? [],
    );
    lines.push(block);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Category tag suggestion ─────────────────────────────────────────────────

export const COMMON_CATEGORIES = [
  "认知科学",
  "行为心理",
  "投资理财",
  "个人成长",
  "沟通表达",
  "系统思维",
  "效率方法",
  "技术工程",
  "创业商业",
  "哲学思辨",
];

export function suggestCategoryTags(
  title: string,
  summary: string,
): string[] {
  const text = (title + " " + summary).toLowerCase();
  const matched: string[] = [];
  const keywordMap: Record<string, string[]> = {
    认知科学: ["认知", "大脑", "思维", "记忆", "注意力"],
    行为心理: ["行为", "习惯", "动机", "情绪", "心理"],
    投资理财: ["投资", "理财", "股票", "基金", "资产"],
    个人成长: ["成长", "自我", "目标", "改变", "提升"],
    沟通表达: ["沟通", "表达", "说话", "写作", "交流"],
    系统思维: ["系统", "模型", "框架", "结构", "原理"],
    效率方法: ["效率", "方法", "工具", "流程", "习惯"],
    技术工程: ["代码", "技术", "工程", "编程", "开发"],
    创业商业: ["创业", "商业", "产品", "用户", "市场"],
    哲学思辨: ["哲学", "逻辑", "思辨", "价值观", "意义"],
  };
  for (const [cat, keywords] of Object.entries(keywordMap)) {
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(cat);
    }
    if (matched.length >= 2) break;
  }
  return matched.length ? matched : ["通用"];
}
