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

export function hasMode7Intent(text: string): boolean {
  return text.trim().length > 50;
}

export function extractUserQuestions(text: string): string[] {
  const lines = text.trim().split("\n");
  const questions: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.length > 200) continue;
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
    if (stripped.length < 150) {
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

// ── Prompt builders ─────────────────────────────────────────────────────────

export function buildAttributionAnswerPrompt(
  material: string,
  question: string,
): string {
  const mat =
    material.length > 2000
      ? material.slice(0, 2000) + "...(截断)"
      : material;
  return `
用户粘贴了以下材料并提出问题，请严格按来源标注规则回答。

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
  const mat =
    material.length > 2000
      ? material.slice(0, 2000) + "...(截断)"
      : material;
  return `
用户粘贴了材料但没有提出具体问题。
作为学习教练，问用户3~5个问题，帮他找到感兴趣的切入点。

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
  const mat =
    material.length > 1500
      ? material.slice(0, 1500) + "...(截断)"
      : material;
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

// ── Session state ───────────────────────────────────────────────────────────

export class PasteSession {
  material = "";
  materialTitle = "";
  questionsAskedByUser: string[] = [];
  proactiveQuestionsAsked = false;
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
