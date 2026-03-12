#!/usr/bin/env bun
/**
 * confirm_concept_map — Validate and persist a concept map
 * Input: { session_id, concept_map: { modules: [{ title, concepts: [{ name, description?, is_core?, target_tier }] }] } }
 * Output: { status, modules_written, concepts_written }
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { z } from "zod";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

const ConceptSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  is_core: z.boolean().default(false),
  target_tier: z.enum(["DWD", "DWS", "ADS"]).default("DWD"),
});

const ModuleSchema = z.object({
  title: z.string().min(1),
  concepts: z.array(ConceptSchema).min(1),
});

const ConceptMapSchema = z.object({
  modules: z.array(ModuleSchema).min(1),
});

function readInput(): any {
  const arg = process.argv[2];
  if (arg) return JSON.parse(arg);
  try {
    return JSON.parse(require("fs").readFileSync(process.stdin.fd, "utf8"));
  } catch {
    console.log(JSON.stringify({ status: "error", message: "Invalid JSON input" }));
    process.exit(1);
  }
}

const input = readInput();
const { session_id, concept_map } = input;

if (!session_id || !concept_map) {
  console.log(JSON.stringify({ status: "error", message: "Missing required fields: session_id, concept_map" }));
  process.exit(1);
}

const parsed = ConceptMapSchema.safeParse(concept_map);
if (!parsed.success) {
  console.log(JSON.stringify({ status: "error", message: "Invalid concept_map", errors: parsed.error.issues }));
  process.exit(1);
}

// Get material_id from session
const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

interface SessionRow { material_id: string | null; session_type: string; }
const session = sqlite.query("SELECT material_id, session_type FROM sessions WHERE id = ?").get(session_id) as SessionRow | null;
if (!session) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: `Session not found: ${session_id}` }));
  process.exit(1);
}
if (session.session_type === "INTERVIEW" && !session.material_id) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: "INTERVIEW 会话没有关联 material_id，无法创建概念图。请先通过 LEARNING 会话录入材料。" }));
  process.exit(1);
}
const material_id = session.material_id;
if (!material_id) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: `Session ${session_id} 没有关联 material_id。请先上传学习材料。` }));
  process.exit(1);
}

const now = new Date().toISOString();
let modules_written = 0;
let concepts_written = 0;

// Wrap in transaction for atomicity — all modules+concepts succeed or none
const insertAll = sqlite.transaction(() => {
  for (let i = 0; i < parsed.data.modules.length; i++) {
    const mod = parsed.data.modules[i]!;
    const module_id = crypto.randomUUID();

    sqlite.prepare(
      `INSERT INTO modules (id, session_id, material_id, title, sequence, status, concept_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
    ).run(module_id, session_id, material_id, mod.title, i + 1, mod.concepts.length, now, now);
    modules_written++;

    for (const concept of mod.concepts) {
      sqlite.prepare(
        `INSERT INTO concepts (id, module_id, name, description, is_core, target_tier, mastery_status, mastery_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'NOT_STARTED', 0, ?, ?)`
      ).run(crypto.randomUUID(), module_id, concept.name, concept.description ?? null, concept.is_core ? 1 : 0, concept.target_tier, now, now);
      concepts_written++;
    }
  }
});

try {
  insertAll();
} catch (err: any) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: `Transaction failed: ${err.message}` }));
  process.exit(1);
}

sqlite.close();

console.log(JSON.stringify({ status: "ok", modules_written, concepts_written }));
