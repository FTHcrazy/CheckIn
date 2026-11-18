import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  InterviewItemDetailDTO,
  InterviewMuteHintDTO,
  InterviewTaxonomyDTO,
} from "@/shared/types/electron";
import type { InterviewDiagram } from "../data/interview-diagrams";
import type { GlossaryTerm } from "../data/interview-glossary";
import type { CategoryNode } from "../data/interview-taxonomy";
import { CATEGORIES } from "../data/interview-taxonomy";
import type { InterviewQuestion, QuestionTrack } from "../data/interview-types";
import { buildMergeBaseline, toMergeRows } from "../persistence/interview-bank-source";
import { buildGlossaryIndex, type GlossaryMatchIndex } from "../persistence/glossary-matcher";
import { hashPayload } from "../persistence/interview-hash";
import {
  mergeInterviewBank,
  type MergeResult,
} from "../persistence/merge-interview-bank";

/**
 * 自定义分类（`u-c-*`）→ 侧栏分类节点。
 *
 * `order` 直接取 `order_no`（>= 100）：基线是 1-22 连续，所以合并排序后
 * 自定义分类自然排在每条轨道的末尾，不会插进基线分组中间。
 *
 * 只收 `adopted`：`draft` 是「AI 建议 / 用户还没确认」的草稿，
 * 进侧栏就会出现「点进去 0 题」的空分类（规范 §9 闸门 ②）。
 */
export function toCategoryNodes(
  rows: readonly InterviewTaxonomyDTO[],
): CategoryNode[] {
  return rows
    .filter((row) => row.status === "adopted")
    .filter((row) => row.track === "written" || row.track === "foundation")
    .map((row) => ({
      id: row.id as CategoryNode["id"],
      label: row.label,
      track: row.track as QuestionTrack,
      order: row.orderNo,
    }))
    .sort((left, right) => left.order - right.order);
}

/**
 * 题库合并视图的状态。
 *
 * 「基线 ∪ 增量」的结果一次性摊平给消费方：页面只要 `questions`，
 * 名词渲染只要 `glossaryIndex`，图解只要 `diagramsById` —— 谁也不需要知道
 * 它们是从源码常量来的还是从 `interview.db` 来的。
 */
export interface InterviewBankState {
  questions: InterviewQuestion[];
  glossary: GlossaryTerm[];
  diagrams: InterviewDiagram[];
  /** 分类白名单 = 22 个基线 + 已采纳的自定义分类（侧栏 / 编辑下拉 / 卡片路径共用） */
  categories: CategoryNode[];
  /** 自定义分类的**原始**行（含 `draft`，分类管理面板要展示草稿并允许采纳） */
  taxonomy: InterviewTaxonomyDTO[];
  /**
   * `status='draft'` 的条目（**合并视图里没有它们**）。
   *
   * 合并只收 `adopted`：草稿是「AI 产出了但还没确认」的东西，混进题库列表会让
   * 「这道题算不算我背过」变成一笔糊涂账。但草稿必须能找到 —— 采纳过一条之后
   * 就再也没地方点「采纳」，等于把内容丢进黑洞。草稿箱抽屉消费这份数据。
   */
  drafts: InterviewItemDetailDTO[];
  /** 按合并后词表重建的匹配器（基线单例 matcher 不认用户新增的词条） */
  glossaryIndex: GlossaryMatchIndex;
  /**
   * 词条匹配负例（用户右键「这里不是这个词」）。
   *
   * 与 `glossaryIndex` 一起变：`reload()` 后重新拉一遍，索引跟着重建。
   * 页面用它渲染「已解除 N 处」的撤销入口。
   */
  hints: InterviewMuteHintDTO[];
  /** 图解 id → 图解；找不到就是 `undefined`，调用方判空即可 */
  diagramsById: Readonly<Record<string, InterviewDiagram>>;
  /** 被用户隐藏的基线题 id（后续「已隐藏的默认题」分区用） */
  hiddenIds: string[];
  /**
   * 每条渲染中的条目来自哪里（`baseline` / `override` / `new`）。
   *
   * 卡片靠它决定显示哪些维护动作；查不到 id 就当「不该显示动作」处理
   * （被隐藏的、被不变式丢弃的条目都不在这张表里）。
   */
  originById: Record<string, "baseline" | "override" | "new">;
  orphaned: MergeResult["orphaned"];
  staleBase: MergeResult["staleBase"];
  warnings: string[];
  /** 加载中：回落基线期间为 `true`（首帧也是 `true`，但那时数据已是基线） */
  loading: boolean;
  /** 读库失败的原因（人话）；`null` = 正常（包括「库里本来就没有增量」） */
  error: string | null;
  reload: () => void;
}

/**
 * 纯基线的合并结果。
 *
 * 模块级只建一次：① 首帧 `useState` 初值直接拿它，**不会先渲染空数组**
 * （否则用户会看到一闪而过的「没有题目」）；② 引用稳定，下游 `useMemo`
 * 不会因为「重新算了一份内容相同的基线」而白跑一轮。
 */
const BASELINE_MERGED: MergeResult = mergeInterviewBank(
  buildMergeBaseline(),
  [],
  hashPayload,
);

/** 22 个基线分类（模块级只取一次：与自定义分类拼白名单时复用同一个引用） */
const BASE_CATEGORIES: readonly CategoryNode[] = CATEGORIES;

/** 没有 IPC 通道（jsdom 单测、或用浏览器打开了 dev server）时的提示 */
const MESSAGE_NO_CHANNEL = "当前环境没有本地题库通道，本次显示内置题库";

/** `unknown` 异常 → 人话。IPC reject 的原因可能是 Error、字符串或裸对象 */
function describeFailure(failure: unknown): string {
  const detail =
    failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  const trimmed = detail.trim();
  if (!trimmed) return "读取本地题库失败，本次显示内置题库";
  return `读取本地题库失败（${trimmed}），本次显示内置题库`;
}

/** 有行被丢掉时的提示文案（丢掉的是脏数据，页面仍可用） */
function describeSkipped(skipped: number): string {
  return `本地题库有 ${skipped} 条记录格式无法识别，已跳过`;
}

/**
 * 题库合并视图（基线 ∪ `interview.db` 增量）。
 *
 * 【四条铁律】
 * 1. **首帧就是基线**：`useState` 初值 = 纯基线合并结果，绝不从空数组开始。
 * 2. **失败一律回落基线**：没有通道 / 未登录返回 `[]` / IPC reject /
 *    `toMergeRows` 全丢 —— 四种情况走同一条回落路径，页面永远可读，不抛、不白屏。
 * 3. **卸载后回来的响应要丢**：每次拉取带一个 `cancelled` 标记（等价于
 *    AbortController 的「这次请求作废」），避免在已卸载组件上 setState。
 * 4. **只读增量**：本轮不写库，也不在这里拼自定义分类（`taxonomyList` 与
 *    自定义分类的类型放宽同批做，届时才把 `categories` 传进 `buildMergeBaseline`）。
 */
export function useInterviewBank(): InterviewBankState {
  const [merged, setMerged] = useState<MergeResult>(BASELINE_MERGED);
  const [taxonomy, setTaxonomy] = useState<InterviewTaxonomyDTO[]>([]);
  const [items, setItems] = useState<InterviewItemDetailDTO[]>([]);
  const [hints, setHints] = useState<InterviewMuteHintDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState<number>(0);

  useEffect(() => {
    const api = window.electronAPI?.interview;

    // 情况一：没有通道（jsdom / 纯浏览器）。同步 setState，避免测试里多一个
    // 微任务导致的 act 警告，也让「回落」这件事在首帧之后就已完成。
    if (!api) {
      setMerged(BASELINE_MERGED);
      setTaxonomy([]);
      setItems([]);
      setHints([]);
      setError(MESSAGE_NO_CHANNEL);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async (): Promise<void> => {
      try {
        // `withPayload: true` 不能省：摘要通道没有 payload，合并会一条都用不上。
        // 分类与条目一起拉：分两次 await 会让「分类先到、条目后到」的中间态
        // 渲染出一批指向不存在分类的题（卡片路径显示「未分类」再跳回来）。
        // 负例也并进来：少一次往返，且索引重建时三者必须同一批（否则会有一帧
        // 用旧负例渲染出新词表）。
        const [list, customCategories, mutedHints] = await Promise.all([
          api.itemsList({ withPayload: true }),
          typeof api.taxonomyList === "function" ? api.taxonomyList() : Promise.resolve([]),
          typeof api.hintList === "function" ? api.hintList() : Promise.resolve([]),
        ]);
        if (cancelled) return;

        setTaxonomy(customCategories);
        setItems(list);
        setHints(mutedHints);
        const extraCategories = toCategoryNodes(customCategories);
        const baseline = buildMergeBaseline(
          extraCategories.length > 0 ? [...BASE_CATEGORIES, ...extraCategories] : undefined,
        );

        const { rows, skipped } = toMergeRows(list);
        if (rows.length === 0) {
          // 情况二：库里没有增量（未登录 / 空库）；情况三：有行但全是脏数据。
          // 两者渲染结果相同（基线），只有「要不要提示」不同。
          setMerged(mergeInterviewBank(baseline, [], hashPayload));
          setError(skipped > 0 ? describeSkipped(skipped) : null);
          setLoading(false);
          return;
        }

        setMerged(mergeInterviewBank(baseline, rows, hashPayload));
        setError(skipped > 0 ? describeSkipped(skipped) : null);
        setLoading(false);
      } catch (failure) {
        // 情况四：IPC reject（库被锁、主进程升级中、通道名对不上……）
        if (cancelled) return;
        setMerged(BASELINE_MERGED);
        setTaxonomy([]);
        setItems([]);
        setHints([]);
        setError(describeFailure(failure));
        setLoading(false);
      }
    };

    void load();

    return () => {
      // 卸载或 reload：这一次响应作废，绝不再 setState
      cancelled = true;
    };
  }, [reloadToken]);

  /**
   * 依赖 `merged.glossary` 的**引用**而不是长度：合并结果是不可变的，
   * 同一份词表永远同一个数组；换一批词条就整棵重建（几百节点，微秒级）。
   *
   * 负例也参与依赖：解除某处绑定后必须重建，否则那一处照旧点亮。
   */
  const glossaryIndex = useMemo<GlossaryMatchIndex>(
    () => buildGlossaryIndex(merged.glossary, { muted: hints }),
    [merged.glossary, hints],
  );

  const diagramsById = useMemo<Readonly<Record<string, InterviewDiagram>>>(
    () => Object.fromEntries(merged.diagrams.map((diagram) => [diagram.id, diagram])),
    [merged.diagrams],
  );

  const reload = useCallback((): void => {
    setReloadToken((token) => token + 1);
  }, []);

  /** 草稿箱的数据源：回收站里的草稿不出现（那时它已经不算「待确认」了） */
  const drafts = useMemo(
    () => items.filter((item) => item.status === "draft" && !item.deletedAt),
    [items],
  );

  return {
    questions: merged.questions,
    glossary: merged.glossary,
    diagrams: merged.diagrams,
    categories: merged.categories,
    taxonomy,
    drafts,
    glossaryIndex,
    hints,
    diagramsById,
    hiddenIds: merged.hiddenIds,
    originById: merged.originById,
    orphaned: merged.orphaned,
    staleBase: merged.staleBase,
    warnings: merged.warnings,
    loading,
    error,
    reload,
  };
}
