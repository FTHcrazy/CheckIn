import { useState } from "react";
import { DownOutlined } from "@ant-design/icons";
import { ENTITY_TYPE_META, MARK_TYPE_OPTIONS } from "../../novel-config";
import type { EntityType } from "../../types";
import "./index.scss";

interface SelectionToolbarProps {
  x: number;
  y: number;
  text: string;
  onMark: (type: EntityType) => void;
}

/**
 * 选区标记工具条（O3 / R20 ③）
 *
 * 选中正文 → 浮起「标记为…」；无卡则秒建（名字带入），有卡则关联为别名。
 * 只提示不自动标注（无 NLP），决定权始终在用户手上。
 */
export default function SelectionToolbar({
  x,
  y,
  text,
  onMark,
}: SelectionToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const quick = MARK_TYPE_OPTIONS.slice(0, 2);
  const rest = MARK_TYPE_OPTIONS.slice(2);

  return (
    <div className="nv-selbar" style={{ left: x, top: y }}>
      {quick.map((type, index) => (
        <span key={type} className="nv-selbar__group">
          {index > 0 && <span className="nv-selbar__divider" />}
          <button type="button" onClick={() => onMark(type)}>
            标记为{ENTITY_TYPE_META[type].label}
          </button>
        </span>
      ))}

      <span className="nv-selbar__divider" />
      <button
        type="button"
        className="nv-selbar__more"
        onClick={() => setExpanded((value) => !value)}
      >
        更多 <DownOutlined />
      </button>

      {expanded && (
        <div className="nv-selbar__menu">
          {rest.map((type) => (
            <button key={type} type="button" onClick={() => onMark(type)}>
              {ENTITY_TYPE_META[type].label}
            </button>
          ))}
        </div>
      )}

      <span className="nv-selbar__sr">选中：{text}</span>
    </div>
  );
}
