/**
 * Quality rules: dedup checks and schema validation.
 *
 * These run after flow/resource checks to catch content-quality issues
 * before writing to Notion or SQLite.
 */
import { cardRepo } from "../../../db/repositories/card-repo.ts";
import { conceptRepo } from "../../../db/repositories/concept-repo.ts";
import { CardCandidateSchema } from "../../../schemas/card-candidate.schema.ts";
import { ConceptSchema } from "../../../schemas/concept-map.schema.ts";
import type { ZodTypeAny } from "zod";

export interface QualityViolation {
  violated: true;
  reason: string;
}

export interface QualityOk {
  violated: false;
  /** Optional warnings that do not block the call */
  warnings?: string[];
}

export type QualityCheckResult = QualityViolation | QualityOk;

// ---------------------------------------------------------------------------
// Dedup check — queries DB for existing content_hash / dedup_key
// ---------------------------------------------------------------------------

/**
 * Check whether a card or concept already exists by content hash.
 *
 * @param contentHash  SHA-256 hash of the canonical content string
 * @param entityType   "card" | "concept" | "answer"
 */
export async function checkDuplicate(
  contentHash: string,
  entityType: "card" | "concept" | "answer"
): Promise<QualityCheckResult> {
  if (entityType === "card") {
    const existing = cardRepo.findByDedupKey(contentHash);
    if (existing) {
      return { violated: true, reason: `卡片已存在（dedup_key: ${contentHash}）` };
    }
  } else if (entityType === "concept") {
    const existing = conceptRepo.findById(contentHash);
    if (existing) {
      return { violated: true, reason: `概念已存在（id: ${contentHash}）` };
    }
  }
  // "answer" type has no dedup requirement
  return { violated: false };
}

// ---------------------------------------------------------------------------
// Zod schema validation
// ---------------------------------------------------------------------------

const SCHEMA_MAP: Record<string, ZodTypeAny> = {
  card: CardCandidateSchema,
  concept: ConceptSchema,
};

/**
 * Validate a payload against the expected Zod schema for a given entity type.
 */
export function validateSchema(
  entityType: "card" | "concept" | "answer" | "session" | "module",
  payload: Record<string, unknown>
): QualityCheckResult {
  if (!payload || typeof payload !== "object") {
    return {
      violated: true,
      reason: `质量校验失败：${entityType} payload 为空或格式错误`,
    };
  }

  const schema = SCHEMA_MAP[entityType];
  if (schema) {
    const result = schema.safeParse(payload);
    if (!result.success) {
      return { violated: true, reason: `${entityType} schema 校验失败：${result.error.message}` };
    }
  }

  const warnings: string[] = [];
  const content = payload["content"] ?? payload["text"] ?? payload["body"];
  if (typeof content === "string" && content.trim().length < 10) {
    warnings.push(`${entityType} 内容过短（< 10字符），请确认是否为占位符`);
  }

  return warnings.length > 0
    ? { violated: false, warnings }
    : { violated: false };
}

// ---------------------------------------------------------------------------
// Composite quality check
// ---------------------------------------------------------------------------

export async function runQualityChecks(
  entityType: "card" | "concept" | "answer" | "session" | "module",
  payload: Record<string, unknown>,
  contentHash?: string
): Promise<QualityCheckResult> {
  const schemaResult = validateSchema(entityType, payload);
  if (schemaResult.violated) return schemaResult;

  if (contentHash && (entityType === "card" || entityType === "concept" || entityType === "answer")) {
    const dedupResult = await checkDuplicate(contentHash, entityType);
    if (dedupResult.violated) return dedupResult;
  }

  const warnings = schemaResult.warnings ?? [];
  return warnings.length > 0 ? { violated: false, warnings } : { violated: false };
}
