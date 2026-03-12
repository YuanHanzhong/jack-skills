/**
 * paths.ts — Cross-platform path definitions (shared across all skills)
 */
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { platform } from "node:process";

export const IS_WINDOWS = platform === "win32";

// Temp directories
export const TEMP_BASE = tmpdir();
export const SESSION_DIR = join(TEMP_BASE, "cannon_session");
export const PENDING_LOGS_DIR = join(TEMP_BASE, "session_logs");
export const CANNON_STATE_DIR = join(TEMP_BASE, "cannon_state");

// User home (persistent)
export const HOME_DIR = homedir();
export const PERSISTENCE_DIR = join(HOME_DIR, ".claude", "state");

// Skills directory — .claude/skills/
export const SKILLS_DIR = typeof import.meta.dir === "string"
  ? join(import.meta.dir, "..")
  : join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..");
