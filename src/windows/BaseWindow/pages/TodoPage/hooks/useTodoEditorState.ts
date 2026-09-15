import { useState } from "react";

interface TodoEditorActions {
  handleUpdateContent: (id: number, content: string) => Promise<boolean>;
  handleUpdateNote: (id: number, note: string) => Promise<void>;
  handleUpdateWorkHour: (id: number, value: number | null) => Promise<boolean>;
}

export function useTodoEditorState(actions: TodoEditorActions) {
  const [childInputFor, setChildInputFor] = useState<number | null>(null);
  const [noteModalFor, setNoteModalFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [workHourModalFor, setWorkHourModalFor] = useState<number | null>(null);
  const [workHourDraft, setWorkHourDraft] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const saveContent = async (id: number, content: string): Promise<void> => {
    if (await actions.handleUpdateContent(id, content)) setEditingId(null);
  };

  const saveNote = async (): Promise<void> => {
    if (noteModalFor === null) return;
    await actions.handleUpdateNote(noteModalFor, noteDraft);
    setNoteModalFor(null);
    setNoteDraft("");
  };

  const saveWorkHour = async (value: number | null): Promise<void> => {
    if (workHourModalFor === null) return;
    if (await actions.handleUpdateWorkHour(workHourModalFor, value)) {
      setWorkHourModalFor(null);
      setWorkHourDraft(null);
    }
  };

  return {
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
  };
}
