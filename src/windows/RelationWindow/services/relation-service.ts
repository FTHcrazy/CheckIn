/**
 * 关系图画布记忆的读写通道（窗口本地薄封装）
 *
 * 走现有的 `novel-config-get` / `novel-config-set`：**不新增 IPC、不新增表**。
 * 记忆是「一本书一张图」的单键 JSON，`novel_config` 本来就是键值表，为它造一条
 * 专用通道只会多一处要同步的 preload 白名单与类型声明，收益为零。
 *
 * ⚠️ 不要在 `useNovelData` / `useNovelPage` 里 import 本文件：
 * 那五份对 `novel-service` 做穷举 mock 的测试会因为多了一个模块而集体变红。
 * 图窗口自己持有这条通道，主窗口一概不碰（写回主窗口是 S3 的
 * `novel-links-changed` 广播，不是这里）。
 */
import type {
  NovelGraphCommitRequest,
  NovelGraphCommitResult,
} from "@/shared/types/electron";
import { graphDocKey, parseGraphDoc, serializeGraphDoc, type RelGraphDoc } from "../utils/graph-doc";

/**
 * 读取结果：**必须区分「没有记录」和「读失败」**。
 *
 * 两者都返回 null 会让调用方把一次瞬时故障当成「首次打开」——重新布局、播种、
 * 立刻写回，把用户摆好的坐标覆盖掉，且全程无提示。所以故障单独成一个分支，
 * 由调用方转成「本次不恢复、且禁止写回」。
 */
export type GraphDocRead =
  | { status: "ok"; doc: RelGraphDoc | null }
  | { status: "error"; message: string };

/** 读取本书的画布记忆；`ok + null` = 真的没有（调用方按首次打开处理） */
export async function readGraphDoc(workId: string): Promise<GraphDocRead> {
  const key = graphDocKey(workId);
  if (!key) return { status: "ok", doc: null };
  const api = window.electronAPI?.novel;
  if (!api?.configGet) return { status: "error", message: "数据通道不可用（预加载脚本未就绪）" };
  try {
    const raw = await api.configGet(key);
    return { status: "ok", doc: parseGraphDoc(raw) };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 写入整份记忆（单键直写，不做读-改-写，跨作品互不影响） */
export async function writeGraphDoc(workId: string, doc: RelGraphDoc): Promise<boolean> {
  const key = graphDocKey(workId);
  if (!key) return false;
  const api = window.electronAPI?.novel;
  if (!api) return false;
  try {
    return await api.configSet(key, serializeGraphDoc(doc));
  } catch {
    return false;
  }
}

/**
 * 提交关系变更（S3）：新建关系 + 改备注 + 画布文档，**单事务**。
 *
 * 与 `writeGraphDoc` 的分工：写坐标是高频、幂等、无冲突面的动作（单键直写）；
 * 建关系要连带去重 / 端点校验 / rev 乐观锁，必须交给主进程的事务，否则
 * 「边建好了坐标没存」这类半成品无法回滚。
 *
 * 通道缺失（老 preload）时按失败返回而不是抛错：调用方只需要一句可读提示。
 */
export async function commitGraph(
  request: NovelGraphCommitRequest,
): Promise<NovelGraphCommitResult> {
  const api = window.electronAPI?.novel;
  if (!api?.graphCommit) {
    return { ok: false, code: "db", message: "数据通道不可用（预加载脚本未就绪）" };
  }
  try {
    return await api.graphCommit(request);
  } catch (error) {
    return {
      ok: false,
      code: "db",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 「去主窗口打开资料卡」：把主窗口抬到最前并投递 `rel-open-entity`。
 *
 * 走通用 `window-send-to`（带 `create`）：主窗口没开时由主进程先入队再拉起，
 * 窗口装载后 preload 补投 —— 消息不会因为「窗口刚起来、React 还没订阅」而丢。
 * 落点判定全在主窗口侧（书架 → 切书；同一本书 → 直接开卡；另一本书 → 先弹确认），
 * 本函数只负责把意图送到，并如实返回「有没有送出去 / 排上了队」。
 * 返回 false 时调用方要给提示 —— 静默失败会让用户以为按钮坏了。
 */
export async function focusEntityInMainWindow(workId: string, entityId: string): Promise<boolean> {
  if (!workId || !entityId) return false;
  const api = window.electronAPI?.windowAPI;
  if (!api?.sendTo) return false;
  try {
    const result = await api.sendTo(
      "novel",
      "rel-open-entity",
      { workId, entityId },
      true,
      { create: true },
    );
    // `queued=true` 也算成功：消息已进待投递队列，窗口起来就会补投。
    // 只认 `delivered` 会把「窗口正在拉起」误报成失败 —— 用户会收到一句
    // 「主窗口没能打开」，而窗口其实已经在开了。
    return Boolean(result?.delivered || result?.queued);
  } catch {
    return false;
  }
}
