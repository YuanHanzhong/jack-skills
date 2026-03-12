import { scoringRepo } from "../db/repositories/scoring-repo.ts";
import { weaknessRailRepo } from "../db/repositories/weakness-rail-repo.ts";
import type { ScoreResult } from "../schemas/score-result.schema.ts";

function saveScores(
  sessionId: string,
  moduleId: string,
  conceptId: string,
  result: ScoreResult
) {
  const now = new Date().toISOString();
  for (const dim of result.scores) {
    scoringRepo.create({
      id: crypto.randomUUID(),
      session_id: sessionId,
      module_id: moduleId,
      concept_id: conceptId,
      dimension: dim.dimension,
      score: dim.score,
      evidence: dim.evidence,
      created_at: now,
      // Note: scoring_results table has no updated_at column (immutable audit records)
    });
  }

  if (result.weakness_identified && result.weakness_dimensions?.length) {
    for (const dim of result.weakness_dimensions) {
      weaknessRailRepo.create({
        id: crypto.randomUUID(),
        session_id: sessionId,
        module_id: moduleId,
        concept_id: conceptId,
        weakness_type: dim,
        status: "IDENTIFIED",
        evidence: result.overall_assessment,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }

  return { saved: result.scores.length };
}

function getConceptScores(conceptId: string, sessionId: string) {
  return scoringRepo.findByConceptAndSession(conceptId, sessionId);
}

export const scoringService = { saveScores, getConceptScores };
