import { useCallback } from "react";
import { App } from "antd";
import { useMemoData } from "./useMemoData";
import { useMemoEditorState } from "./useMemoEditorState";
import { useMemoViewState } from "./useMemoViewState";

/** MemoPage 的兼容组合层，具体职责由 data/editor/view Hook 分担。 */
export function useMemoPage() {
  const { message } = App.useApp();
  const data = useMemoData();
  const editor = useMemoEditorState(data);
  const view = useMemoViewState(
    editor.content,
    editor.originalContent,
    editor.isEditing,
  );

  const copyCode = useCallback(
    async (code: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(code);
        message.success("代码已复制");
      } catch (error) {
        message.error("复制失败");
        console.error(error);
      }
    },
    [message],
  );

  return {
    ...data,
    ...editor,
    ...view,
    handleOpenInExplorer: data.openInExplorer,
    copyCode,
  };
}
