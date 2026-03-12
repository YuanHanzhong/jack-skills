import type { SessionState } from "../state-machine/types.ts";
import { getFlowRule } from "./rules/flow-rules.ts";
import { checkResourceAccess } from "./rules/resource-rules.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LEARNING_ENGINE_TOOLS = [
  "submit_answer",
  "confirm_concept_map",
  "request_interruption",
  "execute_pending_tasks",
  "start_interview_session",
  "submit_interview_answer",
  "trigger_review",
  "export_mastery_map",
  "check_job_status",
  "sync_notion",
] as const;

export type LearningEngineTool = typeof LEARNING_ENGINE_TOOLS[number];

function isDomainTool(name: string): name is LearningEngineTool {
  return (LEARNING_ENGINE_TOOLS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Decision types
// ---------------------------------------------------------------------------

export type Decision =
  | { decision: "approve" }
  | { decision: "deny"; reason: string }
  | { decision: "trigger"; action: string; data?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Core evaluate function
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a tool call should be allowed given the current session state.
 *
 * Evaluation order:
 *  1. Resource rules (SQLite / path guards) — always run, highest priority
 *  2. Non-domain tools → auto-approve
 *  3. PENDING state gate — only execute_pending_tasks and check_job_status pass
 *  4. Flow rules per state
 *  5. Default approve for domain tools not covered by flow rules
 *
 * @param toolName   Name of the tool being called
 * @param state      Current session state
 * @param hookEvent  The hook event string (e.g. "PreToolCall")
 * @param args       Raw tool call arguments (used for resource checks)
 */
export function evaluate(
  toolName: string,
  state: SessionState,
  hookEvent: string,
  args: Record<string, unknown> = {}
): Decision {
  // 1. Resource rules (always run)
  const resourceCheck = checkResourceAccess(toolName, args);
  if (resourceCheck.violated) {
    return { decision: "deny", reason: resourceCheck.reason };
  }

  // 2. Non-domain tools → always approve
  if (!isDomainTool(toolName)) {
    return { decision: "approve" };
  }

  // 3. PENDING state gate
  if (state.endsWith("_PENDING")) {
    if (toolName === "execute_pending_tasks" || toolName === "check_job_status") {
      return { decision: "approve" };
    }
    return {
      decision: "deny",
      reason: `当前处于${state}状态，异步任务仍在执行中。必须先调用 execute_pending_tasks 或 check_job_status。`,
    };
  }

  // 4. Flow rules
  const rule = getFlowRule(state);
  if (rule) {
    // Explicit deny takes precedence
    if (rule.denied.includes(toolName)) {
      return {
        decision: "deny",
        reason: rule.note
          ? `${rule.note}（被拒工具: ${toolName}）`
          : `工具 "${toolName}" 在 ${state} 状态下不被允许`,
      };
    }
    // Explicit allow
    if (rule.allowed.includes(toolName)) {
      return { decision: "approve" };
    }
    // Tool is a domain tool but not listed — deny as unknown
    return {
      decision: "deny",
      reason: `工具 "${toolName}" 未在 ${state} 状态的允许列表中`,
    };
  }

  // 5. No flow rule for this state → approve domain tool by default
  console.warn(`[policy/engine] 未映射状态 "${state}"，工具 "${toolName}" 默认放行`);
  return { decision: "approve" };
}

// ---------------------------------------------------------------------------
// Batch evaluate (for pre-flight checks on multi-tool calls)
// ---------------------------------------------------------------------------

export interface BatchEvalResult {
  toolName: string;
  decision: Decision;
}

export function evaluateBatch(
  tools: Array<{ name: string; args?: Record<string, unknown> }>,
  state: SessionState,
  hookEvent: string
): BatchEvalResult[] {
  return tools.map((t) => ({
    toolName: t.name,
    decision: evaluate(t.name, state, hookEvent, t.args ?? {}),
  }));
}
