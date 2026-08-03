import { useEffect, useState, useCallback } from "react";
import { App, Button, Checkbox, Empty, Input, Popconfirm, Space, Typography } from "antd";
import { PlusOutlined, DeleteOutlined, CheckCircleOutlined, ClockCircleOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import Page from "../../components/Page";
import "./index.scss";

const { Text } = Typography;

interface TodoItem {
  id: number;
  parent_id: number | null;
  content: string;
  done: number; // 0 or 1
  created_at: string;
  done_at: string | null;
}

const db = {
  all: (sql: string, params?: unknown[]) => window.electronAPI?.db.all(sql, params) ?? Promise.resolve([]),
  run: (sql: string, params?: unknown[]) => window.electronAPI?.db.run(sql, params) ?? Promise.resolve({ changes: 0, lastInsertRowid: 0 }),
  exec: (sql: string) => window.electronAPI?.db.exec(sql) ?? Promise.resolve(false),
};

// 初始化表
let tableInited = false;
async function ensureTable() {
  if (tableInited) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER DEFAULT NULL,
      content TEXT NOT NULL,
      done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      done_at TEXT DEFAULT NULL
    )
  `);
  tableInited = true;
}

function TodoPage() {
  const { message } = App.useApp();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [newContent, setNewContent] = useState("");
  const [childInputFor, setChildInputFor] = useState<number | null>(null);
  const [childContent, setChildContent] = useState("");

  const loadItems = useCallback(async () => {
    try {
      const rows = (await db.all("SELECT * FROM todos ORDER BY created_at DESC")) as TodoItem[];
      setItems(rows);
    } catch (err) {
      message.error("加载 TODO 列表失败");
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void ensureTable().then(() => void loadItems());
  }, [loadItems]);

  const handleAdd = async () => {
    const text = newContent.trim();
    if (!text) { message.warning("请输入内容"); return; }
    try {
      await db.run("INSERT INTO todos (content) VALUES (?)", [text]);
      setNewContent("");
      message.success("已添加");
      void loadItems();
    } catch (err) {
      message.error("添加失败");
      console.error(err);
    }
  };

  const handleAddChild = async (parentId: number) => {
    const text = childContent.trim();
    if (!text) { message.warning("请输入子项内容"); return; }
    try {
      await db.run("INSERT INTO todos (parent_id, content) VALUES (?, ?)", [parentId, text]);
      setChildInputFor(null);
      setChildContent("");
      message.success("子项已添加");
      void loadItems();
    } catch (err) {
      message.error("添加失败");
      console.error(err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      // 同时删除子项
      await db.run("DELETE FROM todos WHERE id = ? OR parent_id = ?", [id, id]);
      message.success("已删除");
      void loadItems();
    } catch (err) {
      message.error("删除失败");
      console.error(err);
    }
  };

  const handleToggle = async (id: number, checked: boolean) => {
    try {
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(`UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`, [doneVal, id]);
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  // 勾选子项后检查父项是否全部完成
  const handleToggleChild = async (id: number, checked: boolean) => {
    try {
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(`UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`, [doneVal, id]);

      // 获取该子项的 parent_id
      const child = (await db.all("SELECT parent_id FROM todos WHERE id = ?", [id])) as TodoItem[];
      if (child.length > 0 && child[0].parent_id !== null) {
        const parentId = child[0].parent_id;
        // 检查该父项的所有子项是否都已完成
        const siblings = (await db.all("SELECT done FROM todos WHERE parent_id = ?", [parentId])) as TodoItem[];
        const allDone = siblings.length > 0 && siblings.every(s => s.done === 1);
        if (allDone) {
          await db.run(`UPDATE todos SET done = 1, done_at = datetime('now', 'localtime') WHERE id = ?`, [parentId]);
        } else {
          // 如果取消勾选子项，父项也应取消
          if (!checked) {
            await db.run(`UPDATE todos SET done = 0, done_at = NULL WHERE id = ?`, [parentId]);
          }
        }
      }
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  // 取消父项勾选时，子项也取消
  const handleToggleParent = async (id: number, checked: boolean) => {
    try {
      const doneVal = checked ? 1 : 0;
      const doneAt = checked ? "datetime('now', 'localtime')" : "NULL";
      await db.run(`UPDATE todos SET done = ?, done_at = ${doneAt} WHERE id = ?`, [doneVal, id]);
      if (!checked) {
        // 取消父项时，子项也取消
        await db.run(`UPDATE todos SET done = 0, done_at = NULL WHERE parent_id = ?`, [id]);
      }
      void loadItems();
    } catch (err) {
      message.error("操作失败");
      console.error(err);
    }
  };

  // 分离顶级项
  const topLevel = items.filter(i => i.parent_id === null);
  const getChildren = (parentId: number) => items.filter(i => i.parent_id === parentId);

  const todoItems = topLevel.filter(i => i.done === 0);
  const doneItems = topLevel.filter(i => i.done === 1);

  const renderItem = (item: TodoItem, isChild = false) => {
    const children = isChild ? [] : getChildren(item.id);
    const hasChildren = children.length > 0;
    const isDone = item.done === 1;

    return (
      <div key={item.id} className={`todo-item ${isDone ? "todo-item--done" : ""} ${isChild ? "todo-item--child" : ""}`}>
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
          <div className="todo-item-content">
            <Text className={isDone ? "todo-item-text--done" : ""}>{item.content}</Text>
            <Text type="secondary" className="todo-item-time">
              <ClockCircleOutlined style={{ fontSize: 12, marginRight: 4 }} />
              {dayjs(item.created_at).format("MM-DD HH:mm")}
            </Text>
          </div>
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
              <>
                {!isChild && (
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setChildInputFor(childInputFor === item.id ? null : item.id)}
                  />
                )}
              </>
            )}
            <Popconfirm
              title="确定删除？"
              onConfirm={() => void handleDelete(item.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>

        {/* 子项输入框 */}
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
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void handleAddChild(item.id)} />
          </div>
        )}

        {/* 子项列表 */}
        {hasChildren && (
          <div className="todo-children">
            {children.map(child => renderItem(child, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Page>
      <div className="todo-page">
        {/* 新增区域 */}
        <div className="todo-input-bar">
          <Input
            placeholder="输入新任务，回车添加"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onPressEnter={() => void handleAdd()}
            size="large"
            spellCheck={false}
          />
          <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => void handleAdd()}>
            添加
          </Button>
        </div>

        {/* TODO 分区 */}
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
            <div className="todo-list">
              {todoItems.map(item => renderItem(item))}
            </div>
          )}
        </div>

        {/* DONE 分区 */}
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
            <div className="todo-list">
              {doneItems.map(item => renderItem(item))}
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

export default TodoPage;
