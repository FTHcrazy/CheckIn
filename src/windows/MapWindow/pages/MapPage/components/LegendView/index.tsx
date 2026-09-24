/**
 * 地形图例视图（§5.1 图例规格，M2 美术验收基准，场景 s8）
 * 展示 12 类铺满型 + 2 类叠加型的配色与图案构成说明。
 *
 * 文案单一事实源 = map-terrain.TER_META（与地形画笔侧栏、PNG 导出图例共用），
 * 此处只负责排版，禁止再写一份中文名/说明映射表。
 */
import { TERRAIN_COLORS, TER_KEY, TERRAIN_TEXTURE, TER_META } from "../../map-symbols";
import MapIcon from "../MapIcon";
import "./index.scss";

/** 当前图案规格版本（新增地形时 +1，旧图按旧版本回读） */
const LEGEND_VERSION = 2;

export interface LegendViewProps {
  open: boolean;
  onClose: () => void;
}

const OVERLAY = [
  { name: "岛屿", desc: "海中孤立小陆块：沙洲 + 陆块 + 岸线 + 中央微地貌" },
  { name: "瀑布", desc: "崖唇 + 三条水帘 + 水潭溅点，只生成在河道跨越山地落差处" },
];

export default function LegendView(props: LegendViewProps) {
  if (!props.open) return null;
  return (
    <div className="legend-view">
      <div className="legend-view__head">
        <h2>地形图例</h2>
        <span className="legend-view__ver">content.terrain.legendVersion = {LEGEND_VERSION}</span>
        <div className="top-spacer" />
        <button type="button" className="icon-btn" onClick={props.onClose}><MapIcon name="close" size={16} /></button>
      </div>
      <div className="legend-view__body">
        <div className="legend-section">
          <h3>铺满型（占满栅格：底色 + 专属纹理，共 {TER_KEY.length} 类）</h3>
          <div className="legend-cards">
            {TER_KEY.map((k, i) => (
              <div className="legend-card" key={k}>
                <span className="legend-card__sw" style={{ background: TERRAIN_COLORS[i] }} />
                <div className="legend-card__text">
                  <b>{TER_META[i]?.name ?? k}</b>
                  <span>{TER_META[i]?.desc ?? ""}</span>
                  <em>纹理：{TERRAIN_TEXTURE[i]}</em>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="legend-section">
          <h3>叠加型（不占格，画在地形层之上的符号层）</h3>
          <div className="legend-cards">
            {OVERLAY.map((o) => (
              <div className="legend-card" key={o.name}>
                <span className="legend-card__sw legend-card__sw--overlay"><MapIcon name="layer" size={16} /></span>
                <div className="legend-card__text">
                  <b>{o.name}</b>
                  <span>{o.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="legend-note">
            叠加型符号由栅格确定性派生：手改地形后符号自动跟随，不会出现悬空的线段。
          </p>
        </div>
      </div>
    </div>
  );
}
