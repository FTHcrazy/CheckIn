/**
 * 全局设定中心 · 影响面（分类头卡的第一行）
 *
 * 「改动之前先看见影响面」是本次的核心语义：选中分类即显示「被 N 部书引用 ·
 * 改动会即时同步到这 N 部书」（N=0 时是「暂无作品引用 · 改动只影响全局库」）。
 *
 * 三条口径纪律：
 * - 计数与后果文案**只**由 `impactTextOf` 产出（内部再走 `formatReferenceCountLabel`），
 *   本组件不另拼字符串；
 * - R11② 的「影响面较大」提示**只落在 ⚠ 标记 + Tooltip** 上，**不进删除
 *   确认框** —— 确认框口径唯一（走 `data.onDeleteCategory`），用一次性弹窗去解决
 *   常驻可见性问题，方向是反的；
 * - **删除入口只有一处（分类卡头）**。此前这里也有一颗「删除」，与卡头的删除
 *   上下相邻、语义完全重复 —— 破坏性动作出现两次只会让人犹豫，不会让人更快。
 *   这里只留「查看引用方」这一条只读出口。
 */

import { LinkOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import {
  impactTextOf,
  impactWarningOf,
  type GsImpactTier,
} from "../../hooks/gs-view-utils";
import "./index.scss";

export interface GsImpactBarProps {
  refCount: number;
  tier: GsImpactTier;
  /** （R12）打开引用方名单抽屉；`refCount === 0` 时入口不渲染 */
  onOpenRefs: () => void;
}

export default function GsImpactBar({
  refCount,
  tier,
  onOpenRefs,
}: GsImpactBarProps) {
  const text = impactTextOf(refCount);
  const warning = impactWarningOf(refCount);

  return (
    <div className={`gs-impact is-${tier}`}>
      {/* 图标方片：与书架统计卡的图标底同一套（弱底 + 同色图标） */}
      <span className="gs-impact__tile" aria-hidden>
        <LinkOutlined />
      </span>
      {/* 全文挂 Tooltip：窄窗下面条单行省略，省略掉的部分要能看回来 */}
      <Tooltip title={text} classNames={{ root: "gs-impact__tip" }}>
        <span className="gs-impact__text">{text}</span>
      </Tooltip>
      {warning && (
        <Tooltip title={warning} classNames={{ root: "gs-impact__tip" }}>
          <span className="gs-impact__warn" aria-label="影响面较大">
            <WarningOutlined />
          </span>
        </Tooltip>
      )}
      <span className="gs-impact__spacer" />
      {refCount > 0 && (
        <Button
          size="small"
          type="text"
          className="gs-impact__refs"
          onClick={onOpenRefs}
        >
          查看引用方
        </Button>
      )}
    </div>
  );
}
