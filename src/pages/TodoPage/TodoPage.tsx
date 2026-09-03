import {
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Space,
  Typography,
  type MenuProps,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  UndoOutlined,
  StarFilled,
} from "@ant-design/icons";
import dayjs from "dayjs";
import Page from "../../components/Page";
import NoteModal from "./NoteModal";
import WorkHourModal from "./WorkHourModal";
import { useTodoPage } from "./hooks/useTodoPage";
import type { TodoItem } from "./todo-db";
import "./index.scss";

const { Text } = Typography;

function TodoPage() {
  const {
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
        { key: "work-hour", label: item.work_hour !== null ? "修改工时" : "添加工时" },
        ...(item.work_hour !== null ? [{ key: "delete-work-hour", label: "删除工时" }] : []),
        { key: "important", label: isImportant ? "取消特别关注" : "设为特别关注" },
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
        className={`todo-item ${isDone ? "todo-item--done" : ""} ${isChild ? "todo-item--child" : ""} ${isImportant ? "todo-item--important" : ""}`}
      >
        <Dropdown menu={contextMenuItems} trigger={["contextMenu"]} placement="bottomLeft">
          <div className="todo-item-row">
            <div className="todo-item-checkbox">
              <Checkbox
                checked={isDone}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (isChild) {
                    void handleToggleChild(item.id, checked);
                  } else if (hasChildren) {
                    void handleToggleParent(item.id, checked);
                  } else {
                    void handleToggle(item.id, checked);
                  }
                }}
              />
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
                    onPressEnter={() => {
                      void handleUpdateContent(item.id, editingContent);
                    }}
                    onBlur={() => {
                      void handleUpdateContent(item.id, editingContent);
                    }}
                  />
                ) : (
                  <Text
                    className={isDone ? "todo-item-text--done" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      setEditingId(item.id);
                      setEditingContent(item.content);
                    }}
                  >
                    {item.content}
                  </Text>
                )}
              </div>
              {item.note && (
                <Text className="todo-item-note" ellipsis={{ tooltip: item.note }}>
                  {item.note}
                </Text>
              )}
              <Text type="secondary" className="todo-item-time">
                <ClockCircleOutlined style={{ fontSize: 12, marginRight: 4 }} />
                {dayjs(item.created_at).format("MM-DD HH:mm")}
              </Text>
            </div>
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
                    if (isChild) {
                      void handleToggleChild(item.id, false);
                    } else if (hasChildren) {
                      void handleToggleParent(item.id, false);
                    } else {
                      void handleToggle(item.id, false);
                    }
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
                      setChildInputFor(childInputFor === item.id ? null : item.id)
                    }
                  />
                )
              )}
              <Popconfirm
                title="确定删除？"
                onConfirm={() => void handleDelete(item.id)}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          </div>
        </Dropdown>

        {childInputFor === item.id && (
          <div className="todo-child-input">
            <Input
              size="small"
              placeholder="输入子项内容，回车添加"
              value={childContent}
              onChange={(e) => setChildContent(e.target.value)}
              onPressEnter={() => void handleAddChild(item.id)}
              autoFocus
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => void handleAddChild(item.id)}
            />
          </div>
        )}

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
      <div className="todo-page">
        <div className="todo-input-bar">
          <Input
            placeholder="输入新任务，回车添加，后缀加 #{n}h，快捷添加工时"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onPressEnter={() => void handleAdd()}
            size="large"
            spellCheck={false}
          />
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={() => void handleAdd()}
          >
            添加
          </Button>
        </div>

        <div className="todo-list-container">
          <div className="todo-section">
            <div className="todo-section-header">
              <Space>
                <CheckCircleOutlined style={{ color: "#1677ff" }} />
                <Text strong>TODO</Text>
                <Text type="secondary">({todoItems.length})</Text>
              </Space>
            </div>
            {todoItems.length === 0 ? (
              <Empty description="暂无待办事项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="todo-list">{todoItems.map((item) => renderItem(item))}</div>
            )}
          </div>

          <div className="todo-section todo-section--done">
            <div className="todo-section-header">
              <Space>
                <CheckCircleOutlined style={{ color: "#52c41a" }} />
                <Text strong>DONE</Text>
                <Text type="secondary">({doneItems.length})</Text>
              </Space>
            </div>
            {doneItems.length === 0 ? (
              <Empty description="暂无已完成事项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="todo-list">{doneItems.map((item) => renderItem(item))}</div>
            )}
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
            if (noteModalFor !== null) {
              void handleUpdateNote(noteModalFor, noteDraft);
            }
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
            if (workHourModalFor !== null) {
              void handleUpdateWorkHour(workHourModalFor, value);
            }
          }}
        />
      </div>
    </Page>
  );
}

export default TodoPage;
