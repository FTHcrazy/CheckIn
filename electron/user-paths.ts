/**
 * 用户数据目录定位（跨 IPC handler 复用）
 *
 * 备忘目录 memos/ 同时被 memo-handlers（读写备忘）与 migration-handlers
 * （导出/导入 zip）使用，路径规则集中在此，避免两处各写一份。
 */
import fs from "fs";
import path from "path";
import { getUserDataDir, getCurrentUserEmail } from "./db";

/** 当前用户的备忘目录（memos/*.md） */
export function getMemosDir(): string {
  return path.join(getUserDataDir(getCurrentUserEmail()), "memos");
}

/** 确保备忘目录存在并返回其路径 */
export function ensureMemosDir(): string {
  const memosDir = getMemosDir();
  if (!fs.existsSync(memosDir)) fs.mkdirSync(memosDir, { recursive: true });
  return memosDir;
}
