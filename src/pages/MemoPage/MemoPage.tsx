import { useEffect, useState, useCallback, useMemo } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Typography,
  Tooltip,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FileMarkdownOutlined,
} from "@ant-design/icons";
import { marked } from "marked";
import dayjs from "dayjs";
import Page from "../../components/Page";
import "./index.scss";

const { TextArea } = Input;
const { Text, Title } = Typography;

interface MemoFile {
  name: string;
  updatedAt: string;
}

function MemoPage() {
  const { message } = App.useApp();
  const [files, setFiles] = useState<MemoFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  // 将 Markdown 转为 HTML
  const renderedHtml = useMemo(() => {
    if (!originalContent) return "";
    return marked.parse(originalContent, { async: false }) as string;
  }, [originalContent]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.electronAPI?.memo.list();
      setFiles(list ?? []);
    } catch (err) {
      message.error("加载文件列表失败");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleSelectFile = async (filename: string) => {
    if (selected === filename) return;
    try {
      const data = await window.electronAPI?.memo.read(filename);
      setSelected(filename);
      setContent(data ?? "");
      setOriginalContent(data ?? "");
      setIsEditing(false); // 切换到预览模式
    } catch (err) {
      message.error("读取文件失败");
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await window.electronAPI?.memo.write(selected, content);
      setOriginalContent(content);
      setIsEditing(false); // 保存后切换回预览模式
      message.success("保存成功");
      void loadFiles();
    } catch (err) {
      message.error("保存失败");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const name = newFileName.trim();
    if (!name) {
      message.warning("请输入文件名");
      return;
    }
    const filename = name.endsWith(".md") ? name : `${name}.md`;
    const initContent = `# ${name.replace(/\.md$/, "")}\n\n`;
    try {
      await window.electronAPI?.memo.write(filename, initContent);
      message.success("创建成功");
      setCreateModalOpen(false);
      setNewFileName("");
      await loadFiles();
      // 直接设置状态，避免 handleSelectFile 因 selected 相同而跳过
      setSelected(filename);
      setContent(initContent);
      setOriginalContent(initContent);
      setIsEditing(true); // 新建后直接进入编辑模式
    } catch (err) {
      message.error("创建失败");
      console.error(err);
    }
  };

  const handleDelete = async (filename: string) => {
    try {
      await window.electronAPI?.memo.delete(filename);
      message.success("删除成功");
      if (selected === filename) {
        setSelected(null);
        setContent("");
        setOriginalContent("");
      }
      void loadFiles();
    } catch (err) {
      message.error("删除失败");
      console.error(err);
    }
  };

  const handleOpenInExplorer = async (filename: string) => {
    try {
      await window.electronAPI?.memo.openInExplorer(filename);
    } catch (err) {
      message.error("打开失败");
      console.error(err);
    }
  };

  return (
    <Page>
      <div className="memo-page">
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
              onClick={() => setCreateModalOpen(true)}
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
              <Empty description="暂无备忘文件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              files.map((item) => (
                <div
                  key={item.name}
                  className={`memo-list-item ${selected === item.name ? "memo-list-item--active" : ""}`}
                  onClick={() => void handleSelectFile(item.name)}
                >
                  <div className="memo-list-item-content">
                    <div className="memo-list-item-icon">
                      <FileMarkdownOutlined style={{ fontSize: 20, color: "#1677ff" }} />
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
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleOpenInExplorer(item.name);
                          }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="确定删除此文件？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          void handleDelete(item.name);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="memo-editor">
          {selected ? (
            <Card
              title={
                <Space>
                  <FileMarkdownOutlined />
                  <span>{selected}</span>
                  {isEditing && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      (编辑中)
                    </Text>
                  )}
                </Space>
              }
              extra={
                isEditing ? (
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saving}
                    onClick={() => void handleSave()}
                  >
                    保存
                  </Button>
                ) : (
                  <Button
                    icon={<EditOutlined />}
                    onClick={() => setIsEditing(true)}
                  >
                    编辑
                  </Button>
                )
              }
              className="memo-editor-card"
            >
              {isEditing ? (
                <TextArea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="在此编辑 Markdown 内容..."
                  autoSize={{ minRows: 20 }}
                  spellCheck={false}
                  className="memo-textarea"
                />
              ) : (
                <div
                  className="memo-preview"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              )}
            </Card>
          ) : (
            <div className="memo-editor-empty">
              <Empty description="选择左侧文件或新建一个备忘" />
            </div>
          )}
        </div>
      </div>

      <Modal
        title="新建备忘文件"
        open={createModalOpen}
        destroyOnHidden
        onOk={() => void handleCreate()}
        onCancel={() => {
          setCreateModalOpen(false);
          setNewFileName("");
        }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="输入文件名（自动添加 .md 后缀）"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          onPressEnter={() => void handleCreate()}
          autoFocus
        />
      </Modal>
    </Page>
  );
}

export default MemoPage;
