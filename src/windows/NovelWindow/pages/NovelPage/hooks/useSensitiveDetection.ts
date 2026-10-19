/**
 * 敏感词检测的页面级接线（注册持久化 / 读盘 / 跳转消费）
 *
 * 页面只在编排层调用一次，把「编辑器要高亮什么词」「点结果跳到哪」两件事
 * 收成最小 props，其余状态留在模块级 store 里由各自组件订阅。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  registerSensitivePersistence,
  useSensitiveStore,
} from "../store/useSensitiveStore";
import {
  fetchSensitiveConfig,
  saveSensitiveConfig,
} from "../services/novel-service";

interface Options {
  /** 当前作品：切换时清空上一次的扫描结果（词库是全局的，保留） */
  activeWorkId: string;
  onSelectChapter: (chapterId: string) => void;
}

export interface SensitiveDetection {
  /** 参与检测的词库（内置 - 屏蔽 + 用户），身份稳定，可直接喂给编辑器 compartment */
  words: string[];
  /** 是否启用高亮（仅自动模式：手动模式是「用完即走」的审计，正文保持干净） */
  enabled: boolean;
  /** 待定位的光标偏移：面板点结果后由编辑器消费一次 */
  focusPos: number | null;
  clearFocusPos: () => void;
  /** 正文脉搏：编辑器每次内容变更调用（记录最新草稿 + auto 模式防抖扫描） */
  handleDraftPulse: (chapterId: string, title: string, content: string) => void;
}

export function useSensitiveDetection({
  activeWorkId,
  onSelectChapter,
}: Options): SensitiveDetection {
  const words = useSensitiveStore((state) => state.activeWords);
  const mode = useSensitiveStore((state) => state.config.mode);
  const jumpTarget = useSensitiveStore((state) => state.jumpTarget);
  const load = useSensitiveStore((state) => state.load);
  const resetResults = useSensitiveStore((state) => state.resetResults);
  const consumeJump = useSensitiveStore((state) => state.consumeJump);
  const noteDraft = useSensitiveStore((state) => state.noteDraft);

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

  return {
    words,
    // 只有自动模式在正文上挂高亮：手动模式是「跑一次审计」，跑完不留在纸上
    enabled: mode === "auto",
    focusPos,
    clearFocusPos,
    handleDraftPulse,
  };
}
