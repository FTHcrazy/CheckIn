/**
 * 地形图例视图（§5.1 图例规格，M2 美术验收基准，场景 s8）
 * 展示 9 类铺满型 + 3 类叠加型的配色与图案构成说明。
 */
import { TERRAIN_COLORS, TER_KEY, TERRAIN_TEXTURE } from "../../map-symbols";
import MapIcon from "../MapIcon";
import "./index.scss";

export interface LegendViewProps {
  open: boolean;
  onClose: () => void;
}

const FILL_DESC: Record<string, string> = {
  sea: "两行交错的水平短弧浪纹",
  lake: "细密点状涟漪，比海浪更短更静",
  river: "平滑曲线水带，两岸留浅色岸线",
  desert: "同向排列的新月形沙丘弧",
  grass: "稀疏草叶短线，散布密度最低",
  forest: "树木符号成簇散布，簇间留林间空地",
  mountain: "折线山形符号连绵成脊，山脚阴影线",
  snowmtn: "山形符号，峰顶覆白",
  snowfield: "极稀疏淡蓝冰晶点，几乎纯白",
};
const OVERLAY = [
  { name: "悬崖", desc: "陡崖线：沿边界绘制带短刺的粗线，刺向崖底" },
  { name: "岛屿", desc: "海中椭圆地块 + 一圈沙滩描边 + 中央微符号" },
  { name: "瀑布", desc: "竖向双线 + 下方水花点，落在悬崖线或山地边缘" },
];

export default function LegendView(props: LegendViewProps) {
  if (!props.open) return null;
  return (
    <div className="legend-view">
      <div className="legend-view__head">
        <h2>地形图例</h2>
        <span className="legend-view__ver">content.terrain.legendVersion = 1</span>
        <div className="top-spacer" />
        <button type="button" className="icon-btn" onClick={props.onClose}><MapIcon name="close" size={16} /></button>
      </div>
      <div className="legend-view__body">
        <div className="legend-section">
          <h3>铺满型（占满栅格：底色 + 专属纹理）</h3>
          <div className="legend-cards">
            {TER_KEY.map((k, i) => (
              <div className="legend-card" key={k}>
                <span className="legend-card__sw" style={{ background: TERRAIN_COLORS[i] }} />
                <div className="legend-card__text">
                  <b>{terrainCn(k)}</b>
                  <span>{FILL_DESC[k] ?? ""}</span>
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
        </div>
      </div>
    </div>
  );
}

function terrainCn(key: string): string {
  const m: Record<string, string> = {
    sea: "大海", lake: "湖泊", river: "河流", desert: "沙漠", grass: "草原",
    forest: "森林", mountain: "山地", snowmtn: "雪山", snowfield: "雪原",
  };
  return m[key] ?? key;
}
