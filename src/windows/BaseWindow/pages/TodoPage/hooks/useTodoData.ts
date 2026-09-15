import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import {
  formatWorkHour,
  getTotalRemainingWorkHour,
  parseWorkHourTag,
} from "../todo-utils";
import type { TodoItem } from "../types";

export function useTodoData() {
  const { message } = App.useApp();
  const [items, setItems] = useState<TodoItem[]>([]);
  const api = window.electronAPI!.todo;

  const loadItems = useCallback(async (): Promise<void> => {
    try {
      const rows = await api.list();
      setItems(rows);
    } catch (error) {
      message.error("加载 TODO 列表失败");
      console.error(error);
    }
  }, [api, message]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const handleAdd = async (rawContent: string): Promise<number | null> => {
    const parsed = parseWorkHourTag(rawContent);
    if (!parsed.content) {
      message.warning("请输入内容");
      return null;
    }

    try {
      const result = await api.add(parsed.content, parsed.workHour);
      void loadItems();
      return Number(result.lastInsertRowid);
    } catch (error) {
      message.error("添加失败");
      console.error(error);
      return null;
    }
  };

  const handleAddChild = async (
    parentId: number,
    rawContent: string,
  ): Promise<boolean> => {
    const parsed = parseWorkHourTag(rawContent);
    if (!parsed.content) {
      message.warning("请输入子项内容");
      return false;
    }

    try {
      await api.addChild(parentId, parsed.content, parsed.workHour);
      void loadItems();
      return true;
    } catch (error) {
      message.error("添加失败");
      console.error(error);
      return false;
    }
  };

  const handleDelete = async (id: number): Promise<void> => {
    try {
      await api.delete(id);
      message.success("已删除");
      void loadItems();
    } catch (error) {
      message.error("删除失败");
      console.error(error);
    }
  };

  const handleUpdateContent = async (
    id: number,
    nextContent: string,
  ): Promise<boolean> => {
    const parsed = parseWorkHourTag(nextContent);
    if (!parsed.content) {
      message.warning("内容不能为空");
      return false;
    }

    try {
      const currentWorkHour = items.find((item) => item.id === id)?.work_hour ?? null;
      await api.updateContent(
        id,
        parsed.content,
        parsed.workHour ?? currentWorkHour,
      );
      void loadItems();
      return true;
    } catch (error) {
      message.error("内容更新失败");
      console.error(error);
      return false;
    }
  };

  const handleUpdateNote = async (id: number, nextNote: string): Promise<void> => {
    try {
      await api.updateNote(id, nextNote.trim() || null);
      message.success("备注已更新");
      void loadItems();
    } catch (error) {
      message.error("备注更新失败");
      console.error(error);
    }
  };

  const handleUpdateWorkHour = async (
    id: number,
    nextValue: number | null,
  ): Promise<boolean> => {
    const normalized = nextValue === null ? null : Number(nextValue);
    if (
      normalized !== null &&
      (!Number.isFinite(normalized) || normalized < 0)
    ) {
      message.warning("工时必须为非负数字");
      return false;
    }

    try {
      await api.updateWorkHour(id, normalized);
      void loadItems();
      return true;
    } catch (error) {
      message.error("工时更新失败");
      console.error(error);
      return false;
    }
  };

  const handleDeleteNote = async (id: number): Promise<void> => {
    try {
      await api.deleteNote(id);
      message.success("备注已删除");
      void loadItems();
    } catch (error) {
      message.error("删除备注失败");
      console.error(error);
    }
  };

  const handleDeleteWorkHour = async (id: number): Promise<void> => {
    try {
      await api.deleteWorkHour(id);
      message.success("工时已删除");
      void loadItems();
    } catch (error) {
      message.error("删除工时失败");
      console.error(error);
    }
  };

  const handleToggleImportant = async (id: number): Promise<void> => {
    try {
      const item = items.find((entry) => entry.id === id);
      await api.toggleImportant(id, item?.important === 1 ? 0 : 1);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  };

  const handleToggle = async (id: number, checked: boolean): Promise<void> => {
    try {
      await api.toggle(id, checked);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  };

  const handleToggleChild = async (
    id: number,
    checked: boolean,
  ): Promise<void> => {
    try {
      await api.toggleChild(id, checked);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  };

  const handleToggleParent = async (
    id: number,
    checked: boolean,
  ): Promise<void> => {
    try {
      await api.toggleParent(id, checked);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  };

  const getChildren = useCallback(
    (parentId: number): TodoItem[] =>
      items.filter((item) => item.parent_id === parentId),
    [items],
  );

  const topLevel = items.filter((item) => item.parent_id === null);
  const todoItems = topLevel
    .filter((item) => item.done === 0)
    .sort(
      (a, b) =>
        b.important - a.important ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  const doneItems = topLevel
    .filter((item) => item.done === 1)
    .sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));

  return {
    items,
    todoItems,
    doneItems,
    getChildren,
    getRemainingWorkHour: (id: number) => getTotalRemainingWorkHour(id, items),
    getWorkHourLabel: (value: number | null | undefined) => formatWorkHour(value),
    handleAdd,
    handleAddChild,
    handleDelete,
    handleUpdateContent,
    handleUpdateNote,
    handleUpdateWorkHour,
    handleDeleteNote,
    handleDeleteWorkHour,
    handleToggleImportant,
    handleToggle,
    handleToggleChild,
    handleToggleParent,
  };
}
