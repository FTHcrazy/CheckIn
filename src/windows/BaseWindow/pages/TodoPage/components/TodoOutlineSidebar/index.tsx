import { CheckCircleOutlined } from "@ant-design/icons";
import { memo, useCallback, useMemo } from "react";
import { GroupedVirtuoso } from "react-virtuoso";
import type { TodoItem } from "../../types";
import "./index.scss";

interface OutlineGroup {
  key: "todo" | "done";
  label: string;
  color: string;
  items: TodoItem[];
}

interface TodoOutlineSidebarProps {
  items: TodoItem[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

function TodoOutlineSidebar({
  items,
  activeId,
  onSelect,
}: TodoOutlineSidebarProps) {
  // ✅ 统一规范化 done 值后再分组，避免 0/1、布尔值、字符串等混合导致 DONE 被误判为空
  const groups = useMemo<OutlineGroup[]>(() => {
    const todo = items.filter((item) => Number(item.done) !== 1);
    const done = items.filter((item) => Number(item.done) === 1);

    const result: OutlineGroup[] = [];
    if (todo.length > 0) {
      result.push({
        key: "todo",
        label: "TODO",
        color: "#1677ff",
        items: todo,
      });
    }
    if (done.length > 0) {
      result.push({
        key: "done",
        label: "DONE",
        color: "#52c41a",
        items: done,
      });
    }
    return result;
  }, [items]);

  const groupCounts = useMemo(
    () => groups.map((g) => g.items.length),
    [groups],
  );

  // itemContent 的 index 是全部条目的全局索引（不含组头），需减去前面各组的条目数得到组内索引。
  // 预计算前缀和，避免每次调用都做一次 slice+reduce（原本是 O(n²)）。
  const groupOffsets = useMemo(() => {
    const offsets: number[] = [];
    let sum = 0;
    groups.forEach((g) => {
      offsets.push(sum);
      sum += g.items.length;
    });
    return offsets;
  }, [groups]);

  const groupContent = useCallback(
    (groupIndex: number) => {
      const group = groups[groupIndex];
      return (
        <div className="todo-outline__group-header">
          <CheckCircleOutlined style={{ color: group.color }} />
          <span
            className="todo-outline__group-title"
            style={{ color: group.color }}
          >
            {group.label}
          </span>
          <span className="todo-outline__group-count">
            ({group.items.length})
          </span>
        </div>
      );
    },
    [groups],
  );

  const itemContent = useCallback(
    (index: number, groupIndex: number) => {
      const group = groups[groupIndex];
      const item = group.items[index - groupOffsets[groupIndex]];
      if (!item) return null;
      const isDone = group.key === "done";

      return (
        // 用包裹层做间距：margin 不会被 Virtuoso 计入测量高度
        <div className="todo-outline__item-wrap" key={item.id}>
          <button
            type="button"
            className={[
              "todo-outline__item",
              isDone ? "todo-outline__item--done" : "",
              activeId === item.id ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelect(item.id)}
          >
            <span
              className="todo-outline__dot"
              style={{ background: group.color }}
            />
            <span className="todo-outline__label">{item.content}</span>
          </button>
        </div>
      );
    },
    [activeId, groupOffsets, groups, onSelect],
  );

  return (
    <aside className="todo-outline">
      <div className="todo-outline__header">大纲</div>

      {!items.length ? (
        <div className="todo-outline__empty">暂无父任务</div>
      ) : (
        <GroupedVirtuoso
          className="todo-outline__virtuoso"
          style={{ height: "100%" }}
          groupCounts={groupCounts}
          overscan={5}
          // ✅ 吸顶组头
          groupContent={groupContent}
          itemContent={itemContent}
        />
      )}
    </aside>
  );
}

export default memo(TodoOutlineSidebar);
