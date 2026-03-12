/**
 * Coverage Rail — tracks per-concept coverage status across a module.
 *
 * The coverage rail answers: "Have we tested every concept at least once?"
 * It drives the TEST phase loop and signals when BACKFILL can begin.
 *
 * Coverage statuses (in-memory runtime)
 * -----------------
 * UNTESTED   → DB: NOT_COVERED
 * TESTED     → DB: PARTIALLY_COVERED
 * CONFIRMED  → DB: FULLY_COVERED
 * SKIPPED    → DB: FULLY_COVERED (with evidence="SKIPPED")
 *
 * This module is a pure in-memory computation object.
 * Persistence mapping to DB enums is done by rail-service.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const COVERAGE_STATUSES = ["UNTESTED", "TESTED", "CONFIRMED", "SKIPPED"] as const;
export type CoverageStatus = typeof COVERAGE_STATUSES[number];

export interface ConceptCoverage {
  conceptId: string;
  conceptLabel: string;
  status: CoverageStatus;
  /** Last test score [0.0 – 1.0]; undefined if UNTESTED */
  lastScore?: number;
  /** ISO timestamp of last test event */
  lastTestedAt?: string;
  /** Number of times this concept has been tested */
  attemptCount: number;
}

export interface CoverageRailState {
  moduleId: string;
  concepts: Map<string, ConceptCoverage>;
  /** Threshold above which a concept is marked CONFIRMED */
  confirmationThreshold: number;
}

export type CoverageSnapshot = {
  total: number;
  untested: number;
  tested: number;
  confirmed: number;
  skipped: number;
  coverageRatio: number;   // (tested + confirmed + skipped) / total
  completionRatio: number; // (confirmed + skipped) / total
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCoverageRail(
  moduleId: string,
  conceptIds: string[],
  confirmationThreshold = 0.7,
  conceptLabels?: Map<string, string>,
): CoverageRailState {
  const concepts = new Map<string, ConceptCoverage>();
  for (const id of conceptIds) {
    concepts.set(id, {
      conceptId: id,
      conceptLabel: conceptLabels?.get(id) ?? id,
      status: "UNTESTED",
      attemptCount: 0,
    });
  }
  return { moduleId, concepts, confirmationThreshold };
}

// ---------------------------------------------------------------------------
// Mutations (return new state — do not mutate in place)
// ---------------------------------------------------------------------------

/**
 * Record a test result for a concept. Updates status and attempt count.
 */
export function recordTestResult(
  rail: CoverageRailState,
  conceptId: string,
  score: number
): CoverageRailState {
  const existing = rail.concepts.get(conceptId);
  if (!existing) {
    throw new Error(`[coverage-rail] Unknown concept: ${conceptId}`);
  }

  const newStatus: CoverageStatus =
    score >= rail.confirmationThreshold ? "CONFIRMED" : "TESTED";

  const updated: ConceptCoverage = {
    ...existing,
    status: newStatus,
    lastScore: score,
    lastTestedAt: new Date().toISOString(),
    attemptCount: existing.attemptCount + 1,
  };

  const newConcepts = new Map(rail.concepts);
  newConcepts.set(conceptId, updated);
  return { ...rail, concepts: newConcepts };
}

/**
 * Mark a concept as skipped (already mastered, out of scope, etc.).
 */
export function skipConcept(
  rail: CoverageRailState,
  conceptId: string
): CoverageRailState {
  const existing = rail.concepts.get(conceptId);
  if (!existing) {
    throw new Error(`[coverage-rail] Unknown concept: ${conceptId}`);
  }
  const newConcepts = new Map(rail.concepts);
  newConcepts.set(conceptId, { ...existing, status: "SKIPPED" });
  return { ...rail, concepts: newConcepts };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getSnapshot(rail: CoverageRailState): CoverageSnapshot {
  let untested = 0, tested = 0, confirmed = 0, skipped = 0;
  for (const c of rail.concepts.values()) {
    if (c.status === "UNTESTED")  untested++;
    else if (c.status === "TESTED")    tested++;
    else if (c.status === "CONFIRMED") confirmed++;
    else if (c.status === "SKIPPED")   skipped++;
  }
  const total = rail.concepts.size;
  return {
    total,
    untested,
    tested,
    confirmed,
    skipped,
    coverageRatio: total === 0 ? 0 : (tested + confirmed + skipped) / total,
    completionRatio: total === 0 ? 0 : (confirmed + skipped) / total,
  };
}

/** Returns true when all concepts are CONFIRMED or SKIPPED. */
export function isCoverageComplete(rail: CoverageRailState): boolean {
  return getSnapshot(rail).completionRatio >= 0.999;
}

/** Returns concepts that still need testing. */
export function getUntestedConcepts(rail: CoverageRailState): ConceptCoverage[] {
  return Array.from(rail.concepts.values()).filter((c) => c.status === "UNTESTED");
}

/** Returns concepts tested at least once but not yet confirmed. */
export function getWeakConcepts(rail: CoverageRailState): ConceptCoverage[] {
  return Array.from(rail.concepts.values()).filter(
    (c) => c.status === "TESTED" && (c.lastScore ?? 0) < rail.confirmationThreshold
  );
}
