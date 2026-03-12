import type { SessionContext, SessionState } from "./types.ts";

/**
 * Returns true when all modules have completed the TEST→PACK loop.
 */
export function isAllModulesComplete(ctx: SessionContext): boolean {
  if (ctx.moduleCursor === undefined || ctx.moduleCount === undefined) return false;
  // After advancing, cursor would be >= moduleCount
  return ctx.moduleCursor + 1 >= ctx.moduleCount;
}

/**
 * Build a new context with the module cursor advanced by 1.
 * Sets moduleId to undefined (caller should resolve the new module name).
 */
export function advanceModuleCursor(ctx: SessionContext): SessionContext {
  return {
    ...ctx,
    moduleCursor: (ctx.moduleCursor ?? 0) + 1,
    moduleId: undefined,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Determine the next state from the current context, accounting for the
 * module-level sub-loop:
 *
 *   PACK → TEST          (more modules remain)
 *   PACK → REVIEW_SCHEDULE  (all modules done)
 *
 * For all other states the simple linear chain is followed.
 */
export function getNextState(
  ctx: SessionContext,
  currentState: SessionState
): SessionState {
  if (currentState === "PACK") {
    if (isAllModulesComplete(ctx)) {
      return "REVIEW_SCHEDULE";
    }
    return "TEST";
  }

  // Linear chain for remaining states
  const LINEAR_NEXT: Partial<Record<SessionState, SessionState>> = {
    INGEST:           "MAP_REVIEW",
    MAP_REVIEW:       "AUDIT",
    AUDIT:            "TEST",
    TEST:             "BACKFILL",
    BACKFILL:         "CARD_GEN",
    CARD_GEN:         "PACK",
    REVIEW_SCHEDULE:  "DONE",
    // Interview chain
    INTERVIEW_PREP:   "STARL_BUILD",
    STARL_BUILD:      "FEYNMAN_LOOP",
    FEYNMAN_LOOP:     "PRESSURE_TEST",
    PRESSURE_TEST:    "FINALIZE",
    FINALIZE:         "DONE",
    // PENDING → back to parent
    TEST_PENDING:     "TEST",
    CARD_GEN_PENDING: "CARD_GEN",
    PACK_PENDING:     "PACK",
  };

  const next = LINEAR_NEXT[currentState];
  if (!next) {
    throw new Error(`getNextState: no linear successor for state "${currentState}"`);
  }
  return next;
}
