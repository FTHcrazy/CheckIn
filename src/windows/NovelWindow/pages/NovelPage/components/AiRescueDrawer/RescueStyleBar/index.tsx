/**
 * 风格旋钮 + 条数 + 换一批（R-AI-11）
 *
 * 为什么把「换一批」放在这里而不是结果区：换一批和换风格是**同一类动作**
 * —— 都是「这组不算，按新参数再来一次」。参数与动作挨在一起，作者点一次就懂；
 * 分开会让「换一批」看起来像「重新生成同一批」。
 *
 * 受控组件：不持有结果、不发请求，只回调。
 */
import { Button, Segmented } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
  BRANCH_COUNT_RANGE,
  RESCUE_STYLE_LABELS,
  RESCUE_STYLES,
  isRescueStyle,
  type RescueStyle,
} from "@/shared/ai/context";
import "./index.scss";

/** 条数选项：3–5（与 builder 的 clamp 区间同源，不另写一份） */
const COUNT_OPTIONS = Array.from(
  { length: BRANCH_COUNT_RANGE.max - BRANCH_COUNT_RANGE.min + 1 },
  (_, index) => BRANCH_COUNT_RANGE.min + index,
);

interface RescueStyleBarProps {
  style: RescueStyle;
  onStyleChange: (style: RescueStyle) => void;
  count: number;
  onCountChange: (count: number) => void;
  /** 换一批：按当前风格与条数重新生成 */
  onRegenerate: () => void;
  /** 生成中：换一批不可点（否则会和在途流抢同一份结果） */
  busy: boolean;
  /** AI 不可用：整条禁用并给出说明由浮层负责 */
  disabled?: boolean;
}

export default function RescueStyleBar({
  style,
  onStyleChange,
  count,
  onCountChange,
  onRegenerate,
  busy,
  disabled = false,
}: RescueStyleBarProps) {
  return (
    <div className="nv-rescue-style">
      <Segmented
        className="nv-rescue-style__tabs"
        aria-label="走向风格"
        value={style}
        disabled={disabled}
        options={RESCUE_STYLES.map((item) => ({
          label: RESCUE_STYLE_LABELS[item],
          value: item,
        }))}
        onChange={(value) => {
          // Segmented 的 onChange 给的是宽泛值类型，用守卫收窄而不是 as 断言
          const next = String(value);
          if (isRescueStyle(next)) onStyleChange(next);
        }}
      />

      <Segmented
        className="nv-rescue-style__count"
        aria-label="生成条数"
        value={count}
        disabled={disabled}
        options={COUNT_OPTIONS.map((item) => ({ label: `${item} 条`, value: item }))}
        onChange={(value) => {
          const next = Number(value);
          if (Number.isFinite(next)) onCountChange(next);
        }}
      />

      {/* 造型整套由 antd 给（§6.1.2 的清零点只针对自绘外观的按钮） */}
      <Button
        icon={<ReloadOutlined />}
        loading={busy}
        disabled={disabled}
        onClick={onRegenerate}
      >
        换一批
      </Button>
    </div>
  );
}
