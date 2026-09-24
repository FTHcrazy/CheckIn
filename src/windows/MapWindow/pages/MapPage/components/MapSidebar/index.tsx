/**
 * 左栏（三态：标注 / 地形画笔 / 符号库，RM3/RM9/RM13）
 *
 * - 标注列表：按「未绑定要素 / 地点钉 / 区域框 / 自由标签」分组，支持选中与新增
 * - 地形画笔：铺满型 9 类 + 叠加型 3 类 + 笔刷大小/形状 + 吸管/恢复草原
 * - 符号库：地点 8 + 地貌装饰 8 + 贴章图层列表（z 序 / 编组 / 磁吸开关）
 */
import { useMemo } from "react";
import {
  TERRAIN_COLORS,
  TER_KEY,
  PLACE_SYMBOLS,
  DECOR_SYMBOLS,
  terrainLabel,
} from "../../map-symbols";
import type { MapContent, MapAnnotation } from "@/shared/types/electron.d.ts";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface MapSidebarProps {
  content: MapContent;
  tool: string;
  sideTab: "anno" | "terrain" | "symbol";
  setSideTab: (t: "anno" | "terrain" | "symbol") => void;
  paintTerrain: number;
  setPaintTerrain: (t: number) => void;
  paintSize: number;
  setPaintSize: (s: 1 | 3 | 5) => void;
  brushShape: "circle" | "rect";
  setBrushShape: (s: "circle" | "rect") => void;
  selectedAnno: string | null;
  onSelectAnno: (id: string | null) => void;
  activeStampSymbol: string | null;
  setActiveStampSymbol: (k: string | null) => void;
  onAddAnnotation: (type: MapAnnotation["type"]) => void;
  onAddStamp: (symbolKey: string) => void;
  onRestoreGrass: () => void;
  symbolStyle: "A" | "B" | "C";
  onSetTool: (t: string) => void;
  onReorderStamp: (id: string, dir: "up" | "down" | "top" | "bottom") => void;
  onRemoveStamp: (id: string) => void;
  onGroupStamp: (id: string) => void;
  magnetOn: boolean;
  setMagnetOn: (v: boolean) => void;
}

const OVERLAY = [
  { key: "island", name: "岛屿" },
  { key: "waterfall", name: "瀑布" },
];

export default function MapSidebar(props: MapSidebarProps) {
  const { content } = props;

  const groups = useMemo(() => {
    const unbound: MapAnnotation[] = [];
    const pins: MapAnnotation[] = [];
    const areas: MapAnnotation[] = [];
    const labels: MapAnnotation[] = [];
    for (const a of content.annotations) {
      if (a.type === "pin") (a.entityId ? pins : unbound).push(a);
      else if (a.type === "area") areas.push(a);
      else if (a.type === "label") labels.push(a);
    }
    return { unbound, pins, areas, labels };
  }, [content.annotations]);

  return (
    <div className="mw-side">
      <div className="side-tabs">
        <button className={`side-tab${props.sideTab === "anno" ? " is-on" : ""}`} onClick={() => props.setSideTab("anno")}>
          <MapIcon name="pin" size={14} /> 标注
        </button>
        <button className={`side-tab${props.sideTab === "terrain" ? " is-on" : ""}`} onClick={() => props.setSideTab("terrain")}>
          <MapIcon name="brush" size={14} /> 地形
        </button>
        <button className={`side-tab${props.sideTab === "symbol" ? " is-on" : ""}`} onClick={() => props.setSideTab("symbol")}>
          <MapIcon name="stamp" size={14} /> 符号库
        </button>
      </div>

      {/* ① 标注 */}
      <div className="panel-anno" style={{ display: props.sideTab === "anno" ? "flex" : "none" }}>
        <div className="side-head">
          <MapIcon name="pin" size={15} /> 标注
          <span className="side-head__count">{content.annotations.length}</span>
        </div>
        <div className="side-body">
          {groups.unbound.length > 0 && (
            <>
              <div className="side-group__label">未绑定要素 <span>{groups.unbound.length}</span></div>
              {groups.unbound.map((a) => (
                <AnnoRow key={a.id} a={a} selected={a.id === props.selectedAnno} onSelect={props.onSelectAnno} />
              ))}
              <div className="side-empty">未绑定的地点不会同步显示名，建议一键建卡补齐。</div>
            </>
          )}
          <div className="side-group__label">地点钉 <span>{groups.pins.length}</span></div>
          {groups.pins.map((a) => (
            <AnnoRow key={a.id} a={a} selected={a.id === props.selectedAnno} onSelect={props.onSelectAnno} />
          ))}
          <div className="side-group__label">区域框 <span>{groups.areas.length}</span></div>
          {groups.areas.map((a) => (
            <AnnoRow key={a.id} a={a} selected={a.id === props.selectedAnno} onSelect={props.onSelectAnno} />
          ))}
          <div className="side-group__label">自由标签 <span>{groups.labels.length}</span></div>
          {groups.labels.map((a) => (
            <AnnoRow key={a.id} a={a} selected={a.id === props.selectedAnno} onSelect={props.onSelectAnno} />
          ))}
          <div className="side-add-row">
            <button className="btn btn--sm" onClick={() => props.onAddAnnotation("pin")}><MapIcon name="pin" size={13} /> 地点</button>
            <button className="btn btn--sm" onClick={() => props.onAddAnnotation("area")}><MapIcon name="frame" size={13} /> 区域</button>
            <button className="btn btn--sm" onClick={() => props.onAddAnnotation("label")}><MapIcon name="tag" size={13} /> 标签</button>
            <button className="btn btn--sm" onClick={() => props.onAddAnnotation("line")}><MapIcon name="link" size={13} /> 连线</button>
          </div>
        </div>
      </div>

      {/* ② 地形画笔 */}
      <div className="panel-terrain" style={{ display: props.sideTab === "terrain" ? "flex" : "none" }}>
        <div className="side-head">
          <MapIcon name="brush" size={15} /> 地形画笔
          <span className="side-head__count">{TER_KEY.length} 类</span>
        </div>
        <div className="side-body">
          <div className="side-section-title">铺满型 <i>· 点选后涂刷栅格</i></div>
          <div className="terrain-grid">
            {TER_KEY.map((k, i) => (
              <button
                key={k}
                type="button"
                className={`terrain-cell${props.paintTerrain === i ? " is-on" : ""}`}
                onClick={() => {
                  props.setPaintTerrain(i);
                  props.onSetTool("brush");
                }}
              >
                <span className="terrain-cell__sw" style={{ background: TERRAIN_COLORS[i] }} />
                <span className="terrain-cell__name">{terrainCn(k)}</span>
              </button>
            ))}
          </div>
          <div className="side-section-title">叠加型 <i>· 符号层，不影响底质</i></div>
          <div className="terrain-grid">
            {OVERLAY.map((o) => (
              <button
                key={o.key}
                type="button"
                className="terrain-cell terrain-cell--overlay"
                onClick={() => props.onSetTool("brush")}
                title={`${o.name}（随机成图自动生成；手绘见 M2 后续）`}
              >
                <span className="terrain-cell__sw terrain-cell__sw--overlay"><MapIcon name={o.key === "island" ? "map" : "download"} size={14} /></span>
                <span className="terrain-cell__name">{o.name}</span>
              </button>
            ))}
          </div>
          <div className="side-section-title">笔刷</div>
          <div className="brush-row">
            {([1, 3, 5] as const).map((s) => (
              <button key={s} className={`btn btn--sm${props.paintSize === s ? " is-on" : ""}`} onClick={() => props.setPaintSize(s)}>{s} 格</button>
            ))}
          </div>
          <div className="brush-row">
            <button className={`btn btn--sm${props.brushShape === "circle" ? " is-on" : ""}`} onClick={() => props.setBrushShape("circle")}>圆形</button>
            <button className={`btn btn--sm${props.brushShape === "rect" ? " is-on" : ""}`} onClick={() => props.setBrushShape("rect")}>矩形填充</button>
          </div>
          <div className="brush-row" style={{ paddingTop: 6 }}>
            <button className="btn btn--sm" style={{ flex: 1 }} onClick={props.onRestoreGrass}><MapIcon name="undo" size={14} /> 恢复草原</button>
          </div>
          <div className="field-note field-note--info" style={{ margin: "10px 12px 0" }}>
            涂刷即时渲染，局部重绘 ≤ 16ms/帧；每次落笔入撤销栈。
          </div>
        </div>
      </div>

      {/* ③ 符号库 */}
      <div className="panel-symbol" style={{ display: props.sideTab === "symbol" ? "flex" : "none" }}>
        <div className="side-head">
          <MapIcon name="stamp" size={15} /> 符号库
          <span className="side-head__count">拖入画布</span>
        </div>
        <div className="side-body">
          <div className="side-section-title">地点 <i>· {PLACE_SYMBOLS.length}</i></div>
          <div className="sym-grid">
            {PLACE_SYMBOLS.map((s) => (
              <SymbolTile key={s.key} def={s} active={props.activeStampSymbol === s.key} style={props.symbolStyle} onClick={() => { props.setActiveStampSymbol(s.key); props.onSetTool("stamp"); }} />
            ))}
          </div>
          <div className="side-section-title">地貌装饰 <i>· {DECOR_SYMBOLS.length}</i></div>
          <div className="sym-grid">
            {DECOR_SYMBOLS.map((s) => (
              <SymbolTile key={s.key} def={s} active={props.activeStampSymbol === s.key} style={props.symbolStyle} onClick={() => { props.setActiveStampSymbol(s.key); props.onSetTool("stamp"); }} />
            ))}
          </div>
          <div className="side-section-title">对象 <i>· 当前 {(content.stamps ?? []).length} 个 / 软上限 500</i></div>
          <div className="layer-list">
            {[...(content.stamps ?? [])].sort((a, b) => b.z - a.z).map((s) => (
              <div key={s.id} className="layer-item" onClick={() => props.onSelectAnno(null)}>
                <MapIcon name="stamp" size={13} />
                {symbolName(s.symbolKey)} <span className="layer-item__z">z {s.z}</span>
                <span className="layer-item__ops">
                  <button className="mini" title="上移" onClick={(e) => { e.stopPropagation(); props.onReorderStamp(s.id, "up"); }}><MapIcon name="chevron-up" size={12} /></button>
                  <button className="mini" title="删除" onClick={(e) => { e.stopPropagation(); props.onRemoveStamp(s.id); }}><MapIcon name="close" size={12} /></button>
                </span>
              </div>
            ))}
            {(content.stamps ?? []).length === 0 && <div className="side-empty">从上方符号库选一个，切到贴章工具点击画布放置。</div>}
          </div>
          <div className="check-row" style={{ padding: "8px 12px 0" }}>
            <input type="checkbox" id="magnetOn" checked={props.magnetOn} onChange={(e) => props.setMagnetOn(e.target.checked)} />
            <label htmlFor="magnetOn">对齐磁吸（可在设置关闭）</label>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnnoRow({ a, selected, onSelect }: { a: MapAnnotation; selected: boolean; onSelect: (id: string) => void }) {
  const color =
    a.type === "pin"
      ? a.kind
        ? kindColor(a.kind)
        : "var(--app-accent-rose)"
      : a.type === "area"
        ? "var(--app-accent-teal)"
        : "var(--app-text-muted)";
  const icon = a.type === "pin" ? "pin-fill" : a.type === "area" ? "frame" : a.type === "label" ? "tag" : "link";
  return (
    <button className={`anno${selected ? " is-active" : ""}`} onClick={() => onSelect(a.id)}>
      <span className="anno__pin" style={{ color }}><MapIcon name={icon} size={16} filled={a.type === "pin"} /></span>
      <span className="anno__text">
        <span className="anno__name">{a.name || "未命名"}</span>
        <span className="anno__meta">{metaOf(a)}</span>
      </span>
      {!a.entityId && a.type === "pin" && (
        <span className="anno__warn" style={{ color: "var(--app-warning)" }}><MapIcon name="warning" size={14} /></span>
      )}
    </button>
  );
}

function SymbolTile({ def, active, style, onClick }: { def: { key: string; name: string; color: string; path: (s: "A" | "B" | "C") => string }; active: boolean; style: "A" | "B" | "C"; onClick: () => void }) {
  return (
    <button type="button" className={`sym-cell${active ? " is-on" : ""}`} title={def.name} onClick={onClick}>
      <svg width="26" height="26" viewBox="0 0 24 24">
        <path d={def.path(style)} fill="none" stroke={def.color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{def.name}</span>
    </button>
  );
}

function terrainCn(key: string): string {
  return terrainLabel(key);
}
function symbolName(key: string): string {
  const all = [...PLACE_SYMBOLS, ...DECOR_SYMBOLS];
  return all.find((s) => s.key === key)?.name ?? key;
}
function kindColor(kind: string): string {
  const m: Record<string, string> = {
    city: "var(--app-accent-rose)", town: "var(--app-accent-green)", village: "var(--app-accent-green)",
    pass: "var(--app-accent-amber)", port: "var(--app-accent-blue)", mountain: "var(--app-accent-purple)",
    river: "var(--app-accent-blue)", forest: "var(--app-accent-green)",
  };
  return m[kind] ?? "var(--app-accent-rose)";
}
function metaOf(a: MapAnnotation): string {
  if (a.type === "pin") return a.entityId ? "已绑定要素卡" : "未建卡";
  if (a.type === "area") return a.childMapId ? "已绑子图" : "区域";
  if (a.type === "label") return "自由标签";
  return "连线";
}
