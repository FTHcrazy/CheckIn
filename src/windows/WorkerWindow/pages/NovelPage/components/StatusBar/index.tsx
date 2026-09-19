import { calcGoalProgress, formatThousands } from "../../novel-utils";
import type { WritingStats } from "../../types";
import "./index.scss";

interface StatusBarProps {
  stats: WritingStats;
}

/**
 * 底部状态条（设计方案 §05 ⑥：32px 常驻）
 *
 * 数字统一 tabular-nums，宽度不跳动；目标达成只靠进度条 + 轻提示表达，不弹窗。
 */
export default function StatusBar({ stats }: StatusBarProps) {
  const progress = calcGoalProgress(stats.todayTotal, stats.dailyGoal);

  return (
    <div className="nv-status">
      <span className="nv-status__item">
        本章 <b>{formatThousands(stats.chapterWords)}</b> 字
      </span>
      <span className="nv-status__item">
        今日 <b className="nv-status__positive">+{formatThousands(stats.todayAdded)}</b>
      </span>
      <span className="nv-status__item">
        <b>{stats.speed}</b> 字/分
      </span>

      <div className="nv-status__goal">
        <span className="nv-status__goal-label">
          今日目标 {formatThousands(stats.dailyGoal)}
        </span>
        <div
          className="nv-status__bar"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className={`nv-status__fill${progress >= 100 ? " is-done" : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="nv-status__percent">{progress}%</span>
      </div>
    </div>
  );
}
