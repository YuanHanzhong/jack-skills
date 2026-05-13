---
name: server
description: "Skill for the Server area of 1_learn. 8 symbols across 2 files."
---

# Server

8 symbols | 2 files | Cohesion: 90%

## When to Use

- Working with code in `tools/`
- Understanding how appendOperation, readOperations work
- Modifying server-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/jack-console/src/server/index.ts` | json, broadcast, recordFileEvent, fetch |
| `tools/jack-console/src/operations/logOperations.ts` | memoryDir, operationsPath, appendOperation, readOperations |

## Entry Points

Start here when exploring this area:

- **`appendOperation`** (Function) — `tools/jack-console/src/operations/logOperations.ts:12`
- **`readOperations`** (Function) — `tools/jack-console/src/operations/logOperations.ts:31`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `appendOperation` | Function | `tools/jack-console/src/operations/logOperations.ts` | 12 |
| `readOperations` | Function | `tools/jack-console/src/operations/logOperations.ts` | 31 |
| `json` | Function | `tools/jack-console/src/server/index.ts` | 17 |
| `broadcast` | Function | `tools/jack-console/src/server/index.ts` | 30 |
| `recordFileEvent` | Function | `tools/jack-console/src/server/index.ts` | 41 |
| `memoryDir` | Function | `tools/jack-console/src/operations/logOperations.ts` | 4 |
| `operationsPath` | Function | `tools/jack-console/src/operations/logOperations.ts` | 8 |
| `fetch` | Method | `tools/jack-console/src/server/index.ts` | 74 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Fetch → SafeRead` | cross_community | 5 |
| `Fetch → NormalizePath` | cross_community | 5 |
| `Fetch → WithoutFrontmatter` | cross_community | 5 |
| `Fetch → ParseTableRows` | cross_community | 4 |
| `Fetch → ExtractSectionLine` | cross_community | 4 |
| `Fetch → MemoryDir` | intra_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| State | 2 calls |

## How to Explore

1. `gitnexus_context({name: "appendOperation"})` — see callers and callees
2. `gitnexus_query({query: "server"})` — find related execution flows
3. Read key files listed above for implementation details
