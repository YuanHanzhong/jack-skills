---
name: validators
description: "Skill for the Validators area of 1_learn. 5 symbols across 1 files."
---

# Validators

5 symbols | 1 files | Cohesion: 83%

## When to Use

- Working with code in `tools/`
- Understanding how detectLayerFromPath, validateFileName, validateFiles work
- Modifying validators-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/validators/naming-validator.js` | detectLayerFromPath, validateDateTimeParts, validateAdsFileName, validateFileName, validateFiles |

## Entry Points

Start here when exploring this area:

- **`detectLayerFromPath`** (Function) — `tools/validators/naming-validator.js:49`
- **`validateFileName`** (Function) — `tools/validators/naming-validator.js:149`
- **`validateFiles`** (Function) — `tools/validators/naming-validator.js:226`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `detectLayerFromPath` | Function | `tools/validators/naming-validator.js` | 49 |
| `validateFileName` | Function | `tools/validators/naming-validator.js` | 149 |
| `validateFiles` | Function | `tools/validators/naming-validator.js` | 226 |
| `validateDateTimeParts` | Function | `tools/validators/naming-validator.js` | 66 |
| `validateAdsFileName` | Function | `tools/validators/naming-validator.js` | 84 |

## How to Explore

1. `gitnexus_context({name: "detectLayerFromPath"})` — see callers and callees
2. `gitnexus_query({query: "validators"})` — find related execution flows
3. Read key files listed above for implementation details
