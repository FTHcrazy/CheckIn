/**
 * 用户管理 IPC handlers（应用级 authDb）
 *
 * 职责：缓存用户的读取 / 登录写入 / 邮箱更新。
 * 登录/更新成功后切换当前用户数据数据库。
 */
import { ipcMain } from "electron";
import { getAuthDb, switchUserDb } from "../db";

type UserCache = { id: number; email: string };

/** 读取缓存用户（单一记录，id 固定为 1） */
export function getCachedUser(): UserCache | null {
  const user = getAuthDb()
    .prepare("SELECT id, email FROM user WHERE id = 1 LIMIT 1")
    .get() as UserCache | undefined;
  return user?.email ? user : null;
}

export function registerUserHandlers(): void {
  ipcMain.handle("user-get", () => getCachedUser());

  ipcMain.handle("user-login", (_event, email: string) => {
    const normalizedEmail = email.trim();
    getAuthDb()
      .prepare(
        "INSERT INTO user (id, email, updated_at) VALUES (1, ?, datetime('now', 'localtime')) ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = datetime('now', 'localtime')",
      )
      .run(normalizedEmail);
    switchUserDb(normalizedEmail);
    return true;
  });

  ipcMain.handle("user-update", (_event, email: string) => {
    const normalizedEmail = email.trim();
    getAuthDb()
      .prepare(
        "UPDATE user SET email = ?, updated_at = datetime('now', 'localtime') WHERE id = 1",
      )
      .run(normalizedEmail);
    switchUserDb(normalizedEmail);
    return true;
  });
}
