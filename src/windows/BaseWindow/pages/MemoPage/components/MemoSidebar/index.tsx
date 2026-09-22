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
  FileZipOutlined,
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
  onImportBackup: () => void;
  onExport: (format: "txt" | "docx" | "backup") => void;
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
  onImportBackup,
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
    {
      key: "backup",
      label: (
        <Space size={6}>
          <FileZipOutlined /> 备份包（zip，全部备忘）
        </Space>
      ),
    },
  ];

  const importItems = [
    {
      key: "file",
      label: (
        <Space size={6}>
          <ImportOutlined /> 导入文件（MD / TXT / DOCX）
        </Space>
      ),
    },
    {
      key: "backup",
      label: (
        <Space size={6}>
          <FileZipOutlined /> 导入备份包（zip）
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
          <Dropdown
            menu={{
              items: importItems,
              onClick: ({ key }) => {
                if (key === "backup") onImportBackup();
                else onImport();
              },
            }}
          >
            <Tooltip title="导入（文件 / 备份包）">
              <Button type="text" size="small" icon={<ImportOutlined />} />
            </Tooltip>
          </Dropdown>
          <Dropdown
            menu={{
              items: exportItems,
              onClick: ({ key }) => {
                if (key === "docx") onExport("docx");
                else if (key === "backup") onExport("backup");
                else onExport("txt");
              },
            }}
          >
            <Tooltip title="导出（TXT / DOCX / 备份包）">
              <Button type="text" size="small" icon={<ExportOutlined />} />
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
