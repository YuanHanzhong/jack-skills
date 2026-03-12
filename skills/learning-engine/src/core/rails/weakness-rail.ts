/**
 * Weakness Rail — tracks identified weaknesses and their resolution lifecycle.
 *
 * The weakness rail answers: "What gaps still need targeted backfill?"
 * It drives the BACKFILL phase and feeds into CARD_GEN for weakness cards.
 *
 * Weakness statuses (in-memory runtime)
 * -----------------
 * IDENTIFIED   → DB: IDENTIFIED
 * IN_BACKFILL  → DB: IDENTIFIED (with evidence noting backfill in progress)
 * RESOLVED     → DB: RESOLVED
 * DEFERRED     → DB: RESOLVED (with evidence="DEFERRED")
 * PROMOTED     → DB: CARD_GENERATED
 *
 * This module is a pure in-memory computation object.
 * Persistence mapping to DB enums is done by rail-service.ts.
 */
import { THRESHOLDS } from "../config.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const WEAKNESS_STATUSES = [
  "IDENTIFIED", "IN_BACKFILL", "RESOLVED", "DEFERRED", "PROMOTED",
] as const;
export type WeaknessStatus = typeof WEAKNESS_STATUSES[number];

export type WeaknessSource =
  | "LOW_SCORE"       // triggered by answer score below threshold
  | "LEARNER_FLAG"    // learner explicitly flagged a gap
  | "INFERENCE"       // inferred from pattern of related errors
  | "INTERRUPT";      // surfaced via an interrupt request

export interface Weakness {
  weaknessId: string;
  conceptId: string;
  conceptLabel: string;
  moduleId: string;
  source: WeaknessSource;
  status: WeaknessStatus;
  /** Score that triggered the weakness identification [0.0 – 1.0] */
  triggerScore?: number;
  /** Number of backfill attempts made */
  backfillAttempts: number;
  /** ISO timestamp when weakness was identified */
  identifiedAt: string;
  /** ISO timestamp of last status change */
  updatedAt: string;
  /** Optional notes added during backfill */
  notes?: string;
}

export interface WeaknessRailState {
  moduleId: string;
  weaknesses: Map<string, Weakness>;
  /** Score above which a weakness is auto-resolved */
  resolutionThreshold: number;
}

export type WeaknessSnapshot = {
  total: number;
  identified: number;
  inBackfill: number;
  resolved: number;
  deferred: number;
  promoted: number;
  resolutionRatio: number; // (resolved + deferred) / total
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWeaknessRail(
  moduleId: string,
  resolutionThreshold = THRESHOLDS.WEAKNESS_RESOLUTION,
): WeaknessRailState {
  return {
    moduleId,
    weaknesses: new Map(),
    resolutionThreshold,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Register a new weakness. No-op if the conceptId already has a non-resolved weakness.
 */
export function identifyWeakness(
  rail: WeaknessRailState,
  conceptId: string,
  conceptLabel: string,
  source: WeaknessSource,
  triggerScore?: number
): WeaknessRailState {
  // Avoid duplicating an active weakness for the same concept
  for (const w of rail.weaknesses.values()) {
    if (
      w.conceptId === conceptId &&
      w.status !== "RESOLVED" &&
      w.status !== "DEFERRED"
    ) {
      return rail; // already tracked
    }
  }

  const id = `${rail.moduleId}::${conceptId}::${Date.now()}`;
  const now = new Date().toISOString();
  const weakness: Weakness = {
    weaknessId: id,
    conceptId,
    conceptLabel,
    moduleId: rail.moduleId,
    source,
    status: "IDENTIFIED",
    triggerScore,
    backfillAttempts: 0,
    identifiedAt: now,
    updatedAt: now,
  };

  const newMap = new Map(rail.weaknesses);
  newMap.set(id, weakness);
  return { ...rail, weaknesses: newMap };
}

/**
 * Start backfilling a specific weakness.
 */
export function startBackfill(
  rail: WeaknessRailState,
  weaknessId: string
): WeaknessRailState {
  return _updateWeakness(rail, weaknessId, (w) => ({
    ...w,
    status: "IN_BACKFILL" as WeaknessStatus,
    backfillAttempts: w.backfillAttempts + 1,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Record a backfill answer score. Auto-resolves if score exceeds threshold.
 */
export function recordBackfillScore(
  rail: WeaknessRailState,
  weaknessId: string,
  score: number,
  notes?: string
): WeaknessRailState {
  const resolved = score >= rail.resolutionThreshold;
  return _updateWeakness(rail, weaknessId, (w) => ({
    ...w,
    status: resolved ? ("RESOLVED" as WeaknessStatus) : ("IN_BACKFILL" as WeaknessStatus),
    triggerScore: score,
    notes: notes ?? w.notes,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Defer a weakness to a later session.
 */
export function deferWeakness(
  rail: WeaknessRailState,
  weaknessId: string
): WeaknessRailState {
  return _updateWeakness(rail, weaknessId, (w) => ({
    ...w,
    status: "DEFERRED" as WeaknessStatus,
    updatedAt: new Date().toISOString(),
  }));
}

/**
 * Mark a weakness as promoted to a CARD_GEN weakness card.
 */
export function promoteToCard(
  rail: WeaknessRailState,
  weaknessId: string
): WeaknessRailState {
  return _updateWeakness(rail, weaknessId, (w) => ({
    ...w,
    status: "PROMOTED" as WeaknessStatus,
    updatedAt: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getWeaknessSnapshot(rail: WeaknessRailState): WeaknessSnapshot {
  let identified = 0, inBackfill = 0, resolved = 0, deferred = 0, promoted = 0;
  for (const w of rail.weaknesses.values()) {
    if (w.status === "IDENTIFIED")  identified++;
    else if (w.status === "IN_BACKFILL") inBackfill++;
    else if (w.status === "RESOLVED")    resolved++;
    else if (w.status === "DEFERRED")    deferred++;
    else if (w.status === "PROMOTED")    promoted++;
  }
  const total = rail.weaknesses.size;
  return {
    total,
    identified,
    inBackfill,
    resolved,
    deferred,
    promoted,
    resolutionRatio: total === 0 ? 0 : (resolved + deferred + promoted) / total,
  };
}

/** Returns true when all weaknesses are resolved, deferred, or promoted. */
export function isWeaknessRailClear(rail: WeaknessRailState): boolean {
  return getWeaknessSnapshot(rail).resolutionRatio >= 0.999;
}

/** Returns weaknesses that still need backfill work. */
export function getActiveWeaknesses(rail: WeaknessRailState): Weakness[] {
  return Array.from(rail.weaknesses.values()).filter(
    (w) => w.status === "IDENTIFIED" || w.status === "IN_BACKFILL"
  );
}

/** Returns weaknesses eligible for card generation (identified, not yet in backfill or promoted). */
export function getPromotionCandidates(rail: WeaknessRailState): Weakness[] {
  return Array.from(rail.weaknesses.values()).filter(
    (w) => w.status === "IDENTIFIED"
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _updateWeakness(
  rail: WeaknessRailState,
  weaknessId: string,
  updater: (w: Weakness) => Weakness
): WeaknessRailState {
  const existing = rail.weaknesses.get(weaknessId);
  if (!existing) {
    throw new Error(`[weakness-rail] Unknown weaknessId: ${weaknessId}`);
  }
  const newMap = new Map(rail.weaknesses);
  newMap.set(weaknessId, updater(existing));
  return { ...rail, weaknesses: newMap };
}
