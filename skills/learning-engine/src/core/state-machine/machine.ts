import type { SessionContext, SessionState } from "./types.ts";
import { canTransition } from "./transitions.ts";
import { advanceModuleCursor, isAllModulesComplete, getNextState } from "./guards.ts";

export type TransitionResult =
  | { ok: true; ctx: SessionContext }
  | { ok: false; error: string };

/**
 * Attempt to transition `ctx` to `targetState`.
 *
 * Special handling:
 *  - PAUSED → pausedFrom: restores the paused-from state
 *  - PACK → TEST: increments module cursor if more modules remain
 *  - PACK → REVIEW_SCHEDULE: fires when all modules are done
 *
 * Returns a new SessionContext on success (does not mutate input).
 */
export function transition(
  ctx: SessionContext,
  targetState: SessionState
): TransitionResult {
  const from = ctx.state;

  // --- Special case: resuming from PAUSED ---
  if (from === "PAUSED") {
    const resumeTarget = ctx.pausedFrom ?? targetState;
    if (targetState !== resumeTarget) {
      return {
        ok: false,
        error: `Cannot resume to "${targetState}" — session was paused from "${resumeTarget}"`,
      };
    }
    const next: SessionContext = {
      ...ctx,
      state: resumeTarget,
      pausedFrom: undefined,
      phaseScope: _scopeFor(resumeTarget),
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, ctx: next };
  }

  // --- Special case: entering PAUSED ---
  if (targetState === "PAUSED") {
    if (!canTransition(from, "PAUSED")) {
      return { ok: false, error: `State "${from}" cannot transition to PAUSED` };
    }
    const next: SessionContext = {
      ...ctx,
      state: "PAUSED",
      pausedFrom: from,
      updatedAt: new Date().toISOString(),
    };
    return { ok: true, ctx: next };
  }

  // --- Module-loop guard for PACK → next ---
  if (from === "PACK" && (targetState === "TEST" || targetState === "REVIEW_SCHEDULE")) {
    const expectedNext = isAllModulesComplete(ctx) ? "REVIEW_SCHEDULE" : "TEST";
    if (targetState !== expectedNext) {
      return {
        ok: false,
        error: `Module loop guard: expected "${expectedNext}" but got "${targetState}". ` +
               `cursor=${ctx.moduleCursor}, count=${ctx.moduleCount}`,
      };
    }
    let next: SessionContext = {
      ...ctx,
      state: targetState,
      phaseScope: _scopeFor(targetState),
      updatedAt: new Date().toISOString(),
    };
    if (targetState === "TEST") {
      next = advanceModuleCursor(next);
    }
    return { ok: true, ctx: next };
  }

  // --- Standard transition ---
  if (!canTransition(from, targetState)) {
    return {
      ok: false,
      error: `Illegal transition: "${from}" → "${targetState}"`,
    };
  }

  const next: SessionContext = {
    ...ctx,
    state: targetState,
    phaseScope: _scopeFor(targetState),
    updatedAt: new Date().toISOString(),
  };
  return { ok: true, ctx: next };
}

/**
 * Convenience: advance to the automatically determined next state.
 * Uses getNextState() from guards — does not work for PAUSED/FAILED.
 */
export function advance(ctx: SessionContext): TransitionResult {
  try {
    const target = getNextState(ctx, ctx.state);
    return transition(ctx, target);
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _scopeFor(state: SessionState): "MATERIAL" | "MODULE" {
  if (state === "PAUSED" || state === "FAILED") {
    throw new Error(`_scopeFor: "${state}" has no intrinsic scope — preserve ctx.phaseScope instead`);
  }
  const materialStates = new Set<string>(["INGEST", "MAP_REVIEW", "AUDIT", "REVIEW_SCHEDULE", "DONE",
    "INTERVIEW_PREP", "STARL_BUILD", "FEYNMAN_LOOP", "PRESSURE_TEST", "FINALIZE"]);
  return materialStates.has(state) ? "MATERIAL" : "MODULE";
}
