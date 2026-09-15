import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import { formatWorkHour, getTotalRemainingWorkHour, parseWorkHourTag } from "../todo-utils";

interface TodoItem {
  id: number;
  parent_id: number | null;
  content: string;
  done: number;
  note: string | null;
  important: number;
  work_hour: number | null;
  created_at: string;
  done_at: string | null;
}

export function useTodoPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [newContent, setNewContent] = useState("");
  const [childInputFor, setChildInputFor] = useState<number | null>(null);
  const [noteModalFor, setNoteModalFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [workHourModalFor, setWorkHourModalFor] = useState<number | null>(null);
  const [workHourDraft, setWorkHourDraft] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const api = window.electronAPI!.todo;

  const loadItems = useCallback(async () => {
    try {
      const rows = await api.list() as TodoItem[];
      setItems(rows);
    } catch (err) {
      message.error("加载 TODO 列表失败");
      console.error(err);
    }
  }, [message, api]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleAdd = async (): Promise<number | null> => {
    const parsed = parseWorkHourTag(newContent);
    if (!parsed.content) {
      message.warning("请输入内容");
      return null;
    }

    try {
      const result = await api.add(parsed.content, parsed.workHour);
      setNewContent("");
      void loadItems();
      return Number(result.lastInsertRowid);
    } catch (err) {
      message.error("添加失败");
      console.error(err);
      return null;
    }
  };

  const handleAddChild = async (
    parentId: number,
    content: string,
  ): Promise<boolean> => {
    const parsed = parseWorkHourTag(content);
    if (!parsed.content) {
      message.warning("请输入子项内容");
      return false;
    }

    try {
      await api.addChild(parentId, parsed.content, parsed.workHour);
      void loadItems();
      return true;
    } catch (err) {
      message.error("添加失败");
      console.error(err);
      return false;
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(id);
      message.success("已删除");
      void loadItems();
    } catch (err) {
      message.error("删除失败");
      console.error(err);
    }
  };

  const handleUpdateNote = async (id: number, nextNote: string) => {
    try {
      const content = nextNote.trim();
      await api.updateNote(id, content || null);
      setNoteModalFor(null);
      setNoteDraft("");
      message.success("备注已更新");
      void loadItems();
    } catch (err) {
      message.error("备注更新失败");
      console.error(err);
    }
  };

  const handleUpdateWorkHour = async (id: number, nextValue: number | null) => {
    try {
      const normalized = nextValue === null ? null : Number(nextValue);
      if (
        normalized !== null &&
        (!Number.isFinite(normalized) || normalized < 0)
      ) {
        message.warning("工时必须为非负数字");
        return;
      }

      await api.updateWorkHour(id, normalized);
      setWorkHourModalFor(null);
      setWorkHourDraft(null);
      void loadItems();
    } catch (err) {
      message.error("工时更新失败");
      console.error(err);
    }
  };

  const handleDeleteNote = async (id: number) => {
    try {
      await api.deleteNote(id);
      message.success("备注已删除");
      void loadItems();
    } catch (err) {
      message.error("删除备注失败");
      console.error(err);
    }
  };

  const handleDeleteWorkHour = async (id: number) => {
    try {
      await api.deleteWorkHour(id);
      message.success("工时应删除");
      void loadItems();
    } catch (err) {
      message.error("删除工时失败");
      console.error(err);
    }
  };

  const handleToggleImportant = async (id: number) => {
    try {
      const item = items.find((entry) => entry.id === id);
      const nextImportant = item?.important === 1 ? 0 : 1;
      await api.toggleImportant(id, nextImportant);
      message.success(nextImportant === 1 ? "已设为特别关注" : "已取消特别关注");
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const handleUpdateContent = async (id: number, nextContent: string) => {
    const parsed = parseWorkHourTag(nextContent);
    if (!parsed.content) {
      message.warning("内容不能为空");
      return;
    }

    try {
      // 编辑标题时未输入工时标签，应保留原有工时；只有明确输入标签时才修改工时。
      const currentWorkHour = items.find((item) => item.id === id)?.work_hour ?? null;
      await api.updateContent(
        id,
        parsed.content,
        parsed.workHour ?? currentWorkHour,
      );
      setEditingId(null);
      setEditingContent("");
      void loadItems();
    } catch (err) {
      message.error("内容更新失败");
      console.error(err);
    }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    try {
      await api.toggle(id, checked);
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const handleToggleChild = async (id: number, checked: boolean) => {
    try {
      await api.toggleChild(id, checked);
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const handleToggleParent = async (id: number, checked: boolean) => {
    try {
      await api.toggleParent(id, checked);
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const topLevel = items.filter((i) => i.parent_id === null);
  const getChildren = (parentId: number) =>
    items.filter((i) => i.parent_id === parentId);
  const todoItems = topLevel
    .filter((i) => i.done === 0)
    .sort(
      (a, b) =>
        b.important - a.important ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const doneItems = topLevel
    .filter((i) => i.done === 1)
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));

  const getWorkHourLabel = (value: number | null | undefined) =>
    formatWorkHour(value);

  const getRemainingWorkHour = (id: number) =>
    getTotalRemainingWorkHour(id, items);

  return {
    items,
    newContent,
    setNewContent,
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
    editingContent,
    setEditingContent,
    todoItems,
    doneItems,
    getChildren,
    getRemainingWorkHour,
    getWorkHourLabel,
    handleAdd,
    handleAddChild,
    handleDelete,
    handleUpdateNote,
    handleUpdateWorkHour,
    handleDeleteNote,
    handleDeleteWorkHour,
    handleToggleImportant,
    handleUpdateContent,
    handleToggle,
    handleToggleChild,
    handleToggleParent,
  };
}
