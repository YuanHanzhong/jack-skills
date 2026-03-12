import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

/** Append a JSONL record to the specified file */
export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  mkdirSync(dirname(filePath), { recursive: true });
  const existing = await Bun.file(filePath).text().catch((e: any) => {
    if (e?.code === "ENOENT" || e?.errno === -2) return "";
    throw e; // re-throw non-ENOENT errors
  });
  await Bun.write(filePath, existing + JSON.stringify(record) + "\n");
}

/** Read all lines from a JSONL string, skipping parse failures */
export function readJsonl<T = unknown>(text: string): T[] {
  const results: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { results.push(JSON.parse(trimmed) as T); } catch { /* skip */ }
  }
  return results;
}
