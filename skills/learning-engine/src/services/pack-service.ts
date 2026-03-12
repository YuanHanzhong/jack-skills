import { packRepo } from "../db/repositories/pack-repo.ts";
import { InterviewPackSchema, type InterviewPack } from "../schemas/interview-pack.schema.ts";

function createPack(data: InterviewPack & { session_id: string }) {
  const parsed = InterviewPackSchema.parse(data);

  const id = crypto.randomUUID();
  packRepo.create({
    id,
    session_id: data.session_id,
    module_id: parsed.module_id,
    pack_type: parsed.pack_type,
    one_liner: parsed.one_liner,
    core_points_json: JSON.stringify(parsed.core_points),
    deep_dive_json: JSON.stringify(parsed.deep_dive),
    project_evidence_json: JSON.stringify(parsed.project_evidence),
    gotcha_defense_json: JSON.stringify(parsed.gotcha_defense),
    status: "DRAFT",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { id, status: "CREATED" };
}

function validatePack(packId: string) {
  const pack = packRepo.findById(packId);
  if (!pack) return { valid: false, reason: "Pack not found" };

  const sections = ["one_liner", "core_points_json", "deep_dive_json", "project_evidence_json", "gotcha_defense_json"] as const;
  const missing = sections.filter((s: typeof sections[number]) => !pack[s]);

  return { valid: missing.length === 0, missing };
}

export const packService = { createPack, validatePack };
