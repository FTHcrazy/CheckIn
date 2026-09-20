import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { Empty } from "antd";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { EditorSettings, EntityTerm, NovelChapter } from "../../types";
import { formatNumberedLabel } from "../../novel-utils";
import type { RestorePosition } from "../../novel-utils";
import {
  annotationEnabledCompartment,
  annotationEnabledFacet,
  annotationLayer,
  refreshAnnotation,
  termsCompartment,
  termsFacet,
} from "../../novel-editor";
import type { EditorSelection } from "../../hooks/useNovelEditorState";
import "./index.scss";

interface EditorPaneProps {
  chapter: NovelChapter | null;
  /** 全书章节序号（派生属性，随拖拽重排变动；0 表示未知） */
  chapterNumber: number;
  content: string;
  settings: EditorSettings;
  terms: EntityTerm[];
  typewriter: boolean;
  onChange: (value: string) => void;
  onSelectionChange: (selection: EditorSelection | null) => void;
  /** 选区非空时右键正文：坐标相对 .nv-page__stage，已按菜单尺寸 clamp */
  onContextMenu: (x: number, y: number) => void;
  onTermHover: (entityId: string, x: number, y: number) => void;
  onTermLeave: () => void;
  onTermClick: (entityId: string) => void;
  onCreateChapter: () => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  /** 续写位置恢复（R6）：与当前章节匹配时应用一次，完成后回调清空 */
  restore: RestorePosition | null;
  onRestoreDone: () => void;
  /** 光标移动上报（R6 位置记忆）：head 为文档内偏移 */
  onCursorChange: (head: number) => void;
  /** 正文滚动上报（R6 位置记忆）：scrollTop */
  onScrollChange: (scrollTop: number) => void;
}

/** 排版相关的动态样式走独立 compartment，改字号不必重建编辑器 */
const stylingCompartment = new Compartment();

const buildTheme = (settings: EditorSettings) =>
  EditorView.theme({
    "&": {
      height: "100%",
      fontSize: `${settings.fontSize}px`,
      backgroundColor: "var(--app-surface)",
      color: "var(--app-text)",
    },
    ".cm-content": {
      fontFamily: 'var(--nv-paper-font, inherit)',
      lineHeight: String(settings.lineHeight),
      padding: "8px 0 0",
      caretColor: "var(--app-primary)",
    },
    ".cm-line": {
      padding: "0 2px",
    },
    ".cm-scroller": {
      fontFamily: 'var(--nv-paper-font, inherit)',
      overflow: "auto",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftWidth: "2px",
      borderLeftColor: "var(--app-primary)",
    },
  });

/**
 * 弹层的定位基准是 .nv-page__stage（EntityContextMenu / HoverEntityCard
 * 的绝对定位父级），不是编辑器 host——host 在滚动容器内，滚动后
 * getBoundingClientRect 的 top 会变成负值，用它算坐标必然飘出视口。
 */
const stageRectOf = (host: HTMLElement): DOMRect =>
  host.closest<HTMLElement>(".nv-page__stage")?.getBoundingClientRect() ??
  host.getBoundingClientRect();

/** 数值夹取：min > max 时以 min 为准，保证结果恒在 [min, max] */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 中央码字区（设计方案 §05 ②）
 *
 * 内核为 CodeMirror 6 纯文本模式：虚拟滚动天然支撑三万字章节，
 * IME 由 CodeMirror 原生处理（组合输入不上报文档变更），
 * 标注层由 novel-editor.ts 的 ViewPlugin 提供，与 UI 完全解耦。
 */
export default function EditorPane({
  chapter,
  chapterNumber,
  content,
  settings,
  terms,
  typewriter,
  onChange,
  onSelectionChange,
  onContextMenu,
  onTermHover,
  onTermLeave,
  onTermClick,
  onCreateChapter,
  onRenameChapter,
  restore,
  onRestoreDone,
  onCursorChange,
  onScrollChange,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastLineRef = useRef<number>(-1);
  /** IME 组合期标记：拼音候选期间的文档变化不上报，避免字数按拼音递增（R2） */
  const composingRef = useRef(false);

  // 章节标题编辑：点击标题进入编辑态（本组件局部交互，含 IME 守卫）
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const startTitleEdit = (): void => {
    if (!chapter) return;
    setTitleDraft(chapter.title);
    setTitleEditing(true);
  };

  const commitTitleEdit = (): void => {
    setTitleEditing(false);
    if (!chapter) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== chapter.title) {
      onRenameChapter(chapter.id, trimmed);
    }
  };

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitleEdit();
    } else if (event.key === "Escape") {
      setTitleEditing(false);
    }
  };

  // 切章 / 回滚后退出编辑态，避免把 A 章标题草稿写进 B 章
  useEffect(() => {
    setTitleEditing(false);
  }, [chapter?.id]);

  // 回调放进 ref，避免重建编辑器（CodeMirror 实例必须整个会话唯一）
  const handlersRef = useRef({
    onChange,
    onSelectionChange,
    onContextMenu,
    onCursorChange,
  });
  useEffect(() => {
    handlersRef.current = {
      onChange,
      onSelectionChange,
      onContextMenu,
      onCursorChange,
    };
  }, [onChange, onSelectionChange, onContextMenu, onCursorChange]);

  const enabled = useMemo(
    () => terms.length > 0,
    [terms.length],
  );

  // 初始化编辑器：只跑一次
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: content,
        extensions: [
          history(),
          // 章节内查找替换（R10）：Ctrl+F 查找、Ctrl+H 打开含替换字段的面板；
          // Mod-h 需要显式绑定（searchKeymap 默认不含），面板置于编辑器顶部
          search({ top: true }),
          keymap.of([
            { key: "Mod-h", run: openSearchPanel },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          stylingCompartment.of(buildTheme(settings)),
          annotationLayer(terms, enabled),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // 拼音候选期间的中间态不上报：草稿与字数统计只看确认后的文本。
              // compositionend 时由下方监听器统一上报最终文档
              if (composingRef.current) return;
              handlersRef.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const { main } = update.state.selection;
              // 光标位置上报（R6）：折叠与非折叠选区都要记 head
              handlersRef.current.onCursorChange(main.head);
              // 选区不随上报携带坐标：右键菜单位置以鼠标事件为准（见 contextmenu 监听）
              handlersRef.current.onSelectionChange(
                main.empty
                  ? null
                  : {
                      text: update.state.sliceDoc(main.from, main.to),
                      from: main.from,
                      to: main.to,
                    },
              );
            }
          }),
        ],
      }),
    });

    viewRef.current = view;

    // IME 组合期监听：候选期间冻结上报；确认（compositionend）后一次性
    // 上报最终文档——此时草稿从组合前文本直接跳到确认文本，字数增量准确
    const handleCompositionStart = (): void => {
      composingRef.current = true;
    };
    const handleCompositionEnd = (): void => {
      composingRef.current = false;
      handlersRef.current.onChange(view.state.doc.toString());
    };
    view.contentDOM.addEventListener("compositionstart", handleCompositionStart);
    view.contentDOM.addEventListener("compositionend", handleCompositionEnd);

    // 选区非空时右键正文 → 弹出标注菜单：坐标以鼠标为准，按菜单尺寸
    // （约 190×320）clamp 进 stage，交给上层渲染 EntityContextMenu
    const handleContextMenu = (event: MouseEvent): void => {
      if (view.state.selection.main.empty) return;
      event.preventDefault();
      const stageRect = stageRectOf(host);
      handlersRef.current.onContextMenu(
        clamp(event.clientX - stageRect.left, 8, stageRect.width - 208),
        clamp(event.clientY - stageRect.top, 44, stageRect.height - 320),
      );
    };
    view.contentDOM.addEventListener("contextmenu", handleContextMenu);

    return () => {
      view.contentDOM.removeEventListener("compositionstart", handleCompositionStart);
      view.contentDOM.removeEventListener("compositionend", handleCompositionEnd);
      view.contentDOM.removeEventListener("contextmenu", handleContextMenu);
      view.destroy();
      viewRef.current = null;
    };
    // 编辑器实例整个会话唯一：content / settings / terms 均通过 ref 或 compartment 热更新
  }, []);

  // 外部灌入的正文（切换章节 / 回滚 / 恢复）与编辑器文档不一致时同步进去。
  // 用 isolateHistory 切断撤销栈（撤销不应跨章节回退到上一章正文）；
  // 同时携带 refreshAnnotation 让标注层立即重建，不残留上一章的高亮
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      effects: refreshAnnotation.of(null),
      annotations: isolateHistory.of("full"),
    });
  }, [content]);

  // 排版设置热更新
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: stylingCompartment.reconfigure(buildTheme(settings)),
    });
  }, [settings]);

  // 续写位置恢复（R6）：等章节正文灌入后下一帧应用光标与滚动，再向上层回收。
  // 光标越界（章节在别处被改短）按文档长度夹取
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !chapter || !restore || restore.chapterId !== chapter.id) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const current = viewRef.current;
      if (!current) return;
      current.dispatch({
        selection: { anchor: Math.min(restore.cursor, current.state.doc.length) },
      });
      const scroller = hostRef.current?.closest<HTMLElement>(".nv-editor__scroll");
      if (scroller) scroller.scrollTop = restore.scrollTop;
      onRestoreDone();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chapter, restore, onRestoreDone]);

  // 词库与标注层开关热更新：只换 facet 值，不重建插件实例（PRD §7：要素保存即刷新词库）。
  // 强制刷新信号必须同事务携带：插件只在 forced/viewportChanged/docChanged 时重建，
  // 单纯的 facet 变化不会触发 decoration 重算（新标记的词要立即高亮）
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        termsCompartment.reconfigure(termsFacet.of(terms)),
        annotationEnabledCompartment.reconfigure(
          annotationEnabledFacet.of(enabled),
        ),
        refreshAnnotation.of(null),
      ],
    });
  }, [terms, enabled]);

  // 点击正文下方的空白区（纸面 / 滚动容器）也能聚焦：CodeMirror 的 content
  // 只占文档实际高度，点在其下方时命中的是容器本身——这里兜底把光标放上去
  // （posAtCoords 命中不到内容点时落到文档末尾），恢复「点哪都能接着写」的手感
  const handleScrollAreaClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const view = viewRef.current;
    if (!view || !chapter) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".cm-content, .cm-panels")) {
      return;
    }
    view.focus();
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length;
    view.dispatch({ selection: { anchor: pos } });
  };

  // 打字机模式：当前光标行垂直居中（PRD R8）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;

    if (!typewriter) {
      lastLineRef.current = -1;
      return undefined;
    }

    const center = (): void => {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head).number;
      if (line === lastLineRef.current) return;
      lastLineRef.current = line;
      view.dispatch({
        effects: EditorView.scrollIntoView(head, { y: "center" }),
      });
    };

    center();
    view.contentDOM.addEventListener("keyup", center);
    view.contentDOM.addEventListener("click", center);
    return () => {
      view.contentDOM.removeEventListener("keyup", center);
      view.contentDOM.removeEventListener("click", center);
    };
  }, [typewriter]);

  // 悬浮资料卡：命中高亮词才上报，坐标相对码字区容器
  useEffect(() => {
    const view = viewRef.current;
    const host = hostRef.current;
    if (!view || !host) return undefined;

    const findTermTarget = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      return target.closest<HTMLElement>("[data-entity-id]");
    };

    const handleMove = (event: MouseEvent): void => {
      const node = findTermTarget(event.target);
      if (!node) {
        onTermLeave();
        return;
      }
      const entityId = node.dataset.entityId;
      if (!entityId) return;

      const nodeRect = node.getBoundingClientRect();
      // 资料卡相对 stage 定位且 translate(-50%)：左右各预留半张卡宽
      const stageRect = stageRectOf(host);
      onTermHover(
        entityId,
        clamp(
          nodeRect.left - stageRect.left + nodeRect.width / 2,
          156,
          stageRect.width - 156,
        ),
        nodeRect.bottom - stageRect.top + 6,
      );
    };

    const handleLeave = (): void => onTermLeave();

    const handleClick = (event: MouseEvent): void => {
      const node = findTermTarget(event.target);
      const entityId = node?.dataset.entityId;
      if (entityId) onTermClick(entityId);
    };

    view.contentDOM.addEventListener("mousemove", handleMove);
    view.contentDOM.addEventListener("mouseleave", handleLeave);
    view.contentDOM.addEventListener("click", handleClick);

    return () => {
      view.contentDOM.removeEventListener("mousemove", handleMove);
      view.contentDOM.removeEventListener("mouseleave", handleLeave);
      view.contentDOM.removeEventListener("click", handleClick);
    };
  }, [onTermHover, onTermLeave, onTermClick]);

  // 编辑器实例常驻渲染（CodeMirror 必须整个会话唯一，见上方初始化 effect）；
  // 未选中章节时用覆盖层遮住正文区，而不是卸载 host —— 否则初始化 effect
  // 在首帧（章节尚未加载）跑完后 host 才出现，编辑器永远创建不出来。
  return (
    <div
      className={`nv-editor${typewriter ? " nv-editor--typewriter" : ""}`}
      style={
        {
          "--nv-indent": settings.indent ? "2em" : "0",
          "--nv-paragraph-spacing": `${settings.paragraphSpacing}em`,
        } as CSSProperties
      }
    >
      {chapter && (
        <div className="nv-editor__title">
          {titleEditing ? (
            <input
              className="nv-editor__title-input"
              value={titleDraft}
              autoFocus
              maxLength={60}
              aria-label="章节名称"
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <button
              type="button"
              className="nv-editor__title-text"
              title="点击修改章节名称"
              onClick={startTitleEdit}
            >
              {chapterNumber > 0 && (
                <span className="nv-editor__title-no">
                  {formatNumberedLabel(
                    settings.numberStyle,
                    settings.chapterSuffix,
                    chapterNumber,
                  )}
                </span>
              )}
              {chapter.title}
            </button>
          )}
          {/* 状态徽标只在完稿时出现；草稿是默认态，常驻只会变成噪音 */}
          {chapter.status === "done" && (
            <span className="nv-editor__title-meta">完稿</span>
          )}
        </div>
      )}
      <div
        className="nv-editor__scroll"
        onClick={handleScrollAreaClick}
        onScroll={(event) => onScrollChange(event.currentTarget.scrollTop)}
      >
        <div className="nv-editor__paper">
          <div ref={hostRef} className="nv-editor__host" />
        </div>
      </div>
      {!chapter && (
        <div className="nv-editor__veil">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有选中章节"
          >
            <button
              type="button"
              className="nv-editor__create"
              onClick={onCreateChapter}
            >
              写下第一章
            </button>
          </Empty>
        </div>
      )}
    </div>
  );
}
