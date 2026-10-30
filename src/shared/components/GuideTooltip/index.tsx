import { type ReactNode } from "react";
import { Tooltip } from "antd";
import { TOOLTIP_STEPS, type TooltipId } from "@/shared/novel/guide-copy";
import {
  fetchGuideState,
  isTooltipUnseen,
  markTooltipSeen,
  saveGuideState,
} from "@/shared/novel/guide-state";
import { useGuideBubble } from "./use-guide-bubble";
import "./index.scss";

/**
 * 弱提示气泡（L2）
 *
 * 为什么不用窗口级 store：行囊窗口（PackWindow）与小说窗口是两个独立窗口，
 * 各自一份 store。弱提示的「已看过」标记必须跨窗口共享，所以默认直接读写
 * `novel_config`（`guide-state.ts`），本组件因此能放进 shared 给两个窗口用。
 *
 * 三条硬规则（PRD FR-02）：
 * 1. 不拦截点击 —— 浮层 `pointer-events: none`，作者可以无视它直接操作
 * 2. 只出现一次 —— 出现即写 `tooltipSeen`，重装前不再重复
 * 3. 打字保护 —— 编辑器内的点位由调用方传入带保护的 consume，作者敲字时不弹
 *
 * 出现调度（延时 / 超时 / 一动就撤）在 `use-guide-bubble`，与 T-03 的
 * 选区定位气泡共用一套规则。
 */

export interface GuideTooltipProps {
  /** 点位编号（T-01 ~ T-07） */
  id: TooltipId;
  /** 触发条件是否满足（如「首次产生选区」）；不传视为始终满足 */
  enabled?: boolean;
  children: ReactNode;
  /**
   * 消费判定：返回 true 才显示。
   * 编辑器内的点位传窗口 store 的版本（带打字保护）；不传走默认持久化判定。
   */
  consume?: (id: string) => boolean;
}

export default function GuideTooltip({
  id,
  enabled = true,
  children,
  consume,
}: GuideTooltipProps) {
  const { open } = useGuideBubble({
    enabled,
    consume: consume
      ? () => consume(id)
      : async () => {
          // 默认：读持久化记录 → 未看过才显示，且立即落盘「已看过」（出现即记）
          const record = await fetchGuideState();
          if (!isTooltipUnseen(record, id)) return false;
          await saveGuideState(markTooltipSeen(record, id));
          return true;
        },
  });

  const copy = TOOLTIP_STEPS.find((item) => item.id === id);
  if (!copy) return <>{children}</>;

  return (
    <Tooltip
      open={open}
      placement={copy.placement}
      classNames={{ root: "guide-tooltip" }}
      title={
        <span className="guide-tooltip__body">
          <span className="guide-tooltip__title">{copy.title}</span>
          <span className="guide-tooltip__desc">{copy.description}</span>
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}
