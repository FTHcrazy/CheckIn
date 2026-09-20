import {
  Button,
  Dropdown,
  Empty,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
  ExportOutlined,
  FileTextOutlined,
  FileWordOutlined,
  ImportOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import MemoListItem from "../MemoListItem";
import type { MemoFile } from "../../types";
import "./index.scss";

const { Text, Title } = Typography;

interface MemoSidebarProps {
  files: MemoFile[];
  selected: string | null;
  loading: boolean;
  onCreate: () => void;
  onImport: () => void;
  onExport: (format: "txt" | "docx") => void;
  onRefresh: () => void;
  onSelect: (filename: string) => void;
  onRename: (filename: string, name: string) => Promise<boolean>;
  onDelete: (filename: string) => void;
  onOpenInExplorer: (filename: string) => void;
}

export default function MemoSidebar({
  files,
  selected,
  loading,
  onCreate,
  onImport,
  onExport,
  onRefresh,
  onSelect,
  onRename,
  onDelete,
  onOpenInExplorer,
}: MemoSidebarProps) {
  const exportItems = [
    {
      key: "txt",
      label: (
        <Space size={6}>
          <FileTextOutlined /> 导出为 TXT
        </Space>
      ),
    },
    {
      key: "docx",
      label: (
        <Space size={6}>
          <FileWordOutlined /> 导出为 DOCX
        </Space>
      ),
    },
  ];

  return (
    <div className="memo-sidebar">
      <div className="memo-sidebar-header">
        <Space>
          <Title level={5} style={{ margin: 0 }}>
            备忘列表
          </Title>
          <Text type="secondary">({files.length})</Text>
        </Space>
        <Space size={4}>
          <Tooltip title="导入文件（Markdown / TXT / DOCX）">
            <Button
              type="text"
              size="small"
              icon={<ImportOutlined />}
              onClick={onImport}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: exportItems,
              onClick: ({ key }) =>
                onExport(key === "docx" ? "docx" : "txt"),
            }}
            disabled={!selected}
          >
            <Tooltip title={selected ? "导出当前备忘" : "先选择要导出的备忘"}>
              <Button
                type="text"
                size="small"
                icon={<ExportOutlined />}
                disabled={!selected}
              />
            </Tooltip>
          </Dropdown>
          <Tooltip title="刷新列表">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={loading} />}
              onClick={onRefresh}
              disabled={loading}
            />
          </Tooltip>
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={onCreate}
          >
            新建
          </Button>
        </Space>
      </div>
      <div className="memo-sidebar-list">
        {loading ? (
          <div className="memo-sidebar-loading">
            <Spin size="small" />
          </div>
        ) : files.length === 0 ? (
          <Empty
            description="暂无备忘文件"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Virtuoso
            className="memo-sidebar-virtuoso"
            style={{ height: "100%" }}
            data={files}
            overscan={10}
            itemContent={(_, item) => (
              <MemoListItem
                key={item.name}
                item={item}
                selected={selected}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                onOpenInExplorer={onOpenInExplorer}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
