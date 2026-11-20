/**
 * 落点选择（R-AI-11）
 *
 * 五档落点，但**只有三档真的写正文**：另外两档是「沉淀」——存灵感（以及按
 * team-lead 裁定退化后的「存为大纲候选」= 存灵感 + 提示手动建节点）。
 * 所以这里是「选落点」而不是「选按钮」：一处选定、一次插入，避免扇出五个按钮
 * 让作者每次都要在五个词之间做阅读理解。
 *
 * 受控、只回调：不写库、不碰编辑器。
 */
import { Select } from "antd";
import {
  RESCUE_LANDING_HINTS,
  RESCUE_LANDING_LABELS,
  RESCUE_LANDING_ORDER,
  type RescueLanding,
} from "../../../utils/rescue";
import "./index.scss";

interface RescueLandingSelectProps {
  value: RescueLanding;
  onChange: (landing: RescueLanding) => void;
  /** 没有选区时「替换选中段落」不可选（点了只会提示「先选中」） */
  hasSelection?: boolean;
  /** 正文里没有明确光标时「插入光标处」不可选（没有落点可言） */
  cursorKnown?: boolean;
  disabled?: boolean;
}

export default function RescueLandingSelect({
  value,
  onChange,
  hasSelection = false,
  cursorKnown = true,
  disabled = false,
}: RescueLandingSelectProps) {
  const options = RESCUE_LANDING_ORDER.map((item) => ({
    value: item,
    label: RESCUE_LANDING_LABELS[item],
    // 没有前置条件的落点保持可选，缺条件的直接禁掉：
    // 留着可选等于让作者点一次才知道不行
    disabled:
      (item === "replaceSelection" && !hasSelection) ||
      (item === "cursor" && !cursorKnown),
  }));

  return (
    <div className="nv-rescue-landing">
      <span className="nv-rescue-landing__label">落点</span>
      <Select<RescueLanding>
        className="nv-rescue-landing__select"
        aria-label="采纳落点"
        value={value}
        options={options}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="nv-rescue-landing__hint">{RESCUE_LANDING_HINTS[value]}</span>
    </div>
  );
}
