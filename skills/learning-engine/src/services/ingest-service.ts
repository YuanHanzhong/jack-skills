import { createHash } from "crypto";
import { materialRepo } from "../db/repositories/material-repo.ts";
import { conceptRepo } from "../db/repositories/concept-repo.ts";

function ingestMaterial(
  sessionId: string,
  title: string,
  content: string,
  sourceUrl?: string
) {
  const checksum = createHash("sha256").update(content).digest("hex");

  const existing = materialRepo.findByChecksum(checksum);
  if (existing) {
    return { status: "DUPLICATE", materialId: existing.id };
  }

  const materialId = crypto.randomUUID();
  materialRepo.create({
    id: materialId,
    session_id: sessionId,
    title,
    content_hash: checksum,
    // TODO: calculate real chunk count once chunking pipeline is implemented
    chunk_count: 0,
    source_url: sourceUrl ?? null,
    status: "PENDING",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { status: "CREATED", materialId };
}

function getConceptsByModule(moduleId: string) {
  return conceptRepo.findByModule(moduleId);
}

function updateChunkCount(materialId: string, count: number) {
  materialRepo.update(materialId, { chunk_count: count, updated_at: new Date().toISOString() });
}

export const ingestService = { ingestMaterial, getConceptsByModule, updateChunkCount };
