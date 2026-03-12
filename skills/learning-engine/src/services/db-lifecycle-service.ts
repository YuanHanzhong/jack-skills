import { snapshotRepo } from "../db/repositories/snapshot-repo.ts";
import { sessionRepo } from "../db/repositories/session-repo.ts";

function snapshot(
  sessionId: string,
  reason: "STOP" | "PRE_COMPACT" | "MODULE_SWITCH" | "CRASH_RECOVERY",
) {
  const session = sessionRepo.findById(sessionId);
  if (!session) throw new Error(`Session not found for snapshot: ${sessionId}`);

  // Capture full session state
  const state = {
    sessionId,
    reason,
    status: session.status,
    session_type: session.session_type,
    module_cursor: session.module_cursor,
    current_module_id: session.current_module_id,
    current_phase_scope: session.current_phase_scope,
    version: session.version,
    ts: new Date().toISOString(),
  };

  const id = crypto.randomUUID();
  snapshotRepo.createSnapshot({
    id,
    session_id: sessionId,
    reason,
    state_json: JSON.stringify(state),
    created_at: new Date().toISOString(),
  });
  return { id, status: "SNAPSHOT_CREATED" };
}

function exportSession(sessionId: string) {
  const session = sessionRepo.findById(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  return {
    exportedAt: new Date().toISOString(),
    sessionId,
    session,
  };
}

export const dbLifecycleService = { snapshot, exportSession };
