/**
 * 卡文救援浮层（R-AI-11，T-11b）
 *
 * 三个入口（编辑器 / 大纲节点 / 灵感面板）共用**这唯一一个** Drawer：
 * 入口只决定传进来的 `context`（有没有选区、有没有大纲节点），
 * 浮层本身不关心自己是被谁打开的。
 *
 * 职责边界（`AGENTS §6.2.1`）：
 * - 本组件持有**纯 UI 状态**：风格、条数、勾选、落点；
 * - 生成 / 采纳 / 撤销全部上抛（`onGenerate` / `onAdopt` / `onUndo`），
 *   本组件不 import 任何数据层 hook、不拼 prompt、不碰编辑器；
 * - 焦点走 O-17 的 `useDrawerFocusReturn`，不另写 triggerRef。
 *
 * 状态机（交互稿 §5）：打开 → 未授权则先授权（授权成功后本组件自动发起一次生成）
 * → 流式逐条落卡 → 勾选 + 选落点 → 插入 → 可「撤销本批次」。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Drawer, Skeleton } from "antd";
import { UndoOutlined } from "@ant-design/icons";
import { useDrawerFocusReturn } from "@/shared/hooks/useDrawerFocusReturn";
import { L3_SCOPE_LABELS, type L3Scope } from "@/shared/ai/ai-consent";
import {
  BRANCH_DEFAULT_COUNT,
  type BranchOutlineNode,
  type RescueStyle,
} from "@/shared/ai/context";
import { formatThousands } from "../../novel-utils";
import {
  pickCheckedSegments,
  type RescueLanding,
  type RescueSegment,
} from "../../utils/rescue";
import type { RescuePhase } from "../../hooks/useRescueBranch";
import RescueBranchCard from "./RescueBranchCard";
import RescueLandingSelect from "./RescueLandingSelect";
import RescueStyleBar from "./RescueStyleBar";
import "./index.scss";

/** 三入口归一后的上下文（页面层组装，浮层不直接读 store） */
export interface AiRescueContext {
  anchor: { workId: string; chapterId: string; cursorOrNodeId: string };
  /** 当前选区文本（有则默认落点「替换选中段落」可用，范围默认 selection） */
  selection?: string;
  /** 从大纲节点触发的入参 */
  outlineNode?: BranchOutlineNode;
  /** 本次 L3 范围（弹窗估算与实发同源，由页面层算） */
  scope: L3Scope;
  /** 将发送的正文字数（与 buildL3Payload 同源） */
  estimatedChars: number;
  /** O-06 三态 */
  availability: "unavailable" | "needsConsent" | "ready";
}

export interface AiRescueDrawerProps {
  open: boolean;
  context: AiRescueContext | null;
  /** 当前批次的走向（流式过程中逐条增长） */
  segments: RescueSegment[];
  phase: RescuePhase;
  error: string | null;
  /** 本批次已插入的记录数（> 0 才显示撤销） */
  undoCount: number;
  /** AI 不可用时的说明（`useAiAvailability().reasonText`） */
  unavailableText?: string;
  /** 未授权时点「授权并生成」→ 走页面层的 L3 授权链路 */
  onRequestConsent: () => void;
  onGenerate: (params: { style: RescueStyle; count: number }) => void;
  onAdopt: (params: { segments: RescueSegment[]; landing: RescueLanding }) => void;
  onUndo: () => void;
  onClose: () => void;
}

export default function AiRescueDrawer({
  open,
  context,
  segments,
  phase,
  error,
  undoCount,
  unavailableText = "",
  onRequestConsent,
  onGenerate,
  onAdopt,
  onUndo,
  onClose,
}: AiRescueDrawerProps) {
  /** 风格旋钮（本组件持有：它是「这次想看什么」的临时偏好，不该落库） */
  const [style, setStyle] = useState<RescueStyle>("default");
  const [count, setCount] = useState(BRANCH_DEFAULT_COUNT);
  /** 勾选顺序 = 采纳拼接顺序（§6.8），所以存数组而不是 Set */
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [landing, setLanding] = useState<RescueLanding>("cursor");

  const containerRef = useRef<HTMLDivElement>(null);
  const { captureTrigger, restoreFocus } = useDrawerFocusReturn({
    active: open,
    containerRef,
  });

  /** 已为哪个「入口锚点」自动发起过生成：防止每次重渲染都烧一次额度 */
  const startedRef = useRef("");

  const streaming = phase === "loading" || phase === "streaming";
  const loading = phase === "loading";
  const hasSelection = Boolean(context?.selection?.trim());
  const availability = context?.availability ?? "unavailable";
  const canGenerate = availability === "ready";

  const handleClose = (): void => {
    restoreFocus();
    onClose();
  };

  // 每次打开都重新记住触发按钮；关闭的三条路径（按钮 / Esc / 遮罩）都经过 handleClose
  useEffect(() => {
    if (open) captureTrigger();
  }, [open, captureTrigger]);

  // 打开时按入口重置局部状态：上一次的勾选不该带进新一次救援
  useEffect(() => {
    if (!open) {
      startedRef.current = "";
      return;
    }
    setCheckedKeys([]);
    setLanding(context?.selection?.trim() ? "replaceSelection" : "cursor");
  }, [open, context?.anchor.chapterId, context?.anchor.cursorOrNodeId, context?.selection]);

  /**
   * 首次自动生成。
   *
   * 只在「AI 可用且已授权」时发起：未授权时先让作者在浮层里看到「要授权」这件事，
   * 授权弹窗确认后 `availability` 才会变成 ready，这里再发一次 —— 于是
   * 「点了取消」不会有任何请求（验收 §2.1-2）。
   */
  useEffect(() => {
    if (!open || !context || !canGenerate) return;
    const key = `${context.anchor.chapterId}:${context.anchor.cursorOrNodeId}`;
    if (startedRef.current === key) return;
    startedRef.current = key;
    onGenerate({ style, count });
  }, [open, context, canGenerate, onGenerate, style, count]);

  const picked = useMemo(
    () => pickCheckedSegments(segments, checkedKeys),
    [segments, checkedKeys],
  );

  const toggleChecked = (index: number, checked: boolean): void => {
    const key = String(index);
    setCheckedKeys((prev) => {
      if (checked) return prev.includes(key) ? prev : [...prev, key];
      return prev.filter((item) => item !== key);
    });
  };

  const handleInsert = (): void => {
    if (picked.length === 0) return;
    onAdopt({ segments: picked, landing });
    setCheckedKeys([]);
  };

  return (
    <Drawer
      className="nv-rescue"
      title="卡文救援"
      open={open}
      onClose={handleClose}
      destroyOnHidden
      size={520}
    >
      <div ref={containerRef} className="nv-rescue__body">
        {availability === "unavailable" ? (
          <Alert
            type="info"
            showIcon={false}
            title={unavailableText || "AI 暂不可用，配置好模型服务后再来救援"}
          />
        ) : null}

        {/* 处境摘要：作者要先确认「发出去的是什么」，再决定要不要生成 */}
        <div className="nv-rescue__meta">
          <span className="nv-rescue__badge">
            {availability === "needsConsent" ? "待授权" : "已授权"}
          </span>
          <span className="nv-rescue__scope">{L3_SCOPE_LABELS[context?.scope ?? "chapter"]}</span>
          <span className="nv-rescue__chars">
            约 {formatThousands(context?.estimatedChars ?? 0)} 字
          </span>
          {context?.outlineNode ? (
            <span className="nv-rescue__node">节点：{context.outlineNode.title}</span>
          ) : null}
        </div>

        {availability === "needsConsent" ? (
          <div className="nv-rescue__consent">
            <p className="nv-rescue__consent-text">
              卡文救援要读你当前的正文（按上面这个范围发送），首次使用需要先授权。
            </p>
            <Button type="primary" onClick={onRequestConsent}>
              授权并生成
            </Button>
          </div>
        ) : (
          <RescueStyleBar
            style={style}
            onStyleChange={setStyle}
            count={count}
            onCountChange={setCount}
            onRegenerate={() => onGenerate({ style, count })}
            busy={streaming}
            disabled={!canGenerate}
          />
        )}

        {error && <Alert type="warning" showIcon={false} title={error} />}

        <div className="nv-rescue__list">
          {segments.length > 0 ? (
            segments.map((segment, index) => (
              <RescueBranchCard
                key={`${index}-${segment.title}`}
                index={index}
                segment={segment}
                checked={checkedKeys.includes(String(index))}
                onCheckedChange={(checked) => toggleChecked(index, checked)}
              />
            ))
          ) : loading ? (
            // 首段未到：整块占位而不是三张骨架卡。骨架卡会让人以为「已经有 3 条」，
            // 而流式解析失败降级成结构化通道时一条都不会逐张出现。
            <div className="nv-rescue__pending">
              <Skeleton active paragraph={{ rows: 3 }} title={false} />
              <span className="nv-rescue__pending-text">正在想几个走向…</span>
            </div>
          ) : (
            <div className="nv-empty">
              <b>{phase === "error" ? "这一次没成" : "还没有走向"}</b>
              <span>
                {availability === "unavailable"
                  ? "配置好模型服务后再来"
                  : phase === "error"
                    ? "换个风格或点「换一批」再试"
                    : "点「换一批」生成几条后续走向"}
              </span>
            </div>
          )}
        </div>

        <div className="nv-rescue__footer">
          <RescueLandingSelect
            value={landing}
            onChange={setLanding}
            hasSelection={hasSelection}
            disabled={streaming}
          />
          <div className="nv-rescue__actions">
            {undoCount > 0 && (
              <Button className="nv-ghost" icon={<UndoOutlined />} onClick={onUndo}>
                撤销本批次
              </Button>
            )}
            <span className="nv-rescue__count">
              已选 {picked.length} 条
            </span>
            <Button
              type="primary"
              disabled={streaming || picked.length === 0 || !canGenerate}
              onClick={handleInsert}
            >
              插入
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
