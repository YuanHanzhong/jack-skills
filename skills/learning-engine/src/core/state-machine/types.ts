// Main learning states
export const LEARNING_STATES = [
  "INGEST", "MAP_REVIEW", "AUDIT", "TEST", "BACKFILL",
  "CARD_GEN", "PACK", "REVIEW_SCHEDULE", "DONE", "PAUSED", "FAILED",
  // PENDING variants — async job is running, session is blocked
  "TEST_PENDING", "CARD_GEN_PENDING", "PACK_PENDING",
] as const;
export type LearningState = typeof LEARNING_STATES[number];

// Interview states
export const INTERVIEW_STATES = [
  "INTERVIEW_PREP", "STARL_BUILD", "FEYNMAN_LOOP", "PRESSURE_TEST", "FINALIZE",
] as const;
export type InterviewState = typeof INTERVIEW_STATES[number];

export type SessionState = LearningState | InterviewState;

// Phase scope: MATERIAL = whole material, MODULE = single module iteration
export type PhaseScope = "MATERIAL" | "MODULE";

// Material-level phases (run once per material)
export const MATERIAL_PHASES: LearningState[] = ["INGEST", "MAP_REVIEW", "AUDIT"];

// Module-level phases (run once per module, loop across all modules)
export const MODULE_PHASES: LearningState[] = ["TEST", "BACKFILL", "CARD_GEN", "PACK"];

export interface SessionContext {
  sessionId: string;
  sessionType: "LEARNING" | "INTERVIEW";
  state: SessionState;
  /** The module currently being processed (null during MATERIAL phases) */
  moduleId?: string;
  /** Index into the ordered list of modules for this material */
  moduleCursor?: number;
  /** Total number of modules in this material */
  moduleCount?: number;
  phaseScope: PhaseScope;
  /** State to return to after PAUSED */
  pausedFrom?: SessionState;
  /** ISO timestamp of last state transition */
  updatedAt?: string;
}
