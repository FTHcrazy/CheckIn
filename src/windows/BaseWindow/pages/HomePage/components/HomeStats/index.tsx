import "./index.scss";

export type HomeStatTone = "blue" | "amber" | "purple" | "teal";

export interface HomeStatItem {
  key: string;
  label: string;
  /** null 表示该项数据暂不可用，渲染为「—」 */
  value: number | null;
  unit: string;
  tone: HomeStatTone;
}

// 主题色变量映射：卡片图标底与文字色都从 var(--app-*) 取，换肤自动跟随
const TONE_VARS: Record<HomeStatTone, { fg: string; bg: string }> = {
  blue: { fg: "var(--app-accent-blue)", bg: "var(--app-accent-blue-weak)" },
  amber: { fg: "var(--app-accent-amber)", bg: "var(--app-accent-amber-weak)" },
  purple: { fg: "var(--app-accent-purple)", bg: "var(--app-accent-purple-weak)" },
  teal: { fg: "var(--app-accent-teal)", bg: "var(--app-accent-teal-weak)" },
};

interface HomeStatsProps {
  items: HomeStatItem[];
}

/** 数据概览行：待办 / 代码 / 备忘 / 打卡四项 */
export default function HomeStats({ items }: HomeStatsProps) {
  return (
    <div className="home-stats">
      {items.map((item) => {
        const tone = TONE_VARS[item.tone];
        return (
          <div key={item.key} className="home-stats__item">
            <span
              className="home-stats__dot"
              style={{ background: tone.fg, boxShadow: `0 0 0 4px ${tone.bg}` }}
            />
            <div className="home-stats__text">
              <span className="home-stats__value">
                {item.value === null ? "—" : item.value}
                <span className="home-stats__unit">{item.unit}</span>
              </span>
              <span className="home-stats__label">{item.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
