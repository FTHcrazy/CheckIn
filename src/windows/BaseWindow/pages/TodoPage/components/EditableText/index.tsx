import { Input, type InputRef } from "antd";
import { memo, useCallback, useEffect, useRef } from "react";
import type { CompositionEvent, KeyboardEvent } from "react";
import "./index.scss";

type EditableTextProps = {
  itemId: number;
  initialValue: string;
  onSave: (id: number, value: string) => void;
  onCancel: () => void;
};

const EditableText = memo(function EditableText({
  itemId,
  initialValue,
  onSave,
  onCancel,
}: EditableTextProps) {
  const inputRef = useRef<InputRef>(null);
  const composingRef = useRef(false);
  const skipBlurRef = useRef(false);

  // 读取原生 input 当前的真实值（包含 IME 已上屏的内容）
  const getDomValue = useCallback(
    () => inputRef.current?.input?.value ?? "",
    [],
  );

  // 提交或关闭
  const commitOrClose = useCallback(() => {
    skipBlurRef.current = true;
    const value = getDomValue();
    if (value === initialValue) {
      onCancel();
    } else {
      onSave(itemId, value);
    }
  }, [getDomValue, initialValue, itemId, onCancel, onSave]);

  // 进入编辑：手动设置原生 DOM 的值 + 聚焦 + 光标置尾
  useEffect(() => {
    const nativeInput = inputRef.current?.input;
    if (nativeInput) {
      nativeInput.value = initialValue; // 直接写原生 DOM
      nativeInput.focus();
      const len = nativeInput.value.length;
      nativeInput.setSelectionRange(len, len);
    }
  }, [initialValue]);

  return (
    <Input
      ref={inputRef}
      className="todo-item-edit-input"
      // 【关键】不传 value → 非受控 → React 永不回写 DOM → IME 安全
      // defaultValue 仅作为初始占位，真正赋值在 useEffect 里做
      defaultValue={initialValue}
      size="small"
      spellCheck={false}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e: CompositionEvent<HTMLInputElement>) => {
        composingRef.current = false;
        // 非受控下无需 setState，DOM 自己已经是正确的中文
        // 这里什么都不用做
        void e;
      }}
      // 【关键】没有 onChange！不打断 IME，也不触发父组件重渲染
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
          skipBlurRef.current = true;
          onCancel();
        }
      }}
      onPressEnter={(e: KeyboardEvent<HTMLInputElement>) => {
        // 拼写中的 Enter（选词/上屏）不提交
        if (composingRef.current || e.nativeEvent.isComposing) return;
        commitOrClose();
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }
        if (composingRef.current) return; // 拼写中失焦不处理

        setTimeout(() => {
          if (composingRef.current) return;
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          const value = getDomValue();
          if (value === initialValue) {
            onCancel();
          } else {
            onSave(itemId, value);
          }
        }, 0);
      }}
    />
  );
});

export default EditableText;
