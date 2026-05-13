/**
 * insight_tracker.ts — learning-engine Insight Capture & Dynamic Exam System
 * Version: 2026-03-04-1049
 *
 * Handles:
 *   1. Insight detection (user "aha" moments -> exam priority)
 *   2. Dynamic exam generation (based on user's OWN answers, not material)
 *   3. Mastery confirmation via 5 fixed angles (not repetition count)
 *   4. Generous L1 scoring + standard-term hint
 *   5. Encouraging feedback style (genuine + positive close)
 */

// ── Insight Detection ───────────────────────────────────────────────────────

export const INSIGHT_TRIGGER_PHRASES = [
  "原来是这样",
  "原来如此",
  "茅塞顿开",
  "懂了",
  "明白了",
  "我懂了",
  "我明白了",
  "啊对",
  "对对对",
  "就是这个意思",
  "哦原来",
  "恍然大悟",
  "这就是说",
  "所以其实",
  "也就是说",
  "i see",
  "got it",
  "i get it",
  "aha",
  "oh i see",
];

export function detectInsight(text: string): boolean {
  const textLower = text.toLowerCase().trim();

  // Hard list check
  for (const phrase of INSIGHT_TRIGGER_PHRASES) {
    if (textLower.includes(phrase)) return true;
  }

  // Heuristic: short affirmative sentence starting with 啊/哦/哇/嗯
  if (/^[啊哦哇嗯]{1,2}[，,]?\s*.{5,50}[！!。]?$/.test(text.trim())) {
    if (["对", "是", "懂", "明白", "清楚", "理解"].some((w) => text.includes(w))) {
      return true;
    }
  }

  return false;
}

export function extractInsightContent(userMessage: string): string {
  let cleaned = userMessage.trim().replace(/^[啊哦哇嗯，,！!。\s]+/, "");
  cleaned = cleaned.replace(/[啊哦哇嗯，,！!。\s]+$/, "");
  return cleaned || userMessage.trim();
}

// ── 5-Angle Mastery Confirmation ────────────────────────────────────────────

export interface MasteryAngle {
  id: string;
  label: string;
  template: string;
  purpose: string;
}

export const MASTERY_ANGLES: MasteryAngle[] = [
  {
    id: "reverse",
    label: "反向推导",
    template: "如果{insight_core}这个说法不成立，会发生什么？",
    purpose: "检验用户是否理解因果，而不只是记住结论",
  },
  {
    id: "scenario",
    label: "场景代入",
    template: "在{scenario}这个具体情境下，你会怎么做/怎么判断？",
    purpose: "检验用户能否把领悟迁移到真实行动",
  },
  {
    id: "analogy",
    label: "类比迁移",
    template: "这个领悟让你想到生活里的哪件具体的事？",
    purpose: "检验用户能否用自己的经验锚定这个概念",
  },
  {
    id: "boundary",
    label: "边界测试",
    template: "什么情况下这个说法不成立，或者会有例外？",
    purpose: "检验用户是否理解适用边界，而不是无脑套用",
  },
  {
    id: "one_liner",
    label: "一句话精华",
    template:
      "如果要告诉一个完全不懂这个话题的朋友，你会怎么一句话说清楚？",
    purpose: "检验用户能否用自己的语言完整表达，最高掌握度指标",
  },
];

export function selectMasteryAngles(
  _insight: string,
  count = 3,
): MasteryAngle[] {
  const n = Math.max(3, Math.min(5, count));
  const anchorIds = new Set(["scenario", "one_liner"]);
  const anchors = MASTERY_ANGLES.filter((a) => anchorIds.has(a.id));
  const others = MASTERY_ANGLES.filter((a) => !anchorIds.has(a.id));

  const selected = [...anchors];
  for (const angle of others) {
    if (selected.length >= n) break;
    selected.push(angle);
  }

  const order = ["reverse", "scenario", "analogy", "boundary", "one_liner"];
  selected.sort(
    (a, b) =>
      (order.indexOf(a.id) === -1 ? 99 : order.indexOf(a.id)) -
      (order.indexOf(b.id) === -1 ? 99 : order.indexOf(b.id)),
  );
  return selected.slice(0, n);
}

export function buildMasteryConfirmationPrompt(
  insight: string,
  userAnswer: string,
  count = 3,
): string {
  const angles = selectMasteryAngles(insight, count);
  const angleLines = angles
    .map(
      (a, i) =>
        `  ${i + 1}. [${a.label}] ${a.template
          .replace("{insight_core}", insight)
          .replace("{scenario}", "具体生活场景")}`,
    )
    .join("\n");

  return `
用户刚才表达了这个领悟：
「${insight}」

用户的原话是：
「${userAnswer}」

请用以下${count}个角度出题，确认用户是否真正掌握（以用户的理解为出发点，不是材料原版）：

${angleLines}

出题规则：
- 题目必须基于用户刚才说的内容，而不是材料的知识点
- 每题独占一行，以对应角度标签开头（如「🔄 反向推导：」）
- 不透露答案
- 语气：像聪明朋友在好奇地追问，不是老师在考学生
- 出完题后等用户回答
`;
}

// ── Dynamic Exam (user-answer-centered) ─────────────────────────────────────

export function buildDynamicExamPrompt(
  userStatement: string,
  level = "L1",
): string {
  const levelDescMap: Record<string, string> = {
    L1: "挖空填充（宽松评分：意思对即满分；挖空+开放式混合；每题附标准词提示）",
    L2: "多角度（反向推导+场景变体+对比辨析；考为什么；5题每题不同角度）",
    L3: "生活场景活用（真实情境；考遇到了能自然做出来吗；5题）",
  };
  const levelDesc = levelDescMap[level] ?? "挖空填充";

  return `
用户这轮说了：
「${userStatement}」

请基于用户刚才说的内容出${level}级别考题。

级别说明：${levelDesc}

核心原则（违反=严重错误）：
- 以用户说的话为素材，不是材料原文
- 考的是用户自己的掌握版本
- L1：挖空要挖关键词（不是无意义词），意思对就满分
- 评分后必须顺带提一句标准词（即使答对也提）
- 答对：真实肯定 + 标准词提示 + 正向收尾
- 答错：详细解释 + 用户确认懂了 + 再出3~5角度确认

每题以 🧪 开头，独占一行。
出题后等用户回答。
`;
}

// ── Scoring & Feedback ──────────────────────────────────────────────────────

export interface ScoringResult {
  scoreNew: number;
  scoreOld: number;
  verdict: string; // "correct" | "partial" | "wrong"
  userAnswerSummary: string;
  standardTerm: string;
  encouragement: string;
  needsDeepExplain: boolean;
}

export function buildGenerousScoringPrompt(
  question: string,
  userAnswer: string,
  standardTerm: string,
  currentScore: number,
  level = "L1",
): string {
  return `
题目：${question}
用户回答：${userAnswer}
标准说法：${standardTerm}
当前掌握度：${currentScore.toFixed(0)}%
级别：${level}

评分规则（宽松版）：
- 意思对、核心逻辑对 → 直接满分（无需用原词）
- 方向对但不完整 → 70-85%
- 方向偏了 → 50%以下
- 完全错 → 40%以下

反馈格式（必须严格遵守）：
> ✅/⚠️/❌ **[知识点]**：评价 → 旧% → **新%**（变化）

>> 🏆 答对的部分（用户自己的话）
>> 📖 标准说法：${standardTerm}（每题必须提，即使答对）
>> 💡 补充/纠正（答错时详细解释，答对时简短补充）
>> 🎯 鼓励：[真实评价 + 正向收尾，不空洞]

鼓励风格：
- 好的示例：「方向完全对，你抓住了核心，标准说法是XX，你已经很接近了」
- 禁止：「太棒了！你好厉害！」（空洞无意义）
- 答错时：先肯定用户理解到的部分，再指出偏差，给出正确方向

如果答错，在反馈末尾加：
>> ❓ 现在清楚了吗？（等用户确认后再出3~5角度确认题）
`;
}

// ── Mastery State ───────────────────────────────────────────────────────────

export class MasteryState {
  knowledgePoint: string;
  anglesPassed: string[] = [];
  anglesFailed: string[] = [];
  currentScore = 0.0;

  static REQUIRED_ANGLES = 3;

  constructor(knowledgePoint: string) {
    this.knowledgePoint = knowledgePoint;
  }

  recordAngle(angleId: string, passed: boolean, score: number): void {
    this.currentScore = score;
    if (passed) {
      if (!this.anglesPassed.includes(angleId)) {
        this.anglesPassed.push(angleId);
      }
    } else {
      if (!this.anglesFailed.includes(angleId)) {
        this.anglesFailed.push(angleId);
      }
    }
  }

  isMastered(): boolean {
    return (
      this.anglesPassed.length >= MasteryState.REQUIRED_ANGLES &&
      this.anglesFailed.length === 0 &&
      this.currentScore >= 75.0
    );
  }

  needsMoreConfirmation(): boolean {
    return !this.isMastered();
  }

  summary(): string {
    const passed = this.anglesPassed.join(", ") || "无";
    const failed = this.anglesFailed.join(", ") || "无";
    return (
      `知识点：${this.knowledgePoint} | ` +
      `已过角度：${passed} | 未过：${failed} | ` +
      `当前分数：${this.currentScore.toFixed(0)}%`
    );
  }
}

// ── Layer-aware exam prompt ─────────────────────────────────────────────────

export function buildExamByUserIntent(
  pointTitle: string,
  userAsked: boolean,
  currentScore: number,
  level = "L1",
  materialSnippet = "",
): string {
  if (userAsked) {
    return `
[ADS严格模式] 知识点：${pointTitle}
用户主动问过此点 → 深入掌握要求

出题要求：
- L1/L2/L3三阶全部要过
- 5角度确认（反向推导/场景代入/类比迁移/边界测试/一句话精华）
- 目标分数：85%以上
- 答错→详细解释→确认懂了→再出角度题
- 以用户自己说的话为出题素材

当前分数：${currentScore.toFixed(0)}%
${materialSnippet ? "材料参考：" + materialSnippet.slice(0, 500) : ""}
`;
  } else {
    return `
[DWD轻量模式] 知识点：${pointTitle}
用户未主动问过 → 扫过知道即可

出题要求：
- 1-2题，确认用户认得出、知道大概是什么就行
- 意思对直接满分
- 到达40%立即停止，不再主动复习此点
- 不深入追问，不要求随时复现

当前分数：${currentScore.toFixed(0)}% / 目标：40%
${materialSnippet ? "材料参考：" + materialSnippet.slice(0, 300) : ""}
`;
  }
}
