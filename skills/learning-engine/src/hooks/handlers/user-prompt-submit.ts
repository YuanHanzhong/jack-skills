/**
 * user-prompt-submit.ts — UserPromptSubmit Hook Handler
 * - Identify input type and route
 * - Attach state context to prompt
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");
const PANORAMA_FLAG = resolve(process.cwd(), ".learning-engine/state/panorama-active");

interface PromptInput {
  prompt: string;
}

// ── Panorama mode detection ───────────────────────────────────────────────
// Detect panoramic view intent BEFORE DB lookup so it works even without an
// active learning session. This injects a reading protocol reminder into the
// prompt so Claude always reads the full material before outputting.

const PANORAMA_PATTERNS = [/全景图/, /给我全景图/, /生成全景图/, /画全景图/, /知识地图/, /总览/];

function detectPanoramaIntent(text: string): boolean {
  return PANORAMA_PATTERNS.some((p) => p.test(text));
}

const PANORAMA_REMINDER = `
[BLOCKING RULE — 全景图模式·执行前必读]
你检测到用户请求全景图。在执行任何操作之前，必须严格按以下顺序执行。
违反顺序（如先 Read 文件）= 严重错误，会导致上下文爆炸。

STEP 1 [绝对禁止直接 Read 文件]
FORBIDDEN: 看到文件路径就 Read
FORBIDDEN: 主 Agent 自己读取任何大文件内容
FORBIDDEN: 先读一部分再决定策略
REQUIRED: 唯一正确的第一步是用 Bash 获取文件行数

STEP 2 [只用 Bash 获取文件大小，不用 Read]
对每个文件执行：Bash(wc -l "文件路径") 和 Bash(grep -n "^#" "文件路径")  // 匹配所有级别标题（#/##/###）
这会告诉你总行数和章节位置，不消耗上下文。

STEP 3 [按文件大小分流]
小文件（300行以下）：主 Agent 直接 Read + buildPanoramaPrompt(text) 输出全景图
大文件（300行以上）：必须拆成多个 SubAgent，每个 SubAgent 只负责一个章节（不超过500行）

STEP 4 [大文件：拆分成多个 SubAgent]
根据 grep 结果决定拆分方式：
  A) 有标题 → 按标题位置切分（间隔<50行的相邻标题合并为同一段）
  B) 无标题（纯文本/对话记录）→ 按每500行均分

示例A（有标题，1629行，标题在 1/365/672/1069）：
  - SubAgent A: 行 1-364
  - SubAgent B: 行 365-671
  - SubAgent C: 行 672-1068
  - SubAgent D: 行 1069-1629

示例B（无标题，1200行纯文本）：
  - SubAgent A: 行 1-500
  - SubAgent B: 行 501-1000
  - SubAgent C: 行 1001-1200

每个 SubAgent 的 prompt 必须包含：
  "读取文件 {path} 的第 {start} 到 {end} 行（用 Read 工具，offset={start}, limit={end-start}）。
   按主题语义切块，每块输出 JSON：[{ theme, level, surface, intent, apply, key_terms }]。
   只返回 JSON 数组，不返回原文。"

用 Task 工具并行启动所有 SubAgent（subagent_type="general-purpose", model="haiku"）。

STEP 5 [合并输出]
收到所有 SubAgent 的 JSON 后，主 Agent 合并去重，渲染全景图：
核心主旨 + 各主题块（表层 + 意图 + 应用 + L级别）+ 学习路径 + 知识密度统计

[多文件] 分别对每个文件拆分，所有 SubAgent 在同一消息中并行启动。
`.trim();

export async function handleUserPromptSubmit(input: PromptInput): Promise<{ result: string }> {
  const prompt = input.prompt || "";

  // Inject panorama protocol reminder before any other processing
  if (detectPanoramaIntent(prompt)) {
    const baseResult = prompt;
    // Still check DB for session context below, but guarantee the reminder is prepended
    if (!existsSync(DB_PATH)) {
      return { result: `${PANORAMA_REMINDER}\n\n${baseResult}` };
    }
    // Fall through to DB lookup, will prepend reminder at the end
  }

  // If no DB, pass through
  if (!existsSync(DB_PATH)) {
    return { result: prompt };
  }

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH, { readonly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    const session = sqlite
      .query(
        `SELECT id, status, session_type, current_module_id, module_cursor, current_phase_scope
         FROM sessions WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as any;

    if (!session) {
      return { result: prompt };
    }

    // Build context prefix
    const ctx: string[] = [];
    ctx.push(`[学习引擎上下文] 状态=${session.status} | 类型=${session.session_type}`);

    if (session.current_module_id) {
      const mod = sqlite
        .query("SELECT title FROM modules WHERE id = ?")
        .get(session.current_module_id) as { title: string | null } | null;
      if (mod) ctx.push(`模块=${mod.title ?? "(未命名)"}`);
    }

    // State-specific guidance (covers all 20 states)
    const STATE_GUIDANCE: Record<string, string> = {
      INGEST: "当前阶段：材料录入中。请提交学习材料。",
      MAP_REVIEW: "当前阶段：概念图审核中。请使用 confirm_concept_map 确认概念结构。",
      AUDIT: "当前阶段：覆盖审计中。系统正在分析材料覆盖度。",
      TEST: "当前阶段：测试中。用户输入应通过 submit_answer 工具处理。",
      BACKFILL: "当前阶段：薄弱点回填中。针对未掌握概念进行强化。",
      CARD_GEN: "当前阶段：闪卡生成中。系统正在生成复习闪卡。",
      PACK: "当前阶段：打包中。正在汇总模块闪卡。",
      REVIEW_SCHEDULE: "当前阶段：复习排期中。正在安排复习计划。",
      DONE: "会话已完成。",
      PAUSED: "会话已暂停。说「继续」恢复学习。",
      FAILED: "会话异常终止。请检查错误日志或开启新会话。",
      TEST_PENDING: "当前阶段：等待测试任务完成。请使用 check_job_status 检查。",
      CARD_GEN_PENDING: "当前阶段：等待闪卡生成完成。请使用 check_job_status 检查。",
      PACK_PENDING: "当前阶段：等待打包完成。请使用 check_job_status 检查。",
      INTERVIEW_PREP: "当前阶段：面试准备中。请提供项目经历或技术领域。",
      STARL_BUILD: "当前阶段：STARL 构建中。请描述项目经历的具体情境。",
      FEYNMAN_LOOP: "当前阶段：费曼循环中。请用自己的话解释概念。",
      PRESSURE_TEST: "当前阶段：压力测试中。使用 submit_interview_answer 回答。",
      FINALIZE: "当前阶段：收尾中。正在整理面试包。",
    };

    const guidance = STATE_GUIDANCE[session.status ?? ""];
    if (guidance) {
      ctx.push(guidance);
    }

    const prefix = ctx.join(" | ");
    const baseResult = `${prefix}\n\n${prompt}`;
    // Prepend panorama reminder if needed
    if (detectPanoramaIntent(prompt)) {
      return { result: `${PANORAMA_REMINDER}\n\n${baseResult}` };
    }
    return { result: baseResult };
  } finally {
    sqlite.close();
  }
}
