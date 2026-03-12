/**
 * auto_archive.ts — Automatic ODS + DWD Creation on First Long Text
 * Version: 2026-03-04-1055
 *
 * Trigger:
 *   - User sends a long block of text (no trigger keyword required)
 *   - Claude gives first reply + asks questions
 *   - User answers -> SILENTLY create ODS + DWD in Notion
 *
 * Flow:
 *   1. Detect long text (>=300 chars or >=5 lines)
 *   2. Claude replies + asks questions (no Notion action yet)
 *   3. User answers Claude's questions -> TRIGGER auto-archive
 *   4. Run ODS dedup check first (ods_dedup.ts)
 *   5. If not duplicate -> create ODS page (raw material)
 *   6. Claude analyzes material -> extract knowledge points -> create DWD page
 *   7. DWD: all knowledge points with score=0%, using collapsible format
 *   8. Silently remind user
 *
 * Key rules:
 *   - NO trigger keyword needed
 *   - Always silent (no interruption to conversation flow)
 *   - ODS = raw material storage
 *   - DWD = analyzed knowledge tree, score=0%, NOT empty skeleton
 */

import {
  buildOdsContentFromSession,
  splitTextIntoChunks,
  MaterialSession,
  makeMaterialId,
} from "./ods_learning.ts";

export interface ChapterAnalysis {
  title?: string;
  points?: Array<{ term?: string; description?: string; layer?: string }>;
}

export const LONG_TEXT_MIN_CHARS = 300;
export const LONG_TEXT_MIN_LINES = 5;

export function isLongText(text: string): boolean {
  const stripped = text.trim();
  return (
    stripped.length >= LONG_TEXT_MIN_CHARS ||
    stripped.split("\n").length >= LONG_TEXT_MIN_LINES
  );
}

export function extractTitleFromText(text: string, maxLen = 40): string {
  const lines = text.trim().split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length > 5) {
      let title = line.slice(0, maxLen);
      if (line.length > maxLen) title += "…";
      return title;
    }
  }
  return "未命名材料";
}

// ── ArchiveSession ──────────────────────────────────────────────────────────

export interface ArchiveSession {
  rawText: string;
  sourceUrl: string;
  title: string;
  odsPageId: string;
  dwdPageId: string;
  archived: boolean;
  duplicateFound: boolean;
  existingPageTitle: string;
}

export function createArchiveSession(
  rawText: string,
  overrides: Partial<ArchiveSession> = {},
): ArchiveSession {
  return {
    rawText,
    sourceUrl: "",
    title: extractTitleFromText(rawText),
    odsPageId: "",
    dwdPageId: "",
    archived: false,
    duplicateFound: false,
    existingPageTitle: "",
    ...overrides,
  };
}

export function buildOdsPageContent(session: ArchiveSession): string {
  const matSession = new MaterialSession(
    makeMaterialId(session.sourceUrl, session.rawText),
    session.sourceUrl,
    "",
    session.title,
    session.rawText,
  );
  return buildOdsContentFromSession(matSession);
}

export function buildDwdAnalysisPrompt(
  material: string,
  title: string,
): string {
  const preview =
    material.length > 3000
      ? material.slice(0, 3000) + "…(截断)"
      : material;
  return `
分析以下材料，提取知识点列表用于建立DWD学习档案。

材料标题：${title}
材料内容：
---
${preview}
---

请输出结构化知识点列表，格式要求：

1. 按章节/主题分组（1-5个大组）
2. 每组下列出3-8个具体知识点
3. 每个知识点一行，包含：
   - 术语/概念名称（简短）
   - 一句话描述（用材料原意）
   - 建议层级：DWD(扫过知道)/DWS(能讲出来)/ADS(深入掌握)
     - 默认大部分知识点=DWD
     - 核心概念/重点论点=DWS
     - 极少数关键核心=ADS

输出格式（JSON）：
{
  "chapters": [
    {
      "title": "章节名",
      "points": [
        {
          "term": "术语",
          "description": "一句话描述",
          "layer": "DWD"
        }
      ]
    }
  ]
}

只输出JSON，不要其他文字。
`;
}

export function buildDwdPageContentFromAnalysis(
  title: string,
  chapters: ChapterAnalysis[],
  sourceUrl = "",
  odsPageUrl = "",
): string {
  const sourceLine = sourceUrl
    ? `🔗 来源：${sourceUrl}`
    : "🔗 来源：（粘贴文本）";
  const odsLine = odsPageUrl ? `📥 ODS原文：${odsPageUrl}` : "";

  const lines: string[] = [
    "# 📊 掌握度汇总\n",
    "| 状态 | 知识点 | 分数 | 层级 | 上次测试 |",
    "|------|--------|------|------|---------|",
  ];

  const allPoints: Array<{ term?: string; description?: string; layer?: string }> = [];
  for (const ch of chapters) {
    for (const pt of ch.points ?? []) {
      allPoints.push(pt);
      lines.push(
        `| ⬜ | ${pt.term ?? ""} | 0% | ${pt.layer ?? "DWD"} | — |`,
      );
    }
  }

  lines.push("\n---\n", "# 📚 知识树\n", sourceLine);
  if (odsLine) lines.push(odsLine);
  lines.push("");

  const total = allPoints.length;
  lines.push(`📊 共 ${total} 个知识点 · 已学 0 · 未学 ${total}\n`);
  lines.push("---\n");

  for (const ch of chapters) {
    lines.push(`## ${ch.title ?? "未命名章节"}\n`);
    for (const pt of ch.points ?? []) {
      const term = pt.term ?? "";
      const desc = pt.description ?? "";
      const layer = pt.layer ?? "DWD";
      const layerEmojiMap: Record<string, string> = {
        DWD: "🚪",
        DWS: "📖",
        ADS: "⭐",
      };
      const layerEmoji = layerEmojiMap[layer] ?? "🚪";
      lines.push("<details>");
      lines.push(
        `<summary>⬜ **${term}** | 0% | ${layerEmoji}${layer} | —</summary>`,
      );
      lines.push("");
      lines.push(`  📖 **材料原版**：${desc}`);
      lines.push("  💬 **用户理解**：（待记录）");
      lines.push("  🏷️ 分类：（待标注）");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push("---\n", "# 📝 来源信息\n", sourceLine);
  if (odsLine) lines.push(odsLine);

  return lines.join("\n");
}

export function buildAutoArchiveReminder(session: ArchiveSession): string {
  if (session.duplicateFound) {
    return `⚠️ 找到旧记录：**${session.existingPageTitle}**——直接进入学习流程，从上次继续。`;
  }
  return `✅ 已静默建档：📥 ODS [${session.title}] + 🔬 DWD [${session.title}]`;
}

// ── Archive trigger detection ───────────────────────────────────────────────

export class AutoArchiveTrigger {
  static readonly IDLE = "idle";
  static readonly WAITING = "waiting_for_user_reply";
  static readonly DONE = "done";

  private state = AutoArchiveTrigger.IDLE;
  pendingSession: ArchiveSession | null = null;

  onUserMessage(text: string): ArchiveSession | null {
    if (this.state === AutoArchiveTrigger.IDLE) {
      if (isLongText(text)) {
        this.pendingSession = createArchiveSession(text);
        this.state = AutoArchiveTrigger.WAITING;
      }
      return null;
    } else if (this.state === AutoArchiveTrigger.WAITING) {
      const session = this.pendingSession;
      this.state = AutoArchiveTrigger.DONE;
      this.pendingSession = null;
      return session;
    }
    return null;
  }

  reset(): void {
    this.state = AutoArchiveTrigger.IDLE;
    this.pendingSession = null;
  }
}
