import { useState } from "react";
import { App } from "antd";

interface MemoEditorActions {
  loadFiles: () => Promise<void>;
  readFile: (filename: string) => Promise<string | null>;
  writeFile: (filename: string, content: string) => Promise<boolean>;
  renameFile: (oldFilename: string, newFilename: string) => Promise<boolean>;
  deleteFile: (filename: string) => Promise<boolean>;
  importFiles: () => Promise<string[]>;
  exportFile: (filename: string, format: "txt" | "docx") => Promise<boolean>;
}

export function useMemoEditorState(actions: MemoEditorActions) {
  const { message } = App.useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const handleSelectFile = async (filename: string): Promise<void> => {
    if (selected === filename) return;
    const nextContent = await actions.readFile(filename);
    if (nextContent === null) return;
    setSelected(filename);
    setContent(nextContent);
    setOriginalContent(nextContent);
    setIsEditing(false);
  };

  const handleSave = async (): Promise<void> => {
    if (!selected) return;
    if (!content.trim()) {
      message.warning("内容不能为空");
      return;
    }

    setSaving(true);
    const saved = await actions.writeFile(selected, content);
    if (saved) {
      setOriginalContent(content);
      setIsEditing(false);
      message.success("保存成功");
      void actions.loadFiles();
    }
    setSaving(false);
  };

  const handleCreate = async (): Promise<void> => {
    const name = newFileName.trim();
    if (!name) {
      message.warning("请输入文件名");
      return;
    }

    const filename = name.endsWith(".md") ? name : `${name}.md`;
    const initContent = `# ${name.replace(/\.md$/, "")}\n\n`;
    const created = await actions.writeFile(filename, initContent);
    if (!created) return;

    message.success("创建成功");
    setCreateModalOpen(false);
    setNewFileName("");
    await actions.loadFiles();
    setSelected(filename);
    setContent(initContent);
    setOriginalContent(initContent);
    setIsEditing(true);
  };

  const handleRename = async (
    oldFilename: string,
    name: string,
  ): Promise<boolean> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      message.warning("请输入文件名");
      return false;
    }

    const newFilename = trimmedName.endsWith(".md")
      ? trimmedName
      : `${trimmedName}.md`;
    if (oldFilename === newFilename) return true;

    const renamed = await actions.renameFile(oldFilename, newFilename);
    if (!renamed) return false;

    if (selected === oldFilename) setSelected(newFilename);
    message.success("重命名成功");
    await actions.loadFiles();
    return true;
  };

  const handleImport = async (): Promise<void> => {
    const importedFiles = await actions.importFiles();
    if (!importedFiles.length) return;
    message.success(`已导入 ${importedFiles.length} 个备忘文件`);
    await actions.loadFiles();
    await handleSelectFile(importedFiles[0]);
  };

  /** 导出当前选中的备忘（.txt / .docx）；未选中或用户取消保存对话框则静默 */
  const handleExport = async (format: "txt" | "docx"): Promise<void> => {
    if (!selected) {
      message.warning("请先选择要导出的备忘");
      return;
    }
    const saved = await actions.exportFile(selected, format);
    if (saved) message.success(`已导出为 ${format.toUpperCase()}`);
  };

  const handleDelete = async (filename: string): Promise<void> => {
    if (!(await actions.deleteFile(filename))) return;
    message.success("删除成功");
    if (selected === filename) {
      setSelected(null);
      setContent("");
      setOriginalContent("");
      setIsEditing(false);
    }
    void actions.loadFiles();
  };

  const handleTextAreaBlur = (): void => {
    if (!selected || content === originalContent) return;
    if (!content.trim()) {
      message.warning("内容不能为空");
      return;
    }
    void handleSave();
  };

  return {
    selected,
    content,
    originalContent,
    saving,
    isEditing,
    createModalOpen,
    newFileName,
    setContent,
    setIsEditing,
    setCreateModalOpen,
    setNewFileName,
    handleSelectFile,
    handleSave,
    handleCreate,
    handleRename,
    handleImport,
    handleExport,
    handleDelete,
    handleTextAreaBlur,
  };
}
