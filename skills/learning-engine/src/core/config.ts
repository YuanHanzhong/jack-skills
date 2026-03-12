/**
 * Shared thresholds — single source of truth for all magic numbers.
 */
export const THRESHOLDS = {
  /** Score below which a weakness card is generated */
  WEAKNESS_SCORE: 0.6,
  /** Mastery score that triggers expression card generation */
  MASTERY_EXPRESSION: 0.85,
  /** Coverage rail confirmation threshold */
  COVERAGE_CONFIRMATION: 0.7,
  /** Weakness rail auto-resolution threshold */
  WEAKNESS_RESOLUTION: 0.75,
  /** Coverage percentage for dual-track readiness */
  COVERAGE_DUAL_TRACK: 0.8,
  /** Max flashcards per concept */
  MAX_CARDS_PER_CONCEPT: 6,
  /** Daemon max poll iterations */
  DAEMON_MAX_POLLS: 20,
  /** Daemon poll interval in ms */
  DAEMON_POLL_INTERVAL_MS: 2000,
} as const;
