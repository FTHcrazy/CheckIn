import { Empty, Typography } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import type { TodoItem } from "../../types";

const { Text } = Typography;

type TodoSectionProps = {
  kind: "todo" | "done";
  items: TodoItem[];
  collapsed: boolean;
  otherCollapsed: boolean;
  hasFilter: boolean;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  renderItem: (item: TodoItem) => React.ReactNode;
  onToggle: () => void;
};

export default function TodoSection({
  kind,
  items,
  collapsed,
  otherCollapsed,
  hasFilter,
  virtuosoRef,
  renderItem,
  onToggle,
}: TodoSectionProps) {
  const isTodo = kind === "todo";
  return (
    <div
      className={`todo-section ${collapsed ? "todo-section--collapsed" : ""} ${otherCollapsed ? "todo-section--expanded" : ""} ${isTodo ? "" : "todo-section--done"}`}
    >
      <div className={`todo-section-header todo-section-header--${kind}`}>
        <button type="button" className="todo-section-header__toggle" onClick={onToggle}>
          <span className="todo-section-header__left">
            <span className="todo-section-header__title">{isTodo ? "待办" : "已完成"}</span>
            <span className={`todo-section-header__badge todo-section-header__badge--${kind}`}>
              {items.length}
            </span>
          </span>
          {collapsed ? <RightOutlined className="todo-section-header__arrow" /> : <DownOutlined className="todo-section-header__arrow" />}
        </button>
      </div>
      {!collapsed && (items.length === 0 ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Empty description={hasFilter ? "没有匹配的任务" : isTodo ? "暂无待办事项" : "暂无已完成事项"} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            {!hasFilter && <Text type="secondary" className="todo-empty-hint">{isTodo ? "在上方输入任务，后缀加 #2h 可快捷记录工时；双击任务名可编辑" : "勾选左侧任务后，完成事项会汇总在这里"}</Text>}
          </Empty>
        </motion.div>
      ) : (
        <Virtuoso ref={virtuosoRef} className="todo-virtuoso" style={{ height: "100%" }} data={items} overscan={5} itemContent={(_, item) => <div className="todo-virtuoso-item">{renderItem(item)}</div>} />
      ))}
    </div>
  );
}
