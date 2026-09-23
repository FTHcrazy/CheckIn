import { Button, Input, Segmented, Space, Tooltip } from "antd";
import {
  CloseOutlined,
  EditOutlined,
  FileMarkdownOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useCallback } from "react";
import { useMemoViewState } from "../../hooks/useMemoViewState";
import { memoActions } from "../../store/useMemoStore";
import "./index.scss";

interface MemoHeaderProps {
  isEditing: boolean;
  saving: boolean;
  onSave: () => void;
}

/**
 * 备忘头部（模式切换 + 搜索 + 保存）
 *
 * 搜索态由本组件自己调用 `useMemoViewState` 订阅：搜索框每敲一个字都在变，
 * 若由页面根持有再透传，输入过程中侧栏与预览都会被一起推着重渲染。
 */
export default function MemoHeader({
  isEditing,
  saving,
  onSave,
}: MemoHeaderProps) {
  const {
    searchOpen,
    searchQuery,
    searchInputRef,
    setSearchQuery,
    setSearchOpen,
    closeSearch,
    handleFind,
  } = useMemoViewState();

  const toggleSearch = useCallback(() => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  }, [searchOpen, closeSearch, setSearchOpen]);

  const onModeChange = useCallback((editing: boolean) => {
    memoActions.setIsEditing(editing);
  }, []);

  return (
    <div className="memo-editor-toolbar">
      <div className="memo-editor-mode">
        <Segmented
          value={isEditing ? "edit" : "preview"}
          onChange={(value) => onModeChange(String(value) === "edit")}
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
            onChange={(event) => setSearchQuery(event.target.value)}
            onPressEnter={handleFind}
            style={{ width: 220 }}
          />
        )}
        <Tooltip title={searchOpen ? "关闭搜索" : "搜索（Ctrl + F）"}>
          <Button
            type={searchOpen ? "primary" : "text"}
            icon={searchOpen ? <CloseOutlined /> : <SearchOutlined />}
            onClick={toggleSearch}
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
