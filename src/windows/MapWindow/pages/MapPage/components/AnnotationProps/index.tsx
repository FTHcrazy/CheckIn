/**
 * 标注属性面板（RM3/RM4 右侧栏）：名称 / 备注 / 要素类型 / 绑定要素 / 绑定子图 / 删除 / 定位
 */
import type { MapAnnotation } from "@/shared/types/electron.d.ts";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface AnnotationPropsProps {
  annotation: MapAnnotation;
  maps?: Array<{ id: string; name: string }>;
  onUpdate: (patch: Partial<MapAnnotation>) => void;
  onDelete: () => void;
  onLocate?: () => void;
  onBindEntity?: () => void;
  onBindSubMap?: (mapId: string | null) => void;
}

const KINDS = [
  { key: "city", name: "城池" },
  { key: "town", name: "城镇" },
  { key: "village", name: "村庄" },
  { key: "pass", name: "关卡" },
  { key: "port", name: "港口" },
  { key: "ruins", name: "遗迹" },
  { key: "temple", name: "神殿" },
  { key: "mine", name: "矿洞" },
];

export default function AnnotationProps(props: AnnotationPropsProps) {
  const { annotation: a } = props;
  return (
    <div className="props-panel">
      <div className="props-head">
        <MapIcon name="pin" size={15} style={{ color: "var(--app-primary)" }} />
        标注属性
        <div className="top-spacer" />
        <span className="chip chip--primary">{typeCn(a.type)}</span>
      </div>
      <div className="props-body">
        <div className="field">
          <div className="field__label">名称</div>
          <input
            className="input"
            value={a.name}
            onChange={(e) => props.onUpdate({ name: e.target.value })}
            placeholder="地点名称"
          />
        </div>

        {a.type === "pin" && (
          <div className="field">
            <div className="field__label">要素类型</div>
            <div className="kind-row">
              {KINDS.map((k) => (
                <button
                  key={k.key}
                  className={`kind-chip${a.kind === k.key ? " is-on" : ""}`}
                  onClick={() => props.onUpdate({ kind: k.key })}
                >
                  {k.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {a.type === "area" && (
          <div className="field">
            <div className="field__label">尺寸</div>
            <div className="xform-grid">
              <div className="field"><div className="field__label">宽</div><input className="input" value={Math.round(a.w ?? 0)} readOnly /></div>
              <div className="field"><div className="field__label">高</div><input className="input" value={Math.round(a.h ?? 0)} readOnly /></div>
            </div>
          </div>
        )}

        <div className="field">
          <div className="field__label">备注</div>
          <textarea
            className="input input--area"
            value={a.note ?? ""}
            onChange={(e) => props.onUpdate({ note: e.target.value })}
            placeholder="剧情/设定备注…"
            rows={3}
          />
        </div>

        <div className="field">
          <div className="field__label">绑定要素（RM4）</div>
          {a.entityId ? (
            <div className="bind-row">
              <span className="bind-badge"><MapIcon name="book" size={13} /> 已绑定要素卡</span>
              <button className="btn btn--sm" onClick={() => props.onUpdate({ entityId: undefined })}>解绑</button>
            </div>
          ) : (
            <button className="btn btn--sm btn--block" onClick={props.onBindEntity}>
              <MapIcon name="plus-sm" size={14} /> 一键建卡 / 绑定要素
            </button>
          )}
        </div>

        {a.type === "area" && (
          <div className="field">
            <div className="field__label">嵌套子图（RM5）</div>
            <select
              className="input"
              value={a.childMapId ?? ""}
              onChange={(e) => props.onBindSubMap?.(e.target.value || null)}
            >
              <option value="">无</option>
              {(props.maps ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="field-note" style={{ fontSize: 11, color: "var(--app-text-muted)" }}>
          坐标 ({Math.round(a.x)}, {Math.round(a.y)}) · 双击画布可拖动
        </div>
      </div>
      <div className="props-foot">
        <button className="btn btn--sm" style={{ flex: 1 }} onClick={props.onLocate}>
          <MapIcon name="target" size={14} /> 定位
        </button>
        <button className="btn btn--sm" style={{ flex: 1, color: "var(--app-error)" }} onClick={props.onDelete}>
          <MapIcon name="close" size={14} /> 删除
        </button>
      </div>
    </div>
  );
}

function typeCn(t: MapAnnotation["type"]): string {
  return { pin: "地点钉", area: "区域框", label: "自由标签", line: "连线" }[t];
}
