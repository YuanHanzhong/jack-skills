---
name: scripts
description: "Skill for the Scripts area of 1_learn. 1763 symbols across 268 files."
---

# Scripts

1763 symbols | 268 files | Cohesion: 89%

## When to Use

- Working with code in `00_DIM/`
- Understanding how run_fanout, save_checkpoint_local, load_checkpoint_local work
- Modifying scripts-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `00_DIM/skills_backup/learning-engine/scripts/ods_learning.py` | build_probe_questions, mark_probe_results, build_compact_overview, parse_branch_selection, _flatten_points (+21) |
| `00_DIM/skills_backup/auto-filing/scripts/notion_doc_maintainer.py` | _save_state, get_close_persistence_instruction, set_page_ids, _validate_page_ids, _build_status_update_instructions (+15) |
| `00_DIM/skills_backup/doc-preprocessor/scripts/preprocessor_engine.py` | run_pdf_pipeline, run_csv_pipeline, normalize_whitespace, remove_ocr_artifacts, _remove_page_headers_footers (+15) |
| `00_DIM/skills_backup/write-auth-guard/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |
| `00_DIM/skills_backup/test-cannon-persistence/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |
| `00_DIM/skills_backup/reply-guard/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |
| `00_DIM/skills_backup/notion-ops/scripts/persistence_mixin.py` | save_to_notion, _get_task_summary, update_task, save_checkpoint, get_status (+14) |
| `00_DIM/skills_backup/local-instruction-generator/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |
| `00_DIM/skills_backup/learning-engine/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |
| `00_DIM/skills_backup/cannon/scripts/persistence_mixin.py` | generate_project_id, init_project, _save_recovery_copy, update_task, save_checkpoint (+14) |

## Entry Points

Start here when exploring this area:

- **`run_fanout`** (Function) — `00_DIM/skills_backup/write-auth-guard/scripts/fanout_runner.py:146`
- **`save_checkpoint_local`** (Function) — `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py:107`
- **`load_checkpoint_local`** (Function) — `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py:115`
- **`generate_dws_markdown`** (Function) — `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py:130`
- **`update_agent_status`** (Function) — `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py:234`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `BaseScenePlugin` | Class | `00_DIM/skills_backup/browser-automation/scripts/scene_plugin.py` | 24 |
| `ClaudeSkillUploadScene` | Class | `00_DIM/skills_backup/browser-automation/scripts/scene_plugin.py` | 71 |
| `FormFillScene` | Class | `00_DIM/skills_backup/browser-automation/scripts/scene_plugin.py` | 149 |
| `run_fanout` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/fanout_runner.py` | 146 |
| `save_checkpoint_local` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 107 |
| `load_checkpoint_local` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 115 |
| `generate_dws_markdown` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 130 |
| `update_agent_status` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 234 |
| `update_batch_progress` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 302 |
| `add_finding` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 311 |
| `mark_completed` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 320 |
| `mark_failed` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 329 |
| `read_before_decide` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 349 |
| `recover_from_dws_content` | Function | `00_DIM/skills_backup/write-auth-guard/scripts/dws_checkpoint.py` | 384 |
| `run_fanout` | Function | `00_DIM/skills_backup/reply-guard/scripts/fanout_runner.py` | 146 |
| `save_checkpoint_local` | Function | `00_DIM/skills_backup/reply-guard/scripts/dws_checkpoint.py` | 108 |
| `load_checkpoint_local` | Function | `00_DIM/skills_backup/reply-guard/scripts/dws_checkpoint.py` | 116 |
| `generate_dws_markdown` | Function | `00_DIM/skills_backup/reply-guard/scripts/dws_checkpoint.py` | 131 |
| `update_agent_status` | Function | `00_DIM/skills_backup/reply-guard/scripts/dws_checkpoint.py` | 235 |
| `update_batch_progress` | Function | `00_DIM/skills_backup/reply-guard/scripts/dws_checkpoint.py` | 303 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Main → _save` | cross_community | 6 |
| `Main → From_dict` | cross_community | 6 |
| `Main → To_dict` | cross_community | 6 |
| `Main → _ensure_dirs` | cross_community | 6 |
| `Main → _log_error` | cross_community | 6 |
| `Main → _load_checkpoint_safe` | cross_community | 6 |
| `Main → From_dict` | cross_community | 6 |
| `Main → To_dict` | cross_community | 6 |
| `Main → _ensure_dirs` | cross_community | 6 |
| `Main → _log_error` | cross_community | 6 |

## How to Explore

1. `gitnexus_context({name: "run_fanout"})` — see callers and callees
2. `gitnexus_query({query: "scripts"})` — find related execution flows
3. Read key files listed above for implementation details
