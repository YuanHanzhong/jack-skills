/**
 * dwd_builder.ts — DWD document builder for learning-engine Mode 6
 * Builds the full Notion DWD document with:
 *   - Top: mastery summary table
 *   - Middle: full knowledge tree (toggle/fold, 1-5 levels, Notion-native)
 *   - Bottom: source info + stats
 */

import { resolve } from "../../_shared/schema_resolver.ts";
import { STATUS_IN_PROGRESS, STATUS_MAP, statusToEmoji } from "../../_shared/constants.ts";

// ── Notion Markdown helpers ─────────────────────────────────────────────────

interface TreeNode {
  title: string;
  depth: number;
  children: TreeNode[];
  status: string;
  statusEmoji: string;
  score: number;
  lastTested: string | null;
}

export function _heading(depth: number, text: string): string {
  if (depth === 1) return `# ${text}`;
  if (depth === 2) return `## ${text}`;
  if (depth === 3) return `### ${text}`;
  return `**${text}**`;
}

export function _knowledgePointLine(
  kp: TreeNode,
  depth: number,
): string {
  const indent = "  ".repeat(Math.max(0, depth - 1));
  return `${indent}- ${kp.statusEmoji} ${kp.title} | ${kp.score.toFixed(0)}% | ${kp.lastTested ?? "—"}`;
}

export function buildDwdContent(
  title: string,
  chapters: TreeNode[],
  sourceUrl: string,
  sourceSummary: string,
  odsPageUrl = "",
): string {
  const lines: string[] = [];

  // TOP: Mastery summary table
  lines.push(
    "## 📊 掌握度汇总表",
    "",
    "| 状态 | 知识点 | 分数% | 上次测试 |",
    "|------|--------|-------|---------|",
  );
  const allLeaves = _collectLeaves(chapters);
  for (const kp of allLeaves) {
    lines.push(
      `| ${kp.statusEmoji} | ${kp.title} | ${kp.score.toFixed(0)}% | ${kp.lastTested ?? "—"} |`,
    );
  }

  lines.push("", "---", "");

  // MIDDLE: Knowledge tree
  lines.push(`# 🗺️ 知识结构 — ${title}`, "");
  lines.push(..._renderTree(chapters, 1));
  lines.push("", "---", "");

  // BOTTOM: Source info + ODS backlink
  const total = allLeaves.length;
  const mastered = allLeaves.filter((kp) => kp.status === "mastered").length;
  const unlearned = total - mastered;
  const odsLine = odsPageUrl
    ? `📥 原文档案：${odsPageUrl}`
    : "📥 原文档案：（未链接，建议通过ODS页面访问原文）";

  const now = new Date().toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  lines.push(
    "## 📋 来源信息",
    "",
    `🔗 来源：${sourceUrl || "（用户粘贴）"}`,
    odsLine,
    `📝 摘要：${sourceSummary || "—"}`,
    `📊 总计 ${total} 个知识点 ｜ 已学 ${mastered} ｜ 未学 ${unlearned}`,
    `🗓️ 建档时间：${now}`,
  );

  // SQ3R CHECKLIST
  lines.push("", "---", "");
  lines.push(...buildSqr3Checklist(title));

  return lines.join("\n");
}

export function _renderTree(
  nodes: TreeNode[],
  depth = 1,
): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    if (!node.children.length) {
      // Leaf node
      const indent = "  ".repeat(Math.max(0, depth - 1));
      lines.push(
        `${indent}- ${node.statusEmoji} ${node.title} | ${node.score.toFixed(0)}% | ${node.lastTested ?? "—"}`,
      );
    } else {
      // Branch node = heading
      if (depth <= 3) {
        lines.push(_heading(depth, node.title));
      } else {
        const indent = "  ".repeat(depth - 1);
        lines.push(`${indent}- **${node.title}**`);
      }
      lines.push("");
      lines.push(..._renderTree(node.children, Math.min(depth + 1, 5)));
      lines.push("");
    }
  }
  return lines;
}

export function _collectLeaves(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    if (!node.children.length) {
      result.push(node);
    } else {
      result.push(..._collectLeaves(node.children));
    }
  }
  return result;
}

export function buildDwdProperties(
  title: string,
): Record<string, string> {
  return {
    [resolve("DWD", "title")]: `🎓 ${title} — 学习进度`,
    [resolve("DWD", "category")]: "知识学习",
    [resolve("DWD", "status")]: STATUS_IN_PROGRESS,
  };
}

export function updateDwdAfterTest(
  dwdContent: string,
  kpTitle: string,
  newScore: number,
  newStatusEmoji: string,
  testDate: string,
): string {
  const lines = dwdContent.split("\n");
  const updated: string[] = [];
  for (let line of lines) {
    if (line.includes("|") && line.includes("%")) {
      const parts = line.split("|").map((p) => p.trim());
      // parts[0]="" parts[1]=emoji parts[2]=title parts[3]=score parts[4]=date
      if (parts.length >= 5 && parts[2] === kpTitle) {
        parts[1] = newStatusEmoji;
        parts[3] = `${newScore.toFixed(0)}%`;
        parts[4] = testDate;
        line = parts.join(" | ");
      }
    }
    updated.push(line);
  }
  return updated.join("\n");
}

export function buildSqr3Checklist(title: string): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "## 📋 SQ3R 学习 Checklist",
    "",
    `> 📌 主题：${title}  |  建档日期：${today}`,
    "",
    "- [ ] **S — Survey 全局预览**：摸底测试完成，知道全貌和分支结构",
    "- [ ] **Q — Question 问题生成**：对每个分支写出「我想搞懂什么？」",
    "- [ ] **R1 — Read 深入阅读**：选一个分支，走完费曼教练循环",
    "- [ ] **R2 — Recite 主动复述**：不看材料，用自己的话把这个分支讲出来",
    "- [ ] **R3 — Review 系统回顾**：所有分支完成后，做一次 L2/L3 综合测试",
    "",
    `📊 进度：已完成 0/5 步  |  上次更新：${today}`,
  ];
}

// ── Tests ───────────────────────────────────────────────────────────────────

import { describe, test, expect } from "bun:test";

describe("DWDBuilder", () => {
  function makeMockKP(
    id: string,
    title: string,
    depth: number,
    children: TreeNode[] = [],
    score = 0,
    status = "untouched",
    lastTested: string | null = null,
  ): TreeNode {
    return {
      title,
      depth,
      children,
      score,
      status,
      statusEmoji: statusToEmoji(status),
      lastTested,
    };
  }

  function makeTree(): TreeNode[] {
    const leaf1 = makeMockKP("1.1", "📌 费曼定义", 2);
    const leaf2 = makeMockKP(
      "1.2",
      "💡 输出代替输入",
      2,
      [],
      80,
      "mastered",
      "03-04",
    );
    const leaf3 = makeMockKP("2.1", "🔹 记忆宫殿", 2);
    const ch1 = makeMockKP(
      "1",
      "🔥 第一章：费曼技巧",
      1,
      [leaf1, leaf2],
    );
    const ch2 = makeMockKP("2", "💡 第二章：记忆法", 1, [leaf3]);
    return [ch1, ch2];
  }

  test("build content has sections", () => {
    const tree = makeTree();
    const content = buildDwdContent(
      "测试视频",
      tree,
      "https://test.com",
      "测试摘要",
    );
    expect(content).toContain("掌握度汇总表");
    expect(content).toContain("知识结构");
    expect(content).toContain("来源信息");
    expect(content).toContain("https://test.com");
  });

  test("summary table has all leaves", () => {
    const tree = makeTree();
    const content = buildDwdContent("测试", tree, "", "");
    expect(content).toContain("费曼定义");
    expect(content).toContain("输出代替输入");
    expect(content).toContain("记忆宫殿");
  });

  test("stats correct", () => {
    const tree = makeTree();
    const content = buildDwdContent("测试", tree, "", "");
    expect(content).toContain("总计 3 个知识点");
    expect(content).toContain("已学 1");
    expect(content).toContain("未学 2");
  });

  test("heading levels", () => {
    expect(_heading(1, "A")).toBe("# A");
    expect(_heading(2, "B")).toBe("## B");
    expect(_heading(3, "C")).toBe("### C");
    expect(_heading(4, "D")).toContain("**");
  });

  test("update after test", () => {
    const content = "| ⬜ | 📌 费曼定义 | 0% | — |\n";
    const updated = updateDwdAfterTest(
      content,
      "📌 费曼定义",
      75.0,
      STATUS_MAP.tested,
      "03-04",
    );
    expect(updated).toContain("75%");
    expect(updated).toContain("03-04");
  });
});
