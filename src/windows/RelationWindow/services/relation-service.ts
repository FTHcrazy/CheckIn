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

/** 边详情里「去右栏删除」：把主窗口抬到最前并打开该要素的资料卡 */
export async function focusEntityInMainWindow(workId: string, entityId: string): Promise<void> {
  if (!workId || !entityId) return;
  try {
    await window.electronAPI?.windowAPI?.sendTo(
      "novel",
      "rel-open-entity",
      { workId, entityId },
      true,
    );
  } catch {
    // 导航失败不阻断任何写入：用户仍可在主窗口自己找到这个要素
  }
}
