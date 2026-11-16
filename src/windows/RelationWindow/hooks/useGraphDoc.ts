/**
 * 画布记忆的装载与写回（S2）
 *
 * 职责边界：只做「记忆」这件事 —— 读、播种、增删移、去抖落库、关窗兜底。
 * 派生（谁上图、边怎么合并）仍归 `@/shared/novel/relation-graph` 的纯函数，
 * 布局归 `utils/graph-layout`，本 hook 只把三者接起来。
 *
 * 三条必须守住的约束：
 * ① **单键直写**：一本书一个 config 键，跨作品互不覆盖（不读-改-写全表）；
 * ② **离散动作立刻落库**（拖入 / 移出），连续动作（拖动）去抖 250ms ——
 *    只有「拖了很久一直没松手」才可能丢，且松手那次一定会写；
 * ③ **关窗前兜底**：`window-close-request`（关闭守卫）与 `beforeunload` 各刷一次，
 *    并在有未落库改动时武装关闭守卫，不让窗口静默吞掉坐标。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelEntity, NovelLink } from "@/shared/novel/entity-model";
import { buildRelationGraph, type RelationGraphDoc } from "@/shared/novel/relation-graph";
import type { SettingCategory } from "@/shared/novel/setting-types";
import { readGraphDoc, writeGraphDoc } from "../services/relation-service";
import {
  createEmptyGraphDoc,
  markSeeded,
  pruneMembers,
  seedMembers,
  setViewport as withViewport,
  stampGraphDoc,
  withMember,
  withMemberPosition,
  withoutMember,
  type GraphPoint,
  type GraphViewport,
  type RelGraphDoc,
} from "../utils/graph-doc";
import { layoutGraphNodes, type LayoutPoint } from "../utils/graph-layout";

/** 拖动去抖：连续拖动期间不写库，松手后这段时间内一定会写一次 */
const MOVE_SAVE_DELAY_MS = 250;

export interface GraphSource {
  workId: string;
  entities: NovelEntity[];
  links: NovelLink[];
  settings: SettingCategory[];
  /** 缺省派生（无成员集合），只用于「首次播种」与坐标兜底 */
  baseDoc: RelationGraphDoc;
}

export type GraphDocStatus = "idle" | "loading" | "ready";

/**
 * 关窗时的外部拦截：S3 的「未确认连线」是唯一需要用户决策的草稿。
 *
 * 为什么由上层决定而不是 hook 自己判断：hook 不认识「弹层还开着」这件事，
 * 而坐标改动（S2）本来就不该问 —— 两类脏数据的处置口径不同。
 */
export interface GraphCloseGuardOptions {
  /**
   * 是否存在「必须问用户」的草稿（S3：未确认的连线）。
   * 与坐标不同 —— 坐标是静默刷盘，连线草稿是「用户还没决定的东西」，丢了就是白拖。
   */
  hasDraft?: boolean;
  /** 被拦下时的通知（上层弹确认框；用户答复后由上层 respondClose） */
  onCloseBlocked?: () => void;
}

export interface UseGraphDocResult {
  /** 最终派生（已按成员集合裁过）：null = 还没装载完 */
  doc: RelationGraphDoc | null;
  /** 画布坐标（记忆优先，缺坐标时用布局兜底） */
  positions: Map<string, LayoutPoint>;
  /** 记忆里的视口（含缩放切分与平移）；null = 还没装载完 */
  viewport: GraphViewport | null;
  status: GraphDocStatus;
  saving: boolean;
  /** 有未落库的坐标/成员改动（关闭守卫据此武装） */
  dirty: boolean;
  /** 写库失败 / 恢复失败的单行提示 */
  notice: string | null;
  dismissNotice: () => void;
  /** 立刻把未落库的改动写掉（切书 / 关窗前调用） */
  flush: () => Promise<boolean>;
  /** 提交前取当前文档快照（含 rev）；null = 还没装载完 */
  snapshot: () => RelGraphDoc | null;
  /** 提交成功后把主进程返回的 rev 接过来（不触发写库，库里已经是新的） */
  adoptRev: (rev: number) => void;
  /**
   * 重新从库里装载记忆（stale 时的唯一正确动作）。
   * 会先摘掉在途的写库定时器：否则旧快照晚到一步，又把库写回冲突前的版本。
   */
  reload: () => Promise<boolean>;
  addNode: (id: string, point: GraphPoint) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, point: GraphPoint) => void;
  /** 视口变化（缩放 / 平移结束）：与坐标共用同一条去抖写库 */
  saveViewport: (view: GraphViewport) => void;
}

export function useGraphDoc(
  source: GraphSource | null,
  options: GraphCloseGuardOptions = {},
): UseGraphDocResult {
  const workId = source?.workId ?? "";
  const [memory, setMemory] = useState<RelGraphDoc | null>(null);
  const [status, setStatus] = useState<GraphDocStatus>("idle");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const memoryRef = useRef<RelGraphDoc | null>(null);
  const workIdRef = useRef(workId);
  const timerRef = useRef<number | null>(null);
  const requestRef = useRef(0);
  /**
   * 写库串行链：一次 `configSet` 超过去抖间隔时，两次 flush 会并发 ——
   * 后发先至就会让磁盘 rev 倒退（本地 7 / 库里 6），之后每次提交都被判 stale。
   * 所有写都挂在这条链上，保证「后发的一定后写」。
   */
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  /** 写入序号：只有最后一次写入的结果才允许清 dirty（更早的写完不算干净） */
  const writeSeqRef = useRef(0);
  /**
   * 读取失败后禁止写回：库里有一份好记忆，只是这次没读到。
   * 此时任何写（含关窗兜底）都会把用户摆好的布局覆盖掉。
   */
  const writeBlockedRef = useRef(false);

  /**
   * 「最新值 ref」的统一写法：**在 effect 里赋值，不在渲染期直接写 `.current`**。
   *
   * 为什么不用 `ref.current = x` 一行了事：渲染期写 ref 会让 React 编译器放弃
   * 整个组件的记忆化（`doc` 那个 useMemo 会被判定「无法保留」），并发渲染下
   * 还可能把被丢弃的那一帧的值留下来。这里读 ref 的地方全是异步回调（写库、
   * 关窗守卫），都发生在提交之后，effect 里赋值足够新。
   */
  useEffect(() => {
    workIdRef.current = workId;
  });

  /** 把记忆塞进 state 与 ref（两者必须同步，写库读的是 ref） */
  const commitMemory = useCallback((next: RelGraphDoc | null) => {
    memoryRef.current = next;
    setMemory(next);
  }, []);

  /** 有效的要素 id：写前收口与拖入校验共用 */
  const validIds = useMemo(() => {
    if (!source) return new Set<string>();
    const { workId: currentWorkId, entities } = source;
    return new Set(
      entities.filter((entity) => entity.workId === currentWorkId).map((entity) => entity.id),
    );
  }, [source]);
  const validIdsRef = useRef(validIds);
  useEffect(() => {
    validIdsRef.current = validIds;
  });

  const flush = useCallback(async (): Promise<boolean> => {
    const target = memoryRef.current;
    const targetWorkId = workIdRef.current;
    if (!target || !targetWorkId) return true;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (writeBlockedRef.current) {
      // 读失败 → 库里那份是好记忆，绝不能拿本地空白覆盖它
      setNotice("画布记忆这次没读到，本次不写回以免覆盖已保存的布局；请点「刷新」重试");
      return false;
    }
    setSaving(true);
    // 写前剔除已删除的要素：卡片删了坐标还留着，键会无限增长
    const pruned = pruneMembers(target, validIdsRef.current);
    // rev 只许前进：提交成功会由主进程接管 rev（adoptRev），若此刻还有一次
    // 坐标 flush 在途，按本地旧 rev+1 写回去会把版本号顶回去，下一次提交就误判 stale
    const stamped = stampGraphDoc(pruned.doc);
    const floorRev = memoryRef.current?.rev ?? 0;
    const safeStamped = stamped.rev < floorRev ? { ...stamped, rev: floorRev } : stamped;
    const seq = ++writeSeqRef.current;
    // 串行化：上一次写完再发下一次（失败也要放行链，否则后续写入永久卡住）
    const run = writeChainRef.current.then(
      () => writeGraphDoc(targetWorkId, safeStamped),
      () => writeGraphDoc(targetWorkId, safeStamped),
    );
    writeChainRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    const ok = await run;
    setSaving(false);
    if (!ok) {
      setDirty(true);
      setNotice("坐标没存住（数据库可能未就绪），请再拖动一次节点重试");
      return false;
    }
    if (memoryRef.current === target || memoryRef.current === pruned.doc) {
      commitMemory(safeStamped);
      // 期间没有新的拖动 / 没有排队的写 → 这才算全部落库
      if (seq === writeSeqRef.current) setDirty(false);
    } else {
      // 写库期间又有新的拖动：只推进 rev，绝不覆盖更新的坐标
      const current = memoryRef.current;
      if (current) commitMemory({ ...current, rev: Math.max(current.rev, safeStamped.rev), ts: safeStamped.ts });
    }
    return true;
  }, [commitMemory]);

  const apply = useCallback(
    (fn: (doc: RelGraphDoc) => RelGraphDoc, immediate: boolean) => {
      const current = memoryRef.current;
      if (!current) return;
      const next = fn(current);
      if (next === current) return;
      commitMemory(next);
      setDirty(true);
      if (immediate) {
        void flush();
        return;
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, MOVE_SAVE_DELAY_MS);
    },
    [commitMemory, flush],
  );

  /** 有效的要素 id：写前收口与拖入校验共用 */

  /**
   * 装载的触发条件用**内容签名**而不是对象引用。
   *
   * 为什么不用 `source` 引用：调用方每次渲染新建一个 source 字面量（很常见）会让
   * 这个 effect 无限重跑 —— 表现是「打开窗口后一直写库」，而且不会报错。
   *
   * 签名只认「作品 + 要素条数」，**不认边数**：S3 提交一条关系后本窗口会把新边
   * 合并进数据，若边数进签名就会立刻重装记忆 —— 而重装会用库里的旧值盖掉还没
   * 落库的坐标（用户刚拖过的那一下白拖）。边变化由图窗口自己合并，外部变化
   * 走「刷新」或 S4 的反向同步。
   */
  const sourceRef = useRef(source);
  useEffect(() => {
    sourceRef.current = source;
  });
  const loadSignature = source ? `${source.workId}|${source.baseDoc.all.length}` : "";

  // ── 装载：读记忆 → 首次播种 → （必要时）立刻写回 ──
  useEffect(() => {
    const src = sourceRef.current;
    if (!src) {
      commitMemory(null);
      setStatus("idle");
      return undefined;
    }
    const requestId = ++requestRef.current;
    let cancelled = false;
    setStatus("loading");

    void (async () => {
      const result = await readGraphDoc(src.workId);
      if (cancelled || requestId !== requestRef.current) return;

      if (result.status === "error") {
        // 读失败 ≠ 首次打开：库里有记忆，只是没读到。绝不能再播种写回 ——
        // 一次瞬时故障就把用户摆好的坐标换掉，是最难解释的丢失。
        writeBlockedRef.current = true;
        commitMemory(markSeeded(createEmptyGraphDoc()));
        setStatus("ready");
        setNotice("没能读到这本书的画布位置（数据通道异常），本次按空白画布打开，不会覆盖已保存的布局。");
        return;
      }
      writeBlockedRef.current = false;

      let doc = result.doc ?? createEmptyGraphDoc();
      let needPersist = false;

      if (doc.autoSeeded !== 1) {
        const layout = layoutGraphNodes(src.baseDoc.nodes, src.baseDoc.edges);
        const seeds = src.baseDoc.nodes.map((node) => ({
          id: node.id,
          point: layout.get(node.id) ?? { x: 0, y: 0 },
        }));
        const result = seedMembers(doc, seeds);
        doc = seeds.length > 0 ? result.doc : markSeeded(doc);
        needPersist = true;
      }

      commitMemory(doc);
      setStatus("ready");

      if (!needPersist) return;
      const stamped = stampGraphDoc(doc);
      // 与 flush 共用同一条串行链：播种写还在途时用户就开始拖动，两次写不能并发
      const seedRun = writeChainRef.current.then(
        () => writeGraphDoc(src.workId, stamped),
        () => writeGraphDoc(src.workId, stamped),
      );
      writeChainRef.current = seedRun.then(
        () => undefined,
        () => undefined,
      );
      const ok = await seedRun;
      if (cancelled || requestId !== requestRef.current) return;
      if (ok) {
        // 播种结果必须回写进本地：rev 以写回值为准，下次才不会误判冲突
        if (memoryRef.current === doc) commitMemory(stamped);
      } else {
        setNotice("首次自动铺开的坐标没能存住，下次打开会重新铺一次");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadSignature, commitMemory]);

  // ── 关窗兜底：关闭守卫先问一句，回答前把未落库的坐标刷掉 ──
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    const handler = (): void => {
      void (async () => {
        // 未确认的连接草稿要用户点头：把决定权交给上层，别在这里静默放行
        if (optionsRef.current.hasDraft) {
          optionsRef.current.onCloseBlocked?.();
          return;
        }
        await flush();
        api?.respondClose(true);
      })();
    };
    const onBeforeUnload = (): void => {
      void flush();
    };
    api?.on("window-close-request", handler);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      api?.off("window-close-request", handler);
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [flush]);

  // 只在真有未落库改动 / 未确认草稿时武装：常态关窗零往返（close-guard 的设计前提）
  const hasDraft = Boolean(options.hasDraft);
  useEffect(() => {
    window.electronAPI?.windowAPI?.setCloseGuard(dirty || hasDraft);
  }, [dirty, hasDraft]);

  /**
   * 派生（谁上图、边怎么合并）。三个字段先解构出来，只为让签名短一些。
   *
   * 依赖里**同时带上 `source` 本身**：`sourceEntities` 这些局部量是从 `source`
   * 读出来的，React 编译器会把依赖上溯到 `source`；只列字段级依赖会让它判定
   * 「手写依赖与推断不一致」，从而放弃整个组件的记忆化（`doc` 每帧重建 → 画布
   * 节点数组跟着重建 → React Flow 反复 setState）。既然调用方已经要求 source
   * 稳定（`App.tsx` 用 useMemo 绑 [data]），直接列 `source` 口径一致且更省。
   *
   * 注意：`data` 变了（含新增/删除了关系）`source` 就会换新 → 这里重建整图，
   * 这是期望行为（新边得立刻上图），与上面「装载」那条不认边数的口径不冲突：
   * 那条管的是**重读记忆**，重建会丢未落库的坐标。
   */
  const sourceWorkId = source?.workId ?? "";
  const sourceEntities = source?.entities;
  const sourceLinks = source?.links;
  const sourceSettings = source?.settings;
  // null = 还没有记忆（首次装载中）→ 走自动铺开；[] = 用户把图清空了。
  // 依赖用 `members` 的引用而不是整份 `memory`：rev / view 变化会换新对象，
  // 拿整份当依赖会让每次提交都重派生整图（200 个节点对象全换一遍）。
  const members = memory?.members ?? null;
  const memberIds = useMemo(() => (members ? Object.keys(members) : null), [members]);

  const doc = useMemo(() => {
    if (!sourceWorkId || !sourceEntities || !sourceLinks || !sourceSettings) return null;
    return buildRelationGraph({
      workId: sourceWorkId,
      entities: sourceEntities,
      links: sourceLinks,
      settings: sourceSettings,
      members: memberIds,
    });
  }, [source, sourceWorkId, sourceEntities, sourceLinks, sourceSettings, memberIds]);

  /** 记忆里缺坐标的节点（正常情况为 0；播放播种中的首帧会短暂出现） */
  const needFallbackLayout = useMemo(
    () => !!doc && doc.nodes.some((node) => !memory?.members[node.id]),
    [doc, memory],
  );

  const baseDoc = source?.baseDoc;
  const fallbackLayout = useMemo(() => {
    if (!needFallbackLayout || !baseDoc) return new Map<string, LayoutPoint>();
    return layoutGraphNodes(baseDoc.nodes, baseDoc.edges);
  }, [needFallbackLayout, baseDoc]);

  const positions = useMemo(() => {
    const map = new Map<string, LayoutPoint>();
    if (!doc) return map;
    for (const node of doc.nodes) {
      const tuple = memory?.members[node.id];
      if (tuple) map.set(node.id, { x: tuple[0], y: tuple[1] });
      else map.set(node.id, fallbackLayout.get(node.id) ?? { x: 0, y: 0 });
    }
    return map;
  }, [doc, memory, fallbackLayout]);

  const addNode = useCallback(
    (id: string, point: GraphPoint) => {
      if (!validIds.has(id)) return;
      apply((current) => withMember(pruneMembers(current, validIds).doc, id, point), true);
    },
    [apply, validIds],
  );

  const removeNode = useCallback(
    (id: string) => {
      apply((current) => withoutMember(current, id), true);
    },
    [apply],
  );

  const moveNode = useCallback(
    (id: string, point: GraphPoint) => {
      apply((current) => withMemberPosition(current, id, point), false);
    },
    [apply],
  );

  /** 视口（缩放 / 平移）与坐标共用同一条去抖写库：一次 flush 就是一次一致快照 */
  const saveViewport = useCallback(
    (view: GraphViewport) => {
      apply((current) => withViewport(current, view), false);
    },
    [apply],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  /** 提交前的文档快照：rev 必须来自这里（不是 state 里的副本，避免慢一拍） */
  const snapshot = useCallback((): RelGraphDoc | null => {
    const current = memoryRef.current;
    if (!current) return null;
    return pruneMembers(current, validIdsRef.current).doc;
  }, []);

  /**
   * 接住主进程提交后的新 rev。
   *
   * 只推进本地版本号、**不写库**：doc 是这次事务一起写进去的，库里已经是新的；
   * 再写一次会把 rev 顶到 +2，下一次提交就误判成 stale。
   */
  const adoptRev = useCallback(
    (rev: number) => {
      const current = memoryRef.current;
      if (!current || !Number.isFinite(rev) || rev <= current.rev) return;
      commitMemory({ ...current, rev });
    },
    [commitMemory],
  );

  const reload = useCallback(async (): Promise<boolean> => {
    const targetWorkId = workIdRef.current;
    if (!targetWorkId) return false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const result = await readGraphDoc(targetWorkId);
    if (result.status === "error") {
      setNotice("重新载入失败：画布记忆没读到，请稍后再试（本次不会写回，避免覆盖已保存的布局）");
      return false;
    }
    if (!result.doc) {
      setNotice("库里还没有这本书的画布记录，无法重新载入");
      return false;
    }
    writeBlockedRef.current = false;
    commitMemory(result.doc);
    setDirty(false);
    setNotice(null);
    return true;
  }, [commitMemory]);

  return useMemo(
    () => ({
      doc,
      positions,
      viewport: memory?.view ?? null,
      status,
      saving,
      dirty,
      notice,
      dismissNotice,
      flush,
      snapshot,
      adoptRev,
      reload,
      addNode,
      removeNode,
      moveNode,
      saveViewport,
    }),
    [
      doc,
      positions,
      memory,
      status,
      saving,
      dirty,
      notice,
      dismissNotice,
      flush,
      snapshot,
      adoptRev,
      reload,
      addNode,
      removeNode,
      moveNode,
      saveViewport,
    ],
  );
}
