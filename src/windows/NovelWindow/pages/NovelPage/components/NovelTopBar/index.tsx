import { Button, Select, Tooltip } from "antd";
import type { Ref } from "react";
import {
  ArrowLeftOutlined,
  ColumnHeightOutlined,
  HistoryOutlined,
  LayoutOutlined,
  MenuOutlined,
  SettingOutlined,
  ShoppingOutlined,
} from "@ant-design/icons";
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
  typewriter: boolean;
  settingsOpen: boolean;
  /** 历史快照抽屉开合状态：按钮呈高亮开关态 */
  snapshotOpen: boolean;
  /** 行囊面板开关（入口独立于侧边栏，Ctrl+Shift+B 同效） */
  packOpen: boolean;
  onSelectWork: (workId: string) => void;
  onCreateWork: (name: string) => boolean;
  onRenameWork: (name: string) => boolean;
  onDeleteWork: () => void;
  onResetTemplate: () => void;
  onExportBook: () => void;
  onExportVolume: () => void;
  onExportChapter: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleTypewriter: () => void;
  onToggleSettings: () => void;
  /** 历史快照按钮即开关：开 → 关 → 开 循环切换 */
  onToggleHistory: () => void;
  /** 行囊按钮即开关：再点一次收起；`Alt+点击` = 速览形态（3 秒后自动收起，不写记忆） */
  onTogglePack: (peek?: boolean) => void;
  /** 返回书架（书架主页接入后传入）；未传则不渲染返回按钮 */
  onBackToShelf?: () => void;
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
  typewriter,
  settingsOpen,
  snapshotOpen,
  packOpen,
  onSelectWork,
  onCreateWork,
  onRenameWork,
  onDeleteWork,
  onResetTemplate,
  onExportBook,
  onExportVolume,
  onExportChapter,
  onToggleLeft,
  onToggleRight,
  onToggleTypewriter,
  onToggleSettings,
  onToggleHistory,
  onTogglePack,
  onBackToShelf,
}: NovelTopBarProps) {
  const { saveState, lastSavedAt } = useSaveState();
  const activeWork = works.find((work) => work.id === activeWorkId) ?? null;
  const activeMeta = activeWorkId ? workMeta.get(activeWorkId) : undefined;
  const hasActiveChapter = (activeMeta?.chapters ?? 0) > 0 && Boolean(chapterName);

  return (
    <div className="nv-topbar">
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
        activeMeta={activeMeta}
        hasActiveChapter={hasActiveChapter}
        onCreate={onCreateWork}
        onRename={onRenameWork}
        onDelete={onDeleteWork}
        onResetTemplate={onResetTemplate}
        onExportBook={onExportBook}
        onExportVolume={onExportVolume}
        onExportChapter={onExportChapter}
      />

      <div className="nv-topbar__crumb">
        <span>{volumeName}</span>
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
          >
            <MenuOutlined />
          </Button>
        </Tooltip>
        <Tooltip title={rightOpen ? "收起支撑面板" : "展开支撑面板"}>
          <Button
            className={`nv-topbar__icon${rightOpen ? " is-on" : ""}`}
            onClick={onToggleRight}
            aria-label="支撑面板"
          >
            <LayoutOutlined />
          </Button>
        </Tooltip>
        <Tooltip title="打字机模式">
          <Button
            className={`nv-topbar__icon${typewriter ? " is-on" : ""}`}
            onClick={onToggleTypewriter}
            aria-label="打字机模式"
          >
            <ColumnHeightOutlined />
          </Button>
        </Tooltip>
        <Tooltip title="行囊（主角随身盘点 · Ctrl+Shift+B；Alt+点击 = 速览）">
          <Button
            className={`nv-topbar__icon${packOpen ? " is-on" : ""}`}
            onClick={(event) => onTogglePack(event.altKey)}
            aria-label="行囊"
            aria-pressed={packOpen}
          >
            <ShoppingOutlined />
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
        <Tooltip title="设置">
          <Button
            className={`nv-topbar__icon${settingsOpen ? " is-on" : ""}`}
            onClick={onToggleSettings}
            aria-label="设置"
          >
            <SettingOutlined />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
