import { useEffect, useRef, useState } from "react";
import { Button } from "antd";
import {
  formatShortcut,
  shortcutFromEvent,
  normalizeKeyName,
} from "@/shared/shortcuts";
import "./index.scss";

interface ShortcutRecorderProps {
  /** 当前键位（平台中立写法，如 `Mod+Shift+B`） */
  value: string;
  /** 默认键位：录制时按 Backspace / Delete 可回退到它 */
  defaultValue: string;
  disabled?: boolean;
  onCommit: (keys: string) => void;
}

/**
 * 快捷键录制按钮。
 *
 * 交互约定：
 * - 点一下进入录制（按钮显示「按下组合键…」），再按一次有效组合即提交；
 * - 只按修饰键不提交（`shortcutFromEvent` 返回 null，继续等主键）；
 * - Esc 取消录制 —— 注意这里必须用 **capture** 阶段监听并 stopPropagation，
 *   否则按 Esc 会先被应用内的「关闭最上层浮层」吃掉，录制框还停在原地；
 * - Backspace / Delete 回退到默认键位。
 *
 * ⚠️ 录制期间同样 capture 拦截所有按键：否则按 Ctrl+S 会在录制时把稿子存一遍。
 */
export default function ShortcutRecorder({
  value,
  defaultValue,
  disabled,
  onCommit,
}: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // 录制态吞掉一切按键：既不让应用快捷键误触发，也不让焦点跳走
      event.preventDefault();
      event.stopPropagation();

      if (normalizeKeyName(event.key) === "Escape") {
        setRecording(false);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        onCommit(defaultValue);
        setRecording(false);
        return;
      }
      const spec = shortcutFromEvent(event);
      if (!spec) return; // 只按了修饰键，继续等主键
      onCommit(spec);
      setRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recording, onCommit, defaultValue]);

  // 退出录制后把焦点还给按钮，键盘用户不会「丢失位置」
  useEffect(() => {
    if (!recording) buttonRef.current?.blur();
  }, [recording]);

  return (
    <Button
      ref={buttonRef}
      className={`settings-shortcut__key${recording ? " is-recording" : ""}`}
      disabled={disabled}
      onClick={() => setRecording((prev) => !prev)}
      title={disabled ? "该快捷键不可修改" : "点击后按下新的组合键，Esc 取消"}
    >
      {recording ? "按下组合键…" : formatShortcut(value)}
    </Button>
  );
}
