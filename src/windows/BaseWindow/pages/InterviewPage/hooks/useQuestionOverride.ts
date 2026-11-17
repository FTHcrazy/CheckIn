/**
 * 题库的**写**通道统一出口：编辑基线题（写覆盖行）、隐藏基线题（墓碑）、
 * 还原默认、确认「沿用我的」、删除自建题。
 *
 * 【为什么写操作要收在一个 hook 里】
 * 五个动作共享三样东西：**正在写哪条**（按钮 loading）、**失败原因**（给用户看
 * 的中文原话）、**写完之后重算合并视图**。让每张卡片各建一份，`pendingId` 只会
 * 在点下去的那张卡片上亮，别的卡片仍可点同一条 —— 于是同一条记录会被并发写两次。
 * 所以页面只建一份，往下传。
 *
 * 【三条正确性铁律（每条都有对应用例钉住）】
 * 1. **`baseHash` 必须算「基线原题」**：合并函数拿 `row.baseHash` 与
 *    `hashPayload(当前基线题)` 比，对不上就把这条置成「基线已更新」并**永久提示**。
 *    拿合并后的 question（用户版本）去算，指纹与基线永远不等 —— 用户改一个字，
 *    这道题从此天天顶着「基线已更新」，点「沿用我的」也消不掉。
 * 2. **覆盖行的 `id` 必须等于基线 id，`baseId` 也必须等于 `id`**（handler 会校验）。
 *    改 id 等于把收藏（`localStorage` 里的 `string[]` 按 id 认人）全部丢给一道
 *    谁也不认识的题。
 * 3. **墓碑不带 payload**：删除基线题只是「不显示」，内容副本留在库里只会被
 *    后续的导入 / 导出当成一份可误读的真值。
 *
 * 【与 `useInterviewBank` 同款的两条容错】
 * - 没有 IPC 通道（jsdom 单测 / 浏览器直接开 dev server）时返回失败结果，**不抛**；
 * - 卸载之后回来的响应一律丢弃（`cancelled` 标记），不在已卸载组件上 setState。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §5.3 / §5.4 / §11
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ElectronAPI, InterviewWriteResultDTO } from "@/shared/types/electron";
import { QUESTION_BY_ID } from "../data/interview-bank";
import type { InterviewQuestion } from "../data/interview-types";
import { hashPayload } from "../persistence/interview-hash";

/** 一道题在合并视图里的来源（决定卡片显示哪些维护动作） */
export type QuestionOrigin = "baseline" | "override" | "new";

/**
 * 一次写操作的结果。
 *
 * `errors` 是主进程返回的**中文原话**（数组），调用方原样展示、不改写也不合并：
 * 用户看到的那句「覆盖基线题时 baseId 必须与 id 相同」就是排查线索本身。
 */
export interface QuestionWriteOutcome {
  ok: boolean;
  errors: string[];
}

/** 页面只建一份，往下传给卡片与抽屉 */
export interface QuestionOverrideApi {
  /** 正在写的那条 id（按钮 loading 用）；`null` = 空闲 */
  pendingId: string | null;
  /** 最近一次失败的完整原因（卡片区顶部提示用）；`null` = 没有错误 */
  error: string | null;
  /** 用户手动关掉提示 */
  clearError: () => void;
  /**
   * 保存一道题。
   *
   * 基线题（id 能在 `QUESTION_BANK` 里查到）写 `override` 行；用户自建题
   * （`u-` 前缀）写 `new` 行 —— 两条路径都由这里决定，调用方只给「改完之后的样子」。
   */
  saveOverride: (question: InterviewQuestion) => Promise<QuestionWriteOutcome>;
  /** 隐藏一道默认题（墓碑）；自建题请用 `deleteNew` */
  hideBaseline: (question: InterviewQuestion) => Promise<QuestionWriteOutcome>;
  /** 软删一道自建题（进回收站） */
  deleteNew: (id: string) => Promise<QuestionWriteOutcome>;
  /** 还原默认：删掉覆盖行，合并时自然回落基线 */
  revertToDefault: (id: string) => Promise<QuestionWriteOutcome>;
  /** 确认「基线已更新，沿用我的」：只记指纹，内容不动 */
  ackBaseline: (id: string) => Promise<QuestionWriteOutcome>;
  /**
   * 孤儿覆盖「转存为我的新建题」：换 `u-` 前缀新 id 另存一条，再删掉原覆盖行。
   *
   * 为什么必须换 id：覆盖行的 id 就是基线 id，基线在新版本已删掉它；沿用旧 id
   * 会让它永远算「孤儿」。换 id 的代价是这道题在收藏里的记录失效 ——
   * 所以只在用户**点了**这个按钮时才做，绝不静默迁移。
   */
  adoptOrphan: (id: string) => Promise<QuestionWriteOutcome>;
}

/** 渲染层唯一入口（`preload.ts` 的 interview 白名单） */
type InterviewBridge = ElectronAPI["interview"];

/** 没有 IPC 通道时的统一失败文案（与 `useInterviewBank` 的口径一致） */
const MESSAGE_NO_CHANNEL = "当前环境没有本地题库通道";

/** 拿不到结果时的兜底文案（handler 正常不会返回 undefined） */
function missingResult(label: string): string {
  return `${label}失败：本地题库没有返回结果`;
}

/** `unknown` 异常 → 人话。IPC reject 的原因可能是 Error、字符串或裸对象 */
function describeFailure(label: string, failure: unknown): string {
  const detail =
    failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  const trimmed = detail.trim();
  return trimmed ? `${label}失败（${trimmed}）` : `${label}失败`;
}

/** 通道句柄；没有 preload（jsdom / 浏览器）时为 `null` */
function interviewBridge(): InterviewBridge | null {
  return window.electronAPI?.interview ?? null;
}

/**
 * 写操作的五种动作。
 *
 * 每个动作都跑同一条流水线：查通道 → 置 loading → 调通道 → 校验结果 →
 * 失败带出 errors / 成功 `reload()`。`reload` 是**必须**的一步：不重算合并视图，
 * 用户点完「还原默认」看到的还是原来那道题，会以为没生效。
 */
export function useQuestionOverride(reload: () => void): QuestionOverrideApi {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** 卸载标记：卸载后回来的响应一律不落地（与 `useInterviewBank` 同款） */
  const cancelledRef = useRef<boolean>(false);
  /** 应用版本号缓存（`undefined` = 还没读过；`null` = 读不到） */
  const stampRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // StrictMode 下 effect 会「挂载 → 卸载 → 再挂载」，这里必须复位而不是只置 true
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  /**
   * 覆盖行的 `baseStamp`：基线版本号（`interview-meta-get` 的 `baseline_version`）。
   *
   * 只用于「你改的版本基于 2026-01 版」这类提示，拿不到就传 `null` ——
   * 主进程写入时对 `base_stamp` 走 `COALESCE`，传 null 不会抹掉已有的值。
   */
  const readBaseStamp = useCallback(async (): Promise<string | null> => {
    const cached = stampRef.current;
    if (cached !== undefined) return cached;
    const api = interviewBridge();
    let resolved: string | null = null;
    if (api && typeof api.metaGet === "function") {
      try {
        const meta = await api.metaGet();
        resolved = meta?.baselineVersion ?? null;
      } catch {
        // 元信息只是标注，读不到不该拦住保存
        resolved = null;
      }
    }
    stampRef.current = resolved;
    return resolved;
  }, []);

  /** 统一流水线：所有写通道都从这里过 */
  const run = useCallback(
    async (
      id: string,
      label: string,
      action: (api: InterviewBridge) => Promise<InterviewWriteResultDTO>,
    ): Promise<QuestionWriteOutcome> => {
      const api = interviewBridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return { ok: false, errors: [MESSAGE_NO_CHANNEL] };
      }

      setPendingId(id);
      setError(null);

      try {
        const result = await action(api);
        // 卸载后回来的响应：不改状态、不刷新（刷新会打到已卸载的父组件）
        if (cancelledRef.current) return { ok: false, errors: [] };

        if (!result) {
          const message = missingResult(label);
          setError(message);
          setPendingId(null);
          return { ok: false, errors: [message] };
        }
        if (!result.ok) {
          const errors =
            result.errors.length > 0 ? [...result.errors] : [`${label}失败，请稍后重试`];
          setError(errors.join("；"));
          setPendingId(null);
          return { ok: false, errors };
        }

        setPendingId(null);
        reload();
        return { ok: true, errors: [] };
      } catch (failure) {
        if (cancelledRef.current) return { ok: false, errors: [] };
        const message = describeFailure(label, failure);
        setError(message);
        setPendingId(null);
        return { ok: false, errors: [message] };
      }
    },
    [reload],
  );

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  /**
   * 保存（覆盖基线 / 新建自建题）。
   *
   * 判据是「id 在不在基线里」而不是 UI 传进来的 origin：UI 的 origin 可能因为
   * 一次还没刷新完的合并结果而过时，而 `QUESTION_BANK` 是编译期常量，永远准。
   */
  const saveOverride = useCallback(
    async (question: InterviewQuestion): Promise<QuestionWriteOutcome> => {
      const base = QUESTION_BY_ID[question.id] ?? null;

      if (base) {
        const baseStamp = await readBaseStamp();
        return run(question.id, "保存修改", (api) =>
          api.itemSave({
            id: question.id,
            kind: "question",
            action: "override",
            // handler 校验 `baseId === id`：覆盖行的主键就是基线 id
            baseId: question.id,
            status: "adopted",
            payload: question,
            baseStamp,
            // ⚠️ 指纹算的是**基线原题**（base），不是传进来的用户版本 question
            baseHash: hashPayload(base),
          }),
        );
      }

      if (!question.id.startsWith("u-")) {
        return { ok: false, errors: ["新建题目的 id 必须以 u- 开头"] };
      }
      return run(question.id, "保存新题", (api) =>
        api.itemSave({
          id: question.id,
          kind: "question",
          action: "new",
          baseId: null,
          status: "adopted",
          payload: question,
          baseStamp: null,
          baseHash: null,
        }),
      );
    },
    [readBaseStamp, run],
  );

  const hideBaseline = useCallback(
    async (question: InterviewQuestion): Promise<QuestionWriteOutcome> => {
      if (!QUESTION_BY_ID[question.id]) {
        return { ok: false, errors: ["只有内置的默认题可以隐藏，你自己新建的题请直接删除"] };
      }
      return run(question.id, "隐藏默认题", (api) =>
        api.itemSave({
          id: question.id,
          kind: "question",
          action: "override",
          baseId: question.id,
          status: "hidden",
          // 墓碑不带 payload（handler 会清空），但标题必填：「已隐藏的默认题」靠它显示
          title: question.title,
        }),
      );
    },
    [run],
  );

  const deleteNew = useCallback(
    async (id: string): Promise<QuestionWriteOutcome> =>
      run(id, "删除题目", (api) => api.itemDelete(id)),
    [run],
  );

  const revertToDefault = useCallback(
    async (id: string): Promise<QuestionWriteOutcome> =>
      run(id, "还原默认题目", (api) => api.itemRevertDefault(id)),
    [run],
  );

  const ackBaseline = useCallback(
    async (id: string): Promise<QuestionWriteOutcome> => {
      const base = QUESTION_BY_ID[id] ?? null;
      if (!base) {
        return { ok: false, errors: ["这道默认题在当前版本已经不存在了"] };
      }
      // 记的是**当前基线**的指纹（合并函数拿它与 `hashPayload(基线题)` 比）
      return run(id, "确认沿用我的版本", (api) => api.itemAckBase(id, hashPayload(base)));
    },
    [run],
  );

  /**
   * 孤儿转存：读覆盖行 → 换 `u-` 新 id 另存 → 删掉原覆盖行。
   *
   * 顺序不能反：先删后存，一旦存失败用户的内容就没了；而且 `itemGet` 在删除后
   * 也拿不到 payload。
   */
  const adoptOrphan = useCallback(
    async (id: string): Promise<QuestionWriteOutcome> => {
      const api = interviewBridge();
      if (!api) {
        setError(MESSAGE_NO_CHANNEL);
        return { ok: false, errors: [MESSAGE_NO_CHANNEL] };
      }

      setPendingId(id);
      setError(null);
      try {
        const row = await api.itemGet(id);
        if (cancelledRef.current) return { ok: false, errors: [] };
        if (!row || !row.payload) {
          const message = "这条内容在库里已经找不到了，请刷新后重试";
          setError(message);
          return { ok: false, errors: [message] };
        }

        // 新 id：`u-` 前缀 + 旧 id 的尾部（保留可读性），长度压到 64 以内
        const suffix = id.replace(/[^a-zA-Z0-9-]+/g, "-").slice(0, 40);
        const newId = `u-${row.kind === "glossary" ? "g" : row.kind === "diagram" ? "d" : "q"}-${suffix}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const payload =
          row.payload && typeof row.payload === "object"
            ? { ...(row.payload as Record<string, unknown>), id: newId }
            : row.payload;

        const saved = await api.itemSave({
          id: newId,
          kind: row.kind,
          action: "new",
          baseId: null,
          status: "adopted",
          payload,
          categoryId: row.categoryId ?? null,
          track: row.track ?? null,
          title: row.title,
        });
        if (cancelledRef.current) return { ok: false, errors: [] };
        if (!saved.ok) {
          const message = saved.errors.join("；") || "转存失败";
          setError(message);
          return { ok: false, errors: [message] };
        }

        // 转存成功才删原覆盖行：删不掉也不算失败（最多下次还看到这条孤儿）
        await api.itemRevertDefault(id);
        if (cancelledRef.current) return { ok: false, errors: [] };
        reload();
        return { ok: true, errors: [] };
      } catch (failure) {
        if (cancelledRef.current) return { ok: false, errors: [] };
        const message = describeFailure("转存这条内容", failure);
        setError(message);
        return { ok: false, errors: [message] };
      } finally {
        if (!cancelledRef.current) setPendingId(null);
      }
    },
    [reload],
  );

  return {
    pendingId,
    error,
    clearError,
    saveOverride,
    hideBaseline,
    deleteNew,
    revertToDefault,
    ackBaseline,
    adoptOrphan,
  };
}
