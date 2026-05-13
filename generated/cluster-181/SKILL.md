---
name: cluster-181
description: "Skill for the Cluster_181 area of 1_learn. 7 symbols across 1 files."
---

# Cluster_181

7 symbols | 1 files | Cohesion: 82%

## When to Use

- Working with code in `tools/`
- Understanding how green, yellow, fetchWithTimeout work
- Modifying cluster_181-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/lib/embedding-provider.js` | green, yellow, fetchWithTimeout, embedL1, embedL1WithRetry (+2) |

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `green` | Function | `tools/lib/embedding-provider.js` | 6 |
| `yellow` | Function | `tools/lib/embedding-provider.js` | 7 |
| `fetchWithTimeout` | Function | `tools/lib/embedding-provider.js` | 36 |
| `embedL1` | Function | `tools/lib/embedding-provider.js` | 47 |
| `embedL1WithRetry` | Function | `tools/lib/embedding-provider.js` | 96 |
| `tryL1` | Function | `tools/lib/embedding-provider.js` | 113 |
| `_init` | Function | `tools/lib/embedding-provider.js` | 153 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → FetchWithTimeout` | cross_community | 6 |
| `Main → Yellow` | cross_community | 5 |
| `Main → Green` | cross_community | 4 |

## How to Explore

1. `gitnexus_context({name: "green"})` — see callers and callees
2. `gitnexus_query({query: "cluster_181"})` — find related execution flows
3. Read key files listed above for implementation details
