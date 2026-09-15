import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import {
  PlusOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  UndoOutlined,
  StarFilled,
  DownOutlined,
  RightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
  FileDoneOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Page from "@/shared/components/Page";
import NoteModal from "./components/NoteModal";
import WorkHourModal from "./components/WorkHourModal";
import TodoOutlineSidebar from "./components/TodoOutlineSidebar";
import { useTodoPage } from "./hooks/useTodoPage";
import type { TodoItem } from "./todo-db";
import { useImeGuard } from "./hooks/useImeGuard";
import EditableText from "./components/EditableText";
import ChildInput from "./components/ChildInput";
import "./index.scss";

const { Text } = Typography;

function TodoPage() {
  const {
    items,
    todoItems,
    doneItems,
    getChildren,
    getRemainingWorkHour,
    getWorkHourLabel,
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
    handleAdd,
    handleAddChild,
    handleDelete,
    handleUpdateNote,
    handleUpdateWorkHour,
    handleDeleteWorkHour,
    handleDeleteNote,
    handleToggleImportant,
    handleUpdateContent,
    handleToggle,
    handleToggleChild,
    handleToggleParent,
  } = useTodoPage();

  const [activeOutlineId, setActiveOutlineId] = useState<number | null>(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () => localStorage.getItem("todo.outlineCollapsed") === "1",
  );
  const [collapsedSection, setCollapsedSection] = useState<
    "todo" | "done" | null
  >(() => {
    const stored = localStorage.getItem("todo.collapsedSection");
    return stored === "todo" || stored === "done" ? stored : null;
  });

  const [filterText, setFilterText] = useState("");
  const [onlyImportant, setOnlyImportant] = useState(false);
  const hasFilter = filterText.trim() !== "" || onlyImportant;

  // 顶部新任务输入框的 IME 守卫（子项输入框的守卫在 ChildInput 内部）
  const toolbarIme = useImeGuard();

  useEffect(() => {
    localStorage.setItem("todo.outlineCollapsed", outlineCollapsed ? "1" : "0");
  }, [outlineCollapsed]);

  useEffect(() => {
    if (collapsedSection === null) {
      localStorage.removeItem("todo.collapsedSection");
    } else {
      localStorage.setItem("todo.collapsedSection", collapsedSection);
    }
  }, [collapsedSection]);

  const filterParents = (parents: TodoItem[]) => {
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
  };

  // 记忆化过滤结果，避免每次渲染都生成新数组导致 Virtuoso 抖动
  const filteredTodoItems = useMemo(
    () => filterParents(todoItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todoItems, filterText, onlyImportant, getChildren],
  );
  const filteredDoneItems = useMemo(
    () => filterParents(doneItems),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doneItems, filterText, onlyImportant, getChildren],
  );

  const todoOutlineItems = useMemo(() => {
    const parentItems = [...filteredTodoItems, ...filteredDoneItems]
      .filter((item) => item.parent_id === null)
      .sort((a, b) => {
        if (a.important !== b.important) return b.important - a.important;
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      });
    return parentItems;
  }, [filteredDoneItems, filteredTodoItems]);

  const todoVirtuosoRef = useRef<VirtuosoHandle>(null);
  const doneVirtuosoRef = useRef<VirtuosoHandle>(null);

  const prevDoneRef = useRef<Map<number, number>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<number>>(() => new Set());

  const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);
  const [enterIds, setEnterIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const prev = prevDoneRef.current;
    const next = new Map(items.map((i) => [i.id, i.done]));
    const newlyDone: number[] = [];
    next.forEach((done, id) => {
      if (done === 1 && prev.get(id) === 0) newlyDone.push(id);
    });
    prevDoneRef.current = next;
    if (newlyDone.length === 0) return;
    setFlashIds(new Set(newlyDone));
    const timer = setTimeout(() => setFlashIds(new Set()), 900);
    return () => clearTimeout(timer);
  }, [items]);

  const handleScrollToItem = (id: number) => {
    setActiveOutlineId(id);
    const inTodo = filteredTodoItems.some((item) => item.id === id);
    const inDone = filteredDoneItems.some((item) => item.id === id);
    if (inTodo && collapsedSection === "todo") {
      setCollapsedSection("done");
    } else if (inDone && collapsedSection === "done") {
      setCollapsedSection("todo");
    }
    setPendingScrollId(id);
  };

  const toggleSection = useCallback((key: "todo" | "done") => {
    setCollapsedSection((prev) => {
      if (prev === key) {
        return null;
      }
      return key;
    });
  }, []);

  const isTodoCollapsed = collapsedSection === "todo";
  const isDoneCollapsed = collapsedSection === "done";

  useEffect(() => {
    if (pendingScrollId === null) return;
    const todoIndex = filteredTodoItems.findIndex(
      (i) => i.id === pendingScrollId,
    );
    if (todoIndex !== -1) {
      if (isTodoCollapsed) return;
      todoVirtuosoRef.current?.scrollToIndex({
        index: todoIndex,
        align: "start",
        behavior: "smooth",
      });
      setPendingScrollId(null);
      return;
    }
    const doneIndex = filteredDoneItems.findIndex(
      (i) => i.id === pendingScrollId,
    );
    if (doneIndex !== -1) {
      if (isDoneCollapsed) return;
      doneVirtuosoRef.current?.scrollToIndex({
        index: doneIndex,
        align: "start",
        behavior: "smooth",
      });
      setPendingScrollId(null);
    }
  }, [
    pendingScrollId,
    filteredTodoItems,
    filteredDoneItems,
    isTodoCollapsed,
    isDoneCollapsed,
  ]);

  const handleAddAndScroll = async () => {
    const newId = await handleAdd();
    if (newId === null) return;
    if (collapsedSection === "todo") setCollapsedSection(null);
    setPendingScrollId(newId);
    setEnterIds(new Set([newId]));
    setTimeout(() => setEnterIds(new Set()), 700);
  };

  /* 编辑保存 / 取消：稳定回调，保证 EditableText 的 memo 生效 */
  const handleSaveEdit = useCallback(
    (id: number, value: string) => {
      setEditingId(null);
      void handleUpdateContent(id, value);
    },
    [handleUpdateContent, setEditingId],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, [setEditingId]);

  const renderItem = (item: TodoItem, isChild = false) => {
    const children = isChild ? [] : getChildren(item.id);
    const hasChildren = children.length > 0;
    const isDone = item.done === 1;
    const isImportant = item.important === 1;
    const isEditing = editingId === item.id;
    const remainingWorkHour = getRemainingWorkHour(item.id);
    const containsWorkHour = remainingWorkHour > 0;

    const contextMenuItems: MenuProps = {
      items: [
        { key: "note", label: item.note ? "修改备注" : "添加备注" },
        ...(item.note ? [{ key: "delete-note", label: "删除备注" }] : []),
        {
          key: "work-hour",
          label: item.work_hour !== null ? "修改工时" : "添加工时",
        },
        ...(item.work_hour !== null
          ? [{ key: "delete-work-hour", label: "删除工时" }]
          : []),
        {
          key: "important",
          label: isImportant ? "取消特别关注" : "设为特别关注",
        },
      ],
      onClick: ({ key }) => {
        if (key === "note") {
          setNoteModalFor(item.id);
          setNoteDraft(item.note ?? "");
          return;
        }
        if (key === "delete-note") {
          void handleDeleteNote(item.id);
          return;
        }
        if (key === "work-hour") {
          setWorkHourModalFor(item.id);
          setWorkHourDraft(item.work_hour ?? null);
          return;
        }
        if (key === "delete-work-hour") {
          void handleDeleteWorkHour(item.id);
          return;
        }
        if (key === "important") {
          void handleToggleImportant(item.id);
        }
      },
    };

    return (
      <div
        key={item.id}
        className={`todo-item ${isDone ? "todo-item--done" : ""} ${isChild ? "todo-item--child" : ""} ${isImportant ? "todo-item--important" : ""} ${flashIds.has(item.id) ? "todo-item--flash" : ""} ${enterIds.has(item.id) ? "todo-item--enter" : ""}`}
      >
        <Dropdown
          menu={contextMenuItems}
          trigger={["contextMenu"]}
          placement="bottomLeft"
        >
          <div className="todo-item-row">
            <div className="todo-item-checkbox">
              <Tooltip
                title={hasChildren && !isDone ? "完成后将同步完成所有子项" : ""}
              >
                <Checkbox
                  checked={isDone}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (isChild) void handleToggleChild(item.id, checked);
                    else if (hasChildren)
                      void handleToggleParent(item.id, checked);
                    else void handleToggle(item.id, checked);
                  }}
                />
              </Tooltip>
            </div>
            <div className="todo-item-main">
              <div className="todo-item-content">
                {isImportant && <StarFilled className="todo-item-important" />}
                {isEditing ? (
                  <EditableText
                    itemId={item.id}
                    initialValue={item.content}
                    onSave={handleSaveEdit}
                    onCancel={handleCancelEdit}
                  />
                ) : (
                  <Text
                    className={isDone ? "todo-item-text--done" : ""}
                    style={{ cursor: "pointer" }}
                    onDoubleClick={() => {
                      setEditingId(item.id);
                    }}
                  >
                    {item.content}
                  </Text>
                )}
              </div>
              {item.note && (
                <Text
                  className="todo-item-note"
                  ellipsis={{ tooltip: item.note }}
                >
                  {item.note}
                </Text>
              )}
              <Text type="secondary" className="todo-item-time">
                <ClockCircleOutlined style={{ fontSize: 12, marginRight: 4 }} />
                {(isDone && item.done_at
                  ? dayjs(item.done_at)
                  : dayjs(item.created_at)
                ).format("MM-DD HH:mm")}
              </Text>
            </div>
            {!isDone && hasChildren && (
              <Text type="secondary" className="todo-item-progress">
                {children.filter((child) => child.done === 1).length}/
                {children.length}
              </Text>
            )}
            {item.work_hour !== null && item.work_hour !== undefined && (
              <Text
                className="todo-item-work-hour"
                onClick={() => {
                  setWorkHourModalFor(item.id);
                  setWorkHourDraft(item.work_hour ?? null);
                }}
              >
                <FieldTimeOutlined className="todo-item-work-hour-icon" />
                <span>{getWorkHourLabel(item.work_hour)}</span>
              </Text>
            )}
            <div className="todo-item-actions">
              {isDone ? (
                <Button
                  type="text"
                  size="small"
                  icon={<UndoOutlined />}
                  onClick={() => {
                    if (isChild) void handleToggleChild(item.id, false);
                    else if (hasChildren)
                      void handleToggleParent(item.id, false);
                    else void handleToggle(item.id, false);
                  }}
                >
                  撤回
                </Button>
              ) : (
                !isChild && (
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() =>
                      setChildInputFor(
                        childInputFor === item.id ? null : item.id,
                      )
                    }
                  />
                )
              )}
              <Popconfirm
                title={
                  hasChildren
                    ? `确定删除？将同时删除 ${children.length} 个子项`
                    : "确定删除？"
                }
                onConfirm={() => void handleDelete(item.id)}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                />
              </Popconfirm>
            </div>
          </div>
        </Dropdown>
        <AnimatePresence initial={false}>
          {childInputFor === item.id && (
            <motion.div
              key="child-input"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <ChildInput
                onSubmit={(content) => handleAddChild(item.id, content)}
                onClose={() => setChildInputFor(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
        {hasChildren && (
          <div className="todo-children">
            {children.map((child) => renderItem(child, true))}
            {containsWorkHour && (
              <div className="todo-item-summary">
                <Text type="secondary">剩余总工时：</Text>
                <Text className="todo-item-work-hour todo-item-work-hour--summary">
                  {getWorkHourLabel(remainingWorkHour)}
                </Text>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Page>
      <div
        className={`todo-page ${outlineCollapsed ? "todo-page--outline-collapsed" : ""}`}
      >
        <div
          className={`todo-outline-wrap ${outlineCollapsed ? "todo-outline-wrap--collapsed" : ""}`}
        >
          <TodoOutlineSidebar
            items={todoOutlineItems}
            activeId={activeOutlineId}
            onSelect={handleScrollToItem}
          />
        </div>

        <div className="todo-main">
          {/* 合并工具栏：输入框 + 筛选 一行搞定 */}
          <div className="todo-toolbar">
            <Input
              className="todo-toolbar__input"
              placeholder="输入新任务，回车添加；后缀加 #2h 记录工时"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onCompositionStart={toolbarIme.onCompositionStart}
              onCompositionEnd={toolbarIme.onCompositionEnd}
              onPressEnter={(e) => {
                // 拼写中的回车不提交
                if (toolbarIme.isComposing(e)) return;
                void handleAddAndScroll();
              }}
              allowClear
              spellCheck={false}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => void handleAddAndScroll()}
            >
              添加
            </Button>
            <span className="todo-toolbar__divider" />
            <Input
              className="todo-toolbar__search"
              placeholder="搜索"
              allowClear
              prefix={<SearchOutlined style={{ color: "rgba(0,0,0,0.25)" }} />}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <Checkbox
              checked={onlyImportant}
              onChange={(e) => setOnlyImportant(e.target.checked)}
            >
              特别关注
            </Checkbox>
            <Tooltip title={outlineCollapsed ? "展开大纲" : "收起大纲"}>
              <Button
                type="text"
                size="small"
                icon={
                  outlineCollapsed ? (
                    <MenuUnfoldOutlined />
                  ) : (
                    <MenuFoldOutlined />
                  )
                }
                onClick={() => setOutlineCollapsed((prev) => !prev)}
              />
            </Tooltip>
          </div>

          <div className="todo-list-container">
            {/* TODO 区域 */}
            <div
              className={`todo-section ${isTodoCollapsed ? "todo-section--collapsed" : ""} ${isDoneCollapsed ? "todo-section--expanded" : ""}`}
            >
              <div className="todo-section-header todo-section-header--todo">
                <button
                  type="button"
                  className="todo-section-header__toggle"
                  onClick={() => toggleSection("todo")}
                >
                  <span className="todo-section-header__left">
                    <UnorderedListOutlined className="todo-section-header__icon" />
                    <span className="todo-section-header__title">待办</span>
                    <span className="todo-section-header__badge todo-section-header__badge--todo">
                      {filteredTodoItems.length}
                    </span>
                  </span>
                  {isTodoCollapsed ? (
                    <RightOutlined className="todo-section-header__arrow" />
                  ) : (
                    <DownOutlined className="todo-section-header__arrow" />
                  )}
                </button>
              </div>
              {!isTodoCollapsed &&
                (filteredTodoItems.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <Empty
                      description={
                        hasFilter ? "没有匹配的任务" : "暂无待办事项"
                      }
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    >
                      {!hasFilter && (
                        <Text type="secondary" className="todo-empty-hint">
                          在上方输入任务，后缀加 #2h
                          可快捷记录工时；双击任务名可编辑
                        </Text>
                      )}
                    </Empty>
                  </motion.div>
                ) : (
                  <Virtuoso
                    ref={todoVirtuosoRef}
                    className="todo-virtuoso"
                    style={{ height: "100%" }}
                    data={filteredTodoItems}
                    overscan={5}
                    itemContent={(_, item) => (
                      <div className="todo-virtuoso-item">
                        {renderItem(item)}
                      </div>
                    )}
                  />
                ))}
            </div>

            {/* DONE 区域 */}
            <div
              className={`todo-section todo-section--done ${isDoneCollapsed ? "todo-section--collapsed" : ""} ${isTodoCollapsed ? "todo-section--expanded" : ""}`}
            >
              <div className="todo-section-header todo-section-header--done">
                <button
                  type="button"
                  className="todo-section-header__toggle"
                  onClick={() => toggleSection("done")}
                >
                  <span className="todo-section-header__left">
                    <FileDoneOutlined className="todo-section-header__icon" />
                    <span className="todo-section-header__title">已完成</span>
                    <span className="todo-section-header__badge todo-section-header__badge--done">
                      {filteredDoneItems.length}
                    </span>
                  </span>
                  {isDoneCollapsed ? (
                    <RightOutlined className="todo-section-header__arrow" />
                  ) : (
                    <DownOutlined className="todo-section-header__arrow" />
                  )}
                </button>
              </div>
              {!isDoneCollapsed &&
                (filteredDoneItems.length === 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <Empty
                      description={
                        hasFilter ? "没有匹配的任务" : "暂无已完成事项"
                      }
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                    >
                      {!hasFilter && (
                        <Text type="secondary" className="todo-empty-hint">
                          勾选左侧任务后，完成事项会汇总在这里
                        </Text>
                      )}
                    </Empty>
                  </motion.div>
                ) : (
                  <Virtuoso
                    ref={doneVirtuosoRef}
                    className="todo-virtuoso"
                    style={{ height: "100%" }}
                    data={filteredDoneItems}
                    overscan={5}
                    itemContent={(_, item) => (
                      <div className="todo-virtuoso-item">
                        {renderItem(item)}
                      </div>
                    )}
                  />
                ))}
            </div>
          </div>
        </div>

        <NoteModal
          open={noteModalFor !== null}
          value={noteDraft}
          onChange={setNoteDraft}
          onCancel={() => {
            setNoteModalFor(null);
            setNoteDraft("");
          }}
          onOk={() => {
            if (noteModalFor !== null)
              void handleUpdateNote(noteModalFor, noteDraft);
          }}
        />
        <WorkHourModal
          open={workHourModalFor !== null}
          value={workHourDraft}
          onChange={setWorkHourDraft}
          onCancel={() => {
            setWorkHourModalFor(null);
            setWorkHourDraft(null);
          }}
          onSave={(value) => {
            if (workHourModalFor !== null)
              void handleUpdateWorkHour(workHourModalFor, value);
          }}
        />
      </div>
    </Page>
  );
}

export default TodoPage;
