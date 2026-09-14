import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Space,
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
  CheckCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  UndoOutlined,
  StarFilled,
  DownOutlined,
  RightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Page from "../../components/Page";
import NoteModal from "./components/NoteModal";
import WorkHourModal from "./components/WorkHourModal";
import TodoOutlineSidebar from "./components/TodoOutlineSidebar";
import { useTodoPage } from "./hooks/useTodoPage";
import type { TodoItem } from "./todo-db";
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
  // ✅ 大纲收起状态：持久化到 localStorage，重启后保留
  const [outlineCollapsed, setOutlineCollapsed] = useState(
    () => localStorage.getItem("todo.outlineCollapsed") === "1",
  );
  // ✅ 互斥折叠：'todo' | 'done' | null，null 表示两者都展开；同样持久化
  const [collapsedSection, setCollapsedSection] = useState<
    "todo" | "done" | null
  >(() => {
    const stored = localStorage.getItem("todo.collapsedSection");
    return stored === "todo" || stored === "done" ? stored : null;
  });

  // 搜索/筛选
  const [filterText, setFilterText] = useState("");
  const [onlyImportant, setOnlyImportant] = useState(false);
  const hasFilter = filterText.trim() !== "" || onlyImportant;

  useEffect(() => {
    localStorage.setItem(
      "todo.outlineCollapsed",
      outlineCollapsed ? "1" : "0",
    );
  }, [outlineCollapsed]);

  useEffect(() => {
    if (collapsedSection === null) {
      localStorage.removeItem("todo.collapsedSection");
    } else {
      localStorage.setItem("todo.collapsedSection", collapsedSection);
    }
  }, [collapsedSection]);

  // 搜索/筛选：父任务匹配关键词或任一子项匹配即保留；特别关注开关只作用于父任务
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
  const filteredTodoItems = filterParents(todoItems);
  const filteredDoneItems = filterParents(doneItems);

  const todoOutlineItems = useMemo(() => {
    const parentItems = [...filteredTodoItems, ...filteredDoneItems]
      .filter((item) => item.parent_id === null)
      .sort((a, b) => {
        // 与主列表一致：特别关注置顶，其余按创建时间倒序
        if (a.important !== b.important) return b.important - a.important;
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      });
    return parentItems;
  }, [filteredDoneItems, filteredTodoItems]);

  const todoVirtuosoRef = useRef<VirtuosoHandle>(null);
  const doneVirtuosoRef = useRef<VirtuosoHandle>(null);
  // 编辑框因 Enter 保存或 Esc 取消即将卸载时置 true，避免随后触发的 blur 再次保存
  const editingSkipBlurRef = useRef(false);

  // 完成时的高亮反馈：追踪 items 中从未完成变为完成的项目，闪烁约 0.9s
  const prevDoneRef = useRef<Map<number, number>>(new Map());
  const [flashIds, setFlashIds] = useState<Set<number>>(() => new Set());

  // 待滚动定位的任务 id：等目标分区展开、Virtuoso 挂载后由副作用统一执行滚动
  const [pendingScrollId, setPendingScrollId] = useState<number | null>(null);
  // 新增任务的入场动画 id 集合
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

  // 点击大纲定位：若目标所在分区被折叠，先展开，再由 pendingScroll 副作用执行滚动
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

  // ✅ 互斥折叠切换逻辑
  const toggleSection = useCallback((key: "todo" | "done") => {
    setCollapsedSection((prev) => {
      if (prev === key) {
        // 当前已折叠 → 展开（回到两者都展开的状态）
        return null;
      }
      // 折叠指定区域，另一个自动占据剩余空间
      return key;
    });
  }, []);

  const isTodoCollapsed = collapsedSection === "todo";
  const isDoneCollapsed = collapsedSection === "done";

  // 定位副作用：等目标出现在已展开的分区后再滚动（新增任务、大纲点击共用）
  useEffect(() => {
    if (pendingScrollId === null) return;
    const todoIndex = filteredTodoItems.findIndex(
      (i) => i.id === pendingScrollId,
    );
    if (todoIndex !== -1) {
      if (isTodoCollapsed) return; // 分区未展开，等下一次渲染再滚动
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

  // 新增任务：成功后定位到列表顶端并播放入场动画
  const handleAddAndScroll = async () => {
    const newId = await handleAdd();
    if (newId === null) return;
    if (collapsedSection === "todo") setCollapsedSection(null); // todo 区被折叠时先展开
    setPendingScrollId(newId);
    setEnterIds(new Set([newId]));
    setTimeout(() => setEnterIds(new Set()), 700);
  };

  // ✅ renderItem 保持不变，此处省略以节省篇幅，实际使用时保留原有完整实现
  const renderItem = (item: TodoItem, isChild = false) => {
    /* ... 保持原有 renderItem 完整实现不变 ... */
    // ⚠️ 注意：请保留你原有的完整 renderItem 函数体，这里仅做标记
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
                  <Input
                    className="todo-item-edit-input"
                    value={editingContent}
                    size="small"
                    autoFocus
                    spellCheck={false}
                    onChange={(e) => setEditingContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        editingSkipBlurRef.current = true;
                        setEditingId(null);
                        setEditingContent("");
                      }
                    }}
                    onPressEnter={() => {
                      editingSkipBlurRef.current = true;
                      void handleUpdateContent(item.id, editingContent);
                    }}
                    onBlur={() => {
                      if (editingSkipBlurRef.current) return;
                      // 内容未变更时直接退出编辑，不写库
                      if (editingContent === item.content) {
                        setEditingId(null);
                        return;
                      }
                      void handleUpdateContent(item.id, editingContent);
                    }}
                  />
                ) : (
                  <Text
                    className={isDone ? "todo-item-text--done" : ""}
                    style={{ cursor: "pointer" }}
                    onDoubleClick={() => {
                      editingSkipBlurRef.current = false;
                      setEditingId(item.id);
                      setEditingContent(item.content);
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
                {/* 完成项显示完成时间，未完成显示创建时间 */}
                {(isDone && item.done_at
                  ? dayjs(item.done_at)
                  : dayjs(item.created_at)
                ).format("MM-DD HH:mm")}
              </Text>
            </div>
            {!isDone && hasChildren && (
              <Text
                type="secondary"
                className="todo-item-progress"
              >
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
              <div className="todo-child-input">
                <Input
                  size="small"
                  placeholder="输入子项内容，回车添加"
                  value={childContent}
                  onChange={(e) => setChildContent(e.target.value)}
                  onPressEnter={() => void handleAddChild(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setChildInputFor(null);
                      setChildContent("");
                    }
                  }}
                  onBlur={() => {
                    if (!childContent.trim()) {
                      setChildInputFor(null);
                      setChildContent("");
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => void handleAddChild(item.id)}
                />
              </div>
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
        {/* ✅ 左侧大纲：支持收起 */}
        {!outlineCollapsed && (
          <TodoOutlineSidebar
            items={todoOutlineItems}
            activeId={activeOutlineId}
            onSelect={handleScrollToItem}
          />
        )}

        <div className="todo-main">
          <div className="todo-input-bar">
            <Input
              placeholder="输入新任务，回车添加，后缀加 #{n}h，快捷添加工时"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onPressEnter={() => void handleAddAndScroll()}
              size="large"
              spellCheck={false}
            />
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              onClick={() => void handleAddAndScroll()}
            >
              添加
            </Button>
          </div>

          {/* 大纲切换按钮与搜索、筛选合并为一行，减少垂直占用 */}
          <div className="todo-filter-bar">
            <Button
              type="text"
              size="small"
              icon={
                outlineCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
              }
              onClick={() => setOutlineCollapsed((prev) => !prev)}
              title={outlineCollapsed ? "展开大纲" : "收起大纲"}
            />
            <Input
              className="todo-filter-bar__search"
              placeholder="搜索任务"
              allowClear
              prefix={
                <SearchOutlined style={{ color: "rgba(0, 0, 0, 0.25)" }} />
              }
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
            <Checkbox
              checked={onlyImportant}
              onChange={(e) => setOnlyImportant(e.target.checked)}
            >
              只看特别关注
            </Checkbox>
          </div>

          <div className="todo-list-container">
            {/* ✅ TODO 区域 */}
            <div
              className={`todo-section ${isTodoCollapsed ? "todo-section--collapsed" : ""} ${isDoneCollapsed ? "todo-section--expanded" : ""}`}
            >
              <div className="todo-section-header">
                <button
                  type="button"
                  className="todo-section-header__toggle"
                  onClick={() => toggleSection("todo")}
                >
                  <Space>
                    <CheckCircleOutlined style={{ color: "#1677ff" }} />
                    <Text strong>TODO</Text>
                    <Text type="secondary">({filteredTodoItems.length})</Text>
                  </Space>
                  {isTodoCollapsed ? <RightOutlined /> : <DownOutlined />}
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
                          在上方输入任务，后缀加 #2h 可快捷记录工时；双击任务名可编辑
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

            {/* ✅ DONE 区域 */}
            <div
              className={`todo-section todo-section--done ${isDoneCollapsed ? "todo-section--collapsed" : ""} ${isTodoCollapsed ? "todo-section--expanded" : ""}`}
            >
              <div className="todo-section-header">
                <button
                  type="button"
                  className="todo-section-header__toggle"
                  onClick={() => toggleSection("done")}
                >
                  <Space>
                    <CheckCircleOutlined style={{ color: "#52c41a" }} />
                    <Text strong>DONE</Text>
                    <Text type="secondary">({filteredDoneItems.length})</Text>
                  </Space>
                  {isDoneCollapsed ? <RightOutlined /> : <DownOutlined />}
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
