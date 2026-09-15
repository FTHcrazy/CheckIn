import { Button, Checkbox, Input, Tooltip } from "antd";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useImeGuard } from "../../hooks/useImeGuard";

interface TodoToolbarProps {
  newContent: string;
  filterText: string;
  onlyImportant: boolean;
  outlineCollapsed: boolean;
  onNewContentChange: (value: string) => void;
  onFilterTextChange: (value: string) => void;
  onOnlyImportantChange: (value: boolean) => void;
  onAdd: () => void;
  onToggleOutline: () => void;
}

export default function TodoToolbar({
  newContent,
  filterText,
  onlyImportant,
  outlineCollapsed,
  onNewContentChange,
  onFilterTextChange,
  onOnlyImportantChange,
  onAdd,
  onToggleOutline,
}: TodoToolbarProps) {
  const ime = useImeGuard();

  return (
    <div className="todo-toolbar">
      <Input
        className="todo-toolbar__input"
        placeholder="输入新任务，回车添加；后缀加 #2h 记录工时"
        value={newContent}
        onChange={(event) => onNewContentChange(event.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onPressEnter={(event) => {
          if (ime.isComposing(event)) return;
          onAdd();
        }}
        allowClear
        spellCheck={false}
      />
      <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
        添加
      </Button>
      <span className="todo-toolbar__divider" />
      <Input
        className="todo-toolbar__search"
        placeholder="搜索"
        allowClear
        prefix={<SearchOutlined style={{ color: "rgba(0,0,0,0.25)" }} />}
        value={filterText}
        onChange={(event) => onFilterTextChange(event.target.value)}
      />
      <Checkbox
        checked={onlyImportant}
        onChange={(event) => onOnlyImportantChange(event.target.checked)}
      >
        特别关注
      </Checkbox>
      <Tooltip title={outlineCollapsed ? "展开大纲" : "收起大纲"}>
        <Button
          type="text"
          size="small"
          icon={outlineCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={onToggleOutline}
        />
      </Tooltip>
    </div>
  );
}
