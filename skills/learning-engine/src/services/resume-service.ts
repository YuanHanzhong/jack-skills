import { sessionRepo } from "../db/repositories/session-repo.ts";
import { moduleRepo } from "../db/repositories/module-repo.ts";
import { scoringRepo } from "../db/repositories/scoring-repo.ts";
import { coverageRailRepo } from "../db/repositories/coverage-rail-repo.ts";
import { weaknessRailRepo } from "../db/repositories/weakness-rail-repo.ts";

function buildResumeContextPack(sessionId: string) {
  const session = sessionRepo.findById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const modules = moduleRepo.findBySession(sessionId);
  const currentModuleId = session.current_module_id;
  const currentModule = currentModuleId ? moduleRepo.findById(currentModuleId) : null;

  // Get recent scores for all concepts in the current module
  const recentScores = currentModuleId
    ? scoringRepo.findByModuleAndSession(currentModuleId, sessionId)
    : [];

  const coverageRails = currentModuleId
    ? coverageRailRepo.findBySessionModule(sessionId, currentModuleId)
    : [];

  const weaknessRails = currentModuleId
    ? weaknessRailRepo.findBySessionModule(sessionId, currentModuleId)
    : [];

  return {
    session: { id: session.id, session_type: session.session_type, status: session.status },
    currentModule,
    modules: modules.map((m) => ({ id: m.id, title: m.title, sequence: m.sequence })),
    recentScores,
    railStatus: {
      coverage: coverageRails,
      weakness: weaknessRails,
    },
  };
}

export const resumeService = { buildResumeContextPack };
