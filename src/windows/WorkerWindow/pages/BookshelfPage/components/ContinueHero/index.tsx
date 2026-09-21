import { CaretRightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { coverPaletteOf, type HeroView } from "../../bookshelf-utils";
import "./index.scss";

interface ContinueHeroProps {
  hero: HeroView;
  todayWords: number;
  dailyGoal: number;
  /** 继续写作：带着位置记忆直接回到编辑器原位 */
  onContinue: () => void;
}

/**
 * 继续写作 Hero（G1 / R6 的书架入口）：上次写到 + 今日目标进度 + 一键续写。
 * 目标进度条用 transform: scaleX 动画（布局属性不参与 transition）。
 */
export default function ContinueHero({
  hero,
  todayWords,
  dailyGoal,
  onContinue,
}: ContinueHeroProps) {
  const palette = coverPaletteOf(hero.workId);
  const initial = hero.workName.trim().charAt(0) || "书";
  const progress =
    dailyGoal > 0 ? Math.min(1, Math.max(0, todayWords / dailyGoal)) : 0;

  return (
    <section className="bs-hero">
      <div
        className="bs-hero__cover"
        style={{ background: `linear-gradient(160deg, ${palette.from}, ${palette.to})` }}
        aria-hidden
      >
        <span className="bs-hero__cover-char" style={{ color: palette.accent }}>
          {initial}
        </span>
      </div>

      <div className="bs-hero__info">
        <p className="bs-hero__eyebrow">上次写到 · {hero.lastActiveText}</p>
        <h2 className="bs-hero__title">
          《{hero.workName}》
          {hero.volumeLabel && (
            <>
              {hero.volumeLabel}
              <span className="bs-hero__sep"> · </span>
            </>
          )}
          <span className="bs-hero__chapter">{hero.chapterLabel}</span>
        </h2>
        <div className="bs-hero__progress">
          <div className="bs-hero__bar">
            <span
              className="bs-hero__bar-fill"
              style={{ transform: `scaleX(${progress})` }}
            />
          </div>
          <span className="bs-hero__goal">
            今日 {todayWords.toLocaleString()} / {dailyGoal.toLocaleString()} 字
          </span>
        </div>
      </div>

      <Button
        type="primary"
        size="large"
        className="bs-hero__cta"
        icon={<CaretRightOutlined />}
        onClick={onContinue}
      >
        继续写作
      </Button>
    </section>
  );
}
