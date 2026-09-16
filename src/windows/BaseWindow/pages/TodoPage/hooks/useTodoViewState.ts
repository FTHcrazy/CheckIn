import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VirtuosoHandle } from "react-virtuoso";
import type { TodoItem } from "../types";

export function useTodoViewState(
  items: TodoItem[],
  todoItems: TodoItem[],
  doneItems: TodoItem[],
  getChildren: (parentId: number) => TodoItem[],
) {
  const [activeOutlineId, setActiveOutlineId] = useState<number | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () => localStorage.getItem("todo.outlineCollapsed") === "1",
  );
  const [collapsedSection, setCollapsedSection] = useState<"todo" | "done" | null>(() => {
    const stored = localStorage.getItem("todo.collapsedSection");
    return stored === "todo" || stored === "done" ? stored : null;
  });
  const [filterText, setFilterText] = useState("");
  const [onlyImportant, setOnlyImportant] = useState(false);
  const [flashIds, setFlashIds] = useState<Set<number>>(() => new Set());
  const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);
  const [enterIds, setEnterIds] = useState<Set<number>>(() => new Set());
  const previousDoneRef = useRef<Map<number, number>>(new Map());
  const todoVirtuosoRef = useRef<VirtuosoHandle>(null);
  const doneVirtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    localStorage.setItem("todo.outlineCollapsed", outlineCollapsed ? "1" : "0");
  }, [outlineCollapsed]);

  useEffect(() => {
    if (collapsedSection === null) localStorage.removeItem("todo.collapsedSection");
    else localStorage.setItem("todo.collapsedSection", collapsedSection);
  }, [collapsedSection]);

  const filterParents = useCallback(
    (parents: TodoItem[]): TodoItem[] => {
      const keyword = filterText.trim().toLowerCase();
      return parents.filter((item) => {
        if (onlyImportant && item.important !== 1) return false;
        if (!keyword) return true;
        return (
          item.content.toLowerCase().includes(keyword) ||
          getChildren(item.id).some((child) =>
            child.content.toLowerCase().includes(keyword),
          )
        );
      });
    },
    [filterText, getChildren, onlyImportant],
  );

  const filteredTodoItems = useMemo(() => filterParents(todoItems), [filterParents, todoItems]);
  const filteredDoneItems = useMemo(() => filterParents(doneItems), [doneItems, filterParents]);
  const todoOutlineItems = useMemo(
    () =>
      [...filteredTodoItems, ...filteredDoneItems]
        .filter((item) => item.parent_id === null)
        .sort((a, b) => {
          if (a.important !== b.important) return b.important - a.important;
          return (
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
          );
        }),
    [filteredDoneItems, filteredTodoItems],
  );

  const isTodoCollapsed = collapsedSection === "todo";
  const isDoneCollapsed = collapsedSection === "done";
  const hasFilter = filterText.trim() !== "" || onlyImportant;

  useEffect(() => {
    const previous = previousDoneRef.current;
    const newlyDone = items
      .filter((item) => item.done === 1 && previous.get(item.id) === 0)
      .map((item) => item.id);
    // 原地更新复用同一个 Map，避免每次刷新都重建整张表
    items.forEach((item) => previous.set(item.id, item.done));
    if (newlyDone.length === 0) return;
    setFlashIds(new Set(newlyDone));
    const timer = setTimeout(() => setFlashIds(new Set()), 900);
    return () => clearTimeout(timer);
  }, [items]);

  const toggleSection = useCallback((key: "todo" | "done") => {
    setCollapsedSection((current) => (current === key ? null : key));
  }, []);

  const handleScrollToItem = useCallback(
    (id: number) => {
      setActiveOutlineId(id);
      if (filteredTodoItems.some((item) => item.id === id) && isTodoCollapsed) {
        setCollapsedSection("done");
      } else if (filteredDoneItems.some((item) => item.id === id) && isDoneCollapsed) {
        setCollapsedSection("todo");
      }
      setPendingScrollId(id);
    },
    [filteredDoneItems, filteredTodoItems, isDoneCollapsed, isTodoCollapsed],
  );

  useEffect(() => {
    if (pendingScrollId === null) return;
    const todoIndex = filteredTodoItems.findIndex((item) => item.id === pendingScrollId);
    if (todoIndex !== -1 && !isTodoCollapsed) {
      todoVirtuosoRef.current?.scrollToIndex({ index: todoIndex, align: "start", behavior: "smooth" });
      setPendingScrollId(null);
      return;
    }
    const doneIndex = filteredDoneItems.findIndex((item) => item.id === pendingScrollId);
    if (doneIndex !== -1 && !isDoneCollapsed) {
      doneVirtuosoRef.current?.scrollToIndex({ index: doneIndex, align: "start", behavior: "smooth" });
      setPendingScrollId(null);
    }
  }, [filteredDoneItems, filteredTodoItems, isDoneCollapsed, isTodoCollapsed, pendingScrollId]);

  const enterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时清掉入场动画的延时器，避免卸载后 setState
  useEffect(
    () => () => {
      if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    },
    [],
  );

  const markAdded = useCallback((id: number) => {
    if (collapsedSection === "todo") setCollapsedSection(null);
    setPendingScrollId(id);
    setEnterIds(new Set([id]));
    if (enterTimerRef.current) clearTimeout(enterTimerRef.current);
    enterTimerRef.current = setTimeout(() => {
      setEnterIds(new Set());
      enterTimerRef.current = null;
    }, 700);
  }, [collapsedSection]);

  return useMemo(() => ({
    activeOutlineId,
    outlineCollapsed,
    setOutlineCollapsed,
    filterText,
    setFilterText,
    onlyImportant,
    setOnlyImportant,
    hasFilter,
    collapsedSection,
    isTodoCollapsed,
    isDoneCollapsed,
    toggleSection,
    handleScrollToItem,
    filteredTodoItems,
    filteredDoneItems,
    todoOutlineItems,
    todoVirtuosoRef,
    doneVirtuosoRef,
    flashIds,
    enterIds,
    markAdded,
  }), [
    activeOutlineId,
    collapsedSection,
    enterIds,
    filteredDoneItems,
    filteredTodoItems,
    filterText,
    flashIds,
    handleScrollToItem,
    hasFilter,
    isDoneCollapsed,
    isTodoCollapsed,
    markAdded,
    onlyImportant,
    outlineCollapsed,
    todoOutlineItems,
    toggleSection,
  ]);
}
