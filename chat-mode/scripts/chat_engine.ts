/**
 * chat_engine.ts — Deep cognitive coach / conversation engine core
 */

// -- Trigger words --
const ENTER_TRIGGERS = [
  "聊聊", "聊天模式", "帮我深挖", "陪我想清楚", "按那个最好的模式来",
  "别急着给答案", "帮我理一下",
];

const EMOTION_KEYWORDS = [
  "好累", "烦死了", "脑子停不下来", "焦虑", "迷茫", "崩溃",
  "自责", "纠结", "犹豫", "烦", "累", "丧", "废",
];

const EXIT_TRIGGERS = [
  "回任务", "不聊了", "直接给答案", "执行模式", "帮我做", "别聊了",
];

const CONVERGENCE_SIGNALS = [
  "想通了", "明白了", "知道该干嘛了", "想清楚了", "困了", "想睡了",
  "好了", "可以了", "行动吧",
];

/**
 * Detect the user's emotional energy zone.
 *
 * - "low"      — exhausted / numb / lost -> just hold, don't push
 * - "mid_low"  — anxious / confused / lost -> gentle questions, help organize
 * - "mid_high" — thinking / exploring / curious -> guide cognitive upgrade
 * - "high"     — clear / determined / wants action -> spark action, gently close
 */
function detectEmotionLevel(message: string): "low" | "mid_low" | "mid_high" | "high" {
  const lowWords = ["累", "丧", "废", "空", "麻木", "没劲", "失落", "疲", "不想动"];
  const midLowWords = ["焦虑", "迷茫", "困惑", "纠结", "犹豫", "烦", "不确定", "慌"];
  const highWords = ["想通了", "明白了", "清楚了", "行动", "坚定", "做", "开始", "冲"];

  const msg = message.toLowerCase();
  if (lowWords.some((w) => msg.includes(w))) return "low";
  if (midLowWords.some((w) => msg.includes(w))) return "mid_low";
  if (highWords.some((w) => msg.includes(w))) return "high";
  return "mid_high";
}

/** Check whether we should enter chat mode. */
export function shouldEnterChatMode(message: string): boolean {
  const msg = message.trim();
  if (ENTER_TRIGGERS.some((t) => msg.includes(t))) return true;
  if (EMOTION_KEYWORDS.some((k) => msg.includes(k))) return true;
  return false;
}

/** Check whether we should exit chat mode. */
export function shouldExitChatMode(message: string): boolean {
  return EXIT_TRIGGERS.some((t) => message.trim().includes(t));
}

/**
 * Generate 3 options based on conversation context.
 * Placeholder implementation -- in practice Claude generates these semantically.
 */
function generateOptions(context: string): string[] {
  return [
    `1\uFE0F\u20E3 关于「${context.slice(0, 10)}」，最卡你的是什么`,
    `2\uFE0F\u20E3 你是什么时候开始有这个感觉的`,
    `3\uFE0F\u20E3 如果这个问题解决了，你最想先做什么`,
  ];
}

/** Build a "not A, but B" golden sentence. */
function buildGoldenSentence(oldBelief: string, newInsight: string): string {
  return `不是${oldBelief}，而是${newInsight}`;
}

/** Detect convergence signal -- user is ready to close the deep conversation. */
function checkConvergenceSignal(message: string): boolean {
  return CONVERGENCE_SIGNALS.some((s) => message.trim().includes(s));
}

// -- Tests --
if (import.meta.main) {
  const { test, expect } = await import("bun:test");

  test("detectEmotionLevel returns low for tired words", () => {
    expect(detectEmotionLevel("好累啊")).toBe("low");
  });

  test("shouldEnterChatMode triggers on emotion keywords", () => {
    expect(shouldEnterChatMode("我好累")).toBe(true);
    expect(shouldEnterChatMode("帮我写代码")).toBe(false);
  });

  test("shouldExitChatMode triggers on exit words", () => {
    expect(shouldExitChatMode("回任务")).toBe(true);
  });

  test("buildGoldenSentence formats correctly", () => {
    expect(buildGoldenSentence("懒", "怕白费力气")).toBe("不是懒，而是怕白费力气");
  });

  test("checkConvergenceSignal detects signals", () => {
    expect(checkConvergenceSignal("我想通了")).toBe(true);
    expect(checkConvergenceSignal("继续聊")).toBe(false);
  });
}
