---
name: assets
description: "Skill for the Assets area of 1_learn. 532 symbols across 7 files."
---

# Assets

532 symbols | 7 files | Cohesion: 69%

## When to Use

- Working with code in `00_方向盘/`
- Understanding how extractRulesFromClaudeMd, scanRulesDirectory, validateClaudeMdIndex work
- Modifying assets-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `00_方向盘/12_Jack控制台/assets/index.js` | m, b, ne, re, ie (+513) |
| `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py` | add, peek, consume_urgent, test_request_inbox |
| `tools/knowledge-health-core.js` | isAdsTaskGroupAlias, parseLegacyAdsName, parseAdsName |
| `tools/validators/index-validator.js` | extractRulesFromClaudeMd, scanRulesDirectory, validateClaudeMdIndex |
| `tools/vec-watch.js` | runIndex, scheduleReindex |
| `tools/jack-console/src/state/buildProjectState.ts` | next |
| `00_DIM/skills_backup/learning-engine/scripts/auto_archive.py` | reset |

## Entry Points

Start here when exploring this area:

- **`extractRulesFromClaudeMd`** (Function) — `tools/validators/index-validator.js:22`
- **`scanRulesDirectory`** (Function) — `tools/validators/index-validator.js:63`
- **`validateClaudeMdIndex`** (Function) — `tools/validators/index-validator.js:88`
- **`add`** (Method) — `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py:181`
- **`peek`** (Method) — `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py:191`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `extractRulesFromClaudeMd` | Function | `tools/validators/index-validator.js` | 22 |
| `scanRulesDirectory` | Function | `tools/validators/index-validator.js` | 63 |
| `validateClaudeMdIndex` | Function | `tools/validators/index-validator.js` | 88 |
| `add` | Method | `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py` | 181 |
| `peek` | Method | `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py` | 191 |
| `consume_urgent` | Method | `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py` | 201 |
| `test_request_inbox` | Method | `00_DIM/skills_backup/cannon/scripts/interrupt_handler.py` | 247 |
| `reset` | Method | `00_DIM/skills_backup/learning-engine/scripts/auto_archive.py` | 256 |
| `m` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `b` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `ne` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `re` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `ie` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `le` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `ue` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `de` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `forEach` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `only` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `c` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |
| `x` | Function | `00_方向盘/12_Jack控制台/assets/index.js` | 0 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Ec → Match` | cross_community | 8 |
| `Ec → DetermineComponentFrameRoot` | cross_community | 7 |
| `Sl → Match` | cross_community | 7 |
| `Au → E` | cross_community | 6 |
| `Fs → Vi` | cross_community | 6 |
| `Fs → _i` | cross_community | 6 |
| `EnqueueForceUpdate → Vi` | cross_community | 6 |
| `EnqueueForceUpdate → _i` | cross_community | 6 |
| `EnqueueReplaceState → Vi` | cross_community | 6 |
| `EnqueueReplaceState → _i` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tools | 1 calls |
| Scripts | 1 calls |

## How to Explore

1. `gitnexus_context({name: "extractRulesFromClaudeMd"})` — see callers and callees
2. `gitnexus_query({query: "assets"})` — find related execution flows
3. Read key files listed above for implementation details
