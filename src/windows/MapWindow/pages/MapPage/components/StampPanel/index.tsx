/**
 * 贴章对象属性面板（RM13 右侧栏）：变换（X/Y/旋转/缩放）/ 层级 / 编组 / 翻转 / 删除
 */
import type { MapStamp } from "@/shared/types/electron.d.ts";
import { findSymbol } from "../../map-symbols";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface StampPanelProps {
  stamp: MapStamp;
  onUpdate: (patch: Partial<MapStamp>) => void;
  onDelete: () => void;
  onReorder: (dir: "up" | "down" | "top" | "bottom") => void;
  onGroup: () => void;
  onUngroup: () => void;
}

export default function StampPanel(props: StampPanelProps) {
  const { stamp } = props;
  const def = findSymbol(stamp.symbolKey);
  return (
    <div className="panel-stamp">
      <div className="stamp-panel__head">
        <MapIcon name="stamp" size={15} style={{ color: "var(--app-primary)" }} />
        贴章对象
        <div className="top-spacer" />
        <span className="chip chip--primary">{def?.name ?? stamp.symbolKey}</span>
      </div>
      <div className="stamp-panel__body">
        <div className="side-section-title" style={{ padding: "0 0 6px" }}>
          变换 <i>· 实时预览，Shift 吸附 15°</i>
        </div>
        <div className="xform-grid">
          <div className="field"><div className="field__label">X</div><input className="input" value={Math.round(stamp.x)} onChange={(e) => props.onUpdate({ x: Number(e.target.value) })} /></div>
          <div className="field"><div className="field__label">Y</div><input className="input" value={Math.round(stamp.y)} onChange={(e) => props.onUpdate({ y: Number(e.target.value) })} /></div>
          <div className="field"><div className="field__label">旋转<em>{Math.round(stamp.rotation ?? 0)}°</em></div><input className="input" value={Math.round(stamp.rotation ?? 0)} onChange={(e) => props.onUpdate({ rotation: Number(e.target.value) })} /></div>
          <div className="field"><div className="field__label">缩放<em>{(stamp.scale ?? 1).toFixed(2)}×</em></div><input className="input" value={(stamp.scale ?? 1).toFixed(2)} onChange={(e) => props.onUpdate({ scale: Number(e.target.value) })} /></div>
        </div>

        <div className="side-section-title" style={{ padding: "6px 0" }}>层级 <i>· 前后遮挡序</i></div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => props.onReorder("top")}><MapIcon name="layer-up" size={13} /> 置顶</button>
          <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => props.onReorder("up")}>上移</button>
          <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => props.onReorder("down")}>下移</button>
          <button className="btn btn--sm" style={{ flex: 1 }} onClick={() => props.onReorder("bottom")}>置底</button>
        </div>

        <div className="side-section-title" style={{ padding: "12px 0 6px" }}>编组</div>
        {stamp.groupId ? (
          <div className="child-card">
            <span style={{ color: "var(--app-primary)", display: "inline-flex" }}><MapIcon name="group" size={16} /></span>
            <span className="child-card__text"><b>编组 {stamp.groupId.slice(0, 6)}</b><span>相对关系已锁定</span></span>
            <div className="top-spacer" />
            <button className="btn btn--sm" onClick={props.onUngroup}>解组</button>
          </div>
        ) : (
          <button className="btn btn--sm btn--block" onClick={props.onGroup}><MapIcon name="group" size={14} /> 编组（选中多个后）</button>
        )}

        <div className="check-row" style={{ paddingTop: 10 }}>
          <input type="checkbox" id="flipH" checked={stamp.flip ?? false} onChange={(e) => props.onUpdate({ flip: e.target.checked })} />
          <label htmlFor="flipH">水平翻转</label>
        </div>
        <div className="field-note" style={{ margin: "10px 0 0", fontSize: 11, color: "var(--app-text-muted)" }}>
          贴章是预制符号对象：自由摆放 / 旋转 / 缩放 / 遮挡；不做自由笔刷塑形与路径编辑。
        </div>
      </div>
      <div className="stamp-panel__foot">
        <button className="btn btn--sm" style={{ flex: 1 }} onClick={props.onGroup}><MapIcon name="group" size={14} /> 编组</button>
        <button className="btn btn--sm" style={{ flex: 1, color: "var(--app-error)" }} onClick={props.onDelete}><MapIcon name="close" size={14} /> 删除</button>
      </div>
    </div>
  );
}
