import type { ReactNode } from "react";
import "./index.scss";

/**
 * 页面底部常驻操作条（设置窗口公用原语）。
 *
 * 上来的原因很具体：同一个窗口里「保存」曾经有四种位置 ——
 * - AI 页：底部 sticky 条，左边一个状态点，有改动才能点保存；
 * - 个人资料：按钮塞在表单里，内容没改也亮着；
 * - 诊断：改一项立刻落库，调三次保留天数弹三个「已保存」；
 * - 快捷键：卡片内部的 footer 放「恢复默认」。
 * 用户每切一页都要重新找按钮，还会以为「个人资料那个亮着的保存是不是坏了」。
 *
 * 现在的规则（写在这里就是唯一口径）：
 * **这一页只要存在「需要确认」或「可重置」的动作，动作就落在这条常驻条上**；
 * 位置固定在滚动区底部、与内容同宽，左侧恒为「这一页现在是什么状态」。
 * 「改完必须立刻看到效果」的开关（主题色、快捷键录制）不进这条范式，
 * 它们的底条左侧改用 `state="hint"` 写明「立即生效」，右侧只放工具类动作。
 *
 * 实现细节：
 * - `position: sticky` + 不透明底：内容比可视区高时按钮不跟着滚走，
 *   卡片从下面滚过也不会透出来；
 * - `margin-top: auto`：内容不足一屏时把条压到页面底部，
 *   否则它会紧贴最后一张卡，切页时位置忽高忽低（这是「手感」最直接的来源）；
 * - 状态文案只在这里产出，三页共用同一套措辞，避免出现「已保存 / 保存成功 /
 *   用户信息已保存」三种说法。
 */
export type SettingsActionBarState = "dirty" | "saved" | "hint";

interface SettingsActionBarProps {
  /**
   * 左侧状态：
   * - `dirty` 有未保存的更改（warning 色点）
   * - `saved` 已保存（success 色点）
   * - `hint`  一句话说明（无状态点，用于「立即生效」这类无需确认的页面）
   */
  state?: SettingsActionBarState;
  /** `state="hint"` 时左侧显示的说明 */
  hint?: ReactNode;
  /** 右侧动作 */
  children?: ReactNode;
}

/** 状态点的两句话：措辞只在这里定义 */
const STATE_LABEL: Record<"dirty" | "saved", string> = {
  dirty: "有未保存的更改",
  saved: "已保存",
};

export default function SettingsActionBar({ state, hint, children }: SettingsActionBarProps) {
  return (
    <div className="settings-actionbar">
      {state === "hint" ? (
        <span className="settings-actionbar__hint">{hint}</span>
      ) : state ? (
        <span className={`settings-actionbar__state is-${state}`} role="status">
          <span className="settings-actionbar__dot" aria-hidden="true" />
          {STATE_LABEL[state]}
        </span>
      ) : null}
      {children ? <div className="settings-actionbar__actions">{children}</div> : null}
    </div>
  );
}
