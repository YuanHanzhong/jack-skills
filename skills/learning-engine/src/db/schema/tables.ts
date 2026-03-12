import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─────────────────────────────────────────────
// Core tables (8)
// ─────────────────────────────────────────────

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    session_type: text("session_type", { enum: ["LEARNING", "INTERVIEW"] }).notNull(),
    status: text("status").notNull(),
    material_id: text("material_id"),
    current_module_id: text("current_module_id"),
    module_cursor: integer("module_cursor"),
    current_phase_scope: text("current_phase_scope", { enum: ["MATERIAL", "MODULE"] }),
    current_cursor: text("current_cursor"),
    version: integer("version").default(1).notNull(),
    last_event_at: text("last_event_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    index("sessions_status_updated_at_idx").on(t.status, t.updated_at),
  ]
);

export const materials = sqliteTable(
  "materials",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    title: text("title").notNull(),
    source_url: text("source_url"),
    content_hash: text("content_hash").notNull(),
    chunk_count: integer("chunk_count").notNull(),
    status: text("status", { enum: ["PENDING", "INGESTED", "ARCHIVED"] }).notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("materials_checksum_idx").on(t.content_hash),
  ]
);

export const modules = sqliteTable(
  "modules",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    material_id: text("material_id")
      .notNull()
      .references(() => materials.id),
    title: text("title").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status", { enum: ["PENDING", "ACTIVE", "COMPLETED"] }).notNull(),
    concept_count: integer("concept_count").default(0).notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    index("modules_session_id_status_idx").on(t.session_id, t.status),
  ]
);

export const concepts = sqliteTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    module_id: text("module_id")
      .notNull()
      .references(() => modules.id),
    name: text("name").notNull(),
    description: text("description"),
    is_core: integer("is_core").default(0).notNull(),
    target_tier: text("target_tier", { enum: ["DWD", "DWS", "ADS"] }).notNull(),
    mastery_status: text("mastery_status", {
      enum: ["NOT_STARTED", "IN_PROGRESS", "MASTERED"],
    }).notNull(),
    mastery_score: real("mastery_score").default(0).notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    index("concepts_module_id_is_core_idx").on(t.module_id, t.is_core),
    index("concepts_target_tier_mastery_status_idx").on(t.target_tier, t.mastery_status),
  ]
);

export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    concept_id: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    card_type: text("card_type", {
      enum: ["COVERAGE", "CARD_POINT", "APPLICATION", "EXPRESSION", "PROJECT_EVIDENCE"],
    }).notNull(),
    front: text("front").notNull(),
    back: text("back").notNull(),
    dedup_key: text("dedup_key").notNull(),
    priority: text("priority", { enum: ["P0", "P1", "P2", "P3"] }).notNull(),
    next_review_at: text("next_review_at"),
    review_count: integer("review_count").default(0).notNull(),
    ease_factor: real("ease_factor").default(2.5).notNull(),
    interval_days: integer("interval_days").default(1).notNull(),
    status: text("status", { enum: ["ACTIVE", "ARCHIVED", "MERGED"] }).notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    index("cards_concept_id_card_type_idx").on(t.concept_id, t.card_type),
    index("cards_next_review_at_priority_idx").on(t.next_review_at, t.priority),
    uniqueIndex("cards_dedup_key_idx").on(t.dedup_key),
  ]
);

export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  situation: text("situation"),
  task_text: text("task_text"),
  action_text: text("action_text"),
  result_text: text("result_text"),
  takeaway: text("takeaway"),
  project_name: text("project_name"),
  tags_json: text("tags_json"),
  status: text("status", { enum: ["DRAFT", "REVIEWED", "FINAL"] }).notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const interview_packs = sqliteTable("interview_packs", {
  id: text("id").primaryKey(),
  module_id: text("module_id")
    .notNull()
    .references(() => modules.id),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  pack_type: text("pack_type", { enum: ["MODULE_PACK", "INTERVIEW_SCRIPT"] }).notNull(),
  one_liner: text("one_liner"),
  core_points_json: text("core_points_json"),
  deep_dive_json: text("deep_dive_json"),
  project_evidence_json: text("project_evidence_json"),
  gotcha_defense_json: text("gotcha_defense_json"),
  status: text("status", { enum: ["DRAFT", "VALIDATED", "FINAL"] }).notNull(),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const problems = sqliteTable("problems", {
  id: text("id").primaryKey(),
  module_id: text("module_id")
    .notNull()
    .references(() => modules.id),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category"),
  difficulty: text("difficulty", { enum: ["L1", "L2", "L3"] }).notNull(),
  related_concepts_json: text("related_concepts_json"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

// ─────────────────────────────────────────────
// Auxiliary tables (8)
// ─────────────────────────────────────────────

export const material_chunks = sqliteTable(
  "material_chunks",
  {
    id: text("id").primaryKey(),
    material_id: text("material_id")
      .notNull()
      .references(() => materials.id),
    sequence: integer("sequence").notNull(),
    content: text("content").notNull(),
    hash: text("hash").notNull(),
    audit_status: text("audit_status", {
      enum: ["PENDING", "MAPPED", "MERGED", "SKIPPED"],
    }).notNull(),
    mapped_concept_id: text("mapped_concept_id").references(() => concepts.id),
    density_score: real("density_score"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("material_chunks_material_id_audit_status_idx").on(t.material_id, t.audit_status),
  ]
);

export const concept_relations = sqliteTable("concept_relations", {
  id: text("id").primaryKey(),
  source_concept_id: text("source_concept_id")
    .notNull()
    .references(() => concepts.id),
  target_concept_id: text("target_concept_id")
    .notNull()
    .references(() => concepts.id),
  relation_type: text("relation_type", {
    enum: ["PREREQUISITE", "RELATED", "EXTENDS", "CONTRADICTS"],
  }).notNull(),
  created_at: text("created_at").notNull(),
});

export const test_questions = sqliteTable("test_questions", {
  id: text("id").primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  module_id: text("module_id")
    .notNull()
    .references(() => modules.id),
  concept_id: text("concept_id").references(() => concepts.id),
  question_text: text("question_text").notNull(),
  difficulty: text("difficulty", { enum: ["L1", "L2", "L3"] }).notNull(),
  question_type: text("question_type").notNull(),
  sequence: integer("sequence").notNull(),
  created_at: text("created_at").notNull(),
});

export const answer_attempts = sqliteTable("answer_attempts", {
  id: text("id").primaryKey(),
  question_id: text("question_id")
    .notNull()
    .references(() => test_questions.id),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  user_answer: text("user_answer").notNull(),
  is_correct: integer("is_correct"),
  score: real("score"),
  feedback: text("feedback"),
  created_at: text("created_at").notNull(),
});

export const scoring_results = sqliteTable("scoring_results", {
  id: text("id").primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  module_id: text("module_id")
    .notNull()
    .references(() => modules.id),
  concept_id: text("concept_id")
    .notNull()
    .references(() => concepts.id),
  dimension: text("dimension", {
    enum: ["RECALL", "UNDERSTANDING", "APPLICATION", "EXPRESSION", "INSIGHT"],
  }).notNull(),
  score: real("score").notNull(),
  evidence: text("evidence"),
  created_at: text("created_at").notNull(),
});

export const story_links = sqliteTable(
  "story_links",
  {
    id: text("id").primaryKey(),
    concept_id: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    story_id: text("story_id")
      .notNull()
      .references(() => stories.id),
    relevance_score: real("relevance_score").notNull(),
    selected: integer("selected").default(0).notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("story_links_concept_id_story_id_idx").on(t.concept_id, t.story_id),
    index("story_links_concept_id_selected_idx").on(t.concept_id, t.selected),
  ]
);

export const review_queue = sqliteTable(
  "review_queue",
  {
    id: text("id").primaryKey(),
    card_id: text("card_id")
      .notNull()
      .references(() => cards.id),
    scheduled_at: text("scheduled_at").notNull(),
    priority: text("priority", { enum: ["P0", "P1", "P2", "P3"] }).notNull(),
    status: text("status", { enum: ["PENDING", "COMPLETED", "SKIPPED"] }).notNull(),
    completed_at: text("completed_at"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("review_queue_scheduled_at_priority_idx").on(t.scheduled_at, t.priority),
  ]
);

export const pending_questions = sqliteTable("pending_questions", {
  id: text("id").primaryKey(),
  session_id: text("session_id")
    .notNull()
    .references(() => sessions.id),
  question_text: text("question_text").notNull(),
  source_type: text("source_type", {
    enum: ["IN_MODULE", "CROSS_MODULE", "PROJECT_EXPRESSION", "UNRELATED"],
  }).notNull(),
  target_module_id: text("target_module_id").references(() => modules.id),
  status: text("status", { enum: ["PENDING", "RESOLVED", "DEFERRED"] }).notNull(),
  created_at: text("created_at").notNull(),
  resolved_at: text("resolved_at"),
});

// ─────────────────────────────────────────────
// Dual-track tables (2)
// ─────────────────────────────────────────────

export const coverage_rails = sqliteTable(
  "coverage_rails",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    module_id: text("module_id")
      .notNull()
      .references(() => modules.id),
    concept_id: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    status: text("status", {
      enum: ["NOT_COVERED", "PARTIALLY_COVERED", "FULLY_COVERED"],
    }).notNull(),
    coverage_evidence: text("coverage_evidence"),
    updated_at: text("updated_at").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("coverage_rails_session_module_concept_idx").on(
      t.session_id,
      t.module_id,
      t.concept_id
    ),
  ]
);

export const weakness_rails = sqliteTable(
  "weakness_rails",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    module_id: text("module_id")
      .notNull()
      .references(() => modules.id),
    concept_id: text("concept_id")
      .notNull()
      .references(() => concepts.id),
    weakness_type: text("weakness_type", {
      enum: ["RECALL", "UNDERSTANDING", "APPLICATION", "EXPRESSION", "INSIGHT"],
    }).notNull(),
    status: text("status", {
      enum: ["IDENTIFIED", "CARD_GENERATED", "RESOLVED"],
    }).notNull(),
    evidence: text("evidence"),
    card_id: text("card_id").references(() => cards.id),
    updated_at: text("updated_at").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("weakness_rails_session_module_concept_status_idx").on(
      t.session_id,
      t.module_id,
      t.concept_id,
      t.status
    ),
    index("weakness_rails_session_module_concept_type_status_idx").on(
      t.session_id,
      t.module_id,
      t.concept_id,
      t.weakness_type,
      t.status
    ),
  ]
);

// ─────────────────────────────────────────────
// Snapshot table (1)
// ─────────────────────────────────────────────

export const session_snapshots = sqliteTable(
  "session_snapshots",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    reason: text("reason", {
      enum: ["STOP", "PRE_COMPACT", "MODULE_SWITCH", "CRASH_RECOVERY"],
    }).notNull(),
    state_json: text("state_json").notNull(),
    resume_context_pack_json: text("resume_context_pack_json"),
    resume_pack_version: integer("resume_pack_version"),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    index("session_snapshots_session_id_reason_idx").on(t.session_id, t.reason),
    index("session_snapshots_session_id_created_at_idx").on(t.session_id, t.created_at),
  ]
);

// ─────────────────────────────────────────────
// Async job table (1)
// ─────────────────────────────────────────────

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.id),
    module_id: text("module_id").references(() => modules.id),
    job_type: text("job_type", {
      enum: ["MATERIAL_EXTRACT", "COVERAGE_AUDIT", "CARD_GEN", "PACK_BUILD", "NOTION_SYNC"],
    }).notNull(),
    status: text("status", {
      enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"],
    }).notNull(),
    payload_json: text("payload_json"),
    result_summary_json: text("result_summary_json"),
    error_message: text("error_message"),
    started_at: text("started_at"),
    finished_at: text("finished_at"),
    attempts: integer("attempts").default(0).notNull(),
    max_attempts: integer("max_attempts").default(3).notNull(),
    timeout_seconds: integer("timeout_seconds").default(90).notNull(),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => [
    index("jobs_session_id_status_idx").on(t.session_id, t.status),
    index("jobs_status_created_at_idx").on(t.status, t.created_at),
  ]
);
