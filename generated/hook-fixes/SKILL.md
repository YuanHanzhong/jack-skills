---
name: hook-fixes
description: "Skill for the Hook-fixes area of 1_learn. 19 symbols across 5 files."
---

# Hook-fixes

19 symbols | 5 files | Cohesion: 79%

## When to Use

- Working with code in `tools/`
- Understanding how ReportFormatter, ScriptChecker, AutoFixer work
- Modifying hook-fixes-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/hook-fixes/auto-fixes.js` | applyFix, fixExecutePermission, fixStalePid, fixMissingEnv, fixEmptyIndex (+4) |
| `tools/hook-fixes/manual-guides.js` | getGuide, formatGuides, extractManualIssues, detectIssueType |
| `tools/hook-checkers/script-checker.js` | ScriptChecker, check, checkHookScript |
| `tools/check-hooks.js` | run, hasErrors |
| `tools/hook-utils/report-formatter.js` | ReportFormatter |

## Entry Points

Start here when exploring this area:

- **`ReportFormatter`** (Class) — `tools/hook-utils/report-formatter.js:11`
- **`ScriptChecker`** (Class) — `tools/hook-checkers/script-checker.js:17`
- **`AutoFixer`** (Class) — `tools/hook-fixes/auto-fixes.js:16`
- **`getGuide`** (Method) — `tools/hook-fixes/manual-guides.js:14`
- **`formatGuides`** (Method) — `tools/hook-fixes/manual-guides.js:151`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ReportFormatter` | Class | `tools/hook-utils/report-formatter.js` | 11 |
| `ScriptChecker` | Class | `tools/hook-checkers/script-checker.js` | 17 |
| `AutoFixer` | Class | `tools/hook-fixes/auto-fixes.js` | 16 |
| `getGuide` | Method | `tools/hook-fixes/manual-guides.js` | 14 |
| `formatGuides` | Method | `tools/hook-fixes/manual-guides.js` | 151 |
| `extractManualIssues` | Method | `tools/hook-fixes/manual-guides.js` | 196 |
| `detectIssueType` | Method | `tools/hook-fixes/manual-guides.js` | 266 |
| `check` | Method | `tools/hook-checkers/script-checker.js` | 26 |
| `checkHookScript` | Method | `tools/hook-checkers/script-checker.js` | 54 |
| `applyFix` | Method | `tools/hook-fixes/auto-fixes.js` | 141 |
| `fixExecutePermission` | Method | `tools/hook-fixes/auto-fixes.js` | 173 |
| `fixStalePid` | Method | `tools/hook-fixes/auto-fixes.js` | 191 |
| `fixMissingEnv` | Method | `tools/hook-fixes/auto-fixes.js` | 218 |
| `fixEmptyIndex` | Method | `tools/hook-fixes/auto-fixes.js` | 247 |
| `fix` | Method | `tools/hook-fixes/auto-fixes.js` | 27 |
| `collectFixableIssues` | Method | `tools/hook-fixes/auto-fixes.js` | 70 |
| `confirmFix` | Method | `tools/hook-fixes/auto-fixes.js` | 130 |
| `run` | Method | `tools/check-hooks.js` | 39 |
| `hasErrors` | Method | `tools/check-hooks.js` | 128 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → CheckBun` | cross_community | 3 |
| `Run → CheckPython` | cross_community | 3 |
| `Run → CheckGit` | cross_community | 3 |
| `Run → CheckClaude` | cross_community | 3 |
| `Run → ScriptChecker` | intra_community | 3 |
| `Run → CheckHookScript` | intra_community | 3 |
| `Run → ConfigChecker` | cross_community | 3 |
| `Run → CheckSettings` | cross_community | 3 |
| `Run → CheckCodexHooks` | cross_community | 3 |
| `Run → CheckEnv` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Hook-checkers | 3 calls |
| Hook-utils | 1 calls |

## How to Explore

1. `gitnexus_context({name: "ReportFormatter"})` — see callers and callees
2. `gitnexus_query({query: "hook-fixes"})` — find related execution flows
3. Read key files listed above for implementation details
