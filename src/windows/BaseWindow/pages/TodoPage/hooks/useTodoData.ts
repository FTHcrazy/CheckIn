import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import {
  formatWorkHour,
  parseWorkHourTag,
  sortChildrenByDone,
} from "../todo-utils";
import type { TodoItem } from "../types";

export function useTodoData() {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<TodoItem[]>([]);
  const api = window.electronAPI!.todo;
  const itemsRef = useRef<TodoItem[]>(items);
  // 用 ref 持有最新 items，让写操作回调不再依赖 items 数组本身，
  // 从而保持回调引用稳定，避免每次列表刷新都让下游组件全部重新渲染。
  // 注意：必须在 effect 里同步（而非渲染期直接赋值），否则并发渲染下
  // 被丢弃的那次渲染会把 ref 写成过期数据。
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  const handleAdd = useCallback(async (rawContent: string): Promise<number | null> => {
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
  }, [api, loadItems, message]);

  const handleAddChild = useCallback(async (
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
  }, [api, loadItems, message]);

  const handleDelete = useCallback(async (id: number): Promise<void> => {
    try {
      await api.delete(id);
      message.success("已删除");
      void loadItems();
    } catch (error) {
      message.error("删除失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleUpdateContent = useCallback(async (
    id: number,
    nextContent: string,
  ): Promise<boolean> => {
    const parsed = parseWorkHourTag(nextContent);
    if (!parsed.content) {
      message.warning("内容不能为空");
      return false;
    }

    try {
      const currentWorkHour = itemsRef.current.find((item) => item.id === id)?.work_hour ?? null;
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
  }, [api, loadItems, message]);

  const handleUpdateNote = useCallback(async (id: number, nextNote: string): Promise<void> => {
    try {
      await api.updateNote(id, nextNote.trim() || null);
      message.success("备注已更新");
      void loadItems();
    } catch (error) {
      message.error("备注更新失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleUpdateWorkHour = useCallback(async (
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
  }, [api, loadItems, message]);

  const handleDeleteNote = useCallback(async (id: number): Promise<void> => {
    try {
      await api.deleteNote(id);
      message.success("备注已删除");
      void loadItems();
    } catch (error) {
      message.error("删除备注失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleDeleteWorkHour = useCallback(async (id: number): Promise<void> => {
    try {
      await api.deleteWorkHour(id);
      message.success("工时已删除");
      void loadItems();
    } catch (error) {
      message.error("删除工时失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleToggleImportant = useCallback(async (id: number): Promise<void> => {
    try {
      const item = itemsRef.current.find((entry) => entry.id === id);
      await api.toggleImportant(id, item?.important === 1 ? 0 : 1);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleToggle = useCallback(async (id: number, checked: boolean): Promise<void> => {
    try {
      await api.toggle(id, checked);
      void loadItems();
    } catch (error) {
      message.error("操作失败");
      console.error(error);
    }
  }, [api, loadItems, message]);

  const handleToggleChild = useCallback(async (
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
  }, [api, loadItems, message]);

  const handleToggleParent = useCallback(async (
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
  }, [api, loadItems, message]);

  /** 备份导出：全部待办打包 zip（主进程弹保存框）；结果经 message 反馈 */
  const handleExportBackup = useCallback(async (): Promise<void> => {
    try {
      const result = await api.exportBackup();
      if (result.canceled) {
        message.info("已取消导出");
        return;
      }
      message.success(
        result.filePath
          ? `已导出 ${result.count} 条待办，文件：${result.filePath}`
          : `已导出 ${result.count} 条待办`,
      );
    } catch (error) {
      message.error("导出失败");
      console.error(error);
    }
  }, [api, message]);

  /** 备份导入：确认后选 zip 追加合并（重新分配 id，不覆盖现有待办），完成后刷新列表 */
  const handleImportBackup = useCallback(async (): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        const result = await api.importBackup();
        if (result.canceled) {
          message.info("已取消导入");
          return;
        }
        message.success(
          result.skipped.length > 0
            ? `已导入 ${result.count} 条待办，跳过 ${result.skipped.length} 个异常条目`
            : `已导入 ${result.count} 条待办`,
        );
        void loadItems();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "导入失败");
        console.error(error);
      }
    };

    modal.confirm({
      title: "导入待办备份包？",
      content: "导入为追加合并：待办会重新分配编号并保持父子结构，不会覆盖或删除现有数据。",
      okText: "选择文件导入",
      cancelText: "取消",
      onOk: () => run(),
    });
  }, [api, loadItems, message, modal]);

  const childrenByParent = useMemo(() => {
    const result = new Map<number, TodoItem[]>();
    items.forEach((item) => {
      if (item.parent_id === null) return;
      const children = result.get(item.parent_id) ?? [];
      children.push(item);
      result.set(item.parent_id, children);
    });
    // 子项排序：未完成的排前面，已完成的沉底（各自保持原有插入顺序）
    result.forEach((children, parentId) => {
      result.set(parentId, sortChildrenByDone(children));
    });
    return result;
  }, [items]);

  const getChildren = useCallback(
    (parentId: number): TodoItem[] => childrenByParent.get(parentId) ?? [],
    [childrenByParent],
  );

  const { todoItems, doneItems, remainingWorkHours } = useMemo(() => {
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

    // 先把 items 建成 id -> item 的索引，避免递归里对每个节点做 O(n) 的 find（整体 O(n²)）
    const itemById = new Map<number, TodoItem>();
    items.forEach((item) => itemById.set(item.id, item));

    const remainingWorkHours = new Map<number, number>();
    const calculateRemaining = (id: number): number => {
      const cached = remainingWorkHours.get(id);
      if (cached !== undefined) return cached;

      const item = itemById.get(id);
      const currentValue =
        item && item.done === 0 && item.work_hour !== null
          ? Number(item.work_hour)
          : 0;
      const childrenValue = (childrenByParent.get(id) ?? []).reduce(
        (sum, child) => sum + calculateRemaining(child.id),
        0,
      );
      const total = currentValue + childrenValue;
      remainingWorkHours.set(id, total);
      return total;
    };
    topLevel.forEach((item) => calculateRemaining(item.id));
    return { todoItems, doneItems, remainingWorkHours };
  }, [childrenByParent, items]);

  const getRemainingWorkHour = useCallback(
    (id: number): number => remainingWorkHours.get(id) ?? 0,
    [remainingWorkHours],
  );
  const getWorkHourLabel = useCallback(
    (value: number | null | undefined): string => formatWorkHour(value),
    [],
  );

  return useMemo(() => ({
    items,
    todoItems,
    doneItems,
    getChildren,
    getRemainingWorkHour,
    getWorkHourLabel,
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
    handleExportBackup,
    handleImportBackup,
  }), [
    doneItems,
    getChildren,
    getRemainingWorkHour,
    getWorkHourLabel,
    handleAdd,
    handleAddChild,
    handleDelete,
    handleDeleteNote,
    handleDeleteWorkHour,
    handleExportBackup,
    handleImportBackup,
    handleToggle,
    handleToggleChild,
    handleToggleImportant,
    handleToggleParent,
    handleUpdateContent,
    handleUpdateNote,
    handleUpdateWorkHour,
    items,
    todoItems,
  ]);
}
