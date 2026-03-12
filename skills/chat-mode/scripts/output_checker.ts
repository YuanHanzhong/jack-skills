/**
 * output_checker.ts — Chat mode response format validator
 */

const MAX_LINES = 5;

const PREACHING_PATTERNS: RegExp[] = [
  /你应该/,
  /建议你/,
  /其实你可以/,
  /因为.*所以/,
  /我觉得你需要/,
  /你要学会/,
  /你得明白/,
];

interface LineCheckResult {
  ok: boolean;
  lineCount: number;
  message: string;
}

interface PreachCheckResult {
  ok: boolean;
  violations: string[];
}

interface ValidationResult {
  ok: boolean;
  lineCheck: LineCheckResult;
  preachCheck: PreachCheckResult;
}

/** Check whether a single response is <= 5 non-empty lines. */
function checkLineCount(response: string): LineCheckResult {
  const lines = response.trim().split("\n").filter((l) => l.trim());
  const ok = lines.length <= MAX_LINES;
  return {
    ok,
    lineCount: lines.length,
    message: ok ? "" : `超出${lines.length - MAX_LINES}行，请精简`,
  };
}

/** Detect preaching patterns in a response. */
function checkNoPreaching(response: string): PreachCheckResult {
  const violations: string[] = [];
  for (const pattern of PREACHING_PATTERNS) {
    if (pattern.test(response)) {
      violations.push(pattern.source);
      break; // stop at first violation
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Combined response validation. */
function validateResponse(response: string): ValidationResult {
  const lineCheck = checkLineCount(response);
  const preachCheck = checkNoPreaching(response);
  return {
    ok: lineCheck.ok && preachCheck.ok,
    lineCheck,
    preachCheck,
  };
}

// -- Tests --
if (import.meta.main) {
  const { test, expect } = await import("bun:test");

  test("checkLineCount passes for short responses", () => {
    const result = checkLineCount("第一行\n第二行\n第三行");
    expect(result.ok).toBe(true);
    expect(result.lineCount).toBe(3);
  });

  test("checkLineCount fails for long responses", () => {
    const result = checkLineCount("1\n2\n3\n4\n5\n6");
    expect(result.ok).toBe(false);
  });

  test("checkNoPreaching detects violations", () => {
    const result = checkNoPreaching("你应该好好休息");
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  test("checkNoPreaching passes clean text", () => {
    const result = checkNoPreaching("我听见了，今天确实辛苦。");
    expect(result.ok).toBe(true);
  });

  test("validateResponse combines both checks", () => {
    const result = validateResponse("你应该\n1\n2\n3\n4\n5\n6");
    expect(result.ok).toBe(false);
  });
}
