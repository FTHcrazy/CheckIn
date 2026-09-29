import {
  AppstoreOutlined,
  BulbOutlined,
  KeyOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import EntityPanel from "../EntityPanel";
import type { EntitySavePatch } from "../EntityDetail";
import InspirationPanel, { type InspirationActions } from "../InspirationPanel";
import NameGeneratorPanel, { type NamingActions } from "../NameGeneratorPanel";
import OutlinePanel, { type OutlineActions } from "../OutlinePanel";
import SearchPanel from "../SearchPanel";
import { LAYOUT } from "../../novel-config";
import { useSearchStore } from "../../store/useSearchStore";
import type { PanelTab, EntityFilter } from "../../hooks/useNovelViewState";
import type {
  EntityAppearance,
  EntityRelationView,
  EntityType,
  LevelSystem,
  NovelEntity,
  NovelNote,
  OutlineNode,
  SearchHit,
} from "../../types";
import ToolLauncher from "./components/ToolLauncher";
import "./index.scss";

interface SupportPanelProps {
  open: boolean;
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** 面板宽度（280–460），由 useNovelViewState 持有并持久化 */
  width: number;
  onWidthChange: (width: number) => void;
  onCollapse: () => void;
  outline: OutlineNode[];
  /** 当前编辑章：大纲面板同步高亮 */
  activeChapterId: string | null;
  outlineActions: OutlineActions;
  entities: NovelEntity[];
  filter: EntityFilter;
  onFilterChange: (filter: EntityFilter) => void;
  detailEntityId: string | null;
  onOpenEntity: (entityId: string) => void;
  onCloseEntity: () => void;
  getEntityRelations: (
    entityId: string,
    type: EntityType,
  ) => EntityRelationView[];
  levelSystems: LevelSystem[];
  notes: NovelNote[];
  /** 全部作品灵感：灵感面板全局搜索的数据源 */
  globalNotes: NovelNote[];
  /** 当前作品 id：搜索结果中区分其他书籍的灵感（只读 + 来源标签） */
  activeWorkId: string;
  /** 作品 id → 书名（外部灵感的来源标签） */
  workNameOf: (workId: string) => string;
  inspirationActions: InspirationActions;
  onSearch: (keyword: string) => Promise<SearchHit[]>;
  onSelectChapter: (chapterId: string) => void;
  getAppearances: (entityId: string) => EntityAppearance[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onSaveEntity: (entityId: string, patch: EntitySavePatch) => void;
  onAddRelation: (
    entityId: string,
    entityType: EntityType,
    targetId: string,
    relation: string,
  ) => void;
  onRemoveRelation: (linkId: string, targetName: string) => void;
  /** 设定 / 取消当前境界（R25） */
  onSetEntityLevel: (entityId: string, rungId: string | null) => void;
  /** 打开等级体系管理弹框（R25） */
  onOpenLevelManager: () => void;
  /** 打开自定义类型管理弹框（R23）：要素库面板头的齿轮 */
  onOpenTypeManager: () => void;
  /** 起名工具动作组（R18 / 步骤三）：插入正文 / 建角色卡 / 收藏 / 删除收藏 */
  namingActions: NamingActions;
  /** 起名工具避开本书已用名时取数用：当前作品的全部要素名 + 别名 */
  namingExclude: string[];
  /** 起名工具收藏夹（当前作品）：按 createdAt 倒序 */
  namingFavorites: import("../../types").NameFavorite[];
}

interface TabMeta {
  key: PanelTab;
  label: string;
  icon: ReactNode;
}

const TABS: TabMeta[] = [
  { key: "outline", label: "大纲", icon: <UnorderedListOutlined /> },
  { key: "entity", label: "要素", icon: <AppstoreOutlined /> },
  { key: "note", label: "灵感", icon: <BulbOutlined /> },
  { key: "search", label: "检索", icon: <SearchOutlined /> },
  { key: "tools", label: "工具", icon: <ToolOutlined /> },
];

/** 脚注里的快捷键提示：常驻告知，点击成本高时才需要的设计 */
const KEY_HINT = <span className="nv-panel__kbd">Ctrl</span>;

/**
 * 右栏支撑面板容器（设计方案四段式骨架）
 *
 * 负责：面板头的语境计数与 Tab 级主操作、分段 Tab 与滑块指示器、
 * 宽度拖拽、收起 / 重开把手。内容仍是 activeTab 驱动的五张子面板——
 * 各自的筛选 / 折叠 / 搜索都是子面板内部状态，不回流到本容器。
 *
 * 折叠用 width / opacity 过渡而非条件渲染（AGENTS 6.4）：保留子面板的
 * 滚动位置与未提交草稿。
 */
export default function SupportPanel({
  open,
  activeTab,
  onTabChange,
  width,
  onWidthChange,
  onCollapse,
  outline,
  activeChapterId,
  outlineActions,
  entities,
  filter,
  onFilterChange,
  detailEntityId,
  onOpenEntity,
  onCloseEntity,
  getEntityRelations,
  levelSystems,
  notes,
  globalNotes,
  activeWorkId,
  workNameOf,
  inspirationActions,
  onSearch,
  onSelectChapter,
  getAppearances,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onAddRelation,
  onRemoveRelation,
  onSetEntityLevel,
  onOpenLevelManager,
  onOpenTypeManager,
  namingActions,
  namingExclude,
  namingFavorites,
}: SupportPanelProps) {
  /** 工具箱二级面板：null = 启动器首页 */
  const [toolSub, setToolSub] = useState<"naming" | null>(null);
  /** 面板头「＋ 伏笔」触发次数：OutlinePanel 据此打开首卷的新增表单 */
  const [addForeshadowTick, setAddForeshadowTick] = useState(0);
  const [dragging, setDragging] = useState(false);

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // 换作品时清空检索缓存（store 是模块级的，不能把上一本书的命中带过来）
  const clearSearch = useSearchStore((state) => state.clear);
  useEffect(() => {
    clearSearch();
  }, [activeWorkId, clearSearch]);

  // ── 派生计数（面板头的语境信息）─────────────────────────────────
  const counts = useMemo(() => {
    const volumes = outline.filter((node) => node.kind === "volume");
    let chapters = 0;
    let words = 0;
    for (const volume of volumes) {
      for (const child of volume.children) {
        if (child.kind !== "chapter") continue;
        chapters += 1;
        words += child.wordCount;
      }
    }
    const openForeshadows = volumes.reduce(
      (sum, volume) => sum + volume.openForeshadows,
      0,
    );
    const pinned = notes.filter((note) => note.pinned).length;
    return { volumes: volumes.length, chapters, words, openForeshadows, pinned };
  }, [outline, notes]);

  const wordText =
    counts.words >= 10_000
      ? `${(counts.words / 10_000).toFixed(1)} 万字`
      : `${counts.words} 字`;

  /** 当前编辑章的显示名（「第三章 灵潮初现」）：检索面板「本章」作用域要用 */
  const activeChapterTitle = useMemo(() => {
    if (!activeChapterId) return "";
    for (const node of outline) {
      if (node.kind !== "volume") continue;
      for (const child of node.children) {
        if (child.kind === "chapter" && child.chapterId === activeChapterId) {
          return `${child.label} ${child.title}`;
        }
      }
    }
    return "";
  }, [activeChapterId, outline]);

  // ── 分段 Tab 的滑块指示器 ────────────────────────────────────────
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const measure = useCallback(() => {
    const index = TABS.findIndex((tab) => tab.key === activeTab);
    const node = index >= 0 ? tabRefs.current[index] : null;
    if (!node) return;
    setIndicator({ left: node.offsetLeft, width: node.offsetWidth });
  }, [activeTab]);

  useEffect(() => {
    measure();
  }, [measure, width, open]);

  // 字体加载 / 窗口缩放都会改变 tab 宽度：观察容器自身，避免滑块错位
  useEffect(() => {
    const node = tabsRef.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  // ── 拖拽调宽 ────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setDragging(true);
      document.body.style.cursor = "col-resize";

      const move = (moveEvent: globalThis.MouseEvent): void => {
        onWidthChange(startWidth + (startX - moveEvent.clientX));
      };
      const finish = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", finish);
        document.body.style.cursor = "";
        setDragging(false);
        dragCleanupRef.current = null;
      };

      dragCleanupRef.current = finish;
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", finish);
    },
    [width, onWidthChange],
  );

  // 卸载时兜底摘除监听器，避免按住拖拽直接切 Tab 留下悬挂监听
  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  const openTool = useCallback(() => setToolSub("naming"), []);
  const backToTools = useCallback(() => setToolSub(null), []);

  const namedActive = toolSub === "naming" ? "naming" : activeTab;

  // ── 面板头 / 脚：随 Tab 切换 ────────────────────────────────────
  const head = useMemo(() => {
    switch (namedActive) {
      case "outline":
        return {
          title: "大纲",
          meta: `${counts.volumes} 卷 · ${counts.chapters} 章 · ${counts.openForeshadows} 条待回收`,
          action: {
            label: "＋ 伏笔",
            onClick: () => {
              onTabChange("outline");
              setAddForeshadowTick((tick) => tick + 1);
            },
          },
        };
      case "entity":
        return {
          title: "要素库",
          meta: `${entities.length} 个要素`,
          action: null,
        };
      case "note":
        return {
          title: "灵感速记",
          meta: `${notes.length} 条 · 置顶 ${counts.pinned}`,
          action: null,
        };
      case "search":
        return {
          title: "全书检索",
          meta: `${counts.chapters} 章 · ${wordText}`,
          action: null,
        };
      case "naming":
        return {
          title: "起名器",
          meta: `已避开本书 ${namingExclude.length} 个已用名`,
          action: null,
        };
      default:
        return { title: "工具箱", meta: "1 项可用 · 2 项规划中", action: null };
    }
  }, [
    namedActive,
    counts,
    entities.length,
    notes.length,
    namingExclude.length,
    wordText,
    onTabChange,
  ]);

  const foot = useMemo(() => {
    switch (namedActive) {
      case "outline":
        return (
          <>
            <KeyOutlined />
            <span>点章节即跳转 · 点虚线补一句话梗概</span>
          </>
        );
      case "entity":
        return (
          <>
            <KeyOutlined />
            <span>选中正文人名 → 右键「标记为角色」</span>
          </>
        );
      case "note":
        return (
          <>
            <KeyOutlined />
            <span>
              <span className="nv-panel__kbd">Enter</span> 速记 ·{" "}
              <span className="nv-panel__kbd">Shift</span>+
              <span className="nv-panel__kbd">Enter</span> 换行
            </span>
          </>
        );
      case "search":
        return (
          <>
            <KeyOutlined />
            <span>
              {KEY_HINT}+<span className="nv-panel__kbd">F</span> 编辑器内查找 ·{" "}
              {KEY_HINT}+<span className="nv-panel__kbd">P</span> 跳章
            </span>
          </>
        );
      case "naming":
        return (
          <>
            <KeyOutlined />
            <span>双击名字插入正文光标处</span>
          </>
        );
      default:
        return (
          <>
            <KeyOutlined />
            <span>工具按需加载，关闭即释放</span>
          </>
        );
    }
  }, [namedActive]);

  const flatScroll = namedActive === "note" || namedActive === "search";

  return (
    <div className={`nv-panel-region${open ? "" : " is-collapsed"}`}>
      <aside
        className={`nv-panel${open ? "" : " is-collapsed"}`}
        style={{ width: `${width}px` }}
      >
        <div
          className={`nv-panel__resizer${dragging ? " is-drag" : ""}`}
          title={`拖拽调整宽度（${LAYOUT.rightRailMinWidth}–${LAYOUT.rightRailMaxWidth}px）`}
          onMouseDown={handleDragStart}
        />

        <header className="nv-panel__head">
          <div className="nv-panel__head-main">
            <h2 className="nv-panel__title">{head.title}</h2>
            <span className="nv-panel__meta">{head.meta}</span>
          </div>
          <div className="nv-panel__head-actions">
            {toolSub && (
              <button
                type="button"
                className="nv-panel__icon"
                title="返回工具箱"
                onClick={backToTools}
              >
                <LeftOutlined />
              </button>
            )}
            {head.action && (
              <button
                type="button"
                className="nv-panel__btn"
                onClick={head.action.onClick}
              >
                {head.action.label}
              </button>
            )}
            {namedActive === "entity" && (
              <button
                type="button"
                className="nv-panel__icon"
                title="要素类型管理"
                onClick={onOpenTypeManager}
              >
                <SettingOutlined />
              </button>
            )}
            <button
              type="button"
              className="nv-panel__icon"
              title="收起面板"
              onClick={onCollapse}
            >
              <RightOutlined />
            </button>
          </div>
        </header>

        <nav className="nv-panel__tabs" role="tablist" ref={tabsRef}>
          <span
            className="nv-panel__indicator"
            style={{
              width: `${indicator.width}px`,
              transform: `translateX(${indicator.left}px)`,
            }}
          />
          {TABS.map((tab, index) => {
            const on = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                type="button"
                role="tab"
                aria-selected={on}
                className={`nv-panel__tab${on ? " is-on" : ""}`}
                onClick={() => {
                  onTabChange(tab.key);
                  setToolSub(null);
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.key === "outline" && counts.openForeshadows > 0 && (
                  <i className="nv-panel__badge">{counts.openForeshadows}</i>
                )}
                {tab.key === "note" && notes.length > 0 && (
                  <i className="nv-panel__badge nv-panel__badge--soft">
                    {notes.length}
                  </i>
                )}
              </button>
            );
          })}
        </nav>

        <div
          className={`nv-panel__scroll${flatScroll ? " nv-panel__scroll--flat" : ""}`}
        >
          {activeTab === "outline" && (
            <OutlinePanel
              outline={outline}
              activeChapterId={activeChapterId}
              onSelectChapter={onSelectChapter}
              actions={outlineActions}
              addForeshadowSignal={addForeshadowTick}
            />
          )}
          {activeTab === "entity" && (
            <EntityPanel
              entities={entities}
              filter={filter}
              onFilterChange={onFilterChange}
              detailEntityId={detailEntityId}
              onOpenEntity={onOpenEntity}
              onCloseEntity={onCloseEntity}
              getEntityRelations={getEntityRelations}
              getAppearances={getAppearances}
              levelSystems={levelSystems}
              highlighted={highlighted}
              onToggleHighlight={onToggleHighlight}
              onExportCard={onExportCard}
              onSaveEntity={onSaveEntity}
              onSelectChapter={onSelectChapter}
              onAddRelation={onAddRelation}
              onRemoveRelation={onRemoveRelation}
              onSetEntityLevel={onSetEntityLevel}
              onOpenLevelManager={onOpenLevelManager}
              onInsertName={namingActions.onInsertToEditor}
            />
          )}
          {activeTab === "note" && (
            <InspirationPanel
              notes={notes}
              globalNotes={globalNotes}
              activeWorkId={activeWorkId}
              workNameOf={workNameOf}
              actions={inspirationActions}
            />
          )}
          {activeTab === "search" && (
            <SearchPanel
              onSearch={onSearch}
              onSelectChapter={onSelectChapter}
              entities={entities}
              activeChapterId={activeChapterId}
              activeChapterName={activeChapterTitle}
              onOpenEntity={onOpenEntity}
            />
          )}
          {activeTab === "tools" &&
            (toolSub === "naming" ? (
              <NameGeneratorPanel
                exclude={namingExclude}
                favorites={namingFavorites}
                actions={namingActions}
              />
            ) : (
              <ToolLauncher onOpenNaming={openTool} />
            ))}
        </div>

        <footer className="nv-panel__foot">{foot}</footer>
      </aside>

      <button
        type="button"
        className="nv-panel__reopen"
        title="展开面板"
        onClick={onCollapse}
      >
        <LeftOutlined />
        <span className="nv-panel__reopen-text">展开面板</span>
      </button>
    </div>
  );
}
