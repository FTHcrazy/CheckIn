import { Button, Input, Segmented, Space, Tooltip } from "antd";
import type { InputRef } from "antd";
import {
  CloseOutlined,
  EditOutlined,
  FileMarkdownOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { RefObject } from "react";

interface MemoHeaderProps {
  selected: string;
  isEditing: boolean;
  searchOpen: boolean;
  searchQuery: string;
  saving: boolean;
  searchInputRef: RefObject<InputRef | null>;
  onModeChange: (isEditing: boolean) => void;
  onSearchQueryChange: (query: string) => void;
  onFind: () => void;
  onToggleSearch: () => void;
  onSave: () => void;
}

export default function MemoHeader({
  isEditing,
  searchOpen,
  searchQuery,
  saving,
  searchInputRef,
  onModeChange,
  onSearchQueryChange,
  onFind,
  onToggleSearch,
  onSave,
}: MemoHeaderProps) {
  return (
    <div className="memo-editor-toolbar">
      <div className="memo-editor-mode">
        <Segmented
          value={isEditing ? "edit" : "preview"}
          onChange={(value) => onModeChange(value === "edit")}
          options={[
            { label: "预览", value: "preview" },
            { label: "编辑", value: "edit" },
          ]}
        />
      </div>

      <Space>
        {searchOpen && (
          <Input
            ref={searchInputRef}
            value={searchQuery}
            prefix={<SearchOutlined />}
            placeholder="搜索内容"
            allowClear
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onPressEnter={onFind}
            style={{ width: 220 }}
          />
        )}
        <Tooltip title={searchOpen ? "关闭搜索" : "搜索（Ctrl + F）"}>
          <Button
            type={searchOpen ? "primary" : "text"}
            icon={searchOpen ? <CloseOutlined /> : <SearchOutlined />}
            onClick={onToggleSearch}
          />
        </Tooltip>
        {isEditing ? (
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={onSave}
          >
            保存
          </Button>
        ) : (
          <Button icon={<EditOutlined />} onClick={() => onModeChange(true)}>
            编辑
          </Button>
        )}
      </Space>
    </div>
  );
}

export function MemoCardTitle({
  selected,
  isEditing,
}: {
  selected: string;
  isEditing: boolean;
}) {
  return (
    <Space>
      <FileMarkdownOutlined />
      <span>{selected}</span>
      {isEditing && <span className="memo-editing-label">(编辑中)</span>}
    </Space>
  );
}
