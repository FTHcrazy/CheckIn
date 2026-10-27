import { Button, Select, Tooltip } from "antd";
import type { MouseEvent as ReactMouseEvent, Ref } from "react";
import {
  ArrowLeftOutlined,
  ControlOutlined,
  HistoryOutlined,
  LayoutOutlined,
  LoadingOutlined,
  MenuOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import bookSettingSvg from "@/assets/novel/book-setting.svg?raw";
import packSvg from "@/assets/novel/pack.svg?raw";
import { SAVE_STATE_TEXT } from "../../novel-config";
import { formatClock, formatThousands, type WorkMeta } from "../../novel-utils";
import { useSaveState } from "../../store/useNovelEditorStore";
import WorkManageMenu, { type WorkManageMenuHandle } from "../WorkManageMenu";
import type { NovelWork } from "../../types";
import "./index.scss";

interface NovelTopBarProps {
  works: NovelWork[];
  activeWorkId: string;
  /** 作品管理菜单的命令式句柄（空书架空态里「新建作品」复用它） */
  menuRef?: Ref<WorkManageMenuHandle>;
  /** 作品聚合信息（R29）：章节数 / 字数，随下拉选项展示 */
  workMeta: Map<string, WorkMeta>;
  volumeName: string;
  chapterName: string;
  leftOpen: boolean;
  rightOpen: boolean;
  settingsOpen: boolean;
  /** 历史快照抽屉开合状态：按钮呈高亮开关态 */
  snapshotOpen: boolean;
  /** 设定中心（本书设定）开合状态：按钮呈高亮开关态 */
  settingCenterOpen: boolean;
  onSelectWork: (workId: string) => void;
  onCreateWork: (name: string, genre?: string) => boolean;
  onRenameWork: (name: string) => boolean;
  /** 设置当前作品题材（2.7.1，空串 = 清空） */
  onSetWorkGenre: (genre: string) => boolean;
  onDeleteWork: () => void;
  onResetTemplate: () => void;
  onExportBook: () => void;
  onExportVolume: () => void;
  onExportChapter: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleSettings: () => void;
  /**
   * AI 续写（R-AI-07）：光标处顺着前文出 2–3 个候选。
   * 未配置 AI 时点了会在浮层内报错（不写入原文），符合「入口可消失」。
   */
  onContinue?: () => void;
  /** 历史快照按钮即开关：开 → 关 → 开 循环切换 */
  onToggleHistory: () => void;
  /** 行囊：唤起独立行囊窗口（单实例，重复点击仅聚焦），Ctrl+Shift+B 同效 */
  onOpenPack: () => void;
  /**
   * 行囊窗口正在打开（点过按钮、窗口尚未真正可见）。
   *
   * 独立窗口首次创建要等整个 SPA 装载（dev 下 1–3s），期间屏幕上没有任何变化。
   * 没有这个态，作者只会看到「点了没反应」然后补点一次 —— 而第二次往往正好
   * 撞在装载完成前后，于是被记成「要点两次才弹出行囊窗口」（REQ-054）。
   *
   * **刻意不用 `Button` 的 `loading` 属性**：antd 的 loading 会把 onClick 一起吞掉，
   * 而「再点一次」恰恰是窗口落到后面时的唯一退路（主进程已开分支会 `raiseWindow`）。
   * 这里只换内容（图标 → 转圈），把点击留着。
   */
  packOpening?: boolean;
  /**
   * 设定中心（本书设定）：按钮即开关 —— 再点一次收起（REQ-050 修法 ③）。
   * 与「快照」「排版」一致的 toggle 语义，避免「第二次点击看起来没反应」。
   */
  onToggleSettingCenter: () => void;
  /** 返回书架（书架主页接入后传入）；未传则不渲染返回按钮 */
  onBackToShelf?: () => void;
  /**
   * 「点击已真正落到顶栏上」时的通知：由页面注入，用一次状态更新收掉页内浮层
   * （设定中心 / 类型管理的 Modal 遮罩）。REQ-053 见 `useNovelViewState` 的注释。
   *
   * 为什么挂在 **click 捕获阶段**而不是 mousedown：mousedown 就把浮层关掉的话，
   * 遮罩会立刻回到「正在退场但仍铺满视口」的状态（antd 离场动画期间 wrap 还在），
   * 紧接着的 mouseup / click 又被它吃掉 —— 等于白改一层。click 已经派发到按钮，
   * 这时候收浮层才不会反过来抢走同一次点击。
   */
  onDismissOverlays?: () => void;
}

/**
 * 编辑器顶栏（设计方案 §05：44px · 作品切换 / 面包屑 / 保存状态 / 面板开关 / 设置）
 *
 * 保存状态只占一格，不加 spinner 遮罩——这是「零打断」原则在顶栏上的体现。
 *
 * 保存态由本组件直接订阅 store：打字时它每键都在变，若由页面根持有再透传，
 * 每敲一个字都要把整棵树推一遍。
 */
export default function NovelTopBar({
  works,
  activeWorkId,
  menuRef,
  workMeta,
  volumeName,
  chapterName,
  leftOpen,
  rightOpen,
  settingsOpen,
  snapshotOpen,
  settingCenterOpen,
  onSelectWork,
  onCreateWork,
  onRenameWork,
  onSetWorkGenre,
  onDeleteWork,
  onResetTemplate,
  onExportBook,
  onExportVolume,
  onExportChapter,
  onToggleLeft,
  onToggleRight,
  onToggleSettings,
  onToggleSettingCenter,
  onToggleHistory,
  onOpenPack,
  onBackToShelf,
  onDismissOverlays,
  onContinue,
  packOpening = false,
}: NovelTopBarProps) {
  const { saveState, lastSavedAt } = useSaveState();
  const activeWork = works.find((work) => work.id === activeWorkId) ?? null;
  const activeMeta = activeWorkId ? workMeta.get(activeWorkId) : undefined;
  const hasActiveChapter = (activeMeta?.chapters ?? 0) > 0 && Boolean(chapterName);

  /**
   * 顶栏任意一颗按钮被点到 → 先收掉页内浮层（REQ-053）。
   *
   * 用捕获阶段而不是逐颗包一层 onClick：顶栏里有下拉、菜单、四类开关与窗口级入口，
   * 逐颗包会把「离开浮层」这件横切的事复制十几遍，漏一颗就是下次的口子。
   * 例外只有一处：「小说设定」自己就是那颗浮层的开关（`data-page-overlay-keep-open`），
   * 若这里也关一次，就会「先关、再被 toggle 打开」，表现为点了没反应。
   */
  const handleClickCapture = (
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    if (!onDismissOverlays) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("[data-page-overlay-keep-open]")
    ) {
      return;
    }
    onDismissOverlays();
  };

  return (
    <div className="nv-topbar" onClickCapture={handleClickCapture}>
      {onBackToShelf && (
        <Tooltip title="返回书架">
          <Button
            className="nv-topbar__back"
            onClick={onBackToShelf}
            aria-label="返回书架"
          >
            <ArrowLeftOutlined />
            <span>书架</span>
          </Button>
        </Tooltip>
      )}

      <Select
        className="nv-topbar__work"
        value={activeWorkId}
        options={works.map((work) => ({ value: work.id, label: work.name }))}
        onChange={onSelectWork}
        variant="borderless"
        size="small"
        popupMatchSelectWidth={220}
        optionRender={(option) => {
          const meta = workMeta.get(String(option.value));
          return (
            <div className="nv-topbar__work-option">
              <span className="nv-topbar__work-name">{option.label}</span>
              {meta && (
                <span className="nv-topbar__work-meta">
                  {meta.chapters} 章 · {formatThousands(meta.words)} 字
                </span>
              )}
            </div>
          );
        }}
      />

      <WorkManageMenu
        ref={menuRef}
        activeWorkName={activeWork?.name ?? ""}
        activeGenre={activeWork?.genre}
        activeMeta={activeMeta}
        hasActiveChapter={hasActiveChapter}
        onCreate={onCreateWork}
        onRename={onRenameWork}
        onSetGenre={onSetWorkGenre}
        onDelete={onDeleteWork}
        onResetTemplate={onResetTemplate}
        onExportBook={onExportBook}
        onExportVolume={onExportVolume}
        onExportChapter={onExportChapter}
      />

      {/* 语义分组：左侧是「哪部作品」的切换与管理，右侧是「读到哪」的位置 */}
      <span className="nv-topbar__divider" aria-hidden />

      <div className="nv-topbar__crumb">
        <span className="nv-topbar__crumb-volume">{volumeName}</span>
        <span className="nv-topbar__crumb-sep">/</span>
        <span className="nv-topbar__crumb-chapter">{chapterName}</span>
      </div>

      <div className={`nv-topbar__save nv-topbar__save--${saveState}`}>
        <span className="nv-topbar__save-dot" />
        <span>
          {saveState === "saved" && lastSavedAt
            ? `${SAVE_STATE_TEXT.saved} · ${formatClock(lastSavedAt)}`
            : SAVE_STATE_TEXT[saveState]}
        </span>
      </div>

      <div className="nv-topbar__actions">
        <Tooltip title={leftOpen ? "收起章节栏" : "展开章节栏"}>
          <Button
            className={`nv-topbar__icon${leftOpen ? " is-on" : ""}`}
            onClick={onToggleLeft}
            aria-label="章节栏"
            aria-pressed={leftOpen}
          >
            <MenuOutlined />
          </Button>
        </Tooltip>
        <Tooltip title={rightOpen ? "收起支撑面板" : "展开支撑面板"}>
          <Button
            className={`nv-topbar__icon${rightOpen ? " is-on" : ""}`}
            onClick={onToggleRight}
            aria-label="支撑面板"
            aria-pressed={rightOpen}
          >
            <LayoutOutlined />
          </Button>
        </Tooltip>
        {/* 语义分组：左边是本页布局开关，右边是窗口级 / 抽屉级入口。
            五颗 icon 一排不加边界时，布局开关与功能入口容易扫成一团 */}
        <span className="nv-topbar__divider" aria-hidden />
        <Tooltip title={packOpening ? "正在打开行囊…" : "行囊（主角随身盘点 · Ctrl+Shift+B）"}>
          <Button
            className="nv-topbar__icon"
            onClick={onOpenPack}
            aria-label="行囊"
            aria-busy={packOpening || undefined}
            data-tour-target="topbar-pack"
          >
            {packOpening ? <LoadingOutlined spin /> : <SvgIcon svg={packSvg} />}
          </Button>
        </Tooltip>
        <Tooltip title={snapshotOpen ? "收起历史快照" : "历史快照"}>
          <Button
            className={`nv-topbar__icon${snapshotOpen ? " is-on" : ""}`}
            onClick={onToggleHistory}
            aria-label="历史快照"
            aria-pressed={snapshotOpen}
          >
            <HistoryOutlined />
          </Button>
        </Tooltip>
        {onContinue && (
          <Tooltip title="AI 续写（光标处顺着前文接着写）">
            <Button
              className="nv-topbar__icon"
              onClick={onContinue}
              aria-label="AI 续写"
            >
              <ThunderboltOutlined />
            </Button>
          </Tooltip>
        )}
        <Tooltip title={settingCenterOpen ? "收起小说设定" : "小说设定（Ctrl+Shift+S）"}>
          <Button
            className={`nv-topbar__icon${settingCenterOpen ? " is-on" : ""}`}
            onClick={onToggleSettingCenter}
            aria-label="小说设定"
            aria-pressed={settingCenterOpen}
            data-tour-target="topbar-setting"
            /* 它是设定中心这颗浮层的开关本身：click 捕获阶段不要替它先关一次，
               否则「先关、再被 toggle 打开」= 点了没反应（REQ-053） */
            data-page-overlay-keep-open="settingCenter"
          >
            <SvgIcon svg={bookSettingSvg} />
          </Button>
        </Tooltip>
        {/* 与标题栏的「设置」（全局：外观/账号）区分：这里只管排版与码字偏好，
            图标用滑杆而不是齿轮，避免同屏两颗齿轮各开各的设置。
            `data-drawer-keep-open` 是给 SettingsDrawer 的「点外部关闭」看的：
            这颗按钮是它的开关，落在它上面的 mousedown 不算「点了抽屉外部」——
            否则会「先被文档级监听关掉、再被 toggle 打开」，表现为点了没反应。 */}
        <Tooltip title="排版与偏好">
          <Button
            className={`nv-topbar__icon${settingsOpen ? " is-on" : ""}`}
            onClick={onToggleSettings}
            aria-label="排版与偏好"
            aria-pressed={settingsOpen}
            data-drawer-keep-open="settings"
          >
            <ControlOutlined />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
