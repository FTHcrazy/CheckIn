/**
 * 书架书卡右键「作品操作」的动作编排（2.56.0）
 *
 * 分层：数据快照的增删改在 `useBookshelfData`（乐观更新 + 跨页广播），
 * IPC 在服务层，本 hook 只管「菜单在哪 / 哪个弹框开着 / 点一下该做什么」。
 * 页面组件 `BookshelfPage` 不实现列表项菜单细节（AGENTS §6.4），只把回调接上。
 *
 * 与编辑器顶栏「作品管理」保持同一口径：重命名 / 题材 / 删除走同名 IPC，
 * 删除是**移入回收站**（软删除，30 天内可恢复），导出 TXT 走 shared 的
 * `buildBookPlainText` —— 同一部书在书架导与在编辑器导必须得到同一份稿子。
 */
import { useCallback, useMemo, useState } from "react";
import { App } from "antd";
import {
  exportShelfTextFile,
  fetchShelfWorkContent,
  pickShelfWorkCover,
  renameShelfWork,
  setShelfWorkGenre,
  trashShelfWork,
} from "../services/bookshelf-service";
import {
  validateWorkName,
  type ShelfNumberStyle,
  type WorkCardView,
} from "../bookshelf-utils";
import { applyWorkNumbering, type WorkNumberingEntry } from "@/shared/novel/work-numbering";
import { buildBookPlainText } from "@/shared/novel/plain-text";
import type { NovelWorkDTO } from "@/shared/types/electron";

export interface ShelfWorkMenuTarget {
  workId: string;
  /** 视口坐标：菜单按光标落位，而不是按卡片左上角 */
  x: number;
  y: number;
}

export type ShelfWorkModalKind = "rename" | "genre" | "delete" | null;

interface UseShelfWorkActionsParams {
  cards: WorkCardView[];
  /** 全局序号 / 后缀 / 缩进设置（编辑器写入、书架只读） */
  style: ShelfNumberStyle;
  /** 按书覆盖的序号规则：导出时也要认，不能只认全局设置 */
  numberingMap: Record<string, WorkNumberingEntry>;
  patchWork: (id: string, patch: Partial<NovelWorkDTO>) => void;
  removeWork: (id: string) => void;
  refresh: (silent?: boolean) => Promise<void>;
  /**
   * 作品被移入回收站之后的回调（书架页用它重算页脚角标）。
   *
   * 单靠「页面重新可见时刷新」不够：从书卡右键删掉一部作品，用户人还在书架页，
   * 页脚那颗 `回收站 · N` 不会变，得先点进回收站再退出来才更新 —— 看起来像
   * 删除没生效。删除成功后本 hook 直接通知一次，数字当场涨。
   */
  onTrashed?: () => void;
}

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export function useShelfWorkActions({
  cards,
  style,
  numberingMap,
  patchWork,
  removeWork,
  refresh,
  onTrashed,
}: UseShelfWorkActionsParams) {
  const { message } = App.useApp();
  const [target, setTarget] = useState<ShelfWorkMenuTarget | null>(null);
  const [modalKind, setModalKind] = useState<ShelfWorkModalKind>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [genreDraft, setGenreDraft] = useState("");
  const [nameError, setNameError] = useState("");
  /** 原生选图 / 保存框期间锁住确认按钮，防重复派发 */
  const [busy, setBusy] = useState(false);

  const activeWork = useMemo(
    () => (target ? cards.find((card) => card.id === target.workId) ?? null : null),
    [cards, target],
  );

  const openMenu = useCallback((workId: string, x: number, y: number): void => {
    setModalKind(null);
    setNameError("");
    setTarget({ workId, x, y });
  }, []);

  const closeMenu = useCallback((): void => {
    setTarget(null);
    setModalKind(null);
    setNameError("");
  }, []);

  const openRename = useCallback((): void => {
    if (!activeWork) return;
    setNameDraft(activeWork.name);
    setNameError("");
    setModalKind("rename");
  }, [activeWork]);

  const openGenre = useCallback((): void => {
    if (!activeWork) return;
    setGenreDraft(activeWork.genre ?? "");
    setModalKind("genre");
  }, [activeWork]);

  const confirmName = useCallback(async (): Promise<void> => {
    const work = activeWork;
    if (!work || busy) return;
    const name = nameDraft.trim();
    const error = validateWorkName(name);
    if (error) {
      setNameError(error);
      return;
    }
    setBusy(true);
    try {
      const ok = await renameShelfWork(work.id, name);
      if (!ok) {
        message.error("重命名失败，请重试");
        return;
      }
      patchWork(work.id, { name });
      message.success("作品已重命名");
      closeMenu();
    } catch (error) {
      message.error(errorText(error, "重命名失败，请重试"));
    } finally {
      setBusy(false);
    }
  }, [activeWork, busy, nameDraft, message, patchWork, closeMenu]);

  /** 题材允许留空保存（= 清除题材），与编辑器「作品题材」弹框同一口径 */
  const confirmGenre = useCallback(async (): Promise<void> => {
    const work = activeWork;
    if (!work || busy) return;
    const genre = genreDraft.trim();
    setBusy(true);
    try {
      const ok = await setShelfWorkGenre(work.id, genre);
      if (!ok) {
        message.error("题材保存失败，请重试");
        return;
      }
      patchWork(work.id, { genre: genre || undefined });
      message.success(genre ? "题材已更新" : "已清除题材");
      closeMenu();
    } catch (error) {
      message.error(errorText(error, "题材保存失败，请重试"));
    } finally {
      setBusy(false);
    }
  }, [activeWork, busy, genreDraft, message, patchWork, closeMenu]);

  /** 导入封面：主进程一次做完选图 / 压缩 / 落库，取消选图静默返回 */
  const pickCover = useCallback(async (): Promise<void> => {
    const work = activeWork;
    if (!work || busy) return;
    closeMenu();
    setBusy(true);
    try {
      const dataUrl = await pickShelfWorkCover(work.id);
      if (!dataUrl) return;
      patchWork(work.id, { cover: dataUrl });
      message.success("封面已更新");
    } catch (error) {
      message.error(errorText(error, "封面导入失败，换一张图片试试"));
    } finally {
      setBusy(false);
    }
  }, [activeWork, busy, closeMenu, message, patchWork]);

  /** 导出当前作品：只拉该书的卷章正文，序号口径与编辑器「导出整本」同源 */
  const exportWork = useCallback(async (): Promise<void> => {
    const work = activeWork;
    if (!work || busy) return;
    closeMenu();
    setBusy(true);
    try {
      const { volumes, chapters } = await fetchShelfWorkContent(work.id);
      if (chapters.length === 0) {
        message.warning("当前作品还没有章节");
        return;
      }
      const rule = applyWorkNumbering(style, work.id, numberingMap);
      const content = buildBookPlainText(work.name, volumes, chapters, {
        numberStyle: rule.numberStyle,
        chapterSuffix: rule.chapterSuffix,
        volumeSuffix: rule.volumeSuffix,
        paragraphIndent: rule.paragraphIndent !== false,
      });
      const result = await exportShelfTextFile(`${work.name}.txt`, content);
      if (result) message.success(`《${work.name}》已导出：${result.path}`);
      else message.info("已取消导出");
    } catch (error) {
      message.error(errorText(error, "导出失败，请重试"));
    } finally {
      setBusy(false);
    }
  }, [activeWork, busy, closeMenu, style, numberingMap, message]);

  const confirmDelete = useCallback(async (): Promise<void> => {
    const work = activeWork;
    if (!work || busy) return;
    setBusy(true);
    try {
      const ok = await trashShelfWork(work.id);
      if (!ok) {
        message.error("删除失败，请重试");
        return;
      }
      removeWork(work.id);
      message.success("已移入回收站，可在 30 天内恢复");
      closeMenu();
      // 回收站多了一条 → 角标当场 +1（不再等下次进回收站才更新）
      onTrashed?.();
      // 软删除会连带卷章 / 灵感 / 要素打标记，整包重载一次对齐统计与 Hero
      void refresh(true);
    } catch (error) {
      message.error(errorText(error, "删除失败，请重试"));
    } finally {
      setBusy(false);
    }
  }, [activeWork, busy, message, removeWork, closeMenu, refresh, onTrashed]);

  return {
    target,
    modalKind,
    activeWork,
    nameDraft,
    genreDraft,
    nameError,
    busy,
    menuVisible: target !== null && modalKind === null,
    setNameDraft,
    setGenreDraft,
    openMenu,
    closeMenu,
    openRename,
    openGenre,
    openDelete: () => setModalKind("delete"),
    confirmName,
    confirmGenre,
    confirmDelete,
    pickCover,
    exportWork,
  };
}

export type ShelfWorkActions = ReturnType<typeof useShelfWorkActions>;
