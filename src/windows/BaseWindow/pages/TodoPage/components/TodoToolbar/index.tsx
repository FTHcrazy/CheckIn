import { Button, Checkbox, Input, Tooltip } from "antd";
import { useState } from "react";
import {
  DownloadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useImeGuard } from "../../hooks/useImeGuard";
import "./index.scss";

interface TodoToolbarProps {
  filterText: string;
  onlyImportant: boolean;
  outlineCollapsed: boolean;
  onFilterTextChange: (value: string) => void;
  onOnlyImportantChange: (value: boolean) => void;
  onAdd: (content: string) => Promise<boolean>;
  onToggleOutline: () => void;
  onExportBackup: () => Promise<void>;
  onImportBackup: () => Promise<void>;
}

export default function TodoToolbar({
  filterText,
  onlyImportant,
  outlineCollapsed,
  onFilterTextChange,
  onOnlyImportantChange,
  onAdd,
  onToggleOutline,
  onExportBackup,
  onImportBackup,
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
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => void handleAdd()}
      >
        添加
      </Button>
      <span className="todo-toolbar__divider" />
      <Input
        className="todo-toolbar__search"
        placeholder="搜索"
        allowClear
        prefix={
          <SearchOutlined style={{ color: "var(--app-text-disabled)" }} />
        }
        value={filterText}
        onChange={(event) => onFilterTextChange(event.target.value)}
      />
      <Checkbox
        checked={onlyImportant}
        onChange={(event) => onOnlyImportantChange(event.target.checked)}
      >
        特别关注
      </Checkbox>
      <Tooltip title="导出全部待办为备份包（zip）">
        <Button
          type="text"
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => void onExportBackup()}
        />
      </Tooltip>
      <Tooltip title="从备份包导入待办（追加合并，不覆盖现有数据）">
        <Button
          type="text"
          size="small"
          icon={<UploadOutlined />}
          onClick={() => void onImportBackup()}
        />
      </Tooltip>
      <Tooltip title={outlineCollapsed ? "展开大纲" : "收起大纲"}>
        <Button
          type="text"
          size="small"
          icon={
            outlineCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
          }
          onClick={onToggleOutline}
        />
      </Tooltip>
    </div>
  );
}
