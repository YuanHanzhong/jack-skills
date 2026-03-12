/**
 * paste_mode.ts — learning-engine Mode 7: Paste-Driven Learning
 * Version: 2026-03-04
 *
 * Triggered ONLY when user uses explicit trigger keywords alongside pasted text.
 *
 * Three behaviors:
 *   A) User has OWN question -> answer with strict 3-source attribution
 *   B) User has NO question -> Claude asks 3-5 interest-sparking questions
 *   C) After Claude answers user's question -> immediately generate focused exam
 *
 * Source Attribution (3 layers, NEVER mix):
 *   📄 [材料原文有据] — in the pasted material
 *   🌐 [互联网知识]   — general knowledge, NOT in this material
 *   ❓ [不确定·不作答] — Claude unsure; will NOT guess
 */

import { splitTextIntoChunks } from "./ods_learning.ts";

// ── Constants ────────────────────────────────────────────────────────────────

/** Text longer than this triggers chunked processing instead of truncation. */
const LARGE_TEXT_THRESHOLD = 2000;
/** Minimum text length to be considered a substantial paste (not a bare command). */
const MIN_PASTE_LENGTH = 50;
/** Maximum line length to still be considered a question (not body text). */
const MAX_QUESTION_LINE_LENGTH = 200;
/** Maximum line length when splitting material vs questions. */
const MAX_SPLIT_LINE_LENGTH = 150;

export const SOURCE_MATERIAL = "material";
export const SOURCE_INTERNET = "internet";
export const SOURCE_UNSURE = "unsure";

export const SOURCE_LABELS: Record<string, string> = {
  [SOURCE_MATERIAL]: "📄 **【材料原文有据】**",
  [SOURCE_INTERNET]: "🌐 **【互联网知识】**",
  [SOURCE_UNSURE]: "❓ **【不确定·不作答】**",
};

export const QUESTION_MARKERS = [
  /[？?]/,
  /^(为什么|怎么|如何|什么是|什么叫|哪些|区别|对比|解释|说说|讲讲|能不能|有没有)/,
  /(explain|why|how|what is|what are|difference|compare)/i,
];

const MODE7_KEYWORDS = [
  /学这个/, /帮我学/, /帮我理解/, /帮我分析/,
  /解释一下/, /讲讲/, /说说/, /什么意思/,
  /learn this/i, /explain/i, /analyze/i,
];

export function hasMode7Intent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length <= MIN_PASTE_LENGTH) return false;
  return MODE7_KEYWORDS.some((kw) => kw.test(trimmed)) ||
    QUESTION_MARKERS.some((qm) => qm.test(trimmed));
}

export function extractUserQuestions(text: string): string[] {
  const lines = text.trim().split("\n");
  const questions: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length > MAX_QUESTION_LINE_LENGTH) continue;
    for (const pattern of QUESTION_MARKERS) {
      if (pattern.test(line)) {
        questions.push(line);
        break;
      }
    }
  }
  return questions;
}

export function splitMaterialAndQuestions(
  text: string,
): [string, string[]] {
  const lines = text.trim().split("\n");
  const pasteLines: string[] = [];
  const questionLines: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) {
      pasteLines.push(line);
      continue;
    }
    let isQ = false;
    if (stripped.length < MAX_SPLIT_LINE_LENGTH) {
      for (const pattern of QUESTION_MARKERS) {
        if (pattern.test(stripped)) {
          isQ = true;
          break;
        }
      }
    }
    if (isQ) {
      questionLines.push(stripped);
    } else {
      pasteLines.push(line);
    }
  }
  return [pasteLines.join("\n").trim(), questionLines];
}

// ── Exam Focus Tracker ──────────────────────────────────────────────────────

export class ExamFocusTracker {
  priorityPoints: string[] = [];
  secondaryPoints: string[] = [];

  addFromQuestions(questions: string[]): void {
    for (const q of questions) {
      const trimmed = q.trim();
      if (trimmed && !this.priorityPoints.includes(trimmed)) {
        this.priorityPoints.push(trimmed);
      }
    }
  }

  addPriority(point: string): void {
    if (point && !this.priorityPoints.includes(point)) {
      this.priorityPoints.push(point);
    }
  }

  getExamPromptFragment(): string {
    if (!this.priorityPoints.length) {
      return "（用户尚未明确兴趣点，等用户回答问题后再出题）";
    }
    const lines: string[] = ["**出题焦点（必须优先考，全部覆盖）**："];
    for (let i = 0; i < this.priorityPoints.length; i++) {
      lines.push(`  ${i + 1}. ${this.priorityPoints[i]}`);
    }
    if (this.secondaryPoints.length) {
      lines.push("\n**关联点（次要）**：");
      for (const p of this.secondaryPoints) {
        lines.push(`  - ${p}`);
      }
    }
    lines.push("\n规则：不得出题考用户从未提及的独立知识点；焦点全部必须覆盖。");
    return lines.join("\n");
  }

  summary(): string {
    if (!this.priorityPoints.length) return "📌 暂无焦点点";
    const items = this.priorityPoints.map((p) => `>> 🎯 ${p}`).join("\n");
    return `> 📌 **【本次考试焦点（累计）】**\n${items}`;
  }
}

// ── Chunked material formatting ─────────────────────────────────────────────

function formatChunkedMaterial(material: string): string {
  const chunks = splitTextIntoChunks(material);
  return chunks
    .map((c, i) => `[片段 ${i + 1}/${chunks.length}]\n${c}`)
    .join("\n\n---\n\n");
}

function prepareMaterial(material: string, maxShort = LARGE_TEXT_THRESHOLD): string {
  if (material.length <= maxShort) return material;
  return formatChunkedMaterial(material);
}

function chunkedNotice(material: string): string {
  return material.length > LARGE_TEXT_THRESHOLD
    ? "\n⚠️ 材料已分段呈现，请完整阅读所有片段后再回答，不要遗漏任何片段。\n"
    : "";
}

// ── Prompt builders ─────────────────────────────────────────────────────────

export function buildAttributionAnswerPrompt(
  material: string,
  question: string,
): string {
  const mat = prepareMaterial(material);
  return `
用户粘贴了以下材料并提出问题，请严格按来源标注规则回答。
${chunkedNotice(material)}
材料：
---
${mat}
---
用户问题：${question}

来源标注铁律（违反=严重错误）：
每段答案必须标注唯一来源，格式：

> 📄 **【材料原文有据】**
>> 📝 （答案直接来自材料，材料中明确出现或清楚推断）

> 🌐 **【互联网知识】**
>> 📝 （通用背景知识，材料未提及）

> ❓ **【不确定·不作答】**
>> 📌 （不确定——直接说"不确定，不作答"，禁止猜测）

禁止：同一段混合来源 / 用❓填入猜测 / 省略标注 / 把互联网知识说成材料有据

回答完后立刻出考题（只考用户刚问的点及其直接关联点）。
`;
}

export function buildProactiveQuestionPrompt(material: string): string {
  const mat = prepareMaterial(material);
  return `
用户粘贴了材料但没有提出具体问题。
作为学习教练，问用户3~5个问题，帮他找到感兴趣的切入点。
${chunkedNotice(material)}
材料：
---
${mat}
---

提问铁律：
1. 每个问题指向材料中一个重要概念/核心论点
2. 风格：聪明朋友式提问，不是教科书理解题
3. 混合角度：1个反直觉问题 + 1个so-what问题 + 1-3个好奇心钩子
4. 数量：3~5个，不超过5个
5. 每个问题以 ❓ 开头，独占一行

用户回答哪个问题，那个话题就成为本次考试焦点（累计记录，全部考）。
输出问题后等用户回答，不要提前给答案。
`;
}

export function buildFocusedExamPrompt(
  material: string,
  focusTracker: ExamFocusTracker,
  level = "L1",
): string {
  const mat = prepareMaterial(material, 1500);
  const focus = focusTracker.getExamPromptFragment();
  const levelDescMap: Record<string, string> = {
    L1: "概念理解（挖空填充，考是什么，3-5题）",
    L2: "多角度（反向推导+场景变体+对比，考为什么，5题每题不同角度）",
    L3: "生活场景活用（真实情境，考遇到了能自然做出来吗，5题）",
  };
  const levelDesc = levelDescMap[level] ?? "概念理解";
  return `
材料（节选）：
---
${mat}
---
${focus}

出题规则：
- 级别：${level} — ${levelDesc}
- 必须覆盖所有焦点点，每个至少1题
- 关联点可出但非必须
- 用户从未提及的孤立知识点：跳过
- 禁止题目透露答案
- 禁止用编号代替内容
- 每题以 🧪 开头，独占一行

出题后等用户回答，不给答案。
`;
}

// ── Mode 9: Panoramic View (全景图) ─────────────────────────────────────────

/**
 * Keywords that trigger panoramic view mode.
 * These MUST be checked before generic Mode 6 triggers.
 */
export const PANORAMA_KEYWORDS = [
  /全景图/, /给我全景图/, /生成全景图/, /画全景图/,
  /知识地图/, /总览/, /panorama/i, /overview map/i,
];

export function hasPanoramaIntent(text: string): boolean {
  return PANORAMA_KEYWORDS.some((kw) => kw.test(text));
}

/**
 * Three-layer knowledge block structure for panoramic view.
 *
 * Each thematic chunk must expose:
 *   surface  — what it says on the surface
 *   intent   — why the author/designer wrote this; the hidden purpose
 *   apply    — how to USE this in interviews / work / real scenarios
 *   level    — learning recommendation: L1 (recall) | L2 (understand) | L3 (apply)
 */
export interface PanoramaBlock {
  theme: string;          // Thematic title (NOT the document heading — Claude generates this)
  surface: string;        // What it is
  intent: string;        // Why: the author's hidden purpose / design philosophy
  apply: string;         // How to use in practice (interview / work / decision-making)
  level: "L1" | "L2" | "L3";
}

/**
 * Build the panoramic view prompt.
 *
 * Key principle: Claude should chunk content THEMATICALLY, not by document
 * headers. A theme may span multiple sections, or a single section may contain
 * multiple themes — Claude decides based on meaning, not structure.
 *
 * The three-layer format forces Claude to go beyond surface reading:
 *   - Surface: easy, just restate
 *   - Intent: requires inferring WHY this was written / designed this way
 *   - Apply: requires connecting to real contexts the learner cares about
 */
export function buildPanoramaPrompt(material: string, fileEstimatedTokens?: number): string {
  const sizeWarning = fileEstimatedTokens && fileEstimatedTokens > 3000
    ? `\n⚠️ 这是一份大型材料（约 ${fileEstimatedTokens} tokens），你必须完整读完全部内容后再生成全景图，不得只读开头。\n`
    : "";

  return `
你是一名学习教练，正在帮用户生成这份材料的「全景图」。
${sizeWarning}
以下是完整材料：
---
${material}
---

## 全景图生成规则

### 1. 语义切块（最重要）
按「主题」切块，不按文档标题切块。
- 同一个思想跨多个标题 → 合并为一个块
- 一个标题下有多个独立思想 → 拆成多个块
- 每块控制在一个「可以独立记忆、独立练习」的颗粒度

### 2. 每块三层结构（必须全部填写）
每个主题块必须包含：
- 🔍 **表层**（是什么）：这个知识点的字面内容，1-2句话
- 🧠 **意图**（为什么）：作者/设计者的真实目的，或这个设计背后的思想。不是复述内容，是挖掘动机。例如：为什么要这样设计？这解决了什么本质矛盾？
- 🎯 **应用**（怎么用）：在面试、工作、实际场景中，这个知识点如何被激活？给出具体的使用场景或话术。

### 3. 学习分级
每块标注推荐学习等级：
- **L1**：需要背下来、能复述的（概念定义、公式）
- **L2**：需要理解原理、能解释为什么（设计思路、权衡）
- **L3**：需要能在新情境中自主运用的（决策框架、判断能力）

### 4. 输出格式

先输出一句话总结（材料的核心主旨）：
> 📌 **核心主旨**：[1句话，材料想让你掌握什么能力/思维]

然后输出全景图，每个块用以下格式：

---
### 🗂️ [主题名称]（L1/L2/L3）

🔍 **表层**：[是什么，1-2句]

🧠 **意图**：[为什么这样设计/写，背后的真实目的]

🎯 **应用**：[面试/工作/实践中的具体用法，可以给出话术或场景]

---

最后输出学习路径建议：
> 🛤️ **建议学习顺序**：[按重要性排列的主题顺序，哪些先学、哪些深入]
> 📊 **知识密度**：[L1共N块 | L2共N块 | L3共N块 | 预计深度学习时长]
`;
}

// ── Session state ───────────────────────────────────────────────────────────

export class PasteSession {
  material = "";
  materialTitle = "";
  questionsAskedByUser: string[] = [];
  examFocus = new ExamFocusTracker();
  answersGiven = 0;

  recordUserQuestion(question: string): void {
    this.questionsAskedByUser.push(question);
    this.examFocus.addFromQuestions([question]);
  }

  shouldGenerateExam(): boolean {
    return this.answersGiven > 0 && this.examFocus.priorityPoints.length > 0;
  }

  examFocusSummary(): string {
    return this.examFocus.summary();
  }
}
