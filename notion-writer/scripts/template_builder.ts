/**
 * template_builder.ts — ADS document skeleton generation + block formatting +
 * consistency checks + To-Do mapping + smart scanning
 *
 * Principle: code handles format/skeleton/checks, Claude handles judgment/content/semantics
 *
 * v2.0 changes:
 * - Removed archive-move code (archive = change status in ADS kanban + filter view)
 * - Added To-Do tree mapping
 * - Added scan rules (read properties only, never page content)
 * - Added note field auto-generation
 * - Added semantic diff report
 * - Added three-way consistency self-check
 * - Consistency check upgraded to 11 rules
 */

import {
  ADS_DATA_SOURCE_ID, DWD_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID, ODS_DATA_SOURCE_ID,
} from "../../_shared/config.ts";

// ========== Constants ==========

export const DB_TITLE_COLUMN_HINT: Record<string, string> = {
  ADS: "当下任务",
  DWD: "手册",
  DWS: "工程实施",
  ODS: "标题",
};

export const DOC_TYPE_LEARNING = "learning";
export const DOC_TYPE_ENGINEERING = "engineering";
export const DOC_TYPE_MANUAL = "manual";

export const DOC_TYPE_META: Record<string, {
  label: string;
  default_target: string;
  description: string;
  signals: string[];
}> = {
  [DOC_TYPE_LEARNING]: {
    label: "📚 学习内化",
    default_target: "ADS",
    description: "长期学习文档，直到焊忠学会为止。焊忠会持续查看、测试、内化。",
    signals: [
      "学习", "理解", "想通", "内化", "矛盾", "价值观", "认知", "思维模式",
      "为什么", "怎么理解", "底层逻辑", "洞察", "反思", "成长",
    ],
  },
  [DOC_TYPE_ENGINEERING]: {
    label: "🔧 工程实践",
    default_target: "DWS",
    description: "实施阶段文档，焊忠用来监控Claude进度。实施完成后自然归档。",
    signals: [
      "优化技能", "修改代码", "创建技能", "重构", "修复", "实现", "部署",
      "自动化", "脚本", "API", "数据库", "配置", "迁移", "工具", "系统",
    ],
  },
  [DOC_TYPE_MANUAL]: {
    label: "📖 手册",
    default_target: "DWD",
    description: "参考手册文档，焊忠查阅用。归入DWD拆解笔记层。",
    signals: ["手册", "参考", "文档", "指南", "教程", "规范", "模板"],
  },
};

export const DOCUMENT_BLOCKS = [
  "📌 焊忠指挥台",
  "❓ 问题",
  "结论 + 行动",
  "📊 进度",
  "🔍 洞察",
  "💡 思维链",
  "🔧 核心铁律",
  "📝 对话进展记录",
  "🎴 闪卡知识点库",
  "⏭️ 断点续传",
  "📄 原始内容",
];

// ========== 1. Requirement classification + gentle reminder ==========

export interface ClassifyResult {
  recommended_type: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  default_target: string;
  label: string;
}

export function classifyRequirement(userMessage: string, context = ""): ClassifyResult {
  const combined = `${userMessage} ${context}`.toLowerCase();

  let learningScore = 0;
  let engineeringScore = 0;
  let manualScore = 0;

  for (const signal of DOC_TYPE_META[DOC_TYPE_LEARNING].signals) {
    if (combined.includes(signal)) learningScore++;
  }
  for (const signal of DOC_TYPE_META[DOC_TYPE_ENGINEERING].signals) {
    if (combined.includes(signal)) engineeringScore++;
  }
  for (const signal of DOC_TYPE_META[DOC_TYPE_MANUAL].signals) {
    if (combined.includes(signal)) manualScore++;
  }

  const scores: Record<string, number> = {
    learning: learningScore,
    engineering: engineeringScore,
    manual: manualScore,
  };

  let recType = Object.entries(scores).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  if (Object.values(scores).every((v) => v === 0)) {
    recType = DOC_TYPE_LEARNING;
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const topScore = scores[recType];
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const secondScore = sortedScores.length > 1 ? sortedScores[1] : 0;

  let confidence: "high" | "medium" | "low";
  if (total === 0) {
    confidence = "low";
  } else if (topScore - secondScore >= 2) {
    confidence = "high";
  } else {
    confidence = "medium";
  }

  const meta = DOC_TYPE_META[recType];
  return {
    recommended_type: recType,
    confidence,
    reason: `学习${learningScore}/工程${engineeringScore}/手册${manualScore}`,
    default_target: meta.default_target,
    label: meta.label,
  };
}

export function buildGentleReminder(
  userChoice: string,
  recommendedType: string,
  confidence: string,
): string {
  const recMeta = DOC_TYPE_META[recommendedType];
  const recTarget = recMeta.default_target;

  if (userChoice === recTarget) return "";
  if (confidence === "low") return "";

  return (
    `💡 温和提醒：这个需求看起来更像 ${recMeta.label}（${recMeta.description.slice(0, 30)}），` +
    `默认建议放${recTarget}。你说放${userChoice}也完全没问题，以你为准。`
  );
}

export function getTargetDbId(docType: string, userOverride?: string): string {
  const overrideMap: Record<string, string> = {
    ADS: ADS_DATA_SOURCE_ID,
    DWS: DWS_DATA_SOURCE_ID,
    DWD: DWD_DATA_SOURCE_ID,
    ODS: ODS_DATA_SOURCE_ID,
  };
  if (userOverride && userOverride in overrideMap) return overrideMap[userOverride];

  const defaultMap: Record<string, string> = {
    [DOC_TYPE_LEARNING]: ADS_DATA_SOURCE_ID,
    [DOC_TYPE_ENGINEERING]: DWS_DATA_SOURCE_ID,
    [DOC_TYPE_MANUAL]: DWD_DATA_SOURCE_ID,
  };
  return defaultMap[docType] ?? ADS_DATA_SOURCE_ID;
}

export function buildDocTypeHeader(docType: string): string {
  const meta = DOC_TYPE_META[docType] ?? DOC_TYPE_META[DOC_TYPE_LEARNING];
  return `> ${meta.label}｜${meta.description}`;
}

// ========== 2. Document skeleton generation ==========

function _cn(n: number): string {
  const chars = "①②③④⑤⑥⑦⑧⑨⑩";
  return n >= 1 && n <= 10 ? chars[n - 1] : `(${n})`;
}

export function buildAdsDocument(opts: {
  topic: string;
  emoji: string;
  question: string;
  timestamp: string;
  conclusion?: string;
  actions?: string[];
  insight?: string;
  roundSummary?: string;
  flashcard?: { name: string; basis: string; clozeDirection?: string; timestamp?: string };
  skeleton?: boolean;
  todoItems?: TodoItem[];
  docType?: string;
}): string {
  let {
    topic, emoji, question, timestamp,
    conclusion = "", actions, insight = "",
    roundSummary = "", flashcard, skeleton = false,
    todoItems, docType = DOC_TYPE_LEARNING,
  } = opts;

  if (skeleton) {
    conclusion = "";
    actions = undefined;
    insight = "";
    roundSummary = roundSummary || "对话开始·骨架创建";
    flashcard = undefined;
  }

  let actionsBlock = "";
  if (actions && actions.length) {
    actionsBlock = actions.map((a, i) => `🔧 ${_cn(i + 1)} ${a}`).join("\n") + "\n";
  } else {
    actionsBlock = "🔧 ① *(待对话推导后填写)*\n";
  }

  let fcBlock = "*(对话产生新知识后自动追加)*\n";
  if (flashcard) {
    fcBlock = buildFlashcardEntry(flashcard);
  }

  let progressBlock = `✅ ${timestamp} 建档：「${topic}」ADS任务创建\n`;
  if (todoItems && todoItems.length) {
    progressBlock += buildProgressFromTodos(todoItems, timestamp);
  } else {
    progressBlock += "⏳ 待完成：*(指挥台To-Do映射后自动填充)*";
  }

  return `${buildDocTypeHeader(docType)}
# 📌 焊忠指挥台（只有焊忠修改·Claude不可动）
> ⚠️ 此区域**只有焊忠本人修改**，Claude不得改动任何内容
> 📌 Claude的所有策略、洞察、建议，均以此区域内容为**【最高标准】**
> 📌 焊忠在Notion中修改此区域 = 对Claude的指令，读到就执行
## 🎯 目标
*(焊忠填写)*
## ⚖️ 策略
*(焊忠填写)*
## ✅ 焊忠 To-Do
- [ ] *(焊忠手动维护)*
---
# ❓ 问题
${question}
---
## 结论（${timestamp} 更新）
🎯 ${conclusion || "*(待对话推导后填写)*"}

## 行动（下一步）
${actionsBlock}
---
# 📊 进度
${progressBlock}
---
# 🔍 洞察（Claude客观观察）
🔍 ${insight || "*(对话深入后Claude观察填写)*"}
---
# 💡 思维链（一步步怎么推到结论的）
## 第一阶段（${timestamp}起）
📌 ${timestamp} Round-1 开始
---
# 🔧 核心铁律（${topic}核心基因）
🔧 *(待确立——对话中产生共识后写入)*
---
# 📝 对话进展记录（只追加不删除）
📌 ${timestamp} Round-1：${roundSummary || "对话开始"}
---
# 🎴 闪卡知识点库（Claude维护·出题依据）
> 📌 此区域是learning-engine出题的**【数据基础】**
> 📌 格式：知识点名 | 掌握度 | 上次测试 | 连续答对 | 级别 + 挖词依据

### L1·概念理解
${fcBlock}
### L2·多角度应用
*(对话深入后从L1提炼)*

### L3·生活场景活用
*(L1/L2测试通过后提炼)*
---
# ⏭️ 下次启动点 + 断点续传（新对话读此处即可接上）
> 📌 新对话只需fetch本文档，读此区域+焊忠指挥台，即可无缝接续

## 当前状态快照 v1（${timestamp}）
> 🚀 新对话启动：①读最新断点快照 ②读指挥台 ③执行「下次第一步」
📌 **【阶段】**：对话启动·探索阶段
📌 **【已完成】**：
> 文档创建 [${timestamp}]
📌 **【进行中】**：
> 对话探索中
📌 **【下次第一步】**：
> 继续当前对话
📌 **【关键上下文】**：
> ${conclusion || "待对话推导"}
📌 **【To-Do映射】**：
> *(指挥台To-Do检测后自动填充)*
📌 **【关键资源ID】**：
> ADS文档：*(创建后回填)*
---
# 📎 来源信息
> 来源对话：*(自动填充)*
> 来源ODS：*(如有)*
> ODS链接：*(如有)*
> 关联技能：requirement-tracker
---
# 📄 原始内容（粘贴区·只追加不改）
> 📌 焊忠粘贴的原文/截图/原始资料放此区域，Claude不修改，只读取
*(暂无原始内容)*`;
}

// ========== 2. Block append functions ==========

export function buildProgressEntry(timestamp: string, roundNum: number, summary: string): string {
  return `📌 ${timestamp} Round-${roundNum}：${summary}`;
}

export interface ProgressItem {
  text: string;
  done?: boolean;
  timestamp?: string;
  indent?: number;
  auto?: boolean;
  progress_note?: string;
}

export function buildProgressTimeline(items: ProgressItem[]): string {
  const lines: string[] = [];
  for (const item of items) {
    const icon = item.done ? "✅" : "⏳";
    let ts = item.timestamp ?? "";
    if (!ts) ts = "[时间未知]";
    const tsStr = ts ? `${ts} ` : "";
    const indent = "  ".repeat(item.indent ?? 0);
    const tag = item.auto ? " [auto]" : "";
    const progressNote = item.progress_note ? ` [${item.progress_note}]` : "";
    lines.push(`${indent}${icon} ${tsStr}${item.text}${tag}${progressNote}`);
  }
  return lines.length ? lines.join("\n") : "*(暂无进度记录)*";
}

export function buildAlignmentNote(
  timestamp: string,
  directiveSummary: string,
  changes?: string[],
): string {
  if (changes && changes.length) {
    const changeStr = changes.join("；");
    return `📌 ${timestamp} 对齐指挥台：${directiveSummary} → 变更：${changeStr}`;
  }
  return `📌 ${timestamp} 对齐指挥台：${directiveSummary} → 无需变更`;
}

export function buildThoughtChainEntry(
  timestamp: string,
  speaker: string,
  content: string,
  discovery?: string,
  discoveryKeyword?: string,
): string {
  const emoji = speaker === "焊忠" ? "🗣️" : "🧠";
  let entry = `📌 ${timestamp} ${emoji} ${speaker}：${content}`;
  if (discovery && discoveryKeyword) {
    entry += `\n> 💡 **【${discoveryKeyword}】**：${discovery}`;
  }
  return entry;
}

export function buildFlashcardEntry(opts: {
  name: string;
  basis: string;
  clozeDirection?: string;
  level?: string;
  timestamp?: string;
}): string {
  const { name, basis, clozeDirection = "", level = "L1", timestamp = "" } = opts;
  const tsStr = timestamp ? ` [发现于${timestamp}]` : "";
  let entry = `📌 **【${name}】** | \`未测试\` | - | 0 | ${level}\n`;
  entry += `> > 💡 挖词依据：${basis}`;
  if (clozeDirection) entry += `。挖空方向：${clozeDirection}`;
  entry += tsStr;
  return entry;
}

export function buildBreakpoint(opts: {
  timestamp: string;
  stage: string;
  completed: string[];
  inProgress: string[];
  nextStep: string;
  keyContext: string[];
  todoMapping?: string[];
  resourceIds?: Record<string, string>;
  version?: number;
  docType?: string;
}): string {
  const {
    timestamp, stage, completed, inProgress, nextStep, keyContext,
    todoMapping, resourceIds, version = 1, docType = DOC_TYPE_LEARNING,
  } = opts;

  const comp = completed.length ? completed.map((x) => `> ${x}`).join("\n") : "> 无";
  const prog = inProgress.length ? inProgress.map((x) => `> ${x}`).join("\n") : "> 无";
  const ctx = keyContext.length ? keyContext.map((x) => `> 💡 ${x}`).join("\n") : "> 待补充";

  let todoStr = "📌 **【To-Do映射】**：\n";
  if (todoMapping && todoMapping.length) {
    todoStr += todoMapping.map((t) => `> ${t}`).join("\n");
  } else {
    todoStr += "> *(指挥台To-Do检测后自动填充)*";
  }

  let res = "";
  if (resourceIds) {
    res = "📌 **【关键资源ID】**：\n";
    res += Object.entries(resourceIds).map(([k, v]) => `> ${k}：${v}`).join("\n");
  }

  let engExtra = "";
  if (docType === DOC_TYPE_ENGINEERING) {
    const totalSteps = completed.length + inProgress.length;
    const doneSteps = completed.length;
    const pct = totalSteps > 0 ? Math.floor((doneSteps / totalSteps) * 100) : 0;
    engExtra = `📌 **【完成度】**：${doneSteps}/${totalSteps}（${pct}%）\n`;
  }

  let learnExtra = "";
  if (docType === DOC_TYPE_LEARNING) {
    learnExtra = "📌 **【认知阶段】**：*(对话推进后自动填充)*\n";
  }

  return `## 当前状态快照 v${version}（${timestamp}）
> 🚀 新对话启动：①读最新断点快照 ②读指挥台 ③执行「下次第一步」
📌 **【阶段】**：${stage}
${engExtra}${learnExtra}📌 **【已完成】**：
${comp}
📌 **【进行中】**：
${prog}
📌 **【下次第一步】**：
> ${nextStep}
📌 **【关键上下文】**：
${ctx}
${todoStr}
${res}`;
}

// ========== 3. To-Do tree mapping ==========

export interface TodoItem {
  text: string;
  checked: boolean;
  indent: number;
}

export function parseCommandCenterTodos(docContent: string): TodoItem[] {
  const todos: TodoItem[] = [];

  const todoMatch = docContent.match(
    /## ✅ 焊忠 To-Do\s*\n([\s\S]*?)(?=\n---|\n# |\Z)/,
  );
  if (!todoMatch) return todos;

  const todoBlock = todoMatch[1];

  for (const line of todoBlock.trim().split("\n")) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) continue;
    if (trimmedLine.includes("*(焊忠手动维护)*")) continue;
    if (trimmedLine.trimStart().startsWith("<!--")) continue;

    const stripped = trimmedLine.trimStart();
    const leading = trimmedLine.length - stripped.length;
    const indent = Math.floor(leading / 2);

    const checkedMatch = stripped.match(/^- \[([ xX])\] (.*)/);
    if (checkedMatch) {
      todos.push({
        text: checkedMatch[2].trim(),
        checked: checkedMatch[1].toLowerCase() === "x",
        indent,
      });
    }
  }

  return todos;
}

export interface TodoChanges {
  added: TodoItem[];
  removed: TodoItem[];
  checked: TodoItem[];
  unchecked: TodoItem[];
  unchanged: TodoItem[];
  has_changes: boolean;
}

export function detectTodoChanges(oldTodos: TodoItem[], newTodos: TodoItem[]): TodoChanges {
  const oldMap = new Map(oldTodos.map((t) => [t.text, t]));
  const newMap = new Map(newTodos.map((t) => [t.text, t]));

  const oldTexts = new Set(oldMap.keys());
  const newTexts = new Set(newMap.keys());

  const added: TodoItem[] = [];
  const removed: TodoItem[] = [];
  const checked: TodoItem[] = [];
  const unchecked: TodoItem[] = [];
  const unchanged: TodoItem[] = [];

  for (const t of newTexts) {
    if (!oldTexts.has(t)) {
      const item = newMap.get(t);
      if (item) added.push(item);
    }
  }
  for (const t of oldTexts) {
    if (!newTexts.has(t)) {
      const item = oldMap.get(t);
      if (item) removed.push(item);
    }
  }

  for (const t of oldTexts) {
    if (!newTexts.has(t)) continue;
    const oldItem = oldMap.get(t);
    const newItem = newMap.get(t);
    if (!oldItem || !newItem) continue;
    if (!oldItem.checked && newItem.checked) checked.push(newItem);
    else if (oldItem.checked && !newItem.checked) unchecked.push(newItem);
    else unchanged.push(newItem);
  }

  return {
    added,
    removed,
    checked,
    unchecked,
    unchanged,
    has_changes: !!(added.length || removed.length || checked.length || unchecked.length),
  };
}

export function buildProgressFromTodos(
  todos: TodoItem[],
  timestamp: string,
  autoLeaves?: Record<string, string[]>,
): string {
  if (!todos.length) return "⏳ 待完成：*(指挥台To-Do映射后自动填充)*";

  const leaves = autoLeaves ?? {};
  const lines: string[] = [];

  for (const todo of todos) {
    const icon = todo.checked ? "✅" : "⏳";
    const indent = "  ".repeat(todo.indent);
    const tsMark = todo.checked ? ` [${timestamp}]` : "";
    lines.push(`${indent}${icon} ${todo.text}${tsMark}`);

    if (todo.text in leaves && !todo.checked) {
      const leafIndent = "  ".repeat(todo.indent + 1);
      for (const leaf of leaves[todo.text]) {
        lines.push(`${leafIndent}⏳ ${leaf} [auto]`);
      }
    }
  }

  return lines.join("\n");
}

export function buildTodoMappingSnapshot(todos: TodoItem[]): string[] {
  return todos.map((todo) => {
    const status = todo.checked ? "✅" : "⏳";
    const indentMark = "  ".repeat(todo.indent);
    return `${indentMark}${todo.text} → ${status}`;
  });
}

// ========== 4. Smart scanning (read properties only, never content) ==========

export function describeScanDbOnly(): string {
  return `
【数据库扫描流程·只读属性】
Step 1: ads_db = notion_fetch(ADS_DATA_SOURCE_ID)  # 获取数据库级别信息
Step 2: 从返回结果中提取所有页面的属性字段：
         - 标题（任务名称）
         - 状态（🔵进行中 / 📦归档 / 🟢已完成 / ...）
         - 优先级
         - 备注（⚠️ 这是唯一可见摘要，必须写好）
         - 最后编辑时间
Step 3: 按需筛选
Step 4: 输出列表给焊忠，等焊忠说「读XXX」才fetch页面内容

⛔ 禁止在扫描阶段fetch任何页面的content
⛔ 备注字段是扫描时唯一的文档摘要
`;
}

export interface ScanPage {
  title: string;
  status: string;
  priority?: string;
  note?: string;
  last_edited?: string;
}

export function scanDbResultsToTable(pages: ScanPage[]): string {
  if (!pages.length) return "*(未找到匹配的文档)*";

  return pages
    .map((p, i) => {
      const priStr = p.priority ? ` [${p.priority}]` : "";
      const noteStr = p.note ? ` — ${p.note}` : "";
      return `${i + 1}. ${p.status}${priStr} ${p.title}${noteStr}`;
    })
    .join("\n");
}

// ========== 5. Note field ==========

export function buildNoteField(
  stage: string,
  conclusion = "",
  recent = "",
  nextStep = "",
): string {
  const parts = [`[${stage}]`];
  if (conclusion) parts.push(conclusion.slice(0, 40));
  if (recent) parts.push(`| ${recent.slice(0, 30)}`);
  if (nextStep) parts.push(`| 下一步：${nextStep.slice(0, 20)}`);

  let result = parts.join(" ");
  if (result.length > 100) result = result.slice(0, 97) + "...";
  return result;
}

// ========== 6. Semantic diff report ==========

export interface DiffCheck {
  pair: string;
  status: string;
  icon: string;
}

export function buildSemanticDiffReport(timestamp: string, checks: DiffCheck[]): string {
  const lines = [`📌 ${timestamp} 语义对齐检查：`];
  for (const c of checks) {
    lines.push(`  ${c.icon} ${c.pair}：${c.status}`);
  }

  const allOk = checks.every((c) => c.icon === "✅");
  if (allOk) {
    lines.push("  → 全部一致 ✅");
  } else {
    const warnCount = checks.filter((c) => c.icon !== "✅").length;
    lines.push(`  → ${warnCount}项需关注`);
  }

  return lines.join("\n");
}

// ========== 7. Consistency check (11 rules) ==========

export const CONSISTENCY_PAIRS: [string, string, string][] = [
  ["结论", "行动", "结论变→行动必须同步变"],
  ["结论", "断点续传·关键上下文", "结论变→上下文必须一致"],
  ["结论", "备注字段", "结论变→备注必须同步更新"],
  ["洞察", "闪卡知识点", "新洞察→评估是否新增L1"],
  ["思维链·💡新发现", "闪卡知识点", "新发现→评估是否记为知识点"],
  ["思维链·💡新发现", "进展记录", "新发现→追加进展一行"],
  ["进展记录", "断点续传", "进展变→断点同步更新"],
  ["📊进度", "断点续传", "进度变→断点同步更新"],
  ["指挥台To-Do", "📊进度", "To-Do变→进度必须同步映射"],
  ["ADS状态字段", "📊进度", "状态变→进度反映"],
  ["指挥台目标", "所有区块", "指挥台=最高标准，所有内容朝此对齐"],
  ["分类字段", "所在库", "分类与所在库必须匹配（手册→DWD/优化工具→DWS/个人成长→ADS）"],
];

export function getConsistencyChecklist(): string {
  const lines = ["□ 一致性检查（每次写入前逐项过）："];
  for (const [src, tgt, rule] of CONSISTENCY_PAIRS) {
    lines.push(`  □ ${src} ←→ ${tgt}：${rule}`);
  }
  return lines.join("\n");
}

// ========== 8. Placeholder scanning ==========

export const PLACEHOLDER_MARKERS: [string, string, string][] = [
  ["结论", "*(待对话推导后填写)*", "结论区"],
  ["行动", "*(待对话推导后填写)*", "行动区"],
  ["洞察", "*(对话深入后Claude观察填写)*", "洞察区"],
  ["核心铁律", "*(待确立——对话中产生共识后写入)*", "核心铁律区"],
  ["闪卡L1", "*(对话产生新知识后自动追加)*", "闪卡L1区"],
];

export function scanPlaceholders(docContent: string): {
  unfilled: string[];
  filled_pct: number;
  summary: string;
} {
  const total = PLACEHOLDER_MARKERS.length;
  const unfilled: string[] = [];
  for (const [, marker, label] of PLACEHOLDER_MARKERS) {
    if (docContent.includes(marker)) unfilled.push(label);
  }
  const filled = total - unfilled.length;
  const pct = total > 0 ? Math.floor((filled / total) * 100) : 100;
  return {
    unfilled,
    filled_pct: pct,
    summary: `${filled}/${total}区块已填充（${pct}%）`,
  };
}

// ========== 9. Pre-write validation ==========

export function validateBeforeWrite(content: string): { pass: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(content) && content.length > 100) {
    issues.push("⚠️ 未检测到完整时间戳 YYYY-MM-DD HH:MM");
  }

  const badBolds = content.match(/\*\*(?!【)[^*]{2,30}(?<!】)\*\*/g) ?? [];
  for (const b of badBolds.slice(0, 3)) {
    if (!b.includes("焊忠") && !b.includes("填写") && !b.includes("数据基础") && !b.includes("最高标准")) {
      issues.push(`⚠️ 单独加粗 ${b}，应用 **【关键词】**`);
    }
  }

  if (content.includes("待填充") || content.includes("[占位符]")) {
    issues.push("⚠️ 仍有占位符未填写");
  }

  // 📊 progress section timestamp check
  const progressMatch = content.match(/# 📊 进度[\s\S]*?(?=\n# )/);
  if (progressMatch) {
    const progressLines = progressMatch[0].trim().split("\n");
    for (const line of progressLines) {
      const trimmed = line.trim();
      if (trimmed && (trimmed.startsWith("✅") || trimmed.startsWith("⏳") || trimmed.startsWith("🔵"))) {
        if (!/\d{4}-\d{2}-\d{2}/.test(trimmed) && !trimmed.includes("[时间未知]")) {
          issues.push(`⚠️ 进度行缺少时间戳：${trimmed.slice(0, 40)}...`);
        }
      }
    }
  }

  // Breakpoint version number check
  if (content.includes("当前状态快照") && !/当前状态快照 v\d+/.test(content)) {
    issues.push("⚠️ 断点快照缺少版本号（应为 v1/v2/v3...）");
  }

  return { pass: !issues.some((i) => i.startsWith("⛔")), issues };
}

// ========== 10. Command center check ==========

export function checkCommandCenter(docContent: string): {
  filled: boolean;
  empty_parts: string[];
  prompt: string;
} {
  let hasGoal = true;
  let hasStrategy = true;

  if (docContent.includes("## 🎯 目标")) {
    const goalSection = docContent.split("## 🎯 目标")[1].split("##")[0];
    if (goalSection.includes("*(焊忠填写)*")) hasGoal = false;
  }

  if (docContent.includes("## ⚖️ 策略")) {
    const strategySection = docContent.split("## ⚖️ 策略")[1].split("##")[0];
    if (strategySection.includes("*(焊忠填写)*")) hasStrategy = false;
  }

  const emptyParts: string[] = [];
  if (!hasGoal) emptyParts.push("目标");
  if (!hasStrategy) emptyParts.push("策略");

  return {
    filled: emptyParts.length === 0,
    empty_parts: emptyParts,
    prompt: emptyParts.length
      ? `指挥台的${emptyParts.join("和")}还是空的，你想先定一下吗？`
      : "",
  };
}

// ========== 11. Schema dynamic detection ==========

export function parseSchemaFromState(
  dataSourceState: Record<string, Record<string, unknown>>,
): { properties: Record<string, unknown>; property_names: string[] } {
  const properties: Record<string, unknown> = {};
  for (const [propName, propInfo] of Object.entries(dataSourceState)) {
    const entry: Record<string, unknown> = { type: (propInfo.type as string) ?? "text" };
    if (propInfo.options) {
      entry.options = (propInfo.options as Array<{ name: string; color?: string }>).map((opt) => ({
        name: opt.name,
        color: opt.color ?? "default",
      }));
    }
    if (propInfo.description) {
      entry.description = propInfo.description;
    }
    properties[propName] = entry;
  }
  return { properties, property_names: Object.keys(properties) };
}

export function getCurrentOptions(
  schema: { properties: Record<string, { options?: Array<{ name: string; color?: string }> }> },
  propertyName: string,
): Array<{ name: string; color?: string }> {
  return schema.properties[propertyName]?.options ?? [];
}

export function getOptionNames(
  schema: { properties: Record<string, { options?: Array<{ name: string }> }> },
  propertyName: string,
): string[] {
  return getCurrentOptions(schema, propertyName).map((opt) => opt.name);
}

// ========== 12. Post-write alignment flow ==========

export function describePostWriteAlignment(): string {
  return `
【每次写入后触发对齐 - 执行流程】
Step 1: 重新 fetch 当前 ADS 文档
Step 2: 读取「# 📌 焊忠指挥台」区域：目标 / 策略 / 焊忠 To-Do
Step 3: 解析To-Do → detectTodoChanges(old, new) → 有变化则更新📊进度
Step 4: 读取「📊 进度」最新条目 + 「## 行动」区块
Step 5: Claude判断：指挥台内容 vs 当前进度/行动 是否一致？
    - 一致 → buildSemanticDiffReport(全部✅)
    - 有出入 → 告知焊忠后更新相关区块
Step 6: 更新备注字段 → buildNoteField()
Step 7: 将对齐记录追加到「📊 进度」末尾
⛔ 对齐不修改焊忠指挥台，只读取
⛔ 对齐发现结论/行动需要调整 → 必须先告知焊忠获同意再改
`;
}

// ========== 13. Write result report ==========

export function buildWriteReport(
  operation: string,
  target: string,
  success: boolean,
  detail = "",
  timestamp = "",
): string {
  const icon = success ? "✅" : "❌";
  const status = success ? "成功" : "失败";
  let line = `${icon} ${operation} ${status}：${target}`;
  if (detail) line += `（${detail}）`;
  if (timestamp) line += ` [${timestamp}]`;
  return line;
}

// ========== 14. Three-way consistency self-check ==========

export function selfCheckSkillConsistency(): {
  pass: boolean;
  expected: string[];
  actual: string[];
  missing: string[];
  extra: string[];
} {
  const testDoc = buildAdsDocument({
    topic: "自检测试",
    emoji: "🧪",
    question: "自检",
    timestamp: "2026-01-01 00:00",
    skeleton: true,
  });

  const blockMarkers: Record<string, string> = {
    "📌 焊忠指挥台": "📌 焊忠指挥台",
    "❓ 问题": "❓ 问题",
    "结论": "结论 + 行动",
    "📊 进度": "📊 进度",
    "🔍 洞察": "🔍 洞察",
    "💡 思维链": "💡 思维链",
    "🔧 核心铁律": "🔧 核心铁律",
    "📝 对话进展记录": "📝 对话进展记录",
    "🎴 闪卡知识点库": "🎴 闪卡知识点库",
    "⏭️ 下次启动点": "⏭️ 断点续传",
    "📄 原始内容": "📄 原始内容",
  };

  const actualBlocks: string[] = [];
  for (const [marker, blockName] of Object.entries(blockMarkers)) {
    if (testDoc.includes(marker)) actualBlocks.push(blockName);
  }

  const expected = new Set(DOCUMENT_BLOCKS);
  const actual = new Set(actualBlocks);

  const missing = [...expected].filter((x) => !actual.has(x));
  const extra = [...actual].filter((x) => !expected.has(x));

  return {
    pass: missing.length === 0 && extra.length === 0,
    expected: DOCUMENT_BLOCKS,
    actual: actualBlocks,
    missing,
    extra,
  };
}
