import { Select, Tooltip } from "antd";
import {
  ColumnHeightOutlined,
  HistoryOutlined,
  LayoutOutlined,
  MenuOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { SAVE_STATE_TEXT } from "../../novel-config";
import { formatClock, formatThousands, type WorkMeta } from "../../novel-utils";
import WorkManageMenu from "../WorkManageMenu";
import type { NovelWork, SaveState } from "../../types";
import "./index.scss";

interface NovelTopBarProps {
  works: NovelWork[];
  activeWorkId: string;
  /** 作品聚合信息（R29）：章节数 / 字数，随下拉选项展示 */
  workMeta: Map<string, WorkMeta>;
  volumeName: string;
  chapterName: string;
  saveState: SaveState;
  lastSavedAt: number | null;
  leftOpen: boolean;
  rightOpen: boolean;
  typewriter: boolean;
  settingsOpen: boolean;
  onSelectWork: (workId: string) => void;
  onCreateWork: (name: string) => boolean;
  onRenameWork: (name: string) => boolean;
  onDeleteWork: () => void;
  onResetTemplate: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleTypewriter: () => void;
  onToggleSettings: () => void;
  onOpenHistory: () => void;
}

/**
 * 编辑器顶栏（设计方案 §05：44px · 作品切换 / 面包屑 / 保存状态 / 面板开关 / 设置）
 *
 * 保存状态只占一格，不加 spinner 遮罩——这是「零打断」原则在顶栏上的体现。
 */
export default function NovelTopBar({
  works,
  activeWorkId,
  workMeta,
  volumeName,
  chapterName,
  saveState,
  lastSavedAt,
  leftOpen,
  rightOpen,
  typewriter,
  settingsOpen,
  onSelectWork,
  onCreateWork,
  onRenameWork,
  onDeleteWork,
  onResetTemplate,
  onToggleLeft,
  onToggleRight,
  onToggleTypewriter,
  onToggleSettings,
  onOpenHistory,
}: NovelTopBarProps) {
  const activeWork = works.find((work) => work.id === activeWorkId) ?? null;

  return (
    <div className="nv-topbar">
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
        activeWorkName={activeWork?.name ?? ""}
        activeMeta={activeWorkId ? workMeta.get(activeWorkId) : undefined}
        onCreate={onCreateWork}
        onRename={onRenameWork}
        onDelete={onDeleteWork}
        onResetTemplate={onResetTemplate}
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
          <button
            type="button"
            className={`nv-topbar__icon${leftOpen ? " is-on" : ""}`}
            onClick={onToggleLeft}
            aria-label="章节栏"
          >
            <MenuOutlined />
          </button>
        </Tooltip>
        <Tooltip title={rightOpen ? "收起支撑面板" : "展开支撑面板"}>
          <button
            type="button"
            className={`nv-topbar__icon${rightOpen ? " is-on" : ""}`}
            onClick={onToggleRight}
            aria-label="支撑面板"
          >
            <LayoutOutlined />
          </button>
        </Tooltip>
        <Tooltip title="打字机模式">
          <button
            type="button"
            className={`nv-topbar__icon${typewriter ? " is-on" : ""}`}
            onClick={onToggleTypewriter}
            aria-label="打字机模式"
          >
            <ColumnHeightOutlined />
          </button>
        </Tooltip>
        <Tooltip title="历史快照">
          <button
            type="button"
            className="nv-topbar__icon"
            onClick={onOpenHistory}
            aria-label="历史快照"
          >
            <HistoryOutlined />
          </button>
        </Tooltip>
        <Tooltip title="设置">
          <button
            type="button"
            className={`nv-topbar__icon${settingsOpen ? " is-on" : ""}`}
            onClick={onToggleSettings}
            aria-label="设置"
          >
            <SettingOutlined />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
