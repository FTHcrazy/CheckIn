import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { Empty } from "antd";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { EditorSettings, EntityTerm, NovelChapter } from "../../types";
import {
  annotationEnabledCompartment,
  annotationEnabledFacet,
  annotationLayer,
  termsCompartment,
  termsFacet,
} from "../../novel-editor";
import type { EditorSelection } from "../../hooks/useNovelEditorState";
import "./index.scss";

interface EditorPaneProps {
  chapter: NovelChapter | null;
  content: string;
  settings: EditorSettings;
  terms: EntityTerm[];
  typewriter: boolean;
  onChange: (value: string) => void;
  onSelectionChange: (selection: EditorSelection | null) => void;
  onTermHover: (entityId: string, x: number, y: number) => void;
  onTermLeave: () => void;
  onTermClick: (entityId: string) => void;
  onCreateChapter: () => void;
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
 * 中央码字区（设计方案 §05 ②）
 *
 * 内核为 CodeMirror 6 纯文本模式：虚拟滚动天然支撑三万字章节，
 * IME 由 CodeMirror 原生处理（组合输入不上报文档变更），
 * 标注层由 novel-editor.ts 的 ViewPlugin 提供，与 UI 完全解耦。
 */
export default function EditorPane({
  chapter,
  content,
  settings,
  terms,
  typewriter,
  onChange,
  onSelectionChange,
  onTermHover,
  onTermLeave,
  onTermClick,
  onCreateChapter,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lastLineRef = useRef<number>(-1);

  // 回调放进 ref，避免重建编辑器（CodeMirror 实例必须整个会话唯一）
  const handlersRef = useRef({ onChange, onSelectionChange });
  useEffect(() => {
    handlersRef.current = { onChange, onSelectionChange };
  }, [onChange, onSelectionChange]);

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
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          stylingCompartment.of(buildTheme(settings)),
          annotationLayer(terms, enabled),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              handlersRef.current.onChange(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const { main } = update.state.selection;
              if (main.empty) {
                handlersRef.current.onSelectionChange(null);
                return;
              }
              const text = update.state.sliceDoc(main.from, main.to);
              const coords = view.coordsAtPos(main.head);
              const hostRect = host.getBoundingClientRect();
              handlersRef.current.onSelectionChange({
                text,
                from: main.from,
                to: main.to,
                x: coords ? coords.left - hostRect.left : 0,
                y: coords ? coords.top - hostRect.top : 0,
              });
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 编辑器实例整个会话唯一：content / settings / terms 均通过 ref 或 compartment 热更新
  }, []);

  // 外部灌入的正文（切换章节 / 回滚 / 恢复）与编辑器文档不一致时同步进去。
  // 用 isolateHistory 切断撤销栈：撤销不应跨章节回退到上一章的正文（R2 撤销可靠性）
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: isolateHistory.of("full"),
    });
  }, [content]);

  // 排版设置热更新
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: stylingCompartment.reconfigure(buildTheme(settings)),
    });
  }, [settings]);

  // 词库与标注层开关热更新：只换 facet 值，不重建插件实例（PRD §7：要素保存即刷新词库）
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        termsCompartment.reconfigure(termsFacet.of(terms)),
        annotationEnabledCompartment.reconfigure(
          annotationEnabledFacet.of(enabled),
        ),
      ],
    });
  }, [terms, enabled]);

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
      const hostRect = host.getBoundingClientRect();
      onTermHover(
        entityId,
        nodeRect.left - hostRect.left + nodeRect.width / 2,
        nodeRect.bottom - hostRect.top + 6,
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
          <span className="nv-editor__title-text">{chapter.title}</span>
          <span className="nv-editor__title-meta">
            {chapter.status === "done" ? "完稿" : "草稿"}
          </span>
        </div>
      )}
      <div className="nv-editor__scroll">
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
