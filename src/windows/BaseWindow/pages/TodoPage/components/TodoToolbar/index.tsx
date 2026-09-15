import { Button, Checkbox, Input, Tooltip } from "antd";
import { useState } from "react";
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useImeGuard } from "../../hooks/useImeGuard";

interface TodoToolbarProps {
  filterText: string;
  onlyImportant: boolean;
  outlineCollapsed: boolean;
  onFilterTextChange: (value: string) => void;
  onOnlyImportantChange: (value: boolean) => void;
  onAdd: (content: string) => Promise<boolean>;
  onToggleOutline: () => void;
}

export default function TodoToolbar({
  filterText,
  onlyImportant,
  outlineCollapsed,
  onFilterTextChange,
  onOnlyImportantChange,
  onAdd,
  onToggleOutline,
}: TodoToolbarProps) {
  const [newContent, setNewContent] = useState("");
  const ime = useImeGuard();

  const handleAdd = async (): Promise<void> => {
    if (await onAdd(newContent)) setNewContent("");
  };

  return (
    <div className="todo-toolbar">
      <Input
        className="todo-toolbar__input"
        placeholder="输入新任务，回车添加；后缀加 #2h 记录工时"
        value={newContent}
        onChange={(event) => setNewContent(event.target.value)}
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onPressEnter={(event) => {
          if (ime.isComposing(event)) return;
          void handleAdd();
        }}
        allowClear
        spellCheck={false}
      />
      <Button type="primary" icon={<PlusOutlined />} onClick={() => void handleAdd()}>
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
