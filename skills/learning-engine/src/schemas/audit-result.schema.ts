import { z } from "zod";

export const AuditResultSchema = z.object({
  chunk_id: z.string(),
  audit_status: z.enum(["MAPPED", "MERGED", "SKIPPED"]),
  mapped_concept_id: z.string().optional(),
  density_score: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export const AuditBatchResultSchema = z.object({
  results: z.array(AuditResultSchema),
  coverage_summary: z.object({
    total_chunks: z.number(),
    mapped: z.number(),
    merged: z.number(),
    skipped: z.number(),
  }),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;
