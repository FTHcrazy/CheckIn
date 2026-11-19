/**
 * 单条走向卡（R-AI-11）
 *
 * 三段结构（标题 / 核心冲突 / 走向后果）+ 左侧编号 B1..B5 + 勾选框。
 * 受控组件：`checked` 由浮层持有，勾选顺序就是采纳拼接顺序（§6.8）。
 *
 * 三条刻意的取舍：
 * 1. **整卡不是按钮**：卡里已有 `Checkbox`，再套一层点击区会变成嵌套可交互元素，
 *    键盘 Tab 会停两次、读屏会念两遍（§3.5 UI 铁律）。勾选只认勾选框。
 * 2. **默认折叠到 3 行**：五条走向一屏放不下，全展开等于逼作者滚动；
 *    长文给「展开」按钮，短文本不出现该按钮（不摆一个点了没反应的控件）。
 * 3. 不做空态、不碰 IPC / store：它是纯展示件。
 */
import { useMemo, useState } from "react";
import { Button, Checkbox } from "antd";
import type { RescueSegment } from "../../../utils/rescue";
import "./index.scss";

/** 超过这个字数才值得展开（一行中文约 40 字，3 行约 120） */
const EXPAND_THRESHOLD = 60;

interface RescueBranchCardProps {
  /** 生成顺序里的下标（0 起）：渲染成 B1..B5 */
  index: number;
  segment: RescueSegment;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export default function RescueBranchCard({
  index,
  segment,
  checked,
  onCheckedChange,
}: RescueBranchCardProps) {
  const [expanded, setExpanded] = useState(false);

  /** 只有长文才给展开入口：短文本不摆一个点了没反应的按钮 */
  const expandable = useMemo(
    () =>
      segment.conflict.length > EXPAND_THRESHOLD ||
      segment.consequence.length > EXPAND_THRESHOLD,
    [segment.conflict, segment.consequence],
  );

  return (
    <div
      className={`nv-rescue-card${checked ? " is-checked" : ""}${
        expandable && !expanded ? " is-clamped" : ""
      }`}
    >
      <div className="nv-rescue-card__head">
        <Checkbox
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          aria-label={`选择走向 ${index + 1}：${segment.title}`}
        />
        <span className="nv-rescue-card__no">B{index + 1}</span>
        <span className="nv-rescue-card__title">{segment.title}</span>
      </div>

      <dl className="nv-rescue-card__body">
        <dt>冲突</dt>
        <dd className="nv-rescue-card__conflict">{segment.conflict}</dd>
        <dt>后果</dt>
        <dd className="nv-rescue-card__consequence">{segment.consequence}</dd>
      </dl>

      {expandable && (
        <Button
          className="nv-rescue-card__more"
          type="link"
          size="small"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "收起" : "展开全文"}
        </Button>
      )}
    </div>
  );
}
