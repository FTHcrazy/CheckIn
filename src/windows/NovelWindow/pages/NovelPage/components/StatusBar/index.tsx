import { Button } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { TODAY_ADDED_LABEL, TODAY_GOAL_LABEL, WORD_UNIT } from "@/shared/novel/today-stats";
import { calcGoalProgress, formatThousands } from "../../novel-utils";
import { useWritingStats } from "../../store/useNovelEditorStore";
import { useSensitiveStore } from "../../store/useSensitiveStore";
import "./index.scss";

interface StatusBarProps {
  /** 全局标注层是否启用（PRD §2 风险对策） */
  annotationOn: boolean;
  onToggleAnnotation: () => void;
  /** 打开敏感词检测面板；不传则不显示角标（单测直接渲染时无需接） */
  onOpenSensitive?: () => void;
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
  onOpenSensitive,
}: StatusBarProps) {
  const stats = useWritingStats();
  const progress = calcGoalProgress(stats.todayTotal, stats.dailyGoal);

  // 敏感词角标：直接订阅 store，计数变化只重渲染本组件（不推页面根）
  const sensitiveMode = useSensitiveStore((state) => state.config.mode);
  const chapterResult = useSensitiveStore((state) => state.chapterResult);
  const sensitiveHits =
    sensitiveMode === "off" ? 0 : (chapterResult?.total ?? 0);

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
        本章 <b>{formatThousands(stats.chapterWords)}</b> {WORD_UNIT}
      </span>
      {/*
        UI-08：读 todayTotal（今日累计净增）而不是会话内计数。此前显示「今日 +N」
        只算本次打开编辑器后的增量，于是刚进来是「今日 +0」，而右边进度条却按今日
        累计走 —— 同一条状态栏里两个「今日」，也和书架的「今日新增」对不上。
      */}
      <span className="nv-status__item">
        {TODAY_ADDED_LABEL}{" "}
        <b className="nv-status__positive">{formatThousands(stats.todayTotal)}</b> {WORD_UNIT}
      </span>
      <span className="nv-status__item">
        <b>{stats.speed}</b> 字/分
      </span>

      <Button
        className={`nv-status__anno${annotationOn ? " is-on" : ""}`}
        onClick={onToggleAnnotation}
        aria-pressed={annotationOn}
        title={annotationOn ? "正文标注层已开（人名高亮/悬浮卡），点击关闭" : "正文标注层已关，点击开启"}
        data-tour-target="status-annotation"
      >
        <span className="nv-status__anno-dot" />
        标注 {annotationOn ? "开" : "关"}
      </Button>

      {/* 敏感词角标：命中 > 0 才转警示色。它是「结果」不是「开关」，
          点击直接展开右栏面板，省掉「先切工具 Tab 再点卡片」两步 */}
      {onOpenSensitive && (
        <Button
          className={`nv-status__sm${sensitiveHits > 0 ? " is-alert" : ""}`}
          onClick={onOpenSensitive}
          title={
            sensitiveHits > 0
              ? `本章命中 ${sensitiveHits} 处敏感词，点击查看`
              : "打开敏感词检测"
          }
        >
          <SafetyOutlined />
          <span>敏感 {sensitiveHits}</span>
        </Button>
      )}

      <div className="nv-status__goal">
        <span className="nv-status__goal-label">
          {TODAY_GOAL_LABEL} {formatThousands(stats.dailyGoal)} {WORD_UNIT}
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
            style={{ transform: `scaleX(${progress / 100})` }}
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
