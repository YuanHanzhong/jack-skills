import type { SessionContext } from "../../state-machine/types.ts";

/**
 * Interrupt types, ordered by scope / urgency.
 *
 * IN_MODULE         — concept is directly related to the current module.
 * CROSS_MODULE      — concept belongs to a different module in the same material.
 * PROJECT_EXPRESSION — insight spans multiple modules / the whole project.
 * UNRELATED         — belongs to a completely different subject.
 */
export const INTERRUPT_TYPES = [
  "IN_MODULE",
  "CROSS_MODULE",
  "PROJECT_EXPRESSION",
  "UNRELATED",
] as const;
export type InterruptType = typeof INTERRUPT_TYPES[number];

export interface InterruptRequest {
  interruptType: InterruptType;
  content: string;
  /** Module ID the interrupt content belongs to (if known) */
  targetModuleId?: string;
  triggeredAt: string;
}

export interface InterruptDecision {
  action: "HANDLE_NOW" | "ADD_TO_PENDING" | "ROUTE_STORY_LINKER" | "PAUSE_AND_NEW_SESSION";
  reason: string;
  /** For HANDLE_NOW: the interrupt is injected directly into the current phase */
  inline?: boolean;
  /** For ADD_TO_PENDING: key used to store in the pending pool */
  pendingKey?: string;
}

/**
 * Decide how to handle an interrupt given the current session context.
 */
export function resolveInterrupt(
  _ctx: SessionContext,
  req: InterruptRequest
): InterruptDecision {
  switch (req.interruptType) {
    case "IN_MODULE":
      return {
        action: "HANDLE_NOW",
        reason: "概念属于当前模块，立即处理不打断主流程",
        inline: true,
      };

    case "CROSS_MODULE":
      return {
        action: "ADD_TO_PENDING",
        reason: `概念属于其他模块（${req.targetModuleId ?? "未知"}），加入待处理池，当前模块完成后处理`,
        pendingKey: `cross_module::${req.targetModuleId ?? "unknown"}::${req.triggeredAt}`,
      };

    case "PROJECT_EXPRESSION":
      return {
        action: "ROUTE_STORY_LINKER",
        reason: "跨模块洞察，转交故事链接器生成表达卡",
      };

    case "UNRELATED":
      return {
        action: "PAUSE_AND_NEW_SESSION",
        reason: "内容与当前学习材料无关，暂停当前会话，建议新开学习会话",
      };

    default: {
      const _exhaustive: never = req.interruptType;
      return {
        action: "ADD_TO_PENDING",
        reason: `未知打断类型: ${_exhaustive}，默认加入待处理池`,
      };
    }
  }
}

// Keywords that suggest project-level or cross-cutting concerns
const PROJECT_KEYWORDS = ["架构", "设计模式", "系统", "整体", "全局", "跨模块", "总结", "反思"];

/**
 * Classify an interrupt request based on heuristics.
 *
 * Uses keyword matching against current module concepts and known patterns.
 * TODO: Replace with NLP / embedding similarity for production accuracy.
 */
export function classifyInterrupt(
  ctx: SessionContext,
  content: string,
  targetModuleId?: string,
  /** Concept names from the current module for keyword matching */
  currentModuleConcepts?: string[],
  /** Concept names from other modules for cross-module detection */
  otherModuleConcepts?: string[],
): InterruptType {
  // If explicit target module is provided, use it
  if (targetModuleId) {
    if (targetModuleId === ctx.moduleId) {
      return "IN_MODULE";
    }
    return "CROSS_MODULE";
  }

  const lowerContent = content.toLowerCase();

  // Check if content mentions concepts from current module
  if (currentModuleConcepts?.some((c) => lowerContent.includes(c.toLowerCase()))) {
    return "IN_MODULE";
  }

  // Check if content mentions concepts from other modules
  if (otherModuleConcepts?.some((c) => lowerContent.includes(c.toLowerCase()))) {
    return "CROSS_MODULE";
  }

  // Check for project-level keywords
  if (PROJECT_KEYWORDS.some((kw) => lowerContent.includes(kw))) {
    const modulePhases = new Set(["TEST", "BACKFILL", "CARD_GEN", "PACK"]);
    return modulePhases.has(ctx.state) ? "PROJECT_EXPRESSION" : "UNRELATED";
  }

  // Default: no module link found → UNRELATED
  return "UNRELATED";
}
