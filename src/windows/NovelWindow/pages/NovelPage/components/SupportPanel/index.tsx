import { Badge, Button } from "antd";
import {
  AppstoreOutlined,
  BulbOutlined,
  KeyOutlined,
  LeftOutlined,
  RightOutlined,
  SearchOutlined,
  TagsOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import EntityPanel from "../EntityPanel";
import type { EntitySavePatch } from "../EntityDetail";
import InspirationPanel, { type InspirationActions } from "../InspirationPanel";
import NameGeneratorPanel, { type NamingActions } from "../NameGeneratorPanel";
import ConsistencyPanel from "../ConsistencyPanel";
import ExtractPanel, { type ExtractActions } from "../ExtractPanel";
import OutlinePanel, { type OutlineActions } from "../OutlinePanel";
import SearchPanel from "../SearchPanel";
import SensitivePanel from "../SensitivePanel";
import NvSegmented from "../NvSegmented";
import { LAYOUT } from "../../novel-config";
import { useSearchStore } from "../../store/useSearchStore";
import type { PanelTab, EntityFilter, ToolSub } from "../../hooks/useNovelViewState";
import type {
  EntityAppearance,
  EntityRelationView,
  EntityType,
  SettingCategory,
  NovelEntity,
  NovelChapter,
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
  /** 本书「要素 ↔ 要素」关联条数（关系图写回后随之 +1，W-15 第三处） */
  linkCount: number;
  filter: EntityFilter;
  onFilterChange: (filter: EntityFilter) => void;
  detailEntityId: string | null;
  onOpenEntity: (entityId: string) => void;
  onCloseEntity: () => void;
  getEntityRelations: (
    entityId: string,
    type: EntityType,
  ) => EntityRelationView[];
  /** 小说设定：要素卡的「当前境界」从 realm 分类的阶梯里取 */
  settings: SettingCategory[];
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
  /** 设定 / 取消当前境界（sub = 阶内第几层，父阶是组的统一坐标） */
  onSetEntityLevel: (entityId: string, levelId: string | null, sub?: number) => void;
  /** 打开设定中心 */
  onOpenSettings: () => void;
  /** 行囊主角绑定的要素 id（空串 = 尚未指定）；决定角色卡上的「主角」角标 */
  protagonistEntityId: string;
  /** 设为主角 / 换一个 / 再点一次取消（与行囊面板的「绑定实体」是同一格数据） */
  onSetProtagonist: (entityId: string) => void;
  /** 打开自定义类型管理弹框（R23）：要素库面板头的齿轮 */
  onOpenTypeManager: () => void;
  /** 起名工具动作组（R18 / 步骤三）：插入正文 / 建角色卡 / 收藏 / 删除收藏 */
  namingActions: NamingActions;
  /** 起名工具避开本书已用名时取数用：当前作品的全部要素名 + 别名 */
  namingExclude: string[];
  /** 起名工具收藏夹（当前作品）：按 createdAt 倒序 */
  namingFavorites: import("../../types").NameFavorite[];
  /** AI 起名的本书上下文快照（书名 / 要素 / 境界）；缺省时退化为仅用已用名 */
  namingBook?: import("@/shared/ai/context").BookSnapshot;
  /** AI 入口是否**存在**（REQ-063）：透传给起名面板，false 时「AI 起名」按钮不渲染 */
  aiVisible?: boolean;
  /** AI 是否可用（M8 门控）：false 时「AI 起名」按钮禁用并说明原因（本地起名照常） */
  aiAvailable?: boolean;
  /** AI 不可用的一句话说明 */
  aiUnavailableText?: string;
  /** 轻提示：规划中的工具点了也要有回应（UI-09），复用页面级 toast */
  onNotify: (text: string, tone?: import("@/shared/novel/use-auto-toast").ToastTone) => void;
  /**
   * 全书章节：敏感词面板「扫描全书」的数据源。
   *
   * 可选是因为它只服务工具箱里的一个二级面板；缺省时面板会提示
   * 「这本书还没有章节」，不影响其余五个 Tab。
   */
  chapters?: NovelChapter[];
  /**
   * 工具箱二级面板（受控）。
   *
   * 不传时退回组件内部 state —— 单测直接渲染本组件不必接这份状态；
   * 页面侧传入是为了让底部状态条的计数角标能一键直达敏感词面板。
   */
  toolSub?: ToolSub;
  onToolSubChange?: (value: ToolSub) => void;
  /** 打开人物关系网络独立窗口（R27）；不传时工具卡退回「不可进入」占位 */
  onOpenRelation?: () => void;
  /**
   * 抽取设定动作组（R-AI-08）。
   *
   * 会话状态由页面持有：候选与「已建 N 张」在切 Tab 后仍要留在面板上，
   * 放在面板内部 state 里一关就没。
   */
  extractActions: ExtractActions;
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
  linkCount,
  filter,
  onFilterChange,
  detailEntityId,
  onOpenEntity,
  onCloseEntity,
  getEntityRelations,
  settings,
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
  onOpenSettings,
  protagonistEntityId,
  onSetProtagonist,
  onOpenTypeManager,
  namingActions,
  namingExclude,
  namingFavorites,
  namingBook,
  aiVisible = true,
  aiAvailable = true,
  aiUnavailableText = "",
  onNotify,
  chapters = [],
  toolSub: controlledToolSub,
  onToolSubChange,
  onOpenRelation,
  extractActions,
}: SupportPanelProps) {
  /** 工具箱二级面板：null = 启动器首页；受控优先，否则组件内自持 */
  const [internalSub, setInternalSub] = useState<ToolSub>(null);
  const toolSub = controlledToolSub !== undefined ? controlledToolSub : internalSub;
  const setToolSub = onToolSubChange ?? setInternalSub;
  /** 面板头「＋ 伏笔」触发次数：OutlinePanel 据此打开首卷的新增表单 */
  const [addForeshadowTick, setAddForeshadowTick] = useState(0);
  const [dragging, setDragging] = useState(false);

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

  const openTool = useCallback(() => setToolSub("naming"), [setToolSub]);
  const openSensitive = useCallback(() => setToolSub("sensitive"), [setToolSub]);
  const openConsistency = useCallback(
    () => setToolSub("consistency"),
    [setToolSub],
  );
  const openExtract = useCallback(() => setToolSub("extract"), [setToolSub]);
  const backToTools = useCallback(() => setToolSub(null), [setToolSub]);

  /**
   * 抽取入口不可用的原因（未配置 AI / 当前版本不含 AI）。
   *
   * 与起名同一个口径：**不隐藏**卡片，只在状态位与点击回应里说明原因——
   * 「设定库怎么填满」是作者迟早要问的问题，藏起来等于告诉他这软件没有这个能力。
   */
  const extractUnavailableText = useMemo(() => {
    if (!aiVisible) return "当前版本不含 AI 功能";
    if (!aiAvailable) return aiUnavailableText || "AI 当前不可用，先在设置里配置模型";
    return undefined;
  }, [aiVisible, aiAvailable, aiUnavailableText]);

  /**
   * 工具箱头部的「N 项可用 · M 项规划中」。
   *
   * 原先写死「2 项可用 · 2 项规划中」：关系网络上线后它仍说 2 项，属于
   * 面板自己在说谎。改成按真实的入口开关算，新增工具不必再回来改文案。
   */
  const toolStats = useMemo(() => {
    const relationLive = Boolean(onOpenRelation);
    const extractLive = !extractUnavailableText;
    const live = 3 + (extractLive ? 1 : 0) + (relationLive ? 1 : 0);
    const planned = 1 + (relationLive ? 0 : 1);
    const parts = [`${live} 项可用`, `${planned} 项规划中`];
    if (!extractLive) parts.push("抽取需配置 AI");
    return parts.join(" · ");
  }, [onOpenRelation, extractUnavailableText]);

  // 工具箱二级面板直接顶替 Tab 名：head / foot / 滚动策略都按它分支
  const namedActive = toolSub ?? activeTab;

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
          meta: `${entities.length} 个要素 · ${linkCount} 条关联`,
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
      case "sensitive":
        return {
          title: "敏感词检测",
          meta: "涉黄涉暴等通用红线",
          action: null,
        };
      case "consistency":
        return {
          title: "一致性校对",
          meta: "纯本地 · 不耗 AI 额度",
          action: null,
        };
      case "extract":
        return {
          title: "抽取设定",
          meta: `已有 ${entities.length} 张卡 · 勾选后才入库`,
          action: null,
        };
      default:
        return { title: "工具箱", meta: toolStats, action: null };
    }
  }, [
    namedActive,
    counts,
    entities.length,
    notes.length,
    namingExclude.length,
    wordText,
    onTabChange,
    toolStats,
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
      case "sensitive":
        return (
          <>
            <KeyOutlined />
            <span>点命中结果跳到正文第一处</span>
          </>
        );
      case "consistency":
        return (
          <>
            <KeyOutlined />
            <span>点问题跳到正文第一处 · 只提示不改正文</span>
          </>
        );
      case "extract":
        return (
          <>
            <KeyOutlined />
            <span>勾选后批量建卡 · 重名会标「已存在」</span>
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

  /**
   * 面板滚动区是否交给内容自己管。
   *
   * note / search：内容自带滚动容器（虚拟列表）。
   * outline：章节列表已虚拟化并自持滚动，若外层再留 `overflow-y: auto`
   *   会形成「外层滚一下、内层再滚一下」的双滚动条，滚轮落在内层虚拟列表上
   *   时外层永远滚不到（反之亦然），表现为滚到一半卡住。
   *   统计区 / 切换器留在列表之上不参与滚动，所以这里整块交给内容最省事。
   */
  const flatScroll =
    namedActive === "note" ||
    namedActive === "search" ||
    namedActive === "outline" ||
    // 敏感词 / 一致性校对：工具栏常驻、结果列表自持滚动
    namedActive === "sensitive" ||
    namedActive === "consistency" ||
    namedActive === "extract";

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
              <Button
                className="nv-panel__icon"
                title="返回工具箱"
                onClick={backToTools}
              >
                <LeftOutlined />
              </Button>
            )}
            {head.action && (
              <Button
                className="nv-panel__btn"
                onClick={head.action.onClick}
              >
                {head.action.label}
              </Button>
            )}
            {namedActive === "entity" && (
              /* REQ-049：类型管理入口从「纯图标 + Tooltip」升级为「图标 + 文字」——
                 纯图标在面板头一排 icon 里几乎发现不了，而这是新建自定义类型的唯一入口。
                 用标签图标与「设置」齿轮区分：它管的是要素类型，不是设置。 */
              <Button
                className="nv-panel__type"
                aria-label="要素类型管理"
                title="要素类型管理"
                onClick={onOpenTypeManager}
              >
                <TagsOutlined />
                <span>类型管理</span>
              </Button>
            )}
            <Button
              className="nv-panel__icon"
              title="收起面板"
              onClick={onCollapse}
            >
              <RightOutlined />
            </Button>
          </div>
        </header>

        {/* 五 Tab 的分段切换：antd Segmented 的 tabs 变体。
            改前是「grid + 每格一颗清零 Button + 绝对定位滑块 + ResizeObserver
            重量宽度」——滑块定位、字体加载后的错位、面板拖宽后的重算都要自己
            兜。Segmented 的滑块由组件库量，键盘左右键与 radio 语义也是白送的；
            外观（轨道底 / 40px 格 / 图标叠文字 / 选中主色）在 NvSegmented 的
            tabs 变体里用变量复刻，与改前一致。 */}
        <NvSegmented<PanelTab>
          variant="tabs"
          ariaLabel="右栏面板"
          value={activeTab}
          onChange={(tab) => {
            onTabChange(tab);
            setToolSub(null);
          }}
          options={TABS.map((tab) => {
            // tab 角标计数：0 时 antd Badge 自己就不渲染角标（不是我们的分支）
            const badgeCount =
              tab.key === "outline"
                ? counts.openForeshadows
                : tab.key === "note"
                  ? notes.length
                  : 0;
            return {
              value: tab.key,
              label: (
                <>
                  {/* 角标走组件库 Badge（§6.1.2）：包住图标，位置 / 描边 / 圆角
                      由组件库负责；灵感条数是中性信息，走 --soft 换语义色 */}
                  <Badge
                    className={`nv-panel__tab-badge${
                      tab.key === "note" ? " nv-panel__tab-badge--soft" : ""
                    }`}
                    count={badgeCount}
                    size="small"
                    overflowCount={99}
                  >
                    {tab.icon}
                  </Badge>
                  <span>{tab.label}</span>
                </>
              ),
            };
          })}
        />

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
              settings={settings}
              highlighted={highlighted}
              onToggleHighlight={onToggleHighlight}
              onExportCard={onExportCard}
              onSaveEntity={onSaveEntity}
              onSelectChapter={onSelectChapter}
              onAddRelation={onAddRelation}
              onRemoveRelation={onRemoveRelation}
              onSetEntityLevel={onSetEntityLevel}
              onOpenSettings={onOpenSettings}
              onOpenTypeManager={onOpenTypeManager}
              protagonistEntityId={protagonistEntityId}
              onSetProtagonist={onSetProtagonist}
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
                book={namingBook}
                aiVisible={aiVisible}
                aiAvailable={aiAvailable}
                aiUnavailableText={aiUnavailableText}
              />
            ) : toolSub === "sensitive" ? (
              <SensitivePanel
                chapterId={activeChapterId}
                chapters={chapters}
                onNotify={onNotify}
              />
            ) : toolSub === "consistency" ? (
              <ConsistencyPanel
                workId={activeWorkId}
                chapters={chapters}
                entities={entities}
                realmCategory={
                  settings.find((category) => category.kind === "realm") ?? null
                }
                onNotify={onNotify}
              />
            ) : toolSub === "extract" ? (
              <ExtractPanel
                chapterId={activeChapterId}
                chapters={chapters}
                session={extractActions.session}
                onRun={extractActions.onRun}
                onToggle={extractActions.onToggle}
                onTypeChange={extractActions.onTypeChange}
                onConfirm={extractActions.onConfirm}
                onClose={extractActions.onClose}
                onNotify={onNotify}
                unavailableText={extractUnavailableText}
              />
            ) : (
              <ToolLauncher
                onOpenNaming={openTool}
                onOpenSensitive={openSensitive}
                onOpenConsistency={openConsistency}
                onOpenExtract={openExtract}
                extractUnavailableText={extractUnavailableText}
                onNotify={onNotify}
                onOpenRelation={onOpenRelation}
              />
            ))}
        </div>

        <footer className="nv-panel__foot">{foot}</footer>
      </aside>

      <Button
        className="nv-panel__reopen"
        title="展开面板"
        onClick={onCollapse}
      >
        <LeftOutlined />
        <span className="nv-panel__reopen-text">展开面板</span>
      </Button>
    </div>
  );
}
