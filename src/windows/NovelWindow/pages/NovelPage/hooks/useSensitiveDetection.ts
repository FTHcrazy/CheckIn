/**
 * 敏感词检测的页面级接线（注册持久化 / 读盘 / 跳转消费）
 *
 * 页面只在编排层调用一次，把「编辑器要高亮什么词」「点结果跳到哪」两件事
 * 收成最小 props，其余状态留在模块级 store 里由各自组件订阅。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  registerSensitivePersistence,
  useSensitiveStore,
} from "../store/useSensitiveStore";
import {
  fetchSensitiveConfig,
  saveSensitiveConfig,
} from "../services/novel-service";
import {
  isHighlightEnabled,
  resolveHighlightSource,
  type SensitiveRange,
} from "../sensitive";

interface Options {
  /** 当前作品：切换时清空上一次的扫描结果（词库是全局的，保留） */
  activeWorkId: string;
  /** 当前编辑的章节：手动模式的标注只认「本章的扫描结果」，切章即失效 */
  currentChapterId: string | null;
  onSelectChapter: (chapterId: string) => void;
}

/** 稳定的空数组：手动模式未扫描时反复给它新引用会让编辑器每次渲染都 reconfigure */
const NO_RANGES: SensitiveRange[] = [];

export interface SensitiveDetection {
  /** 参与检测的词库（内置 - 屏蔽 + 用户），身份稳定，可直接喂给编辑器 compartment */
  words: string[];
  /** 正文层是否挂载（只有「关闭」才摘） */
  enabled: boolean;
  /**
   * 标注源：`null` = 按词库实时扫（自动模式）；
   * 数组 = 只标这些区间（手动模式，空数组即一个字都不标）。
   */
  ranges: SensitiveRange[] | null;
  /** 待定位的光标偏移：面板点结果后由编辑器消费一次 */
  focusPos: number | null;
  clearFocusPos: () => void;
  /** 正文脉搏：编辑器每次内容变更调用（记录最新草稿 + auto 模式防抖扫描） */
  handleDraftPulse: (chapterId: string, title: string, content: string) => void;
  /**
   * 手动模式：编辑器把「随编辑平移过」的区间报回来（引用稳定，可喂给高亮层）。
   * 面板计数、状态条角标、跳转位置据此与正文红字保持同一份事实。
   */
  handleRangesMapped: (ranges: SensitiveRange[]) => void;
}

export function useSensitiveDetection({
  activeWorkId,
  currentChapterId,
  onSelectChapter,
}: Options): SensitiveDetection {
  const words = useSensitiveStore((state) => state.activeWords);
  const mode = useSensitiveStore((state) => state.config.mode);
  const chapterMatches = useSensitiveStore((state) => state.chapterMatches);
  const chapterResultId = useSensitiveStore((state) => state.chapterResultId);
  const jumpTarget = useSensitiveStore((state) => state.jumpTarget);
  const load = useSensitiveStore((state) => state.load);
  const resetResults = useSensitiveStore((state) => state.resetResults);
  const consumeJump = useSensitiveStore((state) => state.consumeJump);
  const noteDraft = useSensitiveStore((state) => state.noteDraft);
  const syncChapterRanges = useSensitiveStore((state) => state.syncChapterRanges);

  const [focusPos, setFocusPos] = useState<number | null>(null);

  // 注册持久化实现 + 首次读盘（§6.2：store 不 import service，由使用方注入）
  useEffect(() => {
    registerSensitivePersistence({
      load: fetchSensitiveConfig,
      save: saveSensitiveConfig,
    });
    load();
    return () => registerSensitivePersistence(null);
  }, [load]);

  // 切作品：上一次的命中结果对新书没有意义，清掉；词库不动
  const workRef = useRef(activeWorkId);
  useEffect(() => {
    if (workRef.current === activeWorkId) return;
    workRef.current = activeWorkId;
    resetResults();
  }, [activeWorkId, resetResults]);

  /**
   * 消费跳转意图：先切章，再把偏移交给编辑器。
   *
   * 顺序不能反——聚焦到 `from` 需要新章的文档已经灌进编辑器，
   * 而灌入发生在切章渲染之后（EditorPane 内部用 rAF 等排版完成）。
   */
  useEffect(() => {
    if (!jumpTarget) return;
    onSelectChapter(jumpTarget.chapterId);
    setFocusPos(jumpTarget.from);
    consumeJump();
  }, [jumpTarget, onSelectChapter, consumeJump]);

  const handleDraftPulse = useCallback(
    (chapterId: string, title: string, content: string): void => {
      noteDraft({ id: chapterId, title, content });
    },
    [noteDraft],
  );

  const clearFocusPos = useCallback(() => setFocusPos(null), []);

  /**
   * 章节 id 的 ref：上报回调必须引用稳定（高亮层只在初始化时读一次），
   * 所以不能在闭包里直接吃 `currentChapterId` —— 那会随切章换一个新函数。
   */
  const chapterIdRef = useRef(currentChapterId);
  useEffect(() => {
    chapterIdRef.current = currentChapterId;
  }, [currentChapterId]);

  const handleRangesMapped = useCallback(
    (ranges: SensitiveRange[]): void => {
      const chapterId = chapterIdRef.current;
      if (!chapterId) return;
      syncChapterRanges(chapterId, ranges);
    },
    [syncChapterRanges],
  );

  /**
   * 标注源：把「模式」翻译成编辑器要标的东西。
   *
   * 手动模式**只标本章的扫描结果** —— 结果属于别的章、或者根本没扫过，
   * 都是空数组。这样从关闭切到手动时正文一定是干净的，不会凭空冒出红字；
   * 点「扫描本章」之后红字与面板列表、状态条计数同时出现，三者同源。
   */
  const source = resolveHighlightSource(mode);
  const ranges = useMemo<SensitiveRange[] | null>(() => {
    if (source === "live") return null;
    if (source === "none") return NO_RANGES;
    if (!chapterMatches) return NO_RANGES;
    return chapterResultId === currentChapterId ? chapterMatches : NO_RANGES;
  }, [source, chapterMatches, chapterResultId, currentChapterId]);

  return {
    words,
    enabled: isHighlightEnabled(mode),
    ranges,
    focusPos,
    clearFocusPos,
    handleDraftPulse,
    handleRangesMapped,
  };
}
