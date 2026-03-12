import type { SessionState } from "./types.ts";

/**
 * Legal transitions map.
 * Key = from state, Value = set of allowed "to" states.
 *
 * Special rules:
 *  - Any state → PAUSED or FAILED
 *  - PAUSED → pausedFrom (handled dynamically in machine.ts, not encoded here)
 *  - Module loop: after PACK, guard logic in guards.ts decides TEST vs REVIEW_SCHEDULE
 */
export const TRANSITIONS: Record<SessionState, Set<SessionState>> = {
  // --- Learning main chain ---
  INGEST:            new Set(["MAP_REVIEW", "PAUSED", "FAILED"]),
  MAP_REVIEW:        new Set(["AUDIT", "PAUSED", "FAILED"]),
  AUDIT:             new Set(["TEST", "PAUSED", "FAILED"]),

  // Module loop states
  TEST:              new Set(["BACKFILL", "TEST_PENDING", "PAUSED", "FAILED"]),
  TEST_PENDING:      new Set(["TEST", "PAUSED", "FAILED"]),
  BACKFILL:          new Set(["CARD_GEN", "PAUSED", "FAILED"]),
  CARD_GEN:          new Set(["PACK", "CARD_GEN_PENDING", "PAUSED", "FAILED"]),
  CARD_GEN_PENDING:  new Set(["CARD_GEN", "PAUSED", "FAILED"]),
  PACK:              new Set(["TEST", "REVIEW_SCHEDULE", "PACK_PENDING", "PAUSED", "FAILED"]),
  PACK_PENDING:      new Set(["PACK", "PAUSED", "FAILED"]),

  // Terminal / cross-cutting states
  REVIEW_SCHEDULE:   new Set(["DONE", "PAUSED", "FAILED"]),
  DONE:              new Set([]),
  PAUSED:            new Set(["INGEST", "MAP_REVIEW", "AUDIT", "TEST", "BACKFILL",
                               "CARD_GEN", "PACK", "REVIEW_SCHEDULE",
                               "INTERVIEW_PREP", "STARL_BUILD", "FEYNMAN_LOOP",
                               "PRESSURE_TEST", "FINALIZE"]),
  FAILED:            new Set([]),

  // --- Interview chain ---
  INTERVIEW_PREP:    new Set(["STARL_BUILD", "PAUSED", "FAILED"]),
  STARL_BUILD:       new Set(["FEYNMAN_LOOP", "PAUSED", "FAILED"]),
  FEYNMAN_LOOP:      new Set(["PRESSURE_TEST", "PAUSED", "FAILED"]),
  PRESSURE_TEST:     new Set(["FINALIZE", "PAUSED", "FAILED"]),
  FINALIZE:          new Set(["DONE"]),
};

/**
 * Returns true if the transition from → to is legally allowed.
 * NOTE: PAUSED → pausedFrom is validated dynamically by machine.ts, not here.
 */
export function canTransition(from: SessionState, to: SessionState): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Returns all states that can be reached from `from`.
 */
export function allowedTargets(from: SessionState): SessionState[] {
  return Array.from(TRANSITIONS[from] ?? []);
}
