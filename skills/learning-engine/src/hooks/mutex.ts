/**
 * mutex.ts — 文件锁（原子创建 + 过期检测）
 * 用于 Hook 并发安全
 */
import { openSync, closeSync, readFileSync, unlinkSync, mkdirSync, constants } from "fs";
import { resolve } from "path";

const LOCK_DIR = resolve(process.cwd(), ".learning-engine/state");
const LOCK_TIMEOUT_MS = 10_000; // 10 seconds

function getLockPath(name: string): string {
  return resolve(LOCK_DIR, `${name}.lock`);
}

const MAX_ACQUIRE_RETRIES = 5;

export function acquireLock(name: string, _retries = 0): boolean {
  if (_retries >= MAX_ACQUIRE_RETRIES) {
    return false; // Depth limit reached — avoid infinite recursion
  }

  mkdirSync(LOCK_DIR, { recursive: true });
  const lockPath = getLockPath(name);

  // Try atomic create with O_CREAT | O_EXCL (fails if file exists)
  try {
    const fd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    const buf = Buffer.from(Date.now().toString());
    const { writeSync } = require("fs");
    writeSync(fd, buf);
    closeSync(fd);
    return true;
  } catch (e: any) {
    if (e.code !== "EEXIST") throw e;
  }

  // File exists — check if stale
  try {
    const content = readFileSync(lockPath, "utf-8");
    const timestamp = parseInt(content, 10);
    if (Number.isNaN(timestamp) || Date.now() - timestamp >= LOCK_TIMEOUT_MS) {
      // Stale or corrupt lock — reclaim
      try { unlinkSync(lockPath); } catch { /* race: another process already removed it */ }
      return acquireLock(name, _retries + 1);
    }
  } catch {
    // File disappeared between EEXIST and read — retry
    return acquireLock(name, _retries + 1);
  }

  return false; // Lock held by another process
}

export function releaseLock(name: string): void {
  const lockPath = getLockPath(name);
  try { unlinkSync(lockPath); } catch { /* already removed */ }
}

export async function withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const maxWait = 5000;
  const start = Date.now();

  while (!acquireLock(name)) {
    if (Date.now() - start > maxWait) {
      throw new Error(`[mutex] Failed to acquire lock '${name}' after ${maxWait}ms`);
    }
    await Bun.sleep(50);
  }

  try {
    return await fn();
  } finally {
    releaseLock(name);
  }
}
