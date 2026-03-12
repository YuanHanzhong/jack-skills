import type { SessionContext } from "../../state-machine/types.ts";
import { THRESHOLDS } from "../../config.ts";

export interface TriggerEvent {
  type:
    | "ANSWER_SCORED"
    | "MODULE_COMPLETE"
    | "MASTERY_REACHED"
    | "AHA_MOMENT";
  payload: Record<string, unknown>;
}

export interface TriggerAction {
  action:
    | "CREATE_WEAKNESS_CARD"
    | "TRIGGER_PACK"
    | "CREATE_EXPRESSION_CARD"
    | "UPGRADE_PRIORITY";
  reason: string;
  data?: Record<string, unknown>;
}

/**
 * Evaluate a trigger event and return zero or more actions to execute.
 */
export function evaluateTrigger(
  ctx: SessionContext,
  event: TriggerEvent
): TriggerAction[] {
  const actions: TriggerAction[] = [];

  switch (event.type) {
    case "ANSWER_SCORED": {
      const score = event.payload["score"] as number | undefined;
      const conceptId = event.payload["conceptId"] as string | undefined;

      if (score !== undefined) {
        const safeScore = Math.max(0, Math.min(1, score));
        if (safeScore < THRESHOLDS.WEAKNESS_SCORE) {
          actions.push({
            action: "CREATE_WEAKNESS_CARD",
            reason: `得分 ${(safeScore * 100).toFixed(0)}% 低于阈值 ${THRESHOLDS.WEAKNESS_SCORE * 100}%，生成薄弱点闪卡`,
            data: { conceptId, score: safeScore, moduleId: ctx.moduleId },
          });
        }
      }
      break;
    }

    case "MODULE_COMPLETE": {
      if (ctx.state === "BACKFILL" || ctx.state === "CARD_GEN") {
        actions.push({
          action: "TRIGGER_PACK",
          reason: `模块 ${ctx.moduleId ?? "unknown"} 测试完成，触发打包`,
          data: { moduleId: ctx.moduleId, cursor: ctx.moduleCursor },
        });
      }
      break;
    }

    case "MASTERY_REACHED": {
      const masteryScore = event.payload["masteryScore"] as number | undefined;
      const domain = event.payload["domain"] as string | undefined;

      if (masteryScore !== undefined) {
        const safeScore = Math.max(0, Math.min(1, masteryScore));
        if (safeScore >= THRESHOLDS.MASTERY_EXPRESSION) {
          actions.push({
            action: "CREATE_EXPRESSION_CARD",
            reason: `掌握度 ${(safeScore * 100).toFixed(0)}% 达到表达阈值，生成表达卡`,
            data: { domain, masteryScore: safeScore, moduleId: ctx.moduleId },
          });
        }
      }
      break;
    }

    case "AHA_MOMENT": {
      const conceptId = event.payload["conceptId"] as string | undefined;
      const currentPriority = event.payload["currentPriority"] as number | undefined;

      if (conceptId !== undefined && currentPriority !== undefined) {
        actions.push({
          action: "UPGRADE_PRIORITY",
          reason: "触发AHA时刻，将相关概念升为高优先级",
          data: {
            conceptId,
            previousPriority: currentPriority,
            newPriority: 1,
            moduleId: ctx.moduleId,
          },
        });
      }
      break;
    }

    default: {
      const _exhaustive: never = event.type;
      console.warn(`[trigger-rules] Unknown event type: ${_exhaustive}`);
    }
  }

  return actions;
}
