import { Button, Popover } from "antd";
import { MoreOutlined, SafetyOutlined } from "@ant-design/icons";
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
 * 全局标注开关常驻此处，码字途中可一键关闭高亮/悬浮卡（PRD §2 风险对策）。
 *
 * **收敛到 4 项（O-09，v2.57）**：此前 7 项常驻，其中「码字速度」与「时钟」是
 * 阅读型信息 —— 写作时看它们没有决策价值，却和「本章字数 / 目标进度」抢同一条
 * 注意力。现在只留 **本章 / 今日 / 目标进度 / 标注**（敏感命中才亮），速度与
 * 时钟收进右侧「⋯」弹层，需要时点开看。
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

  // 时钟只在「⋯」弹层打开时走秒：关着的时候没人看，没必要每秒推一次渲染
  const [moreOpen, setMoreOpen] = useState(false);
  const [clock, setClock] = useState(() => formatClock(new Date()));
  useEffect(() => {
    if (!moreOpen) return;
    setClock(formatClock(new Date()));
    const timer = window.setInterval(
      () => setClock(formatClock(new Date())),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [moreOpen]);

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

      <span className="nv-status__spacer" aria-hidden />

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

      {/* 阅读型信息（速度 / 时钟）收进这里。仍用 Popover 而不是 Tooltip：
          它承载的是可读数据，鼠标移开就消失等于没有 */}
      <Popover
        trigger="click"
        placement="topRight"
        open={moreOpen}
        onOpenChange={setMoreOpen}
        content={
          <div className="nv-status__pop">
            <div className="nv-status__pop-row">
              <span>码字速度</span>
              <b>
                {formatThousands(stats.speed)} {WORD_UNIT}/分
              </b>
            </div>
            <div className="nv-status__pop-row">
              <span>当前时间</span>
              <b>{clock}</b>
            </div>
          </div>
        }
      >
        <Button
          className="nv-status__more"
          aria-label="状态条更多信息"
          aria-expanded={moreOpen}
          title="状态条更多信息"
        >
          <MoreOutlined />
        </Button>
      </Popover>
    </div>
  );
}

/** HH:MM（24h），补零对齐 */
function formatClock(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
