import { useState } from "react";
import { Button, Input } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useImeGuard } from "../../hooks/useImeGuard";
import "./index.scss";

type ChildInputProps = {
  /** 提交子项内容，父级负责写库与刷新；返回 true 表示已入库 */
  onSubmit: (content: string) => Promise<boolean>;
  /** 关闭输入框（Esc 或空内容失焦时触发） */
  onClose: () => void;
};

/**
 * 新增子项的行内输入框。
 * 内容状态自持在组件内部，避免父级随每次按键全量重渲染，
 * 打断 IME 组合导致拼音提前上屏。
 */
function ChildInput({ onSubmit, onClose }: ChildInputProps) {
  const [value, setValue] = useState("");
  const ime = useImeGuard();

  // 提交成功后清空内容并保留输入框，支持连续录入
  const handleSubmit = () => {
    if (!value.trim()) return;
    void onSubmit(value).then((ok) => {
      if (ok) setValue("");
    });
  };

  return (
    <div className="todo-child-input">
      <Input
        size="small"
        placeholder="输入子项内容，回车添加"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onPressEnter={(e) => {
          // 拼写中的回车不提交
          if (ime.isComposing(e)) return;
          handleSubmit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        onBlur={() => {
          // 拼写中失焦不关闭（如切换中英文的短暂失焦）
          if (ime.composingRef.current) return;
          if (!value.trim()) onClose();
        }}
        autoFocus
      />
      <Button
        size="small"
        type="primary"
        icon={<PlusOutlined />}
        onClick={handleSubmit}
      />
    </div>
  );
}

export default ChildInput;
