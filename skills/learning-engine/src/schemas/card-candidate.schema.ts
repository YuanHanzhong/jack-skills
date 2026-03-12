import { z } from "zod";

export const CardCandidateSchema = z.object({
  concept_id: z.string(),
  card_type: z.enum(["COVERAGE", "CARD_POINT", "APPLICATION", "EXPRESSION", "PROJECT_EVIDENCE"]),
  front: z.string().min(1),
  back: z.string().min(1),
  dedup_key: z.string().min(1),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
});

export const CardBatchSchema = z.object({
  cards: z.array(CardCandidateSchema),
});

export type CardCandidate = z.infer<typeof CardCandidateSchema>;
