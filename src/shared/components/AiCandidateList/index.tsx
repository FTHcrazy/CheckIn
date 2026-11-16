/**
 * AI 候选列表（B7 共用组件）
 *
 * 关系建议、实体抽取、AI 校对三处的产出形态是同一个东西：**一屏候选，逐条勾选，
 * 确认后才落库**。以前每处各写一遍行结构，结果是「勾选框的 aria-label 叫法不同、
 * 禁用态样式不同、证据句的截断口径不同」—— 作者在三处看到三种候选行。
 *
 * 本组件只负责**一行长什么样**与**勾选事件的回传**：
 * - 不做空态（各功能的空态文案差异极大，混用会让作者误以为「已经查过了」）；
 * - 不改状态（勾选态由调用方持有，这里只是受控渲染）；
 * - 不碰 IPC / AI / store。
 *
 * 行内**不整行做成按钮**：里面嵌了 Checkbox 与 Select，按钮套按钮是无效结构，
 * 点勾选框会连带触发整行的动作（AGENTS §6.1.2）。
 */
import type { ReactNode } from "react";
import { Checkbox } from "antd";
import "./index.scss";

/** 一条候选 */
export interface AiCandidateItem {
  /** 稳定键（勾选态按它索引） */
  key: string;
  /** 主标题：抽取是名字，关系是「A → B」 */
  title: string;
  /** 标题行右侧控件（如类型下拉）。给了它就优先于 `tag` */
  accessory?: ReactNode;
  /** 标题行右侧标签文案（「已存在」「高置信」） */
  tag?: string;
  /** 标签色调：muted = 已存在/无需处理，success = 高置信，warning = 需注意 */
  tagTone?: "muted" | "success" | "warning";
  /** 副标题：一句话说明（抽取的 summary / 关系的「关系：师徒」） */
  subtitle?: string;
  /** 原文依据（调用方负责加引号，这里只管显示与两行截断） */
  evidence?: string;
  checked: boolean;
  /** true = 不可勾选（如已存在） */
  disabled?: boolean;
}

export interface AiCandidateListProps {
  items: readonly AiCandidateItem[];
  onToggle: (key: string) => void;
  /** 勾选框的无障碍标签动词（默认「选中」；关系图用「写入」更贴切） */
  toggleVerb?: string;
}

export default function AiCandidateList({
  items,
  onToggle,
  toggleVerb = "选中",
}: AiCandidateListProps) {
  return (
    <div className="ai-cand">
      {items.map((item) => (
        <div
          className={`ai-cand__row${item.disabled ? " is-disabled" : ""}`}
          key={item.key}
        >
          <div className="ai-cand__head">
            <Checkbox
              className="ai-cand__check"
              checked={item.checked}
              disabled={item.disabled}
              aria-label={`${toggleVerb} ${item.title}`}
              onChange={() => onToggle(item.key)}
            />
            <span className="ai-cand__title" title={item.title}>
              {item.title}
            </span>
            {item.accessory ??
              (item.tag ? (
                <span className={`ai-cand__tag is-${item.tagTone ?? "muted"}`}>{item.tag}</span>
              ) : null)}
          </div>
          {item.subtitle && <p className="ai-cand__subtitle">{item.subtitle}</p>}
          {item.evidence && <p className="ai-cand__evidence">{item.evidence}</p>}
        </div>
      ))}
    </div>
  );
}
