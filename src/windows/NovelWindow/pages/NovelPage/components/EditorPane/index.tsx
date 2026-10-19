import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, Ref } from "react";
import { Button, Empty, Input } from "antd";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorActions, useChapterDraft } from "../../store/useNovelEditorStore";
import { GUIDE_MIN_SELECTION_LENGTH } from "@/shared/novel/guide-copy";
import SelectionGuide, {
  type SelectionGuideAnchor,
} from "../../../../components/SelectionGuide";
import { useGuideStore } from "../../../../store/useGuideStore";
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
import {
  refreshSensitive,
  sensitiveEnabledCompartment,
  sensitiveEnabledFacet,
  sensitiveLayer,
  sensitiveWordsCompartment,
  sensitiveWordsFacet,
} from "../../sensitive-editor";
import type { EditorSelection } from "../../hooks/useNovelEditorState";
import "./index.scss";

/** 缺省词库：模块级常量，避免每次渲染都换一个新数组（会白跑一次 reconfigure） */
const NO_WORDS: readonly string[] = [];

interface EditorPaneProps {
  chapter: NovelChapter | null;
  /** 全书章节序号（派生属性，随拖拽重排变动；0 表示未知） */
  chapterNumber: number;
  settings: EditorSettings;
  terms: EntityTerm[];
  /** 全局标注层开关（PRD §2 风险对策）：关闭时即使有词库也不渲染高亮/悬浮卡 */
  annotationOn: boolean;
  onSelectionChange: (selection: EditorSelection | null) => void;
  /** 选区非空时右键正文：坐标相对 .nv-page__stage，已按菜单尺寸 clamp */
  onContextMenu: (x: number, y: number) => void;
  onTermHover: (entityId: string, x: number, y: number) => void;
  onTermLeave: () => void;
  onTermClick: (entityId: string) => void;
  onCreateChapter: () => void;
  /**
   * 空态语义：`no-work` = 整个书架还没有任何作品（要引导新建作品，
   * 此时「写下第一章」点了也无处可落）；`no-chapter` = 有作品但没选中章节。
   * 默认 `no-chapter`，保持既有调用方行为不变。
   */
  emptyKind?: "no-work" | "no-chapter";
  /** 空态为 `no-work` 时点「新建作品」的回调 */
  onCreateWork?: () => void;
  /** 书架 → 编辑器：空书架时的「导入书籍」入口（可选） */
  onImportBook?: () => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  /** 续写位置恢复（R6）：与当前章节匹配时应用一次，完成后回调清空 */
  restore: RestorePosition | null;
  onRestoreDone: () => void;
  /** 光标移动上报（R6 位置记忆）：head 为文档内偏移 */
  onCursorChange: (head: number) => void;
  /** 正文滚动上报（R6 位置记忆）：scrollTop */
  onScrollChange: (scrollTop: number) => void;
  /** 敏感词词库（工具箱 → 敏感词检测）；缺省不渲染高亮层 */
  sensitiveWords?: readonly string[];
  /** 敏感词高亮开关（仅自动模式为 true；手动模式正文保持干净） */
  sensitiveOn?: boolean;
  /** 面板点结果后要定位的文档偏移；编辑器消费一次即回调清空 */
  focusPos?: number | null;
  onFocusPosApplied?: () => void;
  /**
   * 正文脉搏：每次内容变更上报一次（含程序化灌入）。
   * 敏感词检测据此记录最新草稿并在 auto 模式下防抖扫描，
   * 页面根因此不必订阅草稿、为每个字重渲染整棵树。
   */
  onDraftPulse?: (chapterId: string, title: string, content: string) => void;
}

/**
 * 命令式 API（R18 / 步骤三：起名工具「插入正文」出口；REQ-034：行囊表格「插入本章末尾」）
 *
 * 用于在不动 EditorPane 受控 props 的情况下、向正文里插入文本
 * （起名工具面板按名字一键插入；行囊按模块把 Markdown 表格追加到章末）。
 * 其它面板内部动作仍走 onChange。
 */
export interface EditorPaneHandle {
  /** 在当前光标处插入文本；选区非空时替换选区，插入后光标移到插入末尾 */
  insertText: (text: string) => void;
  /**
   * 追加到本章正文末尾（REQ-034）。
   *
   * 与 `insertText` 分开而不是「先把光标移到文末再调它」：那会顺手改掉作者的
   * 光标位置 —— 他正写在半路，插一张表不该把他弹到章末去。这里只动文档尾部，
   * 光标跟着落到插入内容的末尾（作者刚插完，多半要接着在那后面看一眼）。
   */
  appendText: (text: string) => void;
  /**
   * 全量替换正文里的某个词（设定一致性检查的「一键替换」）
   *
   * 不自己改 chapter.content 再回灌 —— 编辑器是非受控的 CodeMirror 实例，
   * 改 prop 不会同步进文档，于是库里换了、屏上没换。这里走 dispatch，
   * 与正常打字同一条链路（updateListener → 防抖保存），且能 Ctrl+Z 撤销。
   */
  replaceAll: (from: string, to: string) => number;
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
  settings,
  terms,
  annotationOn,
  onSelectionChange,
  onContextMenu,
  onTermHover,
  onTermLeave,
  onTermClick,
  onCreateChapter,
  emptyKind = "no-chapter",
  onCreateWork,
  onImportBook,
  onRenameChapter,
  restore,
  onRestoreDone,
  onCursorChange,
  onScrollChange,
  sensitiveWords,
  sensitiveOn = false,
  focusPos = null,
  onFocusPosApplied,
  onDraftPulse,
  ref,
}: EditorPaneProps & { ref?: Ref<EditorPaneHandle> }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** 编辑器根节点：T-03 的选区锚点以它为定位基准（.nv-editor 是 position:relative） */
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** T-03 锚点：非空表示「此刻有一段选区值得提示右键」 */
  const [guideAnchor, setGuideAnchor] = useState<SelectionGuideAnchor | null>(null);
  // SelectionGuide 的 onHide 进 effect 依赖，必须是稳定引用，否则气泡一出现就被清掉
  const clearGuideAnchor = useCallback(
    () => setGuideAnchor((prev) => (prev ? null : prev)),
    [],
  );
  /** 打字保护上报：作者一敲字，在场的 Tour / 弱提示立即让位（PRD FR-06） */
  const noteTyping = useGuideStore((state) => state.noteTyping);
  /**
   * 正文来自 store 的逐章草稿（没有草稿时回落到章节正文）。
   * 打字只让本组件与状态条重渲染——页面根不再持有正文。
   */
  const draft = useChapterDraft(chapter?.id ?? null);
  const content = draft ?? chapter?.content ?? "";
  /** 章节 id 放 ref：正文上报回调因此可以做成模块级稳定函数 */
  const chapterIdRef = useRef<string | null>(null);
  useEffect(() => {
    chapterIdRef.current = chapter?.id ?? null;
  }, [chapter?.id]);
  /**
   * 当前已知的正文放 ref：IME 组合结束后以此为字数基线上报最终文档——
   * 组合期间的中间态从未上报过，store 的基线上仍停在「组合前的已知正文」。
   * （程序化灌入的基线不由它负责，见 hydratingRef）
   */
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  /** IME 组合期标记：拼音候选期间的文档变化不上报，避免字数按拼音递增（R2） */
  const composingRef = useRef(false);
  /**
   * 程序化灌入标记（切章 / 回滚 / 崩溃恢复）。
   *
   * CodeMirror 的 updateListener 分不清「用户敲的字」和「我们用 dispatch 灌进去的整篇正文」，
   * 而它的 `update.startState.doc` 是**变更前**的文档——切章时那是上一章的正文。
   * 拿它当字数基线会把「整章字数」或「两章字数之差」当成用户新增：
   * 打开一本 4200 字的章节立刻「今日新增 4,200 字」，从长章切到短章则出现负增长。
   *
   * 灌入不是写作行为，必须走 `baseContent === next` 的语义（store 据此提前返回：
   * 不写草稿、不计字数、不重启防抖，从而不断掉旧章在途的保存）。
   */
  const hydratingRef = useRef(false);

  /**
   * 命令式 API（R18 / 步骤三）：把名字插入到正文光标处。
   *
   * 选区非空时替换选区；空选区时在 head 处插入；插入后光标移到插入末尾。
   * 不走 onChange（受控回写会触发防抖保存路径）；直接 dispatch 一个
   * userEvent.transaction 的事务，CodeMirror 自身会经 dispatch 通知
   * updateListener → onChange 路径，与键盘输入保持一致行为。
   */
  useImperativeHandle(
    ref,
    () => ({
      insertText: (text: string): void => {
        const view = viewRef.current;
        if (!view || !text) return;
        // 章节未挂载时拒绝（与「点击正文下方空白聚焦续写」一致）
        if (!view.state) return;
        const selection = view.state.selection;
        const hasSelection = selection.ranges.some(
          (range) => range.from !== range.to,
        );
        view.dispatch(
          hasSelection
            ? view.state.replaceSelection(text)
            : {
                changes: { from: selection.main.head, insert: text },
                selection: { anchor: selection.main.head + text.length },
                userEvent: "input.insert",
              },
        );
        view.focus();
      },
      appendText: (text: string): void => {
        const view = viewRef.current;
        if (!view || !text) return;
        const end = view.state.doc.length;
        // 前面补两个换行：章末紧贴着上一个自然段的句子时，标题要能独立成段
        const insert = `\n\n${text}`;
        view.dispatch({
          changes: { from: end, insert },
          selection: { anchor: end + insert.length },
          userEvent: "input.insert",
        });
        view.focus();
      },
      replaceAll: (from: string, to: string): number => {
        const view = viewRef.current;
        if (!view || !from || from === to) return 0;
        const doc = view.state.doc.toString();
        const changes: Array<{ from: number; to: number; insert: string }> = [];
        let cursor = 0;
        // 逐段扫描而不是 split/join：要的是「文档内的位置」，
        // 拼完再整体替换会丢掉光标与 undo 历史
        for (;;) {
          const hit = doc.indexOf(from, cursor);
          if (hit < 0) break;
          changes.push({ from: hit, to: hit + from.length, insert: to });
          cursor = hit + from.length;
        }
        if (changes.length === 0) return 0;
        view.dispatch({ changes, userEvent: "input.replace" });
        return changes.length;
      },
    }),
    [],
  );

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

  // 正文上报走 store 动作（身份恒定），其余回调放进 ref，避免重建编辑器
  // （CodeMirror 实例必须整个会话唯一）。previous 是变更前文档，供 store
  // 计算字数增量——不传时 store 以草稿（再兜底空串）为基线。
  // `source="hydrate"` 用于程序化灌入（切章 / 编辑器重建）：只切章、不计字数，
  // 不依赖「next === previous」这个会被旧草稿破坏的值相等假设。
  const handleContentChange = useCallback(
    (next: string, previous?: string, source?: "user" | "hydrate"): void => {
      const chapterId = chapterIdRef.current;
      if (chapterId) editorActions.setContent(chapterId, next, previous, source);
    },
    [],
  );

  const handlersRef = useRef({
    onChange: handleContentChange,
    onSelectionChange,
    onContextMenu,
    onCursorChange,
    // 敏感词脉搏：未接检测时是空操作（保持 ref 形状稳定，避免每处都判空）
    onDraftPulse: onDraftPulse ?? ((): void => {}),
  });
  useEffect(() => {
    handlersRef.current = {
      onChange: handleContentChange,
      onSelectionChange,
      onContextMenu,
      onCursorChange,
      onDraftPulse: onDraftPulse ?? ((): void => {}),
    };
  }, [
    handleContentChange,
    onSelectionChange,
    onContextMenu,
    onCursorChange,
    onDraftPulse,
  ]);

  /** 章节标题放 ref：updateListener 里上报脉搏时要用，又不能进编辑器初始化依赖 */
  const chapterTitleRef = useRef("");
  useEffect(() => {
    chapterTitleRef.current = chapter?.title ?? "";
  }, [chapter?.title]);

  // 标注层总开关：有词库且用户未全局关闭时才启用（PRD §2 风险对策）。
  // 复用 annotationEnabledCompartment 热更新通道，关闭即整层不渲染高亮/悬浮卡。
  const enabled = useMemo(
    () => terms.length > 0 && annotationOn,
    [terms.length, annotationOn],
  );

  // 初始化编辑器：只跑一次
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    /**
     * T-03：产生非空选区时，在选区下方提示「右键可以建资料卡」。
     *
     * 只弹一次（consumeTooltip 落盘标记），且四条排除条件缺一不可：
     * - 单字符不弹：多半是拖动误选，为它弹提示属于打扰
     * - 输入法组合期不弹：候选期的替换范围会被误判成选区
     * - Tour 正在播时不弹：两个气泡会打架（右键建卡已从 Tour 移出，
     *   改由本提示在首次产生选区时现身说法）
     * - 打字保护窗口内不弹：此时作者还在码字，不是要建卡
     */
    const maybeGuideSelection = (main: {
      from: number;
      to: number;
      empty: boolean;
    }): void => {
      if (main.empty) return;
      if (main.to - main.from < GUIDE_MIN_SELECTION_LENGTH) return;
      if (composingRef.current) return;
      const store = useGuideStore.getState();
      if (store.playingStep !== null) return;
      if (!store.consumeTooltip("T-03", Date.now())) return;
      const coords = view.coordsAtPos(main.from);
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!coords || !rootRect) return;
      setGuideAnchor({
        x: coords.left - rootRect.left,
        y: coords.bottom - rootRect.top,
      });
    };

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
          // 敏感词高亮层：与要素标注层完全独立（各自 compartment / facet）
          sensitiveLayer(sensitiveWords ?? NO_WORDS, sensitiveOn),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // FR-06 打字保护：作者一敲字，任何在场的引导立刻让位。
              // 放在 composing 判断之前——拼音中间态也是作者在打字
              noteTyping(Date.now());
              // 选区提示也撤掉：作者已经开始改字，选区坐标随即失效
              clearGuideAnchor();
              // 拼音候选期间的中间态不上报：草稿与字数统计只看确认后的文本。
              // compositionend 时由下方监听器统一上报最终文档
              if (composingRef.current) return;
              const next = update.state.doc.toString();
              // 程序化灌入（切章 / 编辑器重建）：显式声明 hydrate 语义 ——
              // store 只切章、不计字数、不写草稿。绝不能靠「传 next 自身当基线」
              // 让 previous 与 next 相等：该章若已有未保存草稿，previous 取到的是
              // 旧草稿，值相等假设破裂 → 把「旧草稿 → 灌入文本」的差值算进今日新增。
              if (hydratingRef.current) {
                handlersRef.current.onChange(next, next, "hydrate");
              } else {
                handlersRef.current.onChange(next, update.startState.doc.toString());
              }
              // 敏感词脉搏：不论用户打字还是程序化灌入（切章）都上报，
              // auto 模式由此拿到新章正文、手动扫描也总能用上最新草稿
              const pulseId = chapterIdRef.current;
              if (pulseId) {
                handlersRef.current.onDraftPulse(
                  pulseId,
                  chapterTitleRef.current,
                  next,
                );
              }
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
              maybeGuideSelection(main);
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
      // 组合期间的中间态从未上报，store 的基线仍是「组合前的已知正文」
      // （草稿，兜底 contentRef 里的章节正文），增量即确认文本
      handlersRef.current.onChange(
        view.state.doc.toString(),
        contentRef.current,
      );
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
    // （clearGuideAnchor 是 useCallback([]) 的稳定引用，不会让编辑器重建）
  }, [clearGuideAnchor]);

  // 外部灌入的正文（切换章节 / 回滚 / 恢复）与编辑器文档不一致时同步进去。
  // 用 isolateHistory 切断撤销栈（撤销不应跨章节回退到上一章正文）；
  // 同时携带 refreshAnnotation 让标注层立即重建，不残留上一章的高亮
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) return;
    // try/finally 兜底：一次 dispatch 可能产生多条 update，标记必须在退出前复位，
    // 否则之后用户敲的字会被误判成灌入（表现为「打死字数不涨」）
    hydratingRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        effects: [refreshAnnotation.of(null), refreshSensitive.of(null)],
        annotations: isolateHistory.of("full"),
      });
    } finally {
      hydratingRef.current = false;
    }
  }, [content]);

  // 排版设置热更新
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: stylingCompartment.reconfigure(buildTheme(settings)),
    });
  }, [settings]);

  /**
   * 换章时的滚动定位（R6）。
   *
   * 两种情形共用这一处：
   *
   * 1. **有恢复点**（`restore`，仅启动时来自上次续写位置）→ 跳到记下的
   *    `cursor` 与 `scrollTop`，再向上层回收这份一次性恢复。
   * 2. **没有恢复点**（点章节树 / 大纲 / 要素出场章节等正常换章）→ **滚回顶部**。
   *
   * ⚠️ 第 2 条是修掉「切章后滚动条停在上一章的位置」的关键：
   * `.nv-editor__scroll` 这个滚动容器**不随章节重挂**（编辑器实例整个会话唯一，
   * 见初始化 effect），正文是灌进同一块 DOM 的。于是换章后容器仍带着上一章的
   * `scrollTop` —— 短章一进来就停在中段甚至直接触底，作者看到的是「文本没了」。
   *
   * 上层（useNovelPage）已经把「存下来的位置」在换章时归零，但那只是记录，
   * 碰不到真实 DOM；真实滚动量必须在这里复位。
   *
   * 用 rAF 而非同步执行：正文灌入是同一个提交里的另一次 effect，滚动容器的高度
   * 要等新正文**排版完成**才是对的；在旧高度上设 `scrollTop` 会被新高度夹取，
   * 表现为「短章滚不到真正的顶」。
   */
  // ⚠️ 触发信号必须是「章节 id」而不是「chapter 对象引用」。
  // 防抖保存（800ms）会 setBundle 出一个新的 chapter 对象（content / wordCount /
  // updatedAt 变了），引用必变而 id 不变。若以对象引用为信号，每保存一次就会
  // 走一遍「没有恢复点 → scrollTop = 0」分支 —— 表现为写一会儿正文自己跳回第一行。
  const chapterId = chapter?.id ?? null;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !chapterId) return undefined;

    const isRestore = Boolean(restore && restore.chapterId === chapterId);
    const frame = window.requestAnimationFrame(() => {
      const current = viewRef.current;
      if (!current) return;
      if (isRestore && restore) {
        // 光标越界（章节在别处被改短）按文档长度夹取
        current.dispatch({
          selection: { anchor: Math.min(restore.cursor, current.state.doc.length) },
        });
      }
      const scroller = hostRef.current?.closest<HTMLElement>(".nv-editor__scroll");
      if (scroller) {
        // 有恢复点用它记下的位置，否则一律归零 —— 新章从第一行开始读是唯一
        // 说得通的行为，没有哪一章的「合理起点」是上一章的滚动位置
        scroller.scrollTop = isRestore && restore ? restore.scrollTop : 0;
      }
      if (isRestore) onRestoreDone();
    });
    return () => window.cancelAnimationFrame(frame);
    // restore 是**一次性**输入：消费后由 onRestoreDone 清空，避免它在下一次
    // 换章时被误当成「这一章也有恢复点」而复用上一章的位置
  }, [chapterId, restore, onRestoreDone]);

  /**
   * 切章时补一次敏感词脉搏。
   *
   * 首开编辑器时 `EditorState.create({ doc: content })` 不触发 updateListener，
   * 而上面的「外部灌入」effect 又会因文档已相等而提前返回 —— 于是「刚打开一章、
   * 一个字没敲」时自动模式拿不到正文，面板会是空的。这里在章节 id 变化时主动上报。
   *
   * 只依赖章节 id：正文变化已由 updateListener 逐键上报，挂 content 依赖会重复触发。
   * `contentRef` 是 prop 的镜像（含未保存草稿），切章时已指向新章内容。
   */
  useEffect(() => {
    if (!chapterId) return;
    handlersRef.current.onDraftPulse(
      chapterId,
      chapterTitleRef.current,
      contentRef.current,
    );
  }, [chapterId]);

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

  // 敏感词词库 / 开关热更新：与要素标注层同一套 compartment 范式，
  // 但互不影响（关掉人名高亮不该顺手关掉敏感词高亮）。
  // 强制刷新信号必须同事务携带：纯 facet 变化不会触发 decoration 重算
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        sensitiveWordsCompartment.reconfigure(
          sensitiveWordsFacet.of(sensitiveWords ?? NO_WORDS),
        ),
        sensitiveEnabledCompartment.reconfigure(
          sensitiveEnabledFacet.of(sensitiveOn),
        ),
        refreshSensitive.of(null),
      ],
    });
  }, [sensitiveWords, sensitiveOn]);

  /**
   * 跳转定位（面板点命中结果）。
   *
   * 必须等新章正文灌进文档之后再定位：灌入是与本 effect 同一提交里的另一次
   * effect，rAF 排在它后面，此时 doc 已经是新章的。挂载时 focusPos 为 null，
   * 不会干扰正常的续写位置恢复。
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !chapterId || focusPos === null) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const current = viewRef.current;
      if (!current) return;
      const pos = Math.min(Math.max(focusPos, 0), current.state.doc.length);
      current.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      current.focus();
      onFocusPosApplied?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chapterId, focusPos, onFocusPosApplied]);

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
      ref={rootRef}
      className="nv-editor"
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
            <Input
              className="nv-editor__title-input"
              variant="borderless"
              value={titleDraft}
              autoFocus
              maxLength={60}
              aria-label="章节名称"
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <Button
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
            </Button>
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
        onScroll={(event) => {
          onScrollChange(event.currentTarget.scrollTop);
          // 滚动后选区坐标失效，气泡会飘在错位置 —— 直接撤掉
          clearGuideAnchor();
        }}
        data-tour-target="editor-body"
      >
        <div className="nv-editor__paper">
          <div ref={hostRef} className="nv-editor__host" />
        </div>
      </div>
      {!chapter && (
        <div className="nv-editor__veil">
          {emptyKind === "no-work" ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="nv-editor__empty-desc">
                  书架还是空的
                  <span className="nv-editor__empty-hint">
                    新建一部作品开始写，或从 TXT／DOCX 导入整本书
                  </span>
                </span>
              }
            >
              <div className="nv-editor__empty-actions">
                {onCreateWork && (
                  <Button
                    type="primary"
                    className="nv-editor__create"
                    onClick={onCreateWork}
                  >
                    新建作品
                  </Button>
                )}
                {onImportBook && (
                  <Button
                    className="nv-editor__import"
                    onClick={onImportBook}
                  >
                    导入书籍
                  </Button>
                )}
              </div>
            </Empty>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有选中章节"
            >
              <Button
                className="nv-editor__create"
                onClick={onCreateChapter}
                data-tour-target="editor-first-chapter"
              >
                写下第一章
              </Button>
            </Empty>
          )}
        </div>
      )}
      {/* T-03：选中文字 → 选区下方提示右键建资料卡（只出现一次） */}
      <SelectionGuide anchor={guideAnchor} onHide={clearGuideAnchor} />
    </div>
  );
}
