import type { SessionState } from "../../state-machine/types.ts";

export interface FlowRule {
  /** Tools explicitly allowed in this state (non-domain tools always pass) */
  allowed: string[];
  /** Tools explicitly denied — takes precedence over allowed */
  denied: string[];
  /** Human-readable note shown in deny reason */
  note?: string;
}

/**
 * Per-state flow rules.
 * States not listed here have no domain-tool restrictions (open by default).
 */
export const FLOW_RULES: Partial<Record<SessionState, FlowRule>> = {
  INGEST: {
    allowed: ["confirm_concept_map", "request_interruption", "sync_notion"],
    denied: ["submit_answer", "trigger_review", "export_mastery_map"],
    note: "INGEST阶段只允许确认概念图，不可提交答案或触发复习",
  },

  MAP_REVIEW: {
    allowed: ["confirm_concept_map", "request_interruption", "sync_notion"],
    denied: ["submit_answer", "trigger_review", "export_mastery_map"],
    note: "MAP_REVIEW阶段正在审阅概念图，不可提交答案",
  },

  AUDIT: {
    allowed: ["confirm_concept_map", "request_interruption", "sync_notion"],
    denied: ["submit_answer", "trigger_review"],
    note: "AUDIT阶段进行质量审查，暂不开放答题",
  },

  TEST: {
    allowed: ["submit_answer", "request_interruption", "check_job_status", "sync_notion"],
    denied: ["confirm_concept_map", "export_mastery_map"],
    note: "TEST阶段允许提交答案，不可修改概念图",
  },

  BACKFILL: {
    allowed: ["submit_answer", "request_interruption", "sync_notion"],
    denied: ["confirm_concept_map", "export_mastery_map"],
    note: "BACKFILL阶段补充薄弱知识点",
  },

  CARD_GEN: {
    allowed: ["check_job_status", "request_interruption", "sync_notion"],
    denied: ["submit_answer", "confirm_concept_map", "export_mastery_map"],
    note: "CARD_GEN阶段正在生成闪卡，请等待完成",
  },

  PACK: {
    allowed: ["check_job_status", "request_interruption", "sync_notion"],
    denied: ["submit_answer", "confirm_concept_map", "export_mastery_map"],
    note: "PACK阶段正在打包本模块成果",
  },

  REVIEW_SCHEDULE: {
    allowed: ["trigger_review", "export_mastery_map", "sync_notion"],
    denied: ["submit_answer", "confirm_concept_map"],
    note: "REVIEW_SCHEDULE阶段安排复习计划",
  },

  DONE: {
    allowed: ["export_mastery_map", "trigger_review", "sync_notion"],
    denied: ["submit_answer", "confirm_concept_map"],
    note: "学习已完成，可导出掌握图或安排复习",
  },

  INTERVIEW_PREP: {
    allowed: ["start_interview_session", "request_interruption"],
    denied: ["submit_answer", "confirm_concept_map", "trigger_review"],
    note: "INTERVIEW_PREP阶段准备面试材料",
  },

  STARL_BUILD: {
    allowed: ["submit_interview_answer", "request_interruption"],
    denied: ["submit_answer", "confirm_concept_map"],
    note: "STARL_BUILD阶段构建STARL故事",
  },

  FEYNMAN_LOOP: {
    allowed: ["submit_interview_answer", "request_interruption"],
    denied: ["submit_answer", "confirm_concept_map"],
    note: "FEYNMAN_LOOP阶段用费曼法深化理解",
  },

  PRESSURE_TEST: {
    allowed: ["submit_interview_answer", "request_interruption"],
    denied: ["submit_answer", "confirm_concept_map"],
    note: "PRESSURE_TEST阶段进行压力测试",
  },

  FINALIZE: {
    allowed: ["export_mastery_map", "sync_notion"],
    denied: ["submit_answer", "submit_interview_answer", "confirm_concept_map"],
    note: "FINALIZE阶段整理面试成果",
  },
};

/**
 * Look up the flow rule for a state.
 * Returns undefined if no rule is defined (open state).
 */
export function getFlowRule(state: SessionState): FlowRule | undefined {
  return FLOW_RULES[state];
}
