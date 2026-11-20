import { FloatButton } from "antd";
import { CompassOutlined, LoadingOutlined } from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import aiSvg from "@/assets/novel/ai.svg?raw";
import {
  AI_ENTRY_CONSENT_HINT,
  aiEntryStateClass,
  deriveAiEntryState,
} from "@/shared/ai/ai-entry-state";
import "./index.scss";

interface AiFabGroupProps {
  /** 组的展开态（受控）：上层用「开 || 续写中」合并出单一真相再传入 */
  open: boolean;
  /** 开合回调；「续写进行中禁止收起」由上层在回调里兜底，这里只透传 */
  onOpenChange: (open: boolean) => void;
  /** 点击续写（上层负责二次确认，见 useNovelPage.requestContinuation） */
  onContinue: () => void;
  /** AI 是否可用（M8 门控）：false 时禁用并说明原因 */
  aiAvailable?: boolean;
  /** 不可用的一句话说明 */
  aiUnavailableText?: string;
  /**
   * 是否为「待授权」态（O-06）：AI 配置齐全，但 L3 总开关没开 ——
   * 点一下会先弹授权。**不能禁用**：禁用了用户会以为入口坏了。
   */
  aiNeedsConsent?: boolean;
  /** 已经在续写中：续写项转进度态且不可重复点 */
  busy?: boolean;
  /** 救援项的说明（三态文案由上层派生，见 NovelPage.rescueEntryHint） */
  rescueHint: string;
  /** 点击救援 */
  onRescue: () => void;
}

/**
 * 正文区右下角 AI 动作组（REQ-061 续写 + R-AI-11 卡文救援）。
 *
 * 2.72.2 改用组件库 `FloatButton.Group`：收纳 / 展开的显隐与入场动效全部
 * 交回组件库 —— 原自绘条件渲染在展开瞬间改写布局，宽度一变整组「抖一下」；
 * antd 的 motion 是列表浮层淡入（不参与触发键布局），天然没有这个问题。
 * 触发键即开关：点开变关闭图标，点外部也能收（antd 自带两条出口）。
 *
 * 纯展示 + 回调：确认、请求、插入都在 `useNovelPage` 里编排。
 */
export default function AiFabGroup({
  open,
  onOpenChange,
  onContinue,
  aiAvailable = true,
  aiUnavailableText = "",
  aiNeedsConsent = false,
  busy = false,
  rescueHint,
  onRescue,
}: AiFabGroupProps) {
  const state = deriveAiEntryState({
    available: aiAvailable,
    l3Enabled: !aiNeedsConsent,
    requiresConsent: true,
  });
  return (
    <div className={`nv-ai-fab ${aiEntryStateClass(state)}`.trim()}>
      <FloatButton.Group
        className="nv-ai-fab__group"
        shape="circle"
        trigger="click"
        icon={<SvgIcon svg={aiSvg} />}
        open={open}
        onOpenChange={onOpenChange}
        /* 按钮贴着窗口右缘，说明气泡默认在上方、右端会被窗口边缘截住；
           改到左侧展示，也不再压住按钮本身的点击区 */
        tooltip={{ title: "AI 写作助手 · 续写 / 卡文救援", placement: "left" }}
        aria-label="AI 写作助手"
      >
        <FloatButton
          icon={
            busy ? <LoadingOutlined spin /> : <SvgIcon svg={aiSvg} />
          }
          tooltip={{
            placement: "left",
            title: !aiAvailable
              ? aiUnavailableText
              : busy
                ? "正在续写…"
                : aiNeedsConsent
                  ? AI_ENTRY_CONSENT_HINT
                  : "AI 续写（光标处顺着前文接着写）",
          }}
          /* busy 时一并禁用：续写是串行动作，重复触发只会叠一层确认弹窗 */
          disabled={!aiAvailable || busy}
          onClick={onContinue}
          aria-label="AI 续写"
        />
        <FloatButton
          icon={<CompassOutlined />}
          tooltip={{ title: rescueHint, placement: "left" }}
          disabled={!aiAvailable}
          onClick={onRescue}
          aria-label="卡文救援"
        />
      </FloatButton.Group>
    </div>
  );
}
