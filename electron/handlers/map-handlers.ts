/**
 * 小说地图语义化 IPC handlers（docs/novel-map-prd.md §6 数据层落点，M1 落地）
 *
 * 职责：novel_maps 表的读写编排，包括：
 * - 地图列表（按 work_id 分组，含未归属共享图册）
 * - 新建 / 重命名 / 删除（删除时级联清理父图对子图的引用）
 * - 整文档读写（保存时 schema 校验 + 环引用检测）
 * - 保存后向其他窗口广播 novel-map-updated（RM12 联动防抖 ≤ 300ms）
 *
 * 边界：SQL 只出现在本文件与 db.ts；不导入 main.ts；
 * 渲染层通过 preload 暴露的 map 命名空间调用，禁止裸拼 SQL。
 * RM7 作品绑定主地图走 config 键 novel_work_map_binding:{workId}，
 * 复用 novel-config-get/set，本文件不重复实现。
 */
import { ipcMain, dialog, app } from "electron";
import { dbAll, dbGet, dbRun } from "../db";
import { windowManager } from "../windowManager";

// ── 行类型（snake_case，对应表结构）──

interface NovelMapRow {
  id: string;
  work_id: string | null;
  name: string;
  seed: string;
  content: string;
  created_at: number;
  updated_at: number;
}

// ── DTO（与 src/shared/types/electron.d.ts 的 MapDTO 对齐）──

export interface MapDto {
  id: string;
  workId: string | null;
  name: string;
  seed: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface AnnotationRef {
  id: string;
  childMapId?: string | null;
}

interface MapContent {
  terrain?: { cells?: unknown };
  annotations?: AnnotationRef[];
}

function toDto(row: NovelMapRow): MapDto {
  return {
    id: row.id,
    workId: row.work_id,
    name: row.name,
    seed: row.seed,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 广播防抖窗口（RM12：≤ 300ms） */
let broadcastTimer: NodeJS.Timeout | null = null;
let pendingBroadcast: { mapId: string } | null = null;

function scheduleBroadcast(mapId: string): void {
  pendingBroadcast = { mapId };
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    if (pendingBroadcast) {
      // 广播给除发送方外的所有窗口；地图窗未开则自然丢弃（无队列堆积）
      windowManager.broadcast("novel-map-updated", pendingBroadcast);
      pendingBroadcast = null;
      broadcastTimer = null;
    }
  }, 250);
}

/**
 * 环引用检测：从 startMapId 出发，沿 annotations[].childMapId 链 DFS，
 * 若能回到 startMapId 则存在环（A→B→A），返回 true。
 * 支持 ≥ 3 级嵌套（RM5）。
 */
function detectCycle(startMapId: string, content: MapContent): boolean {
  const visited = new Set<string>();
  const stack: string[] = [];

  // 从 content 中收集直接子图引用
  const collectChildren = (annos: AnnotationRef[] | undefined): string[] => {
    if (!annos) return [];
    const ids: string[] = [];
    for (const a of annos) {
      if (a.childMapId) ids.push(a.childMapId);
    }
    return ids;
  };

  stack.push(...collectChildren(content.annotations));
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === startMapId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);

    const row = dbGet("SELECT content FROM novel_maps WHERE id = ?", [
      cur,
    ]) as { content?: string } | undefined;
    if (!row?.content) continue;
    try {
      const child = JSON.parse(row.content) as MapContent;
      stack.push(...collectChildren(child.annotations));
    } catch {
      // 子图 content 损坏：跳过，不阻断保存
      continue;
    }
  }
  return false;
}

/** 最小 schema 校验：content 必须是合法 JSON 对象 */
function validateContent(raw: string): MapContent | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as MapContent;
  } catch {
    return null;
  }
}

export function registerMapHandlers(): void {
  // ── 地图列表（按 work_id 分组，含未归属共享图册）──
  ipcMain.handle("novel-map-list", () => {
    const rows = dbAll(
      "SELECT id, work_id, name, seed, content, created_at, updated_at FROM novel_maps ORDER BY updated_at DESC",
    ) as NovelMapRow[];
    // 列表不带 content（避免大文档全量传输），只带元信息
    return rows.map((r) => ({
      id: r.id,
      workId: r.work_id,
      name: r.name,
      seed: r.seed,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

  // ── 加载单图（带 content）──
  ipcMain.handle("novel-map-load", (_event, mapId: string) => {
    const row = dbGet(
      "SELECT id, work_id, name, seed, content, created_at, updated_at FROM novel_maps WHERE id = ?",
      [mapId],
    ) as NovelMapRow | undefined;
    return row ? toDto(row) : null;
  });

  // ── 新建地图（id / seed / content 由渲染层生成）──
  ipcMain.handle(
    "novel-map-add",
    (_event, map: { id: string; workId: string | null; name: string; seed: string; content: string }) => {
      const now = Date.now();
      dbRun(
        "INSERT INTO novel_maps (id, work_id, name, seed, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [map.id, map.workId, map.name, map.seed, map.content, now, now],
      );
      return true;
    },
  );

  // ── 重命名 ──
  ipcMain.handle("novel-map-rename", (_event, mapId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    dbRun(
      "UPDATE novel_maps SET name = ?, updated_at = ? WHERE id = ?",
      [trimmed, Date.now(), mapId],
    );
    scheduleBroadcast(mapId);
    return true;
  });

  // ── 删除（级联清理父图对该子图的引用）──
  ipcMain.handle("novel-map-delete", (_event, mapId: string) => {
    // 删除前，遍历所有地图的 content，把引用了 mapId 的 childMapId 置空
    const all = dbAll("SELECT id, content FROM novel_maps") as {
      id: string;
      content: string;
    }[];
    for (const row of all) {
      if (row.id === mapId) continue;
      const parsed = validateContent(row.content);
      if (!parsed?.annotations) continue;
      let dirty = false;
      for (const a of parsed.annotations) {
        if (a.childMapId === mapId) {
          a.childMapId = null;
          dirty = true;
        }
      }
      if (dirty) {
        dbRun("UPDATE novel_maps SET content = ?, updated_at = ? WHERE id = ?", [
          JSON.stringify(parsed),
          Date.now(),
          row.id,
        ]);
        scheduleBroadcast(row.id);
      }
    }
    dbRun("DELETE FROM novel_maps WHERE id = ?", [mapId]);
    scheduleBroadcast(mapId);
    return true;
  });

  // ── 保存（整文档读写 + schema 校验 + 环引用检测）──
  ipcMain.handle(
    "novel-map-save",
    (_event, mapId: string, content: string, updatedAt: number) => {
      // schema 校验：content 必须是合法 JSON 对象
      const parsed = validateContent(content);
      if (!parsed) return { ok: false, reason: "content 非合法 JSON 对象" };

      // 乐观锁：updated_at 比对，冲突时拒绝并提示刷新
      const existing = dbGet(
        "SELECT updated_at FROM novel_maps WHERE id = ?",
        [mapId],
      ) as { updated_at?: number } | undefined;
      if (!existing) return { ok: false, reason: "地图不存在" };
      // 首次保存（updatedAt=0）跳过冲突检测
      if (updatedAt > 0 && existing.updated_at !== updatedAt) {
        return {
          ok: false,
          reason: "地图已在另一窗口更新，请刷新后重试",
        };
      }

      // 环引用检测（RM5）：拒绝 A→B→A 成环
      if (detectCycle(mapId, parsed)) {
        return { ok: false, reason: "检测到子图嵌套环引用，已拒绝保存" };
      }

      const now = Date.now();
      dbRun(
        "UPDATE novel_maps SET content = ?, updated_at = ? WHERE id = ?",
        [content, now, mapId],
      );
      scheduleBroadcast(mapId);
      return { ok: true, updatedAt: now };
    },
  );

  // ── 导出 PNG（RM6）：渲染层生成 dataURL，主进程弹系统保存框并写盘 ──
  ipcMain.handle(
    "novel-map-export-png",
    async (_event, dataUrl: string, defaultName: string) => {
      const first = windowManager.getAll().values().next().value as
        | import("electron").BrowserWindow
        | undefined;
      const defaultPath = `${app.getPath("pictures")}/${defaultName || "map"}.png`;
      const result = await dialog.showSaveDialog(first as import("electron").BrowserWindow, {
        title: "导出地图 PNG",
        defaultPath,
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, cancelled: true };
      }
      try {
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64, "base64");
        await import("fs/promises").then((fs) =>
          fs.writeFile(result.filePath as string, buffer),
        );
        return { ok: true, path: result.filePath as string };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    },
  );
}
