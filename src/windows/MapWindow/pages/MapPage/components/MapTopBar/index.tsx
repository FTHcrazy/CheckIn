/**
 * 顶栏（RM1）：地图切换下拉 + 新建 + 绑定徽标 + 撤销栈 + 导出 PNG + 设置 + 收起侧栏
 */
import { useState } from "react";
import type { MapMetaDTO } from "@/shared/types/electron.d.ts";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface MapTopBarProps {
  maps: MapMetaDTO[];
  currentId: string | null;
  currentName: string;
  bindName?: string | null;
  saveState: "idle" | "saving" | "error";
  canUndo: boolean;
  canRedo: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleSidebar: () => void;
  onSettings?: () => void;
}

export default function MapTopBar(props: MapTopBarProps) {
  const [open, setOpen] = useState(false);
  const {
    maps,
    currentId,
    currentName,
    bindName,
    saveState,
    canUndo,
    canRedo,
    collapsed,
  } = props;

  const saveLabel =
    saveState === "saving" ? "保存中…" : saveState === "error" ? "保存失败" : "已保存";

  return (
    <div className="mw-top">
      <button
        type="button"
        className="icon-btn"
        title={collapsed ? "展开标注栏" : "收起标注栏"}
        onClick={props.onToggleSidebar}
      >
        <MapIcon name="frame" size={16} />
      </button>

      <div className="map-picker-wrap">
        <button type="button" className="map-picker" onClick={() => setOpen((v) => !v)}>
          <MapIcon name="map" size={15} style={{ color: "var(--app-primary)" }} />
          {currentName || "未选择地图"}
          <MapIcon name="chevron" size={14} className="map-picker__caret" />
        </button>
        {open && (
          <div className="map-picker__menu" onMouseLeave={() => setOpen(false)}>
            {maps.length === 0 && <div className="map-picker__empty">还没有地图</div>}
            {maps.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`map-picker__item${m.id === currentId ? " is-on" : ""}`}
                onClick={() => {
                  props.onSelect(m.id);
                  setOpen(false);
                }}
              >
                <MapIcon name="map" size={14} />
                <span>{m.name}</span>
                {m.workId && <span className="map-picker__tag">已绑定</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {bindName && (
        <span className="bind-badge">
          <MapIcon name="book" size={13} /> 已绑定《{bindName}》
        </span>
      )}
      {!bindName && currentId && (
        <span className="bind-badge bind-badge--muted">
          <MapIcon name="book" size={13} /> 主地图
        </span>
      )}

      <button type="button" className="btn btn--sm" onClick={props.onNew}>
        <MapIcon name="plus-sm" size={14} /> 新建地图
      </button>

      <div className="top-spacer" />

      <button type="button" className="btn btn--sm btn--icon" title="撤销 Ctrl+Z" disabled={!canUndo} onClick={props.onUndo}>
        <MapIcon name="undo" size={15} />
      </button>
      <button type="button" className="btn btn--sm btn--icon" title="重做 Ctrl+Y" disabled={!canRedo} onClick={props.onRedo}>
        <MapIcon name="redo" size={15} />
      </button>
      <button type="button" className="btn btn--sm btn--primary" onClick={props.onExport}>
        <MapIcon name="download" size={14} /> 导出 PNG
      </button>
      <button type="button" className="icon-btn" title="设置" onClick={props.onSettings}>
        <MapIcon name="gear" size={16} />
      </button>
      <span className="mw-top__save">{saveLabel}</span>
    </div>
  );
}
