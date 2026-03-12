import { coverageRailRepo } from "../db/repositories/coverage-rail-repo.ts";
import { materialRepo } from "../db/repositories/material-repo.ts";
import { sessionRepo } from "../db/repositories/session-repo.ts";

const VALID_AUDIT_FROM = new Set(["UPLOADED", "INGEST_FAILED", "INGESTED"]);
const VALID_AUDIT_SESSION_STATES = new Set(["AUDIT", "INGEST", "MAP_REVIEW"]);

function runAudit(sessionId: string, materialId: string) {
  // Validate session state before audit
  const session = sessionRepo.findById(sessionId);
  if (session) {
    const sessionStatus = session.status;
    if (sessionStatus && !VALID_AUDIT_SESSION_STATES.has(sessionStatus)) {
      throw new Error(
        `Cannot run audit: session "${sessionId}" is in state "${sessionStatus}". ` +
        `Expected one of: ${[...VALID_AUDIT_SESSION_STATES].join(", ")}`,
      );
    }
  }

  const material = materialRepo.findById(materialId);
  if (!material) throw new Error(`Material not found: ${materialId}`);

  const currentStatus: string | undefined = material.status;
  if (currentStatus && !VALID_AUDIT_FROM.has(currentStatus)) {
    throw new Error(
      `Cannot audit material "${materialId}" in status "${currentStatus}". ` +
      `Expected one of: ${[...VALID_AUDIT_FROM].join(", ")}`,
    );
  }

  materialRepo.update(materialId, { status: "INGESTED", updated_at: new Date().toISOString() });

  return { sessionId, materialId, status: "AUDIT_STARTED", previousStatus: currentStatus ?? "unknown" };
}

function getAuditProgress(sessionId: string, moduleId: string) {
  const rails = coverageRailRepo.findBySessionModule(sessionId, moduleId);

  const total = rails.length;
  const mapped = rails.filter((r) => r.status === "FULLY_COVERED").length;
  const partial = rails.filter((r) => r.status === "PARTIALLY_COVERED").length;
  const pending = rails.filter((r) => r.status === "NOT_COVERED").length;

  return { total, mapped, partial, pending, coverage_pct: total > 0 ? mapped / total : 0 };
}

export const auditService = { runAudit, getAuditProgress };
