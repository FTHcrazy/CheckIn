import {
  Button,
  Empty,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
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
  onRefresh,
  onSelect,
  onRename,
  onDelete,
  onOpenInExplorer,
}: MemoSidebarProps) {
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
          <Tooltip title="导入 Markdown 文件">
            <Button
              type="text"
              size="small"
              icon={<ImportOutlined />}
              onClick={onImport}
            />
          </Tooltip>
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
