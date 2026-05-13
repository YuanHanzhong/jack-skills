---
name: hook-utils
description: "Skill for the Hook-utils area of 1_learn. 8 symbols across 1 files."
---

# Hook-utils

8 symbols | 1 files | Cohesion: 96%

## When to Use

- Working with code in `tools/`
- Understanding how generate, formatTable, formatJSON work
- Modifying hook-utils-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/hook-utils/report-formatter.js` | generate, formatTable, formatJSON, formatMarkdown, calculateSummary (+3) |

## Entry Points

Start here when exploring this area:

- **`generate`** (Method) — `tools/hook-utils/report-formatter.js:21`
- **`formatTable`** (Method) — `tools/hook-utils/report-formatter.js:36`
- **`formatJSON`** (Method) — `tools/hook-utils/report-formatter.js:211`
- **`formatMarkdown`** (Method) — `tools/hook-utils/report-formatter.js:226`
- **`calculateSummary`** (Method) — `tools/hook-utils/report-formatter.js:349`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `generate` | Method | `tools/hook-utils/report-formatter.js` | 21 |
| `formatTable` | Method | `tools/hook-utils/report-formatter.js` | 36 |
| `formatJSON` | Method | `tools/hook-utils/report-formatter.js` | 211 |
| `formatMarkdown` | Method | `tools/hook-utils/report-formatter.js` | 226 |
| `calculateSummary` | Method | `tools/hook-utils/report-formatter.js` | 349 |
| `getStatusIcon` | Method | `tools/hook-utils/report-formatter.js` | 421 |
| `getSeverityIcon` | Method | `tools/hook-utils/report-formatter.js` | 437 |
| `getStatusLabel` | Method | `tools/hook-utils/report-formatter.js` | 453 |

## How to Explore

1. `gitnexus_context({name: "generate"})` — see callers and callees
2. `gitnexus_query({query: "hook-utils"})` — find related execution flows
3. Read key files listed above for implementation details
