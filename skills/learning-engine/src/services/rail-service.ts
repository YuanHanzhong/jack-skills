import { coverageRailRepo } from "../db/repositories/coverage-rail-repo.ts";
import { weaknessRailRepo } from "../db/repositories/weakness-rail-repo.ts";
import { THRESHOLDS } from "../core/config.ts";

const COVERAGE_THRESHOLD = THRESHOLDS.COVERAGE_DUAL_TRACK;

function updateCoverage(
  sessionId: string,
  moduleId: string,
  conceptId: string,
  status: "NOT_COVERED" | "PARTIALLY_COVERED" | "FULLY_COVERED",
  evidence?: string
) {
  coverageRailRepo.upsert({
    id: crypto.randomUUID(),
    session_id: sessionId,
    module_id: moduleId,
    concept_id: conceptId,
    status,
    coverage_evidence: evidence ?? null,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  return { conceptId, status };
}

function updateWeakness(
  sessionId: string,
  moduleId: string,
  conceptId: string,
  weaknessType: "RECALL" | "UNDERSTANDING" | "APPLICATION" | "EXPRESSION" | "INSIGHT",
  status: "IDENTIFIED" | "CARD_GENERATED" | "RESOLVED",
  evidence?: string
) {
  // Find existing weakness by composite key
  const existing = weaknessRailRepo
    .findBySessionModule(sessionId, moduleId)
    .find((w) => w.concept_id === conceptId && w.weakness_type === weaknessType);

  const now = new Date().toISOString();
  if (existing) {
    weaknessRailRepo.update(existing.id, {
      status,
      evidence: evidence ?? existing.evidence,
      updated_at: now,
    });
  } else {
    weaknessRailRepo.create({
      id: crypto.randomUUID(),
      session_id: sessionId,
      module_id: moduleId,
      concept_id: conceptId,
      weakness_type: weaknessType,
      status,
      evidence: evidence ?? null,
      updated_at: now,
      created_at: now,
    });
  }
  return { conceptId, weaknessType, status };
}

function checkDualTrackReady(sessionId: string, moduleId: string) {
  const coverageRails = coverageRailRepo.findBySessionModule(sessionId, moduleId);
  const weaknessRails = weaknessRailRepo.findBySessionModule(sessionId, moduleId);

  const covered = coverageRails.filter((r) => r.status === "FULLY_COVERED").length;
  const coveragePct = coverageRails.length > 0 ? covered / coverageRails.length : 0;
  const coverageReady = coveragePct >= COVERAGE_THRESHOLD;

  const unresolvedWeakness = weaknessRails.filter((r) => r.status !== "RESOLVED").length;
  const weaknessReady = unresolvedWeakness === 0;

  return { coverageReady, weaknessReady, ready: coverageReady && weaknessReady, coveragePct };
}

export const railService = { updateCoverage, updateWeakness, checkDualTrackReady };
