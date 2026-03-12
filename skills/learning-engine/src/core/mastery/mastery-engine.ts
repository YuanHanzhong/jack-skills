/**
 * Mastery calculation engine.
 *
 * Computes a composite mastery score across 5 cognitive dimensions,
 * weighted differently per data warehouse tier (DWD / DWS / ADS).
 *
 * Dimensions
 * ----------
 * RECALL       — can the learner retrieve the fact from memory?
 * UNDERSTANDING — can they explain it in their own words?
 * APPLICATION  — can they apply it to novel problems?
 * EXPRESSION   — can they articulate it clearly to others?
 * INSIGHT      — can they connect it to broader patterns / mental models?
 *
 * Tier semantics
 * --------------
 * DWD  — raw, per-answer grain: heavy on RECALL + UNDERSTANDING
 * DWS  — aggregated module grain: balanced across all dimensions
 * ADS  — expression / output grain: heavy on EXPRESSION + INSIGHT
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const MASTERY_DIMENSIONS = [
  "RECALL",
  "UNDERSTANDING",
  "APPLICATION",
  "EXPRESSION",
  "INSIGHT",
] as const;
export type MasteryDimension = typeof MASTERY_DIMENSIONS[number];

export type DimensionScores = Record<MasteryDimension, number>;

export type MasteryTier = "DWD" | "DWS" | "ADS";

export interface MasteryResult {
  tier: MasteryTier;
  dimensionScores: DimensionScores;
  weightedScore: number;  // 0.0 – 1.0
  /** Human-readable level label */
  level: MasteryLevel;
}

export type MasteryLevel =
  | "NASCENT"       // 0.0 – 0.39
  | "DEVELOPING"    // 0.4 – 0.59
  | "PROFICIENT"    // 0.6 – 0.74
  | "ADVANCED"      // 0.75 – 0.89
  | "MASTERED";     // 0.9 – 1.0

// ---------------------------------------------------------------------------
// Weight profiles per tier
// ---------------------------------------------------------------------------

type WeightProfile = Record<MasteryDimension, number>;

/** Weights must sum to 1.0 */
const TIER_WEIGHTS: Record<MasteryTier, WeightProfile> = {
  DWD: {
    RECALL:       0.35,
    UNDERSTANDING: 0.35,
    APPLICATION:  0.15,
    EXPRESSION:   0.10,
    INSIGHT:      0.05,
  },
  DWS: {
    RECALL:       0.20,
    UNDERSTANDING: 0.25,
    APPLICATION:  0.25,
    EXPRESSION:   0.15,
    INSIGHT:      0.15,
  },
  ADS: {
    RECALL:       0.05,
    UNDERSTANDING: 0.15,
    APPLICATION:  0.20,
    EXPRESSION:   0.35,
    INSIGHT:      0.25,
  },
};

// ---------------------------------------------------------------------------
// Mastery level thresholds
// ---------------------------------------------------------------------------

function scoreToLevel(score: number): MasteryLevel {
  if (score >= 0.90) return "MASTERED";
  if (score >= 0.75) return "ADVANCED";
  if (score >= 0.60) return "PROFICIENT";
  if (score >= 0.40) return "DEVELOPING";
  return "NASCENT";
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

/**
 * Calculate a mastery result for the given tier and dimension scores.
 *
 * @param tier            Which warehouse tier determines the weight profile
 * @param dimensionScores Raw scores [0.0 – 1.0] for each dimension
 */
export function calculateMastery(
  tier: MasteryTier,
  dimensionScores: DimensionScores
): MasteryResult {
  const weights = TIER_WEIGHTS[tier];
  let weighted = 0;

  for (const dim of MASTERY_DIMENSIONS) {
    const score = clamp(dimensionScores[dim] ?? 0, 0, 1);
    weighted += score * weights[dim];
  }

  const weightedScore = Math.round(weighted * 1000) / 1000;

  return {
    tier,
    dimensionScores,
    weightedScore,
    level: scoreToLevel(weightedScore),
  };
}

/**
 * Aggregate multiple DWD results into a DWS-level mastery score.
 * Averages each dimension across all inputs, then re-weights with DWS profile.
 */
export function aggregateToDWS(dwdResults: MasteryResult[]): MasteryResult {
  if (dwdResults.length === 0) {
    return calculateMastery("DWS", zeroScores());
  }

  const averaged = averageDimensions(dwdResults.map((r) => r.dimensionScores));
  return calculateMastery("DWS", averaged);
}

/**
 * Build an ADS mastery result from a DWS result plus explicit expression/insight scores.
 * ADS scores reflect the learner's ability to output, not just recall.
 */
export function buildADSMastery(
  dwsResult: MasteryResult,
  expressionScore: number,
  insightScore: number
): MasteryResult {
  const merged: DimensionScores = {
    ...dwsResult.dimensionScores,
    EXPRESSION: clamp(expressionScore, 0, 1),
    INSIGHT: clamp(insightScore, 0, 1),
  };
  return calculateMastery("ADS", merged);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function zeroScores(): DimensionScores {
  return {
    RECALL: 0, UNDERSTANDING: 0, APPLICATION: 0, EXPRESSION: 0, INSIGHT: 0,
  };
}

function averageDimensions(scores: DimensionScores[]): DimensionScores {
  const n = scores.length;
  const sum = zeroScores();
  for (const s of scores) {
    for (const dim of MASTERY_DIMENSIONS) {
      sum[dim] += s[dim] ?? 0;
    }
  }
  const result = zeroScores();
  for (const dim of MASTERY_DIMENSIONS) {
    result[dim] = Math.round((sum[dim] / n) * 1000) / 1000;
  }
  return result;
}
