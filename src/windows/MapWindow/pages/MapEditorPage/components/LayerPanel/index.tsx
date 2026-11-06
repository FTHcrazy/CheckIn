/**
 * 图层面板（R-MAP-24 / B4-1）。
 *
 * ── 心智模型 ──
 * 层 = **类型容器**，不是 Photoshop 的组：顺序固定、不能拖、不能新建（B4 PRD D1）。
 * 用户来这里只做两件事：**看/不看某一类内容**（眼睛）、**锁住某一类内容**（锁）。
 * 面板列"能力"而不是"数据"：空层也照常显示 —— 层集合由具备哪些能力决定，
 * 隐藏空层会让面板随文档内容忽长忽短，用户就再也记不住"素材是第几行"。
 *
 * ── 组件边界 ──
 * 纯受控展示：状态从 `doc` 读（走 `layerState.ts` 的唯一读点），变更走回调。
 * 不 import store —— 与 ElementPanel / RegionPanel 同一范式，页面负责编排。
 */

import { useEffect, useState } from "react";
import {
  DownOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  LockOutlined,
  RightOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import {
  MAP_LAYER_ROWS,
  layerLockedOf,
  layerVisibleOf,
  type MapLayerId,
  type MapLayerRowId,
} from "../../layerState";
import { docPolylines, type MapDocument } from "../../types";
import "./index.scss";

/**
 * 折叠状态的 localStorage 键。
 *
 * 面板折叠纯属 UI 偏好：不进文档（否则一份地图的存档会替另一份决定"要不要展开"），
 * 也不进撤销栈（折叠不是编辑动作）。
 */
const COLLAPSED_KEY = "map-layer-panel-collapsed";

interface LayerPanelProps {
  doc: MapDocument;
  onToggleVisible: (id: MapLayerId) => void;
  onToggleLock: (id: MapLayerId) => void;
}

/** 每行的对象计数；`base` 无计数（它只有一张底图，写"1"没有信息量） */
function countOf(doc: MapDocument, id: MapLayerRowId): number | null {
  switch (id) {
    case "base":
      return null;
    case "region":
      return doc.regions.length;
    case "polyline":
      return docPolylines(doc).length;
    case "element":
      return doc.elements.length;
    case "submap":
      // 递归数：子图里还能嵌子图，父层只报"我这一级挂了几个"
      return doc.regions.filter((r) => r.submap).length;
    case "label":
      return doc.labels.length;
  }
}

/** 读折叠偏好（隐私模式 / 存储被禁时 localStorage 会抛，一律按展开处理） */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // 存不了就存不了：下次进窗口面板展开而已，不是错误
  }
}

export default function LayerPanel({ doc, onToggleVisible, onToggleLock }: LayerPanelProps) {
  // 惰性初始化：折叠状态只在挂载时读一次 localStorage（避免"先渲染再修正"的闪动）
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  useEffect(() => {
    writeCollapsed(collapsed);
  }, [collapsed]);

  return (
    <aside className="layer-panel">
      <Button
        type="text"
        size="small"
        block
        className="layer-panel__head"
        icon={collapsed ? <RightOutlined /> : <DownOutlined />}
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        图层
      </Button>
      {!collapsed && (
        <div className="layer-panel__rows">
          {MAP_LAYER_ROWS.map((row) => {
            const count = countOf(doc, row.id);
            const visible = row.readonly || layerVisibleOf(doc, row.id as MapLayerId);
            const locked = !row.readonly && layerLockedOf(doc, row.id as MapLayerId);
            return (
              <div
                key={row.id}
                className={[
                  "layer-row",
                  row.readonly ? "layer-row--readonly" : "",
                  visible ? "" : "layer-row--hidden",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-layer={row.id}
                data-visible={visible ? "1" : "0"}
                data-locked={locked ? "1" : "0"}
              >
                <Tooltip title={row.hint} placement="right">
                  <span className="layer-row__name">{row.label}</span>
                </Tooltip>
                {count !== null && <span className="layer-row__count">{count}</span>}
                {row.readonly ? (
                  // 只读行画一个静态锁：告诉用户"这一层永远在，只是改不了"
                  <LockOutlined className="layer-row__static-lock" />
                ) : (
                  <>
                    <Tooltip title={visible ? "隐藏这一层" : "显示这一层"} placement="left">
                      <Button
                        type="text"
                        size="small"
                        aria-label={`${visible ? "隐藏" : "显示"}${row.label}层`}
                        aria-pressed={!visible}
                        icon={visible ? <EyeOutlined /> : <EyeInvisibleOutlined />}
                        onClick={() => onToggleVisible(row.id as MapLayerId)}
                      />
                    </Tooltip>
                    <Tooltip title={locked ? "解锁这一层" : "锁定这一层（不能选中与编辑）"} placement="left">
                      <Button
                        type="text"
                        size="small"
                        aria-label={`${locked ? "解锁" : "锁定"}${row.label}层`}
                        aria-pressed={locked}
                        icon={locked ? <LockOutlined /> : <UnlockOutlined />}
                        onClick={() => onToggleLock(row.id as MapLayerId)}
                      />
                    </Tooltip>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
