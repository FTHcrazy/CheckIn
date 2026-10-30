import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NovelTrashItemDTO } from "@/shared/types/electron";
import {
  listTrash,
  purgeChapter,
  purgeVolume,
  removeWork,
  restoreTrash,
} from "../../NovelPage/services/novel-service";

/** 批量操作进行中的哨兵值：与行内条目的 key 区分开，行内按钮据此不转圈 */
const BATCH_BUSY = "__batch__";

/**
 * 彻底删除：按类型分派到各自的级联通道。
 *
 * 作品复用既有的 `novel-work-delete`（叶 → 根单事务）；卷 / 章的级联顺序与
 * 它们的删除通道放在一起（novel-volume-purge / novel-chapter-purge）。
 * 渲染层只做分派，不拼任何删除顺序。
 */
async function purgeByKind(item: NovelTrashItemDTO): Promise<void> {
  if (item.kind === "volume") {
    await purgeVolume(item.id);
    return;
  }
  if (item.kind === "chapter") {
    await purgeChapter(item.id);
    return;
  }
  await removeWork(item.id);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 单条 / 批量的结果文案（作品用书名号，卷章用引号，与正文里的称呼一致） */
function named(kind: NovelTrashItemDTO["kind"], name: string): string {
  return kind === "work" ? `《${name}》` : `「${name}」`;
}

export interface UseTrashBinResult {
  items: NovelTrashItemDTO[];
  /** 保留期（天），由主进程下发 —— 页面只负责显示，不写死 30 */
  retentionDays: number;
  loading: boolean;
  /** 正在处理的条目 key（批量操作时为哨兵值），用于禁用 / 转圈 */
  busyKey: string | null;
  reload: () => Promise<void>;
  restoreOne: (item: NovelTrashItemDTO) => Promise<void>;
  purgeOne: (item: NovelTrashItemDTO) => Promise<void>;
  restoreMany: (items: NovelTrashItemDTO[]) => Promise<void>;
  purgeMany: (items: NovelTrashItemDTO[]) => Promise<void>;
  emptyAll: () => Promise<void>;
}

/**
 * 回收站数据编排（页面只订阅状态、派发动作）。
 *
 * **过期清理放在第一次读取时**（而不是主进程定时器）：应用不是常驻服务，
 * 关闭期间的定时器根本不会跑；进入本页顺手做一次，用户能看见「为什么少了」，
 * 也不必多养一条后台任务。清除动作走各自既有的级联通道，不另写一套。
 *
 * @param onDataChanged 回收站发生变化（恢复 / 彻底删除）后通知外部刷新书架与角标
 */
export function useTrashBin(onDataChanged?: () => void): UseTrashBinResult {
  const { message } = App.useApp();
  const [items, setItems] = useState<NovelTrashItemDTO[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /** 回调走 ref：父层每次渲染都会传新的函数，进依赖数组会让加载反复重跑。
   *  ⚠️ 只在 effect 里写 ref —— 渲染期写 ref 会被 `react-hooks/refs` 直接拦下，
   *  也确实会在并发渲染下读到半成品。 */
  const changedRef = useRef(onDataChanged);
  useEffect(() => {
    changedRef.current = onDataChanged;
  }, [onDataChanged]);
  /** 过期清理只做一次（StrictMode 下 effect 会跑两遍，ref 能记住已做过） */
  const expiredCheckedRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<{
    items: NovelTrashItemDTO[];
    retentionDays: number;
  }> => {
    const result = await listTrash();
    return { items: result.items, retentionDays: result.retentionDays };
  }, []);

  /**
   * 读取列表，并在首次进入时清掉已过保留期的条目。
   *
   * @param purgeExpired 是否顺手清理过期条目（只有首屏那次为 true）
   */
  const load = useCallback(
    async (purgeExpired: boolean): Promise<void> => {
      setLoading(true);
      try {
        const first = await fetchOnce();
        const expired = purgeExpired
          ? first.items.filter((item) => item.expired)
          : [];
        if (expired.length > 0) {
          for (const item of expired) {
            await purgeByKind(item);
          }
          const fresh = await fetchOnce();
          setItems(fresh.items);
          setRetentionDays(fresh.retentionDays);
          message.info(`已清理 ${expired.length} 项超过保留期的内容`);
          changedRef.current?.();
          return;
        }
        setItems(first.items);
        setRetentionDays(first.retentionDays);
      } catch (error) {
        message.error(`回收站读取失败：${errorText(error)}`);
      } finally {
        setLoading(false);
      }
    },
    [fetchOnce, message],
  );

  const reload = useCallback(() => load(false), [load]);

  // 首屏：挂载即读取，并做一次过期清理
  useEffect(() => {
    const purgeExpired = !expiredCheckedRef.current;
    expiredCheckedRef.current = true;
    void load(purgeExpired);
  }, [load]);

  const restoreOne = useCallback(
    async (item: NovelTrashItemDTO): Promise<void> => {
      setBusyKey(`${item.kind}:${item.id}`);
      try {
        const ok = await restoreTrash(item.kind, item.id);
        if (!ok) {
          message.warning("该条目已不在回收站，列表已刷新");
        } else {
          message.success(
            item.kind === "work"
              ? `${named(item.kind, item.name)}已恢复到书架`
              : `${named(item.kind, item.name)}已恢复`,
          );
          changedRef.current?.();
        }
        await reload();
      } catch (error) {
        message.error(`恢复失败：${errorText(error)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [message, reload],
  );

  const purgeOne = useCallback(
    async (item: NovelTrashItemDTO): Promise<void> => {
      setBusyKey(`${item.kind}:${item.id}`);
      try {
        await purgeByKind(item);
        message.success(`${named(item.kind, item.name)}已彻底删除`);
        await reload();
        changedRef.current?.();
      } catch (error) {
        message.error(`删除失败：${errorText(error)}`);
      } finally {
        setBusyKey(null);
      }
    },
    [message, reload],
  );

  /**
   * 批量操作：逐条串行执行，失败不中断。
   *
   * 串行而不是 `Promise.all` —— 每条都是一次级联写库，并行既抢 SQLite 的写锁，
   * 也会让「已处理几条」这类反馈失去意义。
   */
  const runBatch = useCallback(
    async (
      targets: NovelTrashItemDTO[],
      action: (item: NovelTrashItemDTO) => Promise<void>,
      doneText: (ok: number, failed: number) => string,
    ): Promise<void> => {
      if (targets.length === 0) return;
      setBusyKey(BATCH_BUSY);
      let ok = 0;
      let failed = 0;
      try {
        for (const item of targets) {
          try {
            await action(item);
            ok += 1;
          } catch {
            failed += 1;
          }
        }
      } finally {
        setBusyKey(null);
      }
      await reload();
      changedRef.current?.();
      const text = doneText(ok, failed);
      if (failed > 0) message.warning(text);
      else message.success(text);
    },
    [message, reload],
  );

  const restoreMany = useCallback(
    (targets: NovelTrashItemDTO[]) =>
      runBatch(
        targets,
        async (item) => {
          const ok = await restoreTrash(item.kind, item.id);
          if (!ok) throw new Error(`${item.name} 已不在回收站`);
        },
        (ok, failed) =>
          failed > 0
            ? `已恢复 ${ok} 项，${failed} 项失败（可能已被清理）`
            : `已恢复 ${ok} 项`,
      ),
    [runBatch],
  );

  const purgeMany = useCallback(
    (targets: NovelTrashItemDTO[]) =>
      runBatch(
        targets,
        (item) => purgeByKind(item),
        (ok, failed) =>
          failed > 0
            ? `已彻底删除 ${ok} 项，${failed} 项失败`
            : `已彻底删除 ${ok} 项`,
      ),
    [runBatch],
  );

  const emptyAll = useCallback(
    (): Promise<void> =>
      runBatch(
        items,
        (item) => purgeByKind(item),
        (ok) => `已清空回收站（${ok} 项）`,
      ),
    [items, runBatch],
  );

  return {
    items,
    retentionDays,
    loading,
    busyKey,
    reload,
    restoreOne,
    purgeOne,
    restoreMany,
    purgeMany,
    emptyAll,
  };
}
