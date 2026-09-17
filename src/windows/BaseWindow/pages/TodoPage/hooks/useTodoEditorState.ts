import { useCallback, useMemo, useState } from "react";

interface TodoEditorActions {
  handleUpdateContent: (id: number, content: string) => Promise<boolean>;
  handleUpdateNote: (id: number, note: string) => Promise<void>;
  handleUpdateWorkHour: (id: number, value: number | null) => Promise<boolean>;
}

export function useTodoEditorState(actions: TodoEditorActions) {
  // 解构出具体动作再进 useCallback 依赖：页面传入的动作来自数据层
  // Hook 的 useCallback（稳定引用），解构后回调引用保持稳定；
  // 直接依赖整个 actions 对象则会让回调每次渲染都变化。
  const { handleUpdateContent, handleUpdateNote, handleUpdateWorkHour } = actions;
  const [childInputFor, setChildInputFor] = useState<number | null>(null);
  const [noteModalFor, setNoteModalFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [workHourModalFor, setWorkHourModalFor] = useState<number | null>(null);
  const [workHourDraft, setWorkHourDraft] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const saveContent = useCallback(async (id: number, content: string): Promise<void> => {
    if (await handleUpdateContent(id, content)) setEditingId(null);
  }, [handleUpdateContent]);

  const saveNote = useCallback(async (): Promise<void> => {
    if (noteModalFor === null) return;
    await handleUpdateNote(noteModalFor, noteDraft);
    setNoteModalFor(null);
    setNoteDraft("");
  }, [handleUpdateNote, noteDraft, noteModalFor]);

  const saveWorkHour = useCallback(async (value: number | null): Promise<void> => {
    if (workHourModalFor === null) return;
    if (await handleUpdateWorkHour(workHourModalFor, value)) {
      setWorkHourModalFor(null);
      setWorkHourDraft(null);
    }
  }, [handleUpdateWorkHour, workHourModalFor]);

  return useMemo(() => ({
    childInputFor,
    setChildInputFor,
    noteModalFor,
    setNoteModalFor,
    noteDraft,
    setNoteDraft,
    workHourModalFor,
    setWorkHourModalFor,
    workHourDraft,
    setWorkHourDraft,
    editingId,
    setEditingId,
    saveContent,
    saveNote,
    saveWorkHour,
  }), [
    childInputFor,
    editingId,
    noteDraft,
    noteModalFor,
    saveContent,
    saveNote,
    saveWorkHour,
    workHourDraft,
    workHourModalFor,
  ]);
}
