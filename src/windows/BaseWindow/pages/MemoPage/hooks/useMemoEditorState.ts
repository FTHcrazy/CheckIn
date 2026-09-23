import { useEffect } from "react";
import { App } from "antd";
import {
  memoActions,
  registerMemoRunner,
  useMemoStore,
} from "../store/useMemoStore";

interface MemoEditorActions {
  loadFiles: () => Promise<void>;
  readFile: (filename: string) => Promise<string | null>;
  writeFile: (filename: string, content: string) => Promise<boolean>;
  renameFile: (oldFilename: string, newFilename: string) => Promise<boolean>;
  deleteFile: (filename: string) => Promise<boolean>;
  importFiles: () => Promise<string[]>;
  exportFile: (filename: string, format: "txt" | "docx") => Promise<boolean>;
}

/**
 * 备忘编辑状态编排层
 *
 * 状态本体已搬到 `store/useMemoStore`：正文草稿由 `MemoEditor` 自己订阅、
 * 原文由 `MemoPreview` 自己订阅，本 Hook **不订阅正文**——于是敲一个字
 * 不再把页面根连同侧栏虚拟列表一起推一遍。
 *
 * 这里只做两件事：
 * 1. 把文件读写与 toast 注册给 store（注册不触发任何请求）
 * 2. 订阅页面根真正需要的低频切片：选中文件 / 编辑态 / 弹窗 / 保存中
 */
export function useMemoEditorState(actions: MemoEditorActions) {
  const { message } = App.useApp();

  const {
    loadFiles,
    readFile,
    writeFile,
    renameFile,
    deleteFile,
    importFiles,
    exportFile,
  } = actions;

  useEffect(() => {
    registerMemoRunner({
      loadFiles,
      readFile,
      writeFile,
      renameFile,
      deleteFile,
      importFiles,
      exportFile,
      notify: (level, text) => {
        if (level === "success") message.success(text);
        else if (level === "warning") message.warning(text);
        else message.info(text);
      },
    });
    return () => registerMemoRunner(null);
  }, [
    loadFiles,
    readFile,
    writeFile,
    renameFile,
    deleteFile,
    importFiles,
    exportFile,
    message,
  ]);

  const selected = useMemoStore((state) => state.selected);
  const isEditing = useMemoStore((state) => state.isEditing);
  const createModalOpen = useMemoStore((state) => state.createModalOpen);
  const newFileName = useMemoStore((state) => state.newFileName);
  const saving = useMemoStore((state) => state.saving);

  return {
    selected,
    isEditing,
    createModalOpen,
    newFileName,
    saving,
    // 动作身份恒定，可安全透传
    handleSelectFile: memoActions.selectFile,
    setContent: memoActions.setContent,
    handleSave: memoActions.save,
    handleCreate: memoActions.create,
    handleRename: memoActions.rename,
    handleImport: memoActions.importFiles,
    handleExport: memoActions.exportFile,
    handleDelete: memoActions.remove,
    handleTextAreaBlur: memoActions.saveOnBlur,
    setIsEditing: memoActions.setIsEditing,
    setCreateModalOpen: memoActions.setCreateModalOpen,
    setNewFileName: memoActions.setNewFileName,
  };
}
