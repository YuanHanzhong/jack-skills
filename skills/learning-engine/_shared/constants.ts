/**
 * constants.ts — Shared status, signal, and activity constants.
 * Centralized to avoid duplicate definitions across skill scripts.
 */

// ── Status values (used across ADS/DWS/DWD) ──────────────────────
export const STATUS_IN_PROGRESS = "🔵 进行中";
export const STATUS_DONE = "🟢 已完成";
export const STATUS_FAILED = "❌ 已失败";
export const STATUS_COLLECTING = "🟡 收集中";
export const STATUS_ARCHIVED = "📦 归档";
export const STATUS_ABANDONED = "🔴 已放弃";

// ── Resolution status (ODS realtime) ─────────────────────────────
export const STATUS_RESOLVED = "✅已解决";
export const STATUS_UNRESOLVED = "⚪未解决";

// ── Mastery display labels (ODS learning) ────────────────────────
export const MASTERY_UNTOUCHED = "⚪ 未学习";
export const MASTERY_FAMILIAR = "🟡 了解中";
export const MASTERY_UNDERSTOOD = "🔵 理解中";
export const MASTERY_MASTERED = "🟢 已掌握";
export const MASTERY_INTERNALIZED = "🟣 已内化";

// ── Knowledge status map (learning-engine) ────────────────────────
export const STATUS_MAP: Record<string, string> = {
  untouched: "⬜",
  learning: "🔵",
  tested: "🟡",
  mastered: "🟢",
  internalized: "🟣",
  review: "🔴",
};

export function statusToEmoji(status: string): string {
  return STATUS_MAP[status] ?? "⬜";
}
