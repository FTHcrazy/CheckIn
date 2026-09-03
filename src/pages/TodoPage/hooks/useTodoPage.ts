import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import { db, ensureTable, type TodoItem } from "../todo-db";
import { formatWorkHour, getTotalRemainingWorkHour, parseWorkHourTag } from "../todo-utils";

export function useTodoPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [newContent, setNewContent] = useState("");
  const [childInputFor, setChildInputFor] = useState<number | null>(null);
  const [childContent, setChildContent] = useState("");
  const [noteModalFor, setNoteModalFor] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [workHourModalFor, setWorkHourModalFor] = useState<number | null>(null);
  const [workHourDraft, setWorkHourDraft] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const loadItems = useCallback(async () => {
    try {
      const rows = (await db.all(
        "SELECT * FROM todos ORDER BY created_at DESC",
      )) as TodoItem[];
      setItems(rows);
    } catch (err) {
      message.error("加载 TODO 列表失败");
      console.error(err);
    }
  }, [message]);

  useEffect(() => {
    void ensureTable().then(() => void loadItems());
  }, [loadItems]);

  const handleAdd = async () => {
    const parsed = parseWorkHourTag(newContent);
    if (!parsed.content) {
      message.warning("请输入内容");
      return;
    }

    try {
      await db.run("INSERT INTO todos (content, work_hour) VALUES (?, ?)", [
        parsed.content,
        parsed.workHour,
      ]);
      setNewContent("");
      message.success(parsed.workHour !== null ? "已添加，工时已记录" : "已添加");
      void loadItems();
    } catch (err) {
      message.error("添加失败");
      console.error(err);
    }
  };

  const handleAddChild = async (parentId: number) => {
    const parsed = parseWorkHourTag(childContent);
    if (!parsed.content) {
      message.warning("请输入子项内容");
      return;
    }

    try {
      await db.run(
        "INSERT INTO todos (parent_id, content, work_hour) VALUES (?, ?, ?)",
        [parentId, parsed.content, parsed.workHour],
      );
      setChildInputFor(null);
      setChildContent("");
      message.success(parsed.workHour !== null ? "子项已添加，工时已记录" : "子项已添加");
      void loadItems();
    } catch (err) {
      message.error("添加失败");
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await db.run("DELETE FROM todos WHERE id = ? OR parent_id = ?", [id, id]);
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
      await db.run("UPDATE todos SET note = ? WHERE id = ?", [content || null, id]);
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

      await db.run("UPDATE todos SET work_hour = ? WHERE id = ?", [
        normalized,
        id,
      ]);
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
      await db.run("UPDATE todos SET note = NULL WHERE id = ?", [id]);
      message.success("备注已删除");
      void loadItems();
    } catch (err) {
      message.error("删除备注失败");
      console.error(err);
    }
  };

  const handleDeleteWorkHour = async (id: number) => {
    try {
      await db.run("UPDATE todos SET work_hour = NULL WHERE id = ?", [id]);
      message.success("工时已删除");
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
      await db.run("UPDATE todos SET important = ? WHERE id = ?", [nextImportant, id]);
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
      await db.run("UPDATE todos SET content = ?, work_hour = ? WHERE id = ?", [
        parsed.content,
        parsed.workHour,
        id,
      ]);
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
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(
        `UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`,
        [doneVal, id],
      );
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const handleToggleChild = async (id: number, checked: boolean) => {
    try {
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(
        `UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`,
        [doneVal, id],
      );

      const child = (await db.all("SELECT parent_id FROM todos WHERE id = ?", [
        id,
      ])) as TodoItem[];
      if (child.length > 0 && child[0].parent_id !== null) {
        const parentId = child[0].parent_id;
        const siblings = (await db.all(
          "SELECT done FROM todos WHERE parent_id = ?",
          [parentId],
        )) as TodoItem[];
        const allDone =
          siblings.length > 0 && siblings.every((s) => s.done === 1);
        if (allDone) {
          await db.run(
            `UPDATE todos SET done = 1, done_at = datetime('now', 'localtime') WHERE id = ?`,
            [parentId],
          );
        } else if (!checked) {
          await db.run(
            `UPDATE todos SET done = 0, done_at = NULL WHERE id = ?`,
            [parentId],
          );
        }
      }
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const handleToggleParent = async (id: number, checked: boolean) => {
    try {
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(
        `UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`,
        [doneVal, id],
      );
      if (!checked) {
        await db.run(
          `UPDATE todos SET done = 0, done_at = NULL WHERE parent_id = ?`,
          [id],
        );
      }
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  const topLevel = items.filter((i) => i.parent_id === null);
  const getChildren = (parentId: number) =>
    items.filter((i) => i.parent_id === parentId);
  const todoItems = topLevel.filter((i) => i.done === 0);
  const doneItems = topLevel.filter((i) => i.done === 1);

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
    childContent,
    setChildContent,
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
