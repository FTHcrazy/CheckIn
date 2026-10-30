import { useEffect, useRef } from "react";
import { Tooltip } from "antd";
import { TOOLTIP_STEPS } from "@/shared/novel/guide-copy";
import { useGuideBubble } from "@/shared/components/GuideTooltip/use-guide-bubble";
import "./index.scss";

/**
 * T-03 弱提示：选中文字后，在选区下方提示「右键可以建资料卡」
 *
 * 为什么不能复用 `GuideTooltip`：那个组件把气泡挂在**被包裹的真实元素**上，
 * 而这里的锚点是运行时才存在的选区——CodeMirror 只给坐标，不给元素。
 * 所以自己渲染一个零尺寸定位锚点，气泡仍交给 antd `Tooltip` 计算位置与避让。
 *
 * 锚点坐标由 `EditorPane` 在选区产生时用 `view.coordsAtPos` 算好传入（相对
 * `.nv-editor`），是否该弹（首次 / 打字保护 / Tour 是否在播）也在那里判定——
 * 本组件只负责「给了锚点就出现一次」。
 */

export interface SelectionGuideAnchor {
  /** 相对定位父级（.nv-editor）左上角的横坐标 */
  x: number;
  /** 相对定位父级的纵坐标：取选区底边，气泡落在选中文字下方不压字 */
  y: number;
}

export interface SelectionGuideProps {
  /** 选区锚点；null 表示当前没有要提示的选区 */
  anchor: SelectionGuideAnchor | null;
  /** 气泡收起（超时 / 作者开始操作）后通知外层清掉锚点 */
  onHide: () => void;
}

export default function SelectionGuide({ anchor, onHide }: SelectionGuideProps) {
  const { open } = useGuideBubble({ enabled: anchor !== null });

  // 气泡自己收起后要把锚点清掉：否则下次选中同一段文字时 anchor 仍在，
  // enabled 恒为 true 而气泡只播一次，等于白占一个锚点位。
  const shownRef = useRef(false);
  useEffect(() => {
    if (open) {
      shownRef.current = true;
      return;
    }
    if (!shownRef.current) return;
    shownRef.current = false;
    onHide();
  }, [open, onHide]);

  const copy = TOOLTIP_STEPS.find((item) => item.id === "T-03");
  if (!copy) return null;

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
      <span
        className="nv-guide-anchor"
        style={{ left: anchor?.x ?? 0, top: anchor?.y ?? 0 }}
      />
    </Tooltip>
  );
}
