---
name: hook-checkers
description: "Skill for the Hook-checkers area of 1_learn. 17 symbols across 4 files."
---

# Hook-checkers

17 symbols | 4 files | Cohesion: 88%

## When to Use

- Working with code in `tools/`
- Understanding how validator, ConfigChecker, IntegrationChecker work
- Modifying hook-checkers-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/hook-checkers/config-checker.js` | ConfigChecker, check, checkCodexHooks, checkSettings, checkEnv (+1) |
| `tools/hook-checkers/environment-checker.js` | check, checkBun, checkPython, checkGit, checkClaude (+1) |
| `tools/hook-checkers/integration-checker.js` | IntegrationChecker, check, testNoDefaultHooks, testVectorsDb |
| `tools/hook-utils/hook-registry.js` | validator |

## Entry Points

Start here when exploring this area:

- **`validator`** (Function) — `tools/hook-utils/hook-registry.js:72`
- **`ConfigChecker`** (Class) — `tools/hook-checkers/config-checker.js:15`
- **`IntegrationChecker`** (Class) — `tools/hook-checkers/integration-checker.js:14`
- **`check`** (Method) — `tools/hook-checkers/config-checker.js:23`
- **`checkCodexHooks`** (Method) — `tools/hook-checkers/config-checker.js:62`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ConfigChecker` | Class | `tools/hook-checkers/config-checker.js` | 15 |
| `IntegrationChecker` | Class | `tools/hook-checkers/integration-checker.js` | 14 |
| `validator` | Function | `tools/hook-utils/hook-registry.js` | 72 |
| `check` | Method | `tools/hook-checkers/config-checker.js` | 23 |
| `checkCodexHooks` | Method | `tools/hook-checkers/config-checker.js` | 62 |
| `checkSettings` | Method | `tools/hook-checkers/config-checker.js` | 196 |
| `checkEnv` | Method | `tools/hook-checkers/config-checker.js` | 319 |
| `checkDependencies` | Method | `tools/hook-checkers/config-checker.js` | 411 |
| `check` | Method | `tools/hook-checkers/environment-checker.js` | 20 |
| `checkBun` | Method | `tools/hook-checkers/environment-checker.js` | 55 |
| `checkPython` | Method | `tools/hook-checkers/environment-checker.js` | 91 |
| `checkGit` | Method | `tools/hook-checkers/environment-checker.js` | 128 |
| `checkClaude` | Method | `tools/hook-checkers/environment-checker.js` | 158 |
| `checkGH` | Method | `tools/hook-checkers/environment-checker.js` | 188 |
| `check` | Method | `tools/hook-checkers/integration-checker.js` | 22 |
| `testNoDefaultHooks` | Method | `tools/hook-checkers/integration-checker.js` | 48 |
| `testVectorsDb` | Method | `tools/hook-checkers/integration-checker.js` | 94 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Run → CheckBun` | cross_community | 3 |
| `Run → CheckPython` | cross_community | 3 |
| `Run → CheckGit` | cross_community | 3 |
| `Run → CheckClaude` | cross_community | 3 |
| `Run → ConfigChecker` | cross_community | 3 |
| `Run → CheckSettings` | cross_community | 3 |
| `Run → CheckCodexHooks` | cross_community | 3 |
| `Run → CheckEnv` | cross_community | 3 |
| `Run → IntegrationChecker` | cross_community | 3 |
| `Run → TestNoDefaultHooks` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tools | 1 calls |

## How to Explore

1. `gitnexus_context({name: "validator"})` — see callers and callees
2. `gitnexus_query({query: "hook-checkers"})` — find related execution flows
3. Read key files listed above for implementation details
