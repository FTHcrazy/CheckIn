/**
 * 卡文救援编排 hook（R-AI-11，T-11c）
 *
 * 只做编排，不做渲染、不拼 prompt：
 * - 组装 prompt 由页面层注入（`buildSpec`）——只有它知道 L3 授权范围与正文；
 * - 写正文 / 写灵感由页面层注入（`applyAdopt` / `applyUndo`）——编辑器与数据层
 *   不该被本 hook 认识（`AGENTS §2.2.2.1`）；
 * - 本层负责**状态机**：请求中 → 分段流式落卡 → 完成 / 失败；以及并发防护
 *   （换一批 / 切风格 / 关闭时中断旧流，旧流的后续写入整体作废）。
 *
 * 与续写（`useNovelPage.runContinuation`）同构：同样的 seq + ref 双保险，
 * 同样的「主动中断不算失败」口径 —— 两处行为一致，作者才不会觉得「这里怪」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastTone } from "@/shared/novel/use-auto-toast";
import {
  aiGenerateStream,
  aiGenerateStructured,
  getAiConfig,
  logAiEvent,
  type AiStreamHandle,
} from "@/shared/ai/ai-client";
import {
  createOllamaAccumulator,
  createOpenAiSseAccumulator,
} from "@/shared/ai/ai-stream-parse";
import { newBatchId } from "@/shared/ai/ai-provenance";
import {
  BRANCH_OUTPUT_FORMAT,
  type BranchOutlineNode,
  type RescueStyle,
} from "@/shared/ai/context";
import { createBranchStreamParser } from "../utils/parseBranchStream";
import type { RescueEdit, RescueLanding, RescueSegment } from "../utils/rescue";

/**
 * 无数据卡死看门狗：45 秒。
 *
 * 口径是「连续 45 秒**任何一帧**都没到达才算死」，不是「45 秒没出正文」——
 * spark-x2.6 这类 reasoning 模型会先吐几百字 `reasoning_content` 思考流，
 * 思考帧也是活着的连接（真机日志：帧源源不断、正文排在思考后面），把思考
 * 阶段当无进展等于每次必失败。思考帧到达即续期，只有连接彻底哑掉才中断。
 */
export const RESCUE_STALL_TIMEOUT_MS = 45_000;

/**
 * 首段硬上限：180 秒。
 *
 * 连接活着但思考迟迟不出正文时，也不能无限等下去——180 秒还没写出第一条
 * 走向，就中断并提示换个风格或稍后重试（正常思考几十秒内会结束）。
 */
export const RESCUE_FIRST_SEGMENT_TIMEOUT_MS = 180_000;

/**
 * 正文开始后的总时长上限：120 秒。
 *
 * 从**首段落卡**起算（不是从发起请求起算）：否则思考占了 60 秒，写正文只剩
 * 60 秒预算，长走向写到一半被砍，前功尽弃。有正文就让它收完这一批。
 */
export const RESCUE_TOTAL_TIMEOUT_MS = 120_000;

/** 生成阶段 */
export type RescuePhase = "idle" | "loading" | "streaming" | "done" | "error";

/** 一次生成所需的 prompt（页面层算好，本层只负责发出去） */
export interface RescueSpec {
  system: string;
  prompt: string;
}

/** 生成参数：浮层持有的旋钮 + 入口上下文 */
export interface RescueGenerateParams {
  style: RescueStyle;
  count: number;
  outlineNode?: BranchOutlineNode;
}

export interface UseRescueBranchOptions {
  /** 组装 prompt；返回 null = 这次不该发（没有正文 / 没有选区） */
  buildSpec: (params: RescueGenerateParams) => RescueSpec | null;
  /** 采纳落点的执行者，返回可撤销记录（正文区间 / 灵感 noteId） */
  applyAdopt: (params: {
    batchId: string;
    segments: RescueSegment[];
    landing: RescueLanding;
  }) => Promise<RescueEdit[]>;
  /** 撤销执行者：按记录逆序回滚 */
  applyUndo: (edits: RescueEdit[]) => Promise<void>;
  /** 找出「采纳后又被作者改过」的记录（撤销前要问一句） */
  findStaleEdits: (edits: RescueEdit[]) => RescueEdit[];
  /** 二次编辑确认（Popconfirm 类确认框由页面层提供，这里只要结果） */
  confirmStale: (count: number) => Promise<boolean>;
  /** 轻提示 */
  notify: (text: string, tone?: ToastTone) => void;
}

export interface UseRescueBranchResult {
  /** 当前批次的卡片（流式过程中逐条增长） */
  segments: RescueSegment[];
  phase: RescuePhase;
  /** 还在等首段（骨架 / 整块 loading 的判据） */
  loading: boolean;
  /** 流式进行中（插入按钮锁定） */
  streaming: boolean;
  error: string | null;
  /** 当前批次 id；空串 = 还没有可采纳的结果 */
  batchId: string;
  /** 本批次已插入的记录条数（> 0 才显示「撤销本批次」） */
  undoCount: number;
  /** 发起（或换一批）一次生成；参数变了就是「换风格 / 换条数」 */
  generate: (params: RescueGenerateParams) => void;
  /** 中断在途生成，保留已落卡的走向 */
  stop: () => void;
  /** 清空结果（切章 / 关闭浮层 / 换作品） */
  reset: () => void;
  /** 采纳：按作者勾选顺序落到指定落点 */
  adopt: (params: { segments: RescueSegment[]; landing: RescueLanding }) => Promise<void>;
  /** 撤销本批次（整批回滚） */
  undo: () => Promise<void>;
}

/** 空态常量：避免每次渲染都新建字面量（`useState` 的比较才有意义） */
const EMPTY_SEGMENTS: RescueSegment[] = [];

/**
 * 卡文救援编排。
 *
 * 状态机（对应交互稿 §5）：idle → loading（首段未到）→ streaming（逐段落卡）
 * → done；失败 → error（已落卡的走向保留，只多一行错误说明）。
 */
export function useRescueBranch(options: UseRescueBranchOptions): UseRescueBranchResult {
  const { buildSpec, applyAdopt, applyUndo, findStaleEdits, confirmStale, notify } = options;

  const [segments, setSegments] = useState<RescueSegment[]>(EMPTY_SEGMENTS);
  const [phase, setPhase] = useState<RescuePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState("");
  const [undoCount, setUndoCount] = useState(0);

  /** 在途流句柄（中断用） */
  const streamRef = useRef<AiStreamHandle | null>(null);
  /**
   * 流序号：每次发起 / 中断自增。
   *
   * 为什么需要它：单 ref + 单状态在多流重入时会串味 —— 旧流的 catch 会把**新流**
   * 的 `streaming` 置 false，旧流收尾还会把 ref 清空，让新流再也 abort 不掉。
   * 序号让「旧流的后续写入」整体作废。
   */
  const seqRef = useRef(0);
  /** 本批次已插入的记录（撤销的唯一依据，由页面层在采纳时交回） */
  const editsRef = useRef<RescueEdit[]>([]);
  /** 已撤销过的批次：防止同一批被撤两次（第二次是空操作，但会误报「已撤销」） */
  const undoneRef = useRef("");

  const stop = useCallback((): void => {
    streamRef.current?.abort();
    streamRef.current = null;
    seqRef.current += 1;
  }, []);

  const reset = useCallback((): void => {
    stop();
    setSegments(EMPTY_SEGMENTS);
    setPhase("idle");
    setError(null);
    setBatchId("");
    setUndoCount(0);
    editsRef.current = [];
  }, [stop]);

  // 卸载时断开在途流：抽屉被切章 / 切作品带走时，连接不该继续挂着烧额度
  useEffect(() => () => stop(), [stop]);

  const generate = useCallback(
    (params: RescueGenerateParams): void => {
      const spec = buildSpec(params);
      if (!spec) {
        notify("这一章还没有正文，先去写两句再来救援", "warning");
        return;
      }

      stop();
      const seq = seqRef.current;
      /** 本次流的句柄：catch 里据此区分「主动中断」与「真失败」 */
      let streamed: AiStreamHandle | null = null;
      const nextBatch = newBatchId();

      setSegments(EMPTY_SEGMENTS);
      setPhase("loading");
      setError(null);
      setBatchId(nextBatch);
      setUndoCount(0);
      editsRef.current = [];

      const accepted = (): boolean => seqRef.current === seq;

      /**
       * 结构化降级：流式不可用 / 全部解析失败时的第二通道。
       *
       * 为什么不是「再来一次流式」：解析失败说明模型没按 JSON 输出，再流一次
       * 大概率还是同一堆 prose；`aiGenerateStructured` 带三层解析保险，能把
       * 「勉强像 JSON」的返回捞回来。代价是没有逐段观感，故整块 loading 无骨架卡。
       */
      const fallback = async (reason?: string): Promise<void> => {
        try {
          const result = await aiGenerateStructured({
            system: spec.system,
            prompt: spec.prompt,
            intent: "branch",
            outputFormat: BRANCH_OUTPUT_FORMAT,
            count: params.count,
          });
          if (!accepted()) return;
          if (!result.ok) {
            setError(result.message || reason || "生成失败，请重试");
            setPhase("error");
            return;
          }
          const parsed = result.data.entries
            .map((entry) => ({
              title: (entry.title ?? "").trim(),
              conflict: (entry.conflict ?? "").trim(),
              consequence: (entry.consequence ?? "").trim(),
            }))
            .filter((item) => Boolean(item.title && item.conflict && item.consequence))
            .slice(0, params.count);
          if (parsed.length === 0) {
            setError("模型没有给出可用的走向，换一批试试");
            setPhase("error");
            return;
          }
          setSegments(parsed);
          setPhase("done");
        } catch (thrown) {
          if (!accepted()) return;
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          setError(message || reason || "生成失败，请重试");
          setPhase("error");
        }
      };

      const run = async (): Promise<void> => {
        /**
         * 看门狗命中记录：文案 + 是否要保住已落卡的走向。
         * 定义在 try 外，catch 里 abort 打断挂起 read 抛过来时还能读到。
         */
        const watchdogHit = { message: "", keepCards: false };
        try {
          // provider 必须在建立流**之前**取到：放在之后会让首块在等待这次
          // IPC 的时间里攒起来，第一个 delta 一次吐出好几条卡片
          const provider = (await getAiConfig()).provider;
          if (!accepted()) return;
          const handle = await aiGenerateStream({
            system: spec.system,
            prompt: spec.prompt,
            intent: "branch",
          });
          streamed = handle;
          if (!accepted()) {
            handle.abort();
            return;
          }
          streamRef.current = handle;

          const accumulator =
            provider === "ollama" ? createOllamaAccumulator() : createOpenAiSseAccumulator();
          const parser = createBranchStreamParser();
          const startedAt = Date.now();
          /** 首段硬上限：思考流再热闹，超过它还没写正文就放弃 */
          const firstDeadline = startedAt + RESCUE_FIRST_SEGMENT_TIMEOUT_MS;
          /** 无数据看门狗：任何一帧到达都续期；思考慢不算死，彻底没数据才算死 */
          let stallDeadline = startedAt + RESCUE_STALL_TIMEOUT_MS;
          /** 正文开始后才有意义：从首段落卡起算的总时长（首段前不参与判定） */
          let totalDeadline = Number.POSITIVE_INFINITY;
          /** 本地镜像：避免为了「读当前已有几条」去 setState 里偷值 */
          const collected: RescueSegment[] = [];

          const append = (fresh: RescueSegment[]): void => {
            if (fresh.length === 0 || !accepted()) return;
            // 超过请求条数的丢弃：模型偶尔多给，多出来的会让界面编号越过 B5
            const room = params.count - collected.length;
            if (room <= 0) return;
            // 首段落卡：总时长预算从这一刻起算（思考耗时不再挤占写正文时间）
            if (collected.length === 0) totalDeadline = Date.now() + RESCUE_TOTAL_TIMEOUT_MS;
            const accepted_ = fresh.slice(0, room);
            collected.push(...accepted_);
            setSegments((prev) => [...prev, ...accepted_].slice(0, params.count));
            setPhase("streaming");
          };

          /**
           * 看门狗：真实计时器每秒巡检一次截止线，命中直接 abort。
           *
           * 为什么不写在读取循环里：截止判定夹在 `await readChunk()` 之间，
           * 连接彻底哑掉（readChunk 永不返回）时循环永远醒不来，判定形同虚设；
           * abort 会立刻打断挂起的 read（返回 null / 抛 AbortError），
           * 循环经 break / catch 退出，兜底文案在退出路径统一收场。
           */
          const watchdog = window.setInterval(() => {
            const now = Date.now();
            let message = "";
            if (now > stallDeadline) {
              // 连接哑掉（连续 45 秒一帧都没有）：流式协议层面已经卡死
              message = "模型连接长时间没有数据，已中断；可换一批或稍后重试";
            } else if (collected.length === 0 && now > firstDeadline) {
              // 连接活着但迟迟不出正文：思考流持续到达会续期 stallDeadline，
              // 走不到上一条分支，只能靠这个硬上限兜底
              message = "模型思考太久，还没开始写正文；已中断，可换个风格或稍后重试";
            } else if (now > totalDeadline) {
              // 正文开始后：总时长口径，保住已落卡的走向
              message = "生成超时，已保留已生成的走向";
            }
            if (message) {
              watchdogHit.message = message;
              watchdogHit.keepCards = collected.length > 0;
              handle.abort();
            }
          }, 1_000);

          try {
            for (;;) {
              if (!accepted()) return;
              const chunk = await handle.readChunk();
              if (chunk === null) break;
              // 思考帧 / 正文帧都算活着：到达即续期
              stallDeadline = Date.now() + RESCUE_STALL_TIMEOUT_MS;
              const delta = accumulator.push(chunk);
              if (delta) append(parser.push(delta));
            }
            const tail = accumulator.flush();
            if (tail) append(parser.push(tail));
            append(parser.flush());
          } finally {
            window.clearInterval(watchdog);
          }

          if (!accepted()) return;
          streamRef.current = null;

          // 看门狗命中但流是「正常结束」收场（abort 让 read 返回 null）：
          // 按命中的截止线文案收，别把 abort 误当成生成完成
          if (watchdogHit.message) {
            setError(watchdogHit.message);
            setPhase(watchdogHit.keepCards ? "streaming" : "error");
            return;
          }
          if (collected.length === 0) {
            // 一段都没解开：要么模型没按 JSON 输出，要么流是空的 —— 交给结构化通道
            await fallback();
            return;
          }
          setPhase("done");
        } catch (thrown) {
          if (!accepted()) return;
          streamRef.current = null;
          // 看门狗命中：abort 打断挂起的 read 抛到这里（AbortError），
          // 按截止线文案收场，别让 abort 被吞成「主动中断不算错误」
          if (watchdogHit.message) {
            setError(watchdogHit.message);
            setPhase(watchdogHit.keepCards ? "streaming" : "error");
            return;
          }
          // 主动中断不算错误：已落卡的走向保留，回到「可采纳」态
          if (streamed?.done) {
            setPhase((prev) => (prev === "loading" ? "idle" : "streaming"));
            return;
          }
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          await fallback(message);
        }
      };

      void run();
    },
    [buildSpec, notify, stop],
  );

  const adopt = useCallback(
    async (params: { segments: RescueSegment[]; landing: RescueLanding }): Promise<void> => {
      // 空批次拒绝（§3.2）：没有勾选就没有可写的正文，也没有可撤的记录
      if (params.segments.length === 0) {
        notify("先勾选至少一条走向", "warning");
        return;
      }
      const batch = batchId || newBatchId();
      const edits = await applyAdopt({
        batchId: batch,
        segments: params.segments,
        landing: params.landing,
      });
      if (edits.length === 0) {
        // 落点执行失败（编辑器没就绪 / 章节被删）：不留「已采纳」的假象
        return;
      }
      editsRef.current = edits;
      undoneRef.current = "";
      // 生成后直接采纳（没经过 batchId 的 setState）时也要把批次记牢：
      // 撤销是按 batchId 定位的，空批次会让「撤销本批次」变成永远的空操作
      if (batchId !== batch) setBatchId(batch);
      setUndoCount(edits.length);
      void logAiEvent({
        intent: "branch",
        step: "adopt",
        itemCount: params.segments.length,
      });
    },
    [applyAdopt, batchId, notify],
  );

  const undo = useCallback(async (): Promise<void> => {
    if (!batchId) return;
    if (undoneRef.current === batchId) {
      notify("这一批已经撤销过了", "info");
      return;
    }
    const edits = editsRef.current;
    if (edits.length === 0) {
      notify("没有可撤销的内容", "info");
      return;
    }
    // 二次编辑确认：记录里的原文与当前正文不一致 = 作者已经改过这段，
    // 整批撤销会连他的修改一起抹掉（§3.2 裁定口径）
    const stale = findStaleEdits(edits);
    if (stale.length > 0) {
      const ok = await confirmStale(stale.length);
      if (!ok) return;
    }
    await applyUndo(edits);
    undoneRef.current = batchId;
    editsRef.current = [];
    setUndoCount(0);
    notify("已撤销本批次", "success");
  }, [applyUndo, batchId, confirmStale, findStaleEdits, notify]);

  return {
    segments,
    phase,
    loading: phase === "loading",
    streaming: phase === "loading" || phase === "streaming",
    error,
    batchId,
    undoCount,
    generate,
    stop,
    reset,
    adopt,
    undo,
  };
}
