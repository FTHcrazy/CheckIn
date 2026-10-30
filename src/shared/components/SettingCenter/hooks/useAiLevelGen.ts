/**
 * 等级体系 AI 生成 / 拓展的状态机（R-AI-18）
 *
 * 设定中心（本书域）与全局设定中心（全局库）**共用这一份**：
 * 差异只在调用方传进来的 `categories` / `workName` / `onBatchAddLevels`
 * （各走各自的批量追加通道），UI 与状态机不复制。
 *
 * 为什么状态机放在 hook 而不是 `useSettingCenter`：
 * 后者是**纯 UI 状态机**（不 import IPC / AI），它的 17 个回归用例也据此成立。
 * AI 请求要碰 `ai-client`，所以单开一层，只在需要的地方挂载。
 *
 * 三条硬口径：
 * 1. **只追加**：写入只走 `onBatchAddLevels`（既有通道，不新增 IPC），
 *    绝不产出「删除 / 重排现有等级」的动作 —— 等级行被角色卡与行囊按名字引用；
 * 2. **候选必须勾选**：`run()` 只产候选，写入发生在 `apply()`；
 * 3. **不越级授权**：只发分类名 / 说明 / 已有阶梯名 / 作品题材，不含正文，
 *    属 L1/L2 —— 因此**不弹 L3 授权弹窗**（PRD §五）。
 */
import { useCallback, useMemo, useState } from "react";
import { aiGenerateStructured, logAiEvent } from "@/shared/ai/ai-client";
import { collectBookContext } from "@/shared/ai/context/collector";
import { buildPromptSpec } from "@/shared/ai/context/prompt";
import { promptVersionOf } from "@/shared/ai/context/prompt/registry";
import { useAiAvailability } from "@/shared/ai/hooks/useAiAvailability";
import type { LevelBatchItem, SettingCategory } from "@/shared/novel/setting-types";
import { sortLevels } from "@/shared/novel/setting-utils";
import {
  LEVEL_COUNT_RANGE,
  buildLevelCandidates,
  countLevelPicks,
  pickedLevelItems,
  type LevelCandidate,
  type LevelGenMode,
} from "@/shared/novel/level-gen";

/** 一次生成会话（与面板一一对应；关面板即丢弃） */
export interface LevelGenSession {
  categoryId: string;
  categoryName: string;
  mode: LevelGenMode;
  loading: boolean;
  error: string | null;
  candidates: LevelCandidate[];
  /** 模型没吐合法 JSON、走了启发式兜底（结果质量可能下降，面板要如实说） */
  usedFallback: boolean;
  /** 已加入阶梯的级数；非 null 时面板显示「已加入 N 级」 */
  applied: number | null;
}

export interface UseAiLevelGenParams {
  /** 分类来源：写入后要重查最新快照，下一批的「现有阶梯」才含刚加的 */
  categories: readonly SettingCategory[];
  /** 作品背景（全局库传「跨书共享」与 undefined 题材） */
  workName: string;
  genre?: string | null;
  /** 写入通道：既有批量追加（本书域 / 全局域各一条），不新增 IPC */
  onBatchAddLevels: (categoryId: string, items: LevelBatchItem[]) => void;
  onNotify?: (text: string, tone?: "success" | "info" | "warning" | "error") => void;
}

export interface AiLevelGenController {
  dialogOpen: boolean;
  session: LevelGenSession | null;
  mode: LevelGenMode;
  setMode: (mode: LevelGenMode) => void;
  countText: string;
  setCountText: (value: string) => void;
  /** 夹取后的条数（面板按钮与提示共用一个数） */
  count: number;
  /** 非空时「整理整套」不可用（说明为什么） */
  generateBlockedReason: string | null;
  /** AI 不可用的一句话说明；非空时入口禁用 */
  unavailableText: string | null;
  /** AI 被用户关掉 / 本版本没有通道 → 入口整个不渲染 */
  hidden: boolean;
  /** 当前分类名（弹窗标题） */
  categoryName: string;
  /** 已勾选且不重名的条数 */
  pickedCount: number;
  openDialog: (category: SettingCategory) => void;
  close: () => void;
  run: () => void;
  toggle: (key: string) => void;
  apply: () => void;
}

/** 根级等级名（子层级不算一级：「练气 1–9 层」是练气的细分） */
function rootLevelNames(category: SettingCategory): string[] {
  return sortLevels(category.levels, category.carryDir)
    .filter((level) => !level.parentId)
    .map((level) => level.name.trim())
    .filter(Boolean);
}

/**
 * 条数夹取：`0` / 非数字一律视为「未填」，回落默认值而不是夹到下限
 * （面板里清空输入框得到的就是 0，此时应回到「默认 9 级」）。
 */
function clampCountText(mode: LevelGenMode, text: string): number {
  const { min, max, fallback } = LEVEL_COUNT_RANGE[mode];
  const value = Math.floor(Number(text));
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function useAiLevelGen(params: UseAiLevelGenParams): AiLevelGenController {
  const { categories, workName, genre, onBatchAddLevels, onNotify } = params;
  const ai = useAiAvailability();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [mode, setModeState] = useState<LevelGenMode>("generate");
  const [countText, setCountText] = useState("");
  const [session, setSession] = useState<LevelGenSession | null>(null);

  const category = useMemo(
    () => categories.find((item) => item.id === categoryId) ?? null,
    [categories, categoryId],
  );

  /**
   * 「整理整套」在**由高到低**且已有等级的阶梯上不可用。
   *
   * 原因不是保守，是语义上会错：`generate` 按「入门 → 顶点」产出**一整条**
   * 阶梯，而批量追加只会落在**末尾**。desc 阶梯的末尾是最弱的一端，整条加
   * 进去之后「顶点」会落到最底部，读起来像另起一套更弱的体系。
   * 空阶梯没有这个问题（整块就是全部内容，desc 显示自动「强在上」）。
   *
   * ⚠️ 落点本身在 2.17.1 已修好（desc 现在正确追加到显示末尾），所以这里
   * 不能再写「顺序相反」—— 提示必须说的是**追加位置带来的语义错位**。
   */
  const generateBlockedReason = useMemo((): string | null => {
    if (!category) return null;
    if (rootLevelNames(category).length === 0) return null;
    if (category.carryDir !== "desc") return null;
    return "这套阶梯「由高到低」排列且已有等级：「整理整套」只能追加到末尾，整条排出来顶点会落在最下面；想接着往下延伸请用「拓展后续」";
  }, [category]);

  const count = clampCountText(mode, countText);
  const pickedCount = session ? countLevelPicks(session.candidates) : 0;

  const openDialog = useCallback(
    (target: SettingCategory): void => {
      const empty = rootLevelNames(target).length === 0;
      // 空阶梯 → 整理整套（这才是「一键生成等级体系」的字面场景）；
      // 已有阶梯 → 拓展（author 点它多半是想继续往上加）
      const nextMode: LevelGenMode = empty ? "generate" : "extend";
      setCategoryId(target.id);
      setModeState(nextMode);
      setCountText(String(LEVEL_COUNT_RANGE[nextMode].fallback));
      setSession(null);
      setDialogOpen(true);
    },
    [],
  );

  const close = useCallback((): void => {
    setDialogOpen(false);
    setSession(null);
    setCategoryId(null);
  }, []);

  /** 切模式时把条数拉回该模式的默认值（9 与 4 混用会让作者以为输入没生效） */
  const setMode = useCallback((next: LevelGenMode): void => {
    setModeState(next);
    setCountText(String(LEVEL_COUNT_RANGE[next].fallback));
  }, []);

  const run = useCallback((): void => {
    if (!category) return;
    const effectiveMode: LevelGenMode =
      mode === "generate" && generateBlockedReason ? "extend" : mode;
    if (effectiveMode !== mode) setModeState(effectiveMode);

    const existing = rootLevelNames(category);
    const nextCount = clampCountText(effectiveMode, countText);
    const categoryName = category.name;
    const categoryId = category.id;

    setSession({
      categoryId,
      categoryName,
      mode: effectiveMode,
      loading: true,
      error: null,
      candidates: [],
      usedFallback: false,
      applied: null,
    });

    void (async () => {
      // 只发作品背景：要素卡对「排一条阶梯」是纯噪音（`LIMITS.levelGen` 一个都不采）
      const context = collectBookContext(
        { workName, workGenre: genre ?? undefined, entities: [] },
        "levelGen",
      );
      const spec = buildPromptSpec("levelGen", context, {
        categoryName,
        categoryNote: category.note,
        kind: category.kind === "realm" ? "realm" : "custom",
        existing,
        mode: effectiveMode,
        count: nextCount,
      });

      const result = await aiGenerateStructured({
        system: spec.system,
        prompt: spec.prompt,
        intent: "levelGen",
        count: nextCount,
        outputFormat: spec.outputFormat,
      }).catch((error: unknown) => {
        // 与其余 AI 入口同一条纪律：IPC 侧异常不能留下永远转圈的面板
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false as const,
          code: "internal" as const,
          message: message || "AI 调用失败，请重试",
        };
      });

      if (!result.ok) {
        setSession((prev) =>
          prev && prev.categoryId === categoryId
            ? { ...prev, loading: false, error: result.message }
            : prev,
        );
        return;
      }

      const candidates = buildLevelCandidates(result.data.entries, {
        existing,
        mode: effectiveMode,
        limit: nextCount,
      });

      setSession((prev) =>
        prev && prev.categoryId === categoryId
          ? {
              ...prev,
              loading: false,
              candidates,
              usedFallback: result.data.usedFallback,
              // 空候选有两种原因，文案必须分开：模型没听格式（兜底也没抓到）
              // 与「分类名不是有序体系」（模型老实给了空数组）
              error:
                candidates.length === 0
                  ? result.data.entries.length > 0
                    ? "模型给的等级名都不合规（太短、太长或与现有阶梯重名），换一次试试"
                    : "AI 没有给出等级名 —— 这个分类可能不是有序体系，补一句体系说明或换个分类名再试"
                  : null,
            }
          : prev,
      );
    })();
  }, [category, mode, generateBlockedReason, countText, workName, genre]);

  const toggle = useCallback((key: string): void => {
    setSession((prev) =>
      prev
        ? {
            ...prev,
            candidates: prev.candidates.map((item) =>
              item.key === key && !item.duplicate
                ? { ...item, selected: !item.selected }
                : item,
            ),
          }
        : prev,
    );
  }, []);

  const apply = useCallback((): void => {
    if (!session || session.loading) return;
    // 名字 + 等级说明一起入库：说明在候选里看得见，落库就必须跟着走
    const items = pickedLevelItems(session.candidates);
    if (items.length === 0) {
      onNotify?.("先勾选要加入阶梯的等级", "info");
      return;
    }
    onBatchAddLevels(
      session.categoryId,
      items.map((item) => ({ name: item.name, note: item.note })),
    );
    // 采纳上报：等级生成是「候选 → 资产」的路径，采纳率要能算
    void logAiEvent({
      intent: "levelGen",
      step: "adopt",
      itemCount: items.length,
      promptVer: promptVersionOf("levelGen"),
    });
    setSession((prev) =>
      prev
        ? {
            ...prev,
            applied: items.length,
            // 已写入的名字不能再点第二次（会建出两行同名等级）⇒ 全部取消勾选
            candidates: prev.candidates.map((item) => ({ ...item, selected: false })),
          }
        : prev,
    );
    onNotify?.(`已加入 ${items.length} 级`, "success");
  }, [session, onBatchAddLevels, onNotify]);

  return {
    dialogOpen,
    session,
    mode,
    setMode,
    countText,
    setCountText,
    count,
    generateBlockedReason,
    unavailableText: ai.available ? null : ai.reasonText || "AI 功能当前不可用",
    hidden: ai.hidden,
    categoryName: category?.name ?? "",
    pickedCount,
    openDialog,
    close,
    run,
    toggle,
    apply,
  };
}
