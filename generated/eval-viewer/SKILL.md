---
name: eval-viewer
description: "Skill for the Eval-viewer area of 1_learn. 10 symbols across 1 files."
---

# Eval-viewer

10 symbols | 1 files | Cohesion: 90%

## When to Use

- Working with code in `00_DIM/`
- Understanding how find_runs, load_previous_iteration, generate_html work
- Modifying eval-viewer-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | find_runs, load_previous_iteration, generate_html, _kill_port, do_GET (+5) |

## Entry Points

Start here when exploring this area:

- **`find_runs`** (Function) — `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py:59`
- **`load_previous_iteration`** (Function) — `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py:212`
- **`generate_html`** (Function) — `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py:249`
- **`main`** (Function) — `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py:386`
- **`get_mime_type`** (Function) — `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py:51`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `find_runs` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 59 |
| `load_previous_iteration` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 212 |
| `generate_html` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 249 |
| `main` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 386 |
| `get_mime_type` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 51 |
| `build_run` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 84 |
| `embed_file` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 148 |
| `do_GET` | Method | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 331 |
| `_kill_port` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 287 |
| `_find_runs_recursive` | Function | `00_DIM/skills_backup/cannon/eval-viewer/generate_review.py` | 67 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → Get_mime_type` | cross_community | 7 |

## How to Explore

1. `gitnexus_context({name: "find_runs"})` — see callers and callees
2. `gitnexus_query({query: "eval-viewer"})` — find related execution flows
3. Read key files listed above for implementation details
