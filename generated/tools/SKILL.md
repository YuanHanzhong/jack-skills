---
name: tools
description: "Skill for the Tools area of 1_learn. 888 symbols across 74 files."
---

# Tools

888 symbols | 74 files | Cohesion: 85%

## When to Use

- Working with code in `tools/`
- Understanding how planReview, applyReviewResult, evaluated work
- Modifying tools-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tools/flclash-cli.js` | usage, parseArgs, flClashDir, readCurrentConfig, listProfileFiles (+32) |
| `tools/ads-state-review.js` | readGroupText, readFrontmatter, readGroupCompletionMarkers, analyzeAdsStateReview, parseModelReview (+29) |
| `tools/learning-inbox-review.js` | clampScore, normalizeScore, normalizeQuality, parseDate, pendingReviews (+28) |
| `tools/knowledge-health-core.js` | normalizePath, rel, markdownFiles, knowledgePageFiles, pageKey (+24) |
| `tools/session-git-sync.js` | runGit, readJson, writeJson, statePath, ensureBranchCanPush (+22) |
| `tools/direction-sync.js` | rootPath, ensureAdsDirs, moveAdsGroup, replaceAdsLineForSource, updateDirectionLinks (+22) |
| `tools/session-closeout.js` | file, changedPath, parseStatusLine, extractLabeledField, parseFileDescriptions (+21) |
| `tools/hermes-skills.js` | changed, normalizePath, sha256, walkFiles, visit (+19) |
| `tools/notion-sync.js` | rootPath, nowIso, emptyState, loadSyncState, saveSyncState (+18) |
| `tools/setup-claude.js` | g, r, y, cy, b (+17) |

## Entry Points

Start here when exploring this area:

- **`planReview`** (Function) — `tools/learning-inbox-review.js:205`
- **`applyReviewResult`** (Function) — `tools/learning-inbox-review.js:306`
- **`evaluated`** (Function) — `tools/search-eval.js:152`
- **`llmSemanticSearch`** (Function) — `tools/fallback-memory-search.js:75`
- **`analyzeKnowledgeHealth`** (Function) — `tools/knowledge-health-core.js:555`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `planReview` | Function | `tools/learning-inbox-review.js` | 205 |
| `applyReviewResult` | Function | `tools/learning-inbox-review.js` | 306 |
| `evaluated` | Function | `tools/search-eval.js` | 152 |
| `llmSemanticSearch` | Function | `tools/fallback-memory-search.js` | 75 |
| `analyzeKnowledgeHealth` | Function | `tools/knowledge-health-core.js` | 555 |
| `getProviderInfo` | Function | `tools/lib/embedding-provider.js` | 195 |
| `selectInactiveCandidate` | Function | `tools/session-git-sync.js` | 195 |
| `runSessionGitSync` | Function | `tools/session-git-sync.js` | 310 |
| `runSessionGitSyncForWorktrees` | Function | `tools/session-git-sync.js` | 461 |
| `results` | Function | `tools/session-git-sync.js` | 470 |
| `inferBottleneck` | Function | `tools/hourly-progress.js` | 132 |
| `loadSyncState` | Function | `tools/notion-sync.js` | 41 |
| `saveSyncState` | Function | `tools/notion-sync.js` | 59 |
| `registerLocalFile` | Function | `tools/notion-sync.js` | 75 |
| `runNotionSync` | Function | `tools/notion-sync.js` | 299 |
| `decideSyncAction` | Function | `tools/notion-sync-core.js` | 96 |
| `mergeTrackedObjects` | Function | `tools/notion-sync-core.js` | 133 |
| `isSyncableLocalPath` | Function | `tools/notion-sync-core.js` | 137 |
| `parseGitStatus` | Function | `tools/hourly-progress.js` | 31 |
| `unsafePathReason` | Function | `tools/hourly-progress.js` | 79 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Ec → Match` | cross_community | 8 |
| `Sl → Match` | cross_community | 7 |
| `Main → FetchWithTimeout` | cross_community | 6 |
| `Main → _save` | cross_community | 6 |
| `Main → Visit` | cross_community | 6 |
| `Main → Yellow` | cross_community | 5 |
| `Main → NormalizePath` | cross_community | 5 |
| `RunSessionCloseout → ExtractLabeledField` | cross_community | 5 |
| `RunSessionCloseout → Set` | cross_community | 5 |
| `RunSessionCloseout → ParseStatusLine` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Assets | 11 calls |
| Scripts | 9 calls |
| Cluster_181 | 3 calls |
| Validators | 2 calls |
| Hook-fixes | 1 calls |

## How to Explore

1. `gitnexus_context({name: "planReview"})` — see callers and callees
2. `gitnexus_query({query: "tools"})` — find related execution flows
3. Read key files listed above for implementation details
