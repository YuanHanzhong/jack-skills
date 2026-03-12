import { z } from "zod";

export const DimensionScoreSchema = z.object({
  dimension: z.enum(["RECALL", "UNDERSTANDING", "APPLICATION", "EXPRESSION", "INSIGHT"]),
  score: z.number().min(0).max(1),
  evidence: z.string(),
});

export const ScoreResultSchema = z.object({
  concept_id: z.string(),
  scores: z.array(DimensionScoreSchema).min(1).max(5),
  overall_assessment: z.string(),
  weakness_identified: z.boolean(),
  weakness_dimensions: z.array(z.enum(["RECALL", "UNDERSTANDING", "APPLICATION", "EXPRESSION", "INSIGHT"])).optional(),
});

export type ScoreResult = z.infer<typeof ScoreResultSchema>;
