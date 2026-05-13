---
name: state
description: "Skill for the State area of 1_learn. 16 symbols across 2 files."
---

# State

16 symbols | 2 files | Cohesion: 78%

## When to Use

- Working with code in `tools/`
- Understanding how buildProjectState work
- Modifying state-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/jack-console/src/state/buildProjectState.ts` | normalizePath, withoutFrontmatter, titleFromMarkdown, firstUsefulExcerpt, readSource (+10) |
| `tools/jack-console/src/server/index.ts` | start |

## Entry Points

Start here when exploring this area:

- **`buildProjectState`** (Function) — `tools/jack-console/src/state/buildProjectState.ts:203`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `buildProjectState` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 203 |
| `normalizePath` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 18 |
| `withoutFrontmatter` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 26 |
| `titleFromMarkdown` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 32 |
| `firstUsefulExcerpt` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 37 |
| `readSource` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 45 |
| `readDirection` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 58 |
| `extractSectionLine` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 67 |
| `readAds` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 79 |
| `safeRead` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 22 |
| `readSkills` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 132 |
| `parseTableRows` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 151 |
| `readAgents` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 158 |
| `countQueue` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 176 |
| `buildWarnings` | Function | `tools/jack-console/src/state/buildProjectState.ts` | 194 |
| `start` | Method | `tools/jack-console/src/server/index.ts` | 95 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Fetch → SafeRead` | cross_community | 5 |
| `Fetch → NormalizePath` | cross_community | 5 |
| `Fetch → WithoutFrontmatter` | cross_community | 5 |
| `Fetch → ParseTableRows` | cross_community | 4 |
| `Fetch → ExtractSectionLine` | cross_community | 4 |

## How to Explore

1. `gitnexus_context({name: "buildProjectState"})` — see callers and callees
2. `gitnexus_query({query: "state"})` — find related execution flows
3. Read key files listed above for implementation details
