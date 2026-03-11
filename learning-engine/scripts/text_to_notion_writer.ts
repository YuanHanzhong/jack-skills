/**
 * text_to_notion_writer.ts
 * ------------------------
 * Handles writing plain-text materials (pasted text, transcripts, articles)
 * to the correct Notion layers (ODS / DWD / ADS).
 *
 * Layer routing rules:
 *   ODS  - raw material, full text, no truncation, source-of-truth
 *   DWD  - Claude analysis, knowledge tree, mastery tracking (NO raw text)
 *   ADS  - index only (properties + DWD link, NO body content)
 */

import {
  ODS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, ADS_DATA_SOURCE_ID,
} from "../../_shared/config.ts";
import { STATUS_MAP, STATUS_IN_PROGRESS } from "../../_shared/constants.ts";

// ── ODS Layer ───────────────────────────────────────────────────────────────

export class OdsWriter {
  static buildTitle(materialTitle: string, sourceHint = "文字材料"): string {
    const emojiMap: Record<string, string> = {
      youtube: "📺",
      article: "📄",
      transcript: "🎙️",
      default: "📝",
    };
    const hintLower = sourceHint.toLowerCase();
    let emoji: string;
    let suffix: string;
    if (hintLower.includes("youtube") || hintLower.includes("字幕")) {
      emoji = emojiMap.youtube;
      suffix = "YouTube字幕";
    } else if (
      hintLower.includes("transcript") ||
      hintLower.includes("录音") ||
      hintLower.includes("转写")
    ) {
      emoji = emojiMap.transcript;
      suffix = "文字转写";
    } else if (
      hintLower.includes("article") ||
      hintLower.includes("文章")
    ) {
      emoji = emojiMap.article;
      suffix = "文章原文";
    } else {
      emoji = emojiMap.default;
      suffix = "文字材料";
    }
    return `${emoji} ${materialTitle}｜${suffix}`;
  }

  static buildContent(
    rawText: string,
    title: string,
    sourceUrl?: string | null,
    timestamp?: string | null,
    summary?: string | null,
  ): string {
    const lines: string[] = [];
    lines.push("## 📌 来源信息");
    lines.push(`- 标题：${title}`);
    if (sourceUrl) lines.push(`- 来源：${sourceUrl}`);
    if (timestamp) lines.push(`- 存档时间：${timestamp}`);
    lines.push(`- 字数：${rawText.length}字`);
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("## 📃 原始全文");
    lines.push("");
    lines.push(rawText);
    lines.push("");

    if (summary) {
      lines.push("---");
      lines.push("");
      lines.push("## 📝 摘要（补充）");
      lines.push("");
      lines.push(summary);
    }

    return lines.join("\n");
  }

  static validate(rawText: string): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!rawText || !rawText.trim()) {
      errors.push("raw_text is empty - ODS must store full text");
    }
    if (rawText.trim().length < 10) {
      errors.push("raw_text too short, check input");
    }
    return { ok: errors.length === 0, errors };
  }
}

// ── DWD Layer ───────────────────────────────────────────────────────────────

export class DwdWriter {
  static buildTitle(materialTitle: string, sourceHint = "文字材料"): string {
    const hintLower = sourceHint.toLowerCase();
    let suffix: string;
    if (hintLower.includes("youtube") || hintLower.includes("字幕")) {
      suffix = "视频拆解";
    } else if (
      hintLower.includes("transcript") ||
      hintLower.includes("录音")
    ) {
      suffix = "录音拆解";
    } else {
      suffix = "拆解笔记";
    }
    return `🔬 ${materialTitle}｜${suffix}`;
  }

  static buildKnowledgePointBlock(
    pointTitle: string,
    originalTerm: string,
    userUnderstanding = "",
    categoryTags: string[] | null = null,
    score = 0,
    date = "—",
  ): string {
    const status = DwdWriter._scoreToStatus(score);
    const tagsStr = (categoryTags ?? []).map((t) => `#${t}`).join(" ");
    const userPart = userUnderstanding
      ? `\n  💬 用户理解：${userUnderstanding}`
      : "";
    const tagsPart = tagsStr ? `\n  🏷️ 分类：${tagsStr}` : "";

    return (
      `<details>\n` +
      `<summary>${status} ${pointTitle} | ${score}% | ${date}</summary>\n` +
      `  📖 材料原版：${originalTerm}` +
      `${userPart}` +
      `${tagsPart}\n` +
      `</details>`
    );
  }

  static buildContent(
    title: string,
    sourceUrl: string | null,
    summary: string,
    knowledgePoints: Array<Record<string, any>>,
    takeaways: string[],
    timestamp: string,
    charCount = 0,
  ): string {
    const lines: string[] = [];

    // Top - basic info
    lines.push("## 📌 材料基本信息");
    lines.push(`- 标题：${title}`);
    if (sourceUrl) lines.push(`- 来源：${sourceUrl}`);
    lines.push(`- 存档时间：${timestamp}`);
    if (charCount) lines.push(`- 原文字数：${charCount}字`);
    lines.push("");
    lines.push("---");
    lines.push("");

    // Content overview
    lines.push("## 🗺️ 内容概览");
    lines.push(summary || "（待填写）");
    lines.push("");
    lines.push("---");
    lines.push("");

    // Summary table
    lines.push("## 📊 掌握度汇总表");
    lines.push("");
    lines.push("| 状态 | 知识点 | 分数% | 上次测试 |");
    lines.push("|------|--------|-------|---------|");
    for (const kp of knowledgePoints) {
      const status = DwdWriter._scoreToStatus(kp.score ?? 0);
      lines.push(
        `| ${status} | ${kp.title ?? ""} | ${kp.score ?? 0}% | ${kp.date ?? "—"} |`,
      );
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Core knowledge points
    lines.push("## 🎯 核心知识点");
    lines.push("");
    for (let i = 0; i < knowledgePoints.length; i++) {
      const kp = knowledgePoints[i];
      lines.push(
        DwdWriter.buildKnowledgePointBlock(
          kp.title ?? `知识点${i + 1}`,
          kp.original_term ?? kp.title ?? "",
          kp.understanding ?? "",
          kp.tags ?? null,
          kp.score ?? 0,
          kp.date ?? "—",
        ),
      );
      lines.push("");
    }
    lines.push("---");
    lines.push("");

    // Takeaways
    lines.push("## 💡 Takeaway方法论");
    lines.push("");
    if (takeaways.length) {
      for (const tw of takeaways) {
        lines.push(`- 🔧 ${tw}`);
      }
    } else {
      lines.push("（待填写）");
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // Learning status tracking
    const pending = knowledgePoints
      .filter((kp) => (kp.score ?? 0) < 65)
      .map((kp) => kp.title);
    const done = knowledgePoints
      .filter((kp) => (kp.score ?? 0) >= 65)
      .map((kp) => kp.title);
    const total = knowledgePoints.length;
    const avgScore = total
      ? Math.round(
          knowledgePoints.reduce((s, kp) => s + (kp.score ?? 0), 0) / total,
        )
      : 0;

    lines.push("## 📊 学习状态跟踪");
    lines.push(`- 状态：${pending.length === 0 ? "已完成" : "学习中"}`);
    lines.push(
      `- 已学知识点：${done.length ? JSON.stringify(done) : "[]"}`,
    );
    lines.push(
      `- 待学知识点：${pending.length ? JSON.stringify(pending) : "[]"}`,
    );
    lines.push(`- 上次学习：${timestamp}`);
    lines.push(
      `- 掌握度：${DwdWriter._scoreToStatus(avgScore)} ${avgScore}%`,
    );

    return lines.join("\n");
  }

  static _scoreToStatus(score: number): string {
    if (score === 0) return STATUS_MAP.untouched;
    if (score < 30) return STATUS_MAP.learning;
    if (score < 65) return STATUS_MAP.tested;
    if (score < 95) return STATUS_MAP.mastered;
    return STATUS_MAP.internalized;
  }

  static validate(
    knowledgePoints: any[],
    rawTextIncluded: boolean,
  ): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (rawTextIncluded) {
      errors.push(
        "[CRITICAL/FORBIDDEN] raw_text must NOT be included in DWD. " +
          "DWD stores analysis only.",
      );
    }
    if (!knowledgePoints || !knowledgePoints.length) {
      errors.push(
        "knowledge_points is empty - DWD needs at least 1 knowledge point",
      );
    }
    return { ok: errors.length === 0, errors };
  }
}

// ── ADS Layer ───────────────────────────────────────────────────────────────

export class AdsWriter {
  static buildProperties(
    title: string,
    dwdUrl: string,
    odsUrl: string,
    status = STATUS_IN_PROGRESS,
    materialType = "文字材料",
  ): Record<string, string> {
    return {
      title,
      dwd_url: dwdUrl,
      ods_url: odsUrl,
      status,
      material_type: materialType,
    };
  }

  static validate(hasBodyContent: boolean): {
    ok: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    if (hasBodyContent) {
      errors.push(
        "[CRITICAL/FORBIDDEN] ADS must only store properties + DWD link. " +
          "No body content allowed.",
      );
    }
    return { ok: !hasBodyContent, errors };
  }
}

// ── TextMaterialPipeline ────────────────────────────────────────────────────

export class TextMaterialPipeline {
  rawText: string;
  materialTitle: string;
  sourceHint: string;
  sourceUrl: string | null;
  knowledgePoints: Array<Record<string, any>>;
  takeaways: string[];
  summary: string;
  timestamp: string;

  constructor(opts: {
    rawText: string;
    materialTitle: string;
    sourceHint?: string;
    sourceUrl?: string | null;
    knowledgePoints?: Array<Record<string, any>>;
    takeaways?: string[];
    summary?: string;
    timestamp?: string;
  }) {
    this.rawText = opts.rawText;
    this.materialTitle = opts.materialTitle;
    this.sourceHint = opts.sourceHint ?? "文字材料";
    this.sourceUrl = opts.sourceUrl ?? null;
    this.knowledgePoints = opts.knowledgePoints ?? [];
    this.takeaways = opts.takeaways ?? [];
    this.summary = opts.summary ?? "";
    this.timestamp = opts.timestamp ?? "";
  }

  buildWritePlan(): Record<string, any> {
    const odsValidation = OdsWriter.validate(this.rawText);
    const dwdValidation = DwdWriter.validate(
      this.knowledgePoints,
      false,
    );

    const odsTitle = OdsWriter.buildTitle(
      this.materialTitle,
      this.sourceHint,
    );
    const odsContent = OdsWriter.buildContent(
      this.rawText,
      this.materialTitle,
      this.sourceUrl,
      this.timestamp || null,
      this.summary || null,
    );

    const dwdTitle = DwdWriter.buildTitle(
      this.materialTitle,
      this.sourceHint,
    );
    const dwdContent = DwdWriter.buildContent(
      this.materialTitle,
      this.sourceUrl ?? null,
      this.summary,
      this.knowledgePoints,
      this.takeaways,
      this.timestamp,
      this.rawText.length,
    );

    return {
      ods: {
        data_source_id: ODS_DATA_SOURCE_ID,
        title: odsTitle,
        content: odsContent,
        validation: odsValidation,
      },
      dwd: {
        data_source_id: DWD_DATA_SOURCE_ID,
        title: dwdTitle,
        content: dwdContent,
        validation: dwdValidation,
      },
      ads: {
        data_source_id: ADS_DATA_SOURCE_ID,
        note: "Write properties + DWD/ODS links only. NO body content.",
      },
    };
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

import { describe, test, expect } from "bun:test";

describe("TextToNotionWriter", () => {
  test("ODS title text", () => {
    const t = OdsWriter.buildTitle("深度工作法", "文章");
    expect(t).toContain("深度工作法");
    expect(t.includes("📄") || t.includes("📝")).toBe(true);
  });

  test("ODS title youtube", () => {
    const t = OdsWriter.buildTitle("如何专注", "YouTube字幕");
    expect(t).toContain("📺");
    expect(t).toContain("YouTube字幕");
  });

  test("ODS content has full text", () => {
    const content = OdsWriter.buildContent(
      "全文内容".repeat(50),
      "测试",
      undefined,
      "2026-03-04",
    );
    expect(content).toContain("全文内容");
    expect(content).toContain("原始全文");
  });

  test("ODS validation empty", () => {
    const result = OdsWriter.validate("");
    expect(result.ok).toBe(false);
  });

  test("DWD title", () => {
    const t = DwdWriter.buildTitle("深度工作法", "文章");
    expect(t).toContain("🔬");
    expect(t).toContain("拆解笔记");
  });

  test("DWD score emoji", () => {
    expect(DwdWriter._scoreToStatus(0)).toBe("⬜");
    expect(DwdWriter._scoreToStatus(15)).toBe("🔵");
    expect(DwdWriter._scoreToStatus(50)).toBe("🟡");
    expect(DwdWriter._scoreToStatus(80)).toBe("🟢");
  });

  test("DWD no raw text", () => {
    const result = DwdWriter.validate([], true);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("FORBIDDEN");
  });

  test("ADS no body", () => {
    const result = AdsWriter.validate(true);
    expect(result.ok).toBe(false);
  });

  test("pipeline build plan", () => {
    const pipeline = new TextMaterialPipeline({
      rawText: "材料全文".repeat(100),
      materialTitle: "测试材料",
      knowledgePoints: [
        {
          title: "知识点A",
          original_term: "Point A",
          score: 0,
          date: "—",
        },
      ],
      takeaways: ["方法一"],
      summary: "这是摘要",
      timestamp: "2026-03-04 14:30",
    });
    const plan = pipeline.buildWritePlan();
    expect(plan.ods.validation.ok).toBe(true);
    expect(plan.dwd.validation.ok).toBe(true);
  });
});
