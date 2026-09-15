import { useTodoData } from "./useTodoData";
import { useTodoEditorState } from "./useTodoEditorState";

/**
 * Todo 业务兼容组合层。
 * 新代码应优先直接使用 useTodoData 和 useTodoEditorState。
 */
export function useTodoPage() {
  const data = useTodoData();
  const editor = useTodoEditorState({
    handleUpdateContent: data.handleUpdateContent,
    handleUpdateNote: data.handleUpdateNote,
    handleUpdateWorkHour: data.handleUpdateWorkHour,
  });

  const handleAdd = async (): Promise<number | null> => {
    const result = await data.handleAdd(editor.newContent);
    if (result !== null) editor.setNewContent("");
    return result;
  };

  return {
    ...data,
    ...editor,
    handleAdd,
  };
}
