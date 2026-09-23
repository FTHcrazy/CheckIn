import { useEffect, useState } from "react";
import { calcGoalProgress, formatThousands } from "../../novel-utils";
import { useWritingStats } from "../../store/useNovelEditorStore";
import "./index.scss";

interface StatusBarProps {
  /** 全局标注层是否启用（PRD §2 风险对策） */
  annotationOn: boolean;
  onToggleAnnotation: () => void;
}

/**
 * 底部状态条（设计方案 §05 ⑥：32px 常驻）
 *
 * 数字统一 tabular-nums，宽度不跳动；目标达成只靠进度条 + 轻提示表达，不弹窗。
 * 全局标注开关与时钟常驻此处，码字途中可一键关闭高亮/悬浮卡（PRD §2 风险对策）。
 *
 * 写作统计由本组件直接订阅 store：字数每键都在变，若由页面根持有再透传，
 * 打字就会把整棵树推一遍。
 */
export default function StatusBar({
  annotationOn,
  onToggleAnnotation,
}: StatusBarProps) {
  const stats = useWritingStats();
  const progress = calcGoalProgress(stats.todayTotal, stats.dailyGoal);

  // 实时时钟：每秒更新一次，tabular-nums 保证宽度不跳动
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    const timer = window.setInterval(
      () => setClock(formatClock(new Date())),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

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

      <button
        type="button"
        className={`nv-status__anno${annotationOn ? " is-on" : ""}`}
        onClick={onToggleAnnotation}
        aria-pressed={annotationOn}
        title={annotationOn ? "正文标注层已开（人名高亮/悬浮卡），点击关闭" : "正文标注层已关，点击开启"}
      >
        <span className="nv-status__anno-dot" />
        标注 {annotationOn ? "开" : "关"}
      </button>

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

      <span className="nv-status__clock" title="当前时间">
        {clock}
      </span>
    </div>
  );
}

/** HH:MM（24h），补零对齐 */
function formatClock(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
