/**
 * Resource access rules.
 *
 * Prevents direct SQLite file access and other low-level resource violations.
 * These rules run on tool call arguments regardless of session state.
 */

export interface ResourceViolation {
  violated: true;
  reason: string;
}

export interface ResourceOk {
  violated: false;
}

export type ResourceCheckResult = ResourceViolation | ResourceOk;

// Patterns that indicate direct SQLite / raw DB file access
const SQLITE_PATTERNS = [
  /\.sqlite$/i,
  /\.sqlite3$/i,
  /\.db$/i,
  /\.db3$/i,
  /sqlite:\/\//i,
  // Raw file paths into the db directory
  /\/db\//,
  /\\db\\/,
];

// Additional blocked resource patterns
const BLOCKED_PATH_PATTERNS = [
  // Prevent access to other sessions' data
  /\/sessions\/[^/]+\/(?!current)/,
];

/**
 * Check whether a tool call's arguments contain forbidden resource access patterns.
 *
 * @param toolName  Name of the tool being called
 * @param args      Serialized arguments (JSON string or raw object stringified)
 */
export function checkResourceAccess(
  toolName: string,
  args: Record<string, unknown>
): ResourceCheckResult {
  const argsStr = JSON.stringify(args);

  for (const pattern of SQLITE_PATTERNS) {
    if (pattern.test(argsStr)) {
      return {
        violated: true,
        reason: `直接访问SQLite文件被禁止（工具: ${toolName}）。请通过服务层API访问数据库。`,
      };
    }
  }

  for (const pattern of BLOCKED_PATH_PATTERNS) {
    if (pattern.test(argsStr)) {
      return {
        violated: true,
        reason: `禁止访问其他会话的原始数据路径（工具: ${toolName}）。`,
      };
    }
  }

  return { violated: false };
}

/**
 * Check if a file path string is a direct SQLite path.
 * Convenience wrapper for simple path checks.
 */
export function isSqlitePath(path: string): boolean {
  return SQLITE_PATTERNS.some((p) => p.test(path));
}
