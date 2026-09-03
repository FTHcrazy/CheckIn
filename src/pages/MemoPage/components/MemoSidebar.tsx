import {
  Button,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  FileMarkdownOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

const { Text, Title } = Typography;

export interface MemoFile {
  name: string;
  updatedAt: string;
}

interface MemoSidebarProps {
  files: MemoFile[];
  selected: string | null;
  loading: boolean;
  onCreate: () => void;
  onSelect: (filename: string) => void;
  onDelete: (filename: string) => void;
  onOpenInExplorer: (filename: string) => void;
}

export default function MemoSidebar({
  files,
  selected,
  loading,
  onCreate,
  onSelect,
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
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          onClick={onCreate}
        >
          新建
        </Button>
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
          files.map((item) => (
            <div
              key={item.name}
              className={`memo-list-item ${selected === item.name ? "memo-list-item--active" : ""}`}
              onClick={() => onSelect(item.name)}
            >
              <div className="memo-list-item-content">
                <div className="memo-list-item-icon">
                  <FileMarkdownOutlined
                    style={{ fontSize: 20, color: "#1677ff" }}
                  />
                </div>
                <div className="memo-list-item-info">
                  <Text ellipsis className="memo-list-item-title">
                    {item.name.replace(/\.md$/, "")}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(item.updatedAt).format("MM-DD HH:mm")}
                  </Text>
                </div>
                <div className="memo-list-item-actions">
                  <Tooltip title="在文件夹中显示">
                    <Button
                      type="text"
                      size="small"
                      icon={<FolderOpenOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenInExplorer(item.name);
                      }}
                    />
                  </Tooltip>
                  <Popconfirm
                    title="确定删除此文件？"
                    onConfirm={(event) => {
                      event?.stopPropagation();
                      onDelete(item.name);
                    }}
                    onCancel={(event) => event?.stopPropagation()}
                  >
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
