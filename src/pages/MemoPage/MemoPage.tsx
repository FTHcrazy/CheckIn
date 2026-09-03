import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Typography,
  Tooltip,
} from "antd";
import type { InputRef } from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FileMarkdownOutlined,
  SearchOutlined,
  CloseOutlined,
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

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchInputRef = useRef<InputRef>(null);

  // 将 Markdown 转为 HTML
  const renderedHtml = useMemo(() => {
    if (!originalContent) return "";
    return marked.parse(originalContent, { async: false }) as string;
  }, [originalContent]);

  const highlightedHtml = useMemo(() => {
    if (!activeSearchQuery) return renderedHtml;

    const escapedQuery = activeSearchQuery.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
    let matchIndex = 0;
    return renderedHtml.replace(
      />([^<]+)</g,
      (match, text: string) =>
        `>${text.replace(
          highlightPattern,
          (_fullMatch: string, found: string) => {
            const className =
              matchIndex++ === activeSearchIndex
                ? "memo-search-highlight memo-search-highlight--active"
                : "memo-search-highlight";
            return `<mark class="${className}">${found}</mark>`;
          },
        )}<`,
    );
  }, [activeSearchIndex, activeSearchQuery, renderedHtml]);

  const highlightedEditorHtml = useMemo(() => {
    if (!activeSearchQuery) return escapeHtml(content);

    const escapedQuery = activeSearchQuery.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
    let matchIndex = 0;
    return escapeHtml(content).replace(
      highlightPattern,
      (_fullMatch, found: string) => {
        const className =
          matchIndex++ === activeSearchIndex
            ? "memo-search-highlight memo-search-highlight--active"
            : "memo-search-highlight";
        return `<mark class="${className}">${found}</mark>`;
      },
    );
  }, [activeSearchIndex, activeSearchQuery, content]);

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
  }, [message]);

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
      setIsEditing(false); // 切换文件后保持预览态
    } catch (err) {
      message.error("读取文件失败");
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!selected) return;
    const trimmed = content.trim();
    if (!trimmed) {
      message.warning("内容不能为空");
      return;
    }
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
      setIsEditing(true); // 新建后直接进入编辑态
    } catch (err) {
      message.error("创建失败");
      console.error(err);
    }
  };

  const handleTextAreaBlur = () => {
    if (selected && content !== originalContent) {
      const trimmed = content.trim();
      if (!trimmed) {
        message.warning("内容不能为空");
        return;
      }
      void handleSave();
    }
  };

  const handleFind = () => {
    const query = searchQuery.trim();
    if (!query) return;
    const source = isEditing ? content : originalContent;
    const matches = source.match(
      new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    );
    if (!matches?.length) {
      message.info("未找到匹配内容");
      return;
    }

    const nextIndex =
      query === activeSearchQuery
        ? (activeSearchIndex + 1) % matches.length
        : 0;
    setActiveSearchQuery(query);
    setActiveSearchIndex(nextIndex);
  };

  useEffect(() => {
    if (!activeSearchQuery) return;
    requestAnimationFrame(() => {
      const activeMark = document.querySelector<HTMLElement>(
        ".memo-search-highlight--active",
      );
      if (!activeMark) return;

      const textArea = document.querySelector<HTMLTextAreaElement>(
        ".memo-editor-input-wrap textarea",
      );
      if (textArea && isEditing) {
        textArea.scrollTo({
          top: Math.max(0, activeMark.offsetTop - textArea.clientHeight / 2),
          behavior: "smooth",
        });
        return;
      }

      activeMark.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [activeSearchIndex, activeSearchQuery, isEditing]);

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

  const copyCode = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard.writeText(code);
        message.success("代码已复制");
      } catch (err) {
        message.error("复制失败");
        console.error(err);
      }
    },
    [message],
  );

  useEffect(() => {
    if (!document) return;

    const codeBlocks = document.querySelectorAll(".memo-preview pre code");
    codeBlocks.forEach((block) => {
      const code = block.textContent ?? "";
      const wrapper = block.parentElement;
      if (!wrapper || wrapper.querySelector(".memo-code-copy")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "memo-code-copy";
      button.textContent = "复制";
      button.addEventListener("click", () => {
        void copyCode(code);
      });

      wrapper.style.position = "relative";
      wrapper.appendChild(button);
    });

    return () => {
      document
        .querySelectorAll(".memo-code-copy")
        .forEach((node) => node.remove());
    };
  }, [copyCode, renderedHtml]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier || event.key.toLowerCase() !== "f") return;

      event.preventDefault();
      const activeElement = document.activeElement;
      const selectedText =
        activeElement instanceof HTMLTextAreaElement
          ? activeElement.value
              .slice(activeElement.selectionStart, activeElement.selectionEnd)
              .trim()
          : (window.getSelection()?.toString().trim() ?? "");
      setSearchQuery(selectedText);
      setSearchOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

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
              <Empty
                description="暂无备忘文件"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              files.map((item) => (
                <div
                  key={item.name}
                  className={`memo-list-item ${selected === item.name ? "memo-list-item--active" : ""}`}
                  onClick={() => void handleSelectFile(item.name)}
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
            <>
              <div className="memo-editor-toolbar">
                <div className="memo-editor-mode">
                  <Segmented
                    value={isEditing ? "edit" : "preview"}
                    onChange={(value) => setIsEditing(value === "edit")}
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
                      onClick={() => {
                        setSearchOpen((open) => !open);
                        setActiveSearchQuery("");
                        setActiveSearchIndex(0);
                      }}
                    />
                  </Tooltip>
                  {isEditing ? (
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
                  )}
                </Space>
              </div>

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
                className="memo-editor-card"
              >
                {isEditing ? (
                  <div className="memo-editor-input-wrap">
                    <div
                      className="memo-textarea-highlight"
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{
                        __html: highlightedEditorHtml || "&nbsp;",
                      }}
                    />
                    <TextArea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="在此编辑 Markdown 内容..."
                      spellCheck={false}
                      className="memo-textarea"
                      onScroll={(event) => {
                        const highlight =
                          event.currentTarget.parentElement?.querySelector<HTMLElement>(
                            ".memo-textarea-highlight",
                          );
                        if (highlight) {
                          highlight.scrollTop = event.currentTarget.scrollTop;
                          highlight.scrollLeft = event.currentTarget.scrollLeft;
                        }
                      }}
                      onPressEnter={(event) => {
                        if (!event.shiftKey) {
                          event.preventDefault();
                          void handleSave();
                        }
                      }}
                      onBlur={handleTextAreaBlur}
                    />
                  </div>
                ) : (
                  <div
                    className="memo-preview"
                    dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                  />
                )}
              </Card>
            </>
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
