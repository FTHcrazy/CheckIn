import {
  App,
  Button,
  Checkbox,
  Dropdown,
  Popconfirm,
  Tooltip,
  Typography,
  type MenuProps,
} from "antd";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClockCircleOutlined,
  DeleteOutlined,
  FieldTimeOutlined,
  PlusOutlined,
  StarFilled,
  UndoOutlined,
  CopyFilled,
} from "@ant-design/icons";
import dayjs from "dayjs";
import EditableText from "../EditableText";
import ChildInput from "../ChildInput";
import type { TodoItem } from "../../types";
import { todoDisplayConfig } from "../../todo-config";

const { Text } = Typography;

type TodoListItemProps = {
  item: TodoItem;
  isChild?: boolean;
  editingId: number | null;
  childInputFor: number | null;
  flashIds: Set<number>;
  enterIds: Set<number>;
  getChildren: (parentId: number) => TodoItem[];
  getRemainingWorkHour: (id: number) => number;
  getWorkHourLabel: (value: number | null | undefined) => string;
  onSetEditingId: (id: number | null) => void;
  onToggleChildInput: (id: number) => void;
  onCloseChildInput: () => void;
  onOpenNote: (id: number, note: string | null) => void;
  onOpenWorkHour: (id: number, workHour: number | null) => void;
  onAddChild: (parentId: number, content: string) => Promise<boolean>;
  onDelete: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteWorkHour: (id: number) => void;
  onToggleImportant: (id: number) => void;
  onSaveEdit: (id: number, value: string) => void;
  onCancelEdit: () => void;
  onToggle: (id: number, checked: boolean) => void;
  onToggleChild: (id: number, checked: boolean) => void;
  onToggleParent: (id: number, checked: boolean) => void;
};

function truncateTodoText(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= todoDisplayConfig.maxTextLength) return text;
  return `${characters.slice(0, todoDisplayConfig.maxTextLength).join("")}...`;
}

export default function TodoListItem({
  item,
  isChild = false,
  editingId,
  childInputFor,
  flashIds,
  enterIds,
  getChildren,
  getRemainingWorkHour,
  getWorkHourLabel,
  onSetEditingId,
  onToggleChildInput,
  onCloseChildInput,
  onOpenNote,
  onOpenWorkHour,
  onAddChild,
  onDelete,
  onDeleteNote,
  onDeleteWorkHour,
  onToggleImportant,
  onSaveEdit,
  onCancelEdit,
  onToggle,
  onToggleChild,
  onToggleParent,
}: TodoListItemProps) {
  const { message } = App.useApp();
  const children = isChild ? [] : getChildren(item.id);
  const hasChildren = children.length > 0;
  const isDone = item.done === 1;
  const isImportant = item.important === 1;
  const isEditing = editingId === item.id;
  const remainingWorkHour = getRemainingWorkHour(item.id);
  const containsWorkHour = remainingWorkHour > 0;
  const displayContent = truncateTodoText(item.content);
  const displayNote = item.note ? truncateTodoText(item.note) : null;

  const handleCopyNote = async (): Promise<void> => {
    if (!item.note) return;

    try {
      await navigator.clipboard.writeText(item.note);
      message.success("备注已复制");
    } catch (error) {
      message.error("复制失败");
      console.error(error);
    }
  };

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
        onOpenNote(item.id, item.note);
        return;
      }
      if (key === "delete-note") {
        onDeleteNote(item.id);
        return;
      }
      if (key === "work-hour") {
        onOpenWorkHour(item.id, item.work_hour);
        return;
      }
      if (key === "delete-work-hour") {
        onDeleteWorkHour(item.id);
        return;
      }
      if (key === "important") {
        onToggleImportant(item.id);
      }
    },
  };

  return (
    <div
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
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (isChild) onToggleChild(item.id, checked);
                  else if (hasChildren) onToggleParent(item.id, checked);
                  else onToggle(item.id, checked);
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
                  onSave={onSaveEdit}
                  onCancel={onCancelEdit}
                />
              ) : (
                <Tooltip
                  title={
                    displayContent === item.content ? undefined : item.content
                  }
                >
                  <Text
                    className={isDone ? "todo-item-text--done" : ""}
                    style={{ cursor: "pointer" }}
                    onDoubleClick={() => onSetEditingId(item.id)}
                  >
                    {displayContent}
                  </Text>
                </Tooltip>
              )}
            </div>
            {item.note && (
              <Tooltip
                title={displayNote === item.note ? undefined : item.note}
              >
                <Text
                  className="todo-item-note"
                  ellipsis={false}
                  style={{ cursor: "pointer" }}
                  onClick={() => void handleCopyNote()}
                >
                  {displayNote}&nbsp;|&nbsp;<CopyFilled />
                </Text>
              </Tooltip>
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
              onClick={() => onOpenWorkHour(item.id, item.work_hour)}
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
                  if (isChild) onToggleChild(item.id, false);
                  else if (hasChildren) onToggleParent(item.id, false);
                  else onToggle(item.id, false);
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
                  onClick={() => onToggleChildInput(item.id)}
                />
              )
            )}
            <Popconfirm
              title={
                hasChildren
                  ? `确定删除？将同时删除 ${children.length} 个子项`
                  : "确定删除？"
              }
              onConfirm={() => onDelete(item.id)}
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
              onSubmit={(content) => onAddChild(item.id, content)}
              onClose={onCloseChildInput}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {hasChildren && (
        <div className="todo-children">
          {children.map((child) => (
            <TodoListItem
              key={child.id}
              item={child}
              isChild
              editingId={editingId}
              childInputFor={childInputFor}
              flashIds={flashIds}
              enterIds={enterIds}
              getChildren={getChildren}
              getRemainingWorkHour={getRemainingWorkHour}
              getWorkHourLabel={getWorkHourLabel}
              onSetEditingId={onSetEditingId}
              onToggleChildInput={onToggleChildInput}
              onCloseChildInput={onCloseChildInput}
              onOpenNote={onOpenNote}
              onOpenWorkHour={onOpenWorkHour}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onDeleteNote={onDeleteNote}
              onDeleteWorkHour={onDeleteWorkHour}
              onToggleImportant={onToggleImportant}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              onToggle={onToggle}
              onToggleChild={onToggleChild}
              onToggleParent={onToggleParent}
            />
          ))}
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
}
