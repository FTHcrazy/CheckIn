import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { App } from "antd";
import type { InputRef } from "antd";
import { marked } from "marked";
import type { MemoFile } from "../components/MemoSidebar";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** 高亮文本中的搜索匹配（保留 activeSearchIndex 位置为激活态） */
function highlightText(
  source: string,
  query: string,
  activeIndex: number,
  escapeFirst: boolean,
): string {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
  let matchIndex = 0;
  const text = escapeFirst ? escapeHtml(source) : source;
  return text.replace(highlightPattern, (_fullMatch: string, found: string) => {
    const className =
      matchIndex++ === activeIndex
        ? "memo-search-highlight memo-search-highlight--active"
        : "memo-search-highlight";
    return `<mark class="${className}">${found}</mark>`;
  });
}

/** MemoPage 业务逻辑：备忘文件 CRUD、搜索高亮与编辑态编排 */
export function useMemoPage() {
  const { message } = App.useApp();
  const [files, setFiles] = useState<MemoFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
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

    // 仅高亮 HTML 标签之间的文本内容
    const escapedQuery = activeSearchQuery.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
    let matchIndex = 0;
    return renderedHtml.replace(
      />([^<]+)</g,
      (_match, text: string) =>
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

  const highlightedEditorHtml = useMemo(
    () => highlightText(content, activeSearchQuery, activeSearchIndex, true),
    [activeSearchIndex, activeSearchQuery, content],
  );

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

  const handleImport = async () => {
    try {
      const importedFiles = await window.electronAPI?.memo.import();
      if (!importedFiles?.length) return;

      setImporting(true);
      message.success(`已导入 ${importedFiles.length} 个备忘文件`);
      await loadFiles();
      await handleSelectFile(importedFiles[0]);
    } catch (err) {
      message.error("导入失败");
      console.error(err);
    } finally {
      setImporting(false);
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
          behavior: "instant",
        });
        return;
      }

      activeMark.scrollIntoView({ behavior: "instant", block: "center" });
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

  return {
    // 数据与状态
    files,
    selected,
    content,
    loading,
    importing,
    saving,
    isEditing,
    searchOpen,
    searchQuery,
    createModalOpen,
    newFileName,
    searchInputRef,
    highlightedHtml,
    highlightedEditorHtml,
    // 派发器
    setIsEditing,
    setSearchQuery,
    setSearchOpen,
    setCreateModalOpen,
    setNewFileName,
    setContent,
    setActiveSearchQuery,
    setActiveSearchIndex,
    // 业务动作
    loadFiles,
    handleSelectFile,
    handleSave,
    handleCreate,
    handleImport,
    handleTextAreaBlur,
    handleFind,
    handleDelete,
    handleOpenInExplorer,
    copyCode,
  };
}
