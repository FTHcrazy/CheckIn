import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import type { MemoFile } from "../types";

export function useMemoData() {
  const { message } = App.useApp();
  const [files, setFiles] = useState<MemoFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadFiles = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await window.electronAPI?.memo.list();
      setFiles(list ?? []);
    } catch (error) {
      message.error("加载文件列表失败");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const readFile = async (filename: string): Promise<string | null> => {
    try {
      return (await window.electronAPI?.memo.read(filename)) ?? null;
    } catch (error) {
      message.error("读取文件失败");
      console.error(error);
      return null;
    }
  };

  const writeFile = async (filename: string, content: string): Promise<boolean> => {
    try {
      return (await window.electronAPI?.memo.write(filename, content)) ?? false;
    } catch (error) {
      message.error("保存文件失败");
      console.error(error);
      return false;
    }
  };

  const deleteFile = async (filename: string): Promise<boolean> => {
    try {
      return (await window.electronAPI?.memo.delete(filename)) ?? false;
    } catch (error) {
      message.error("删除失败");
      console.error(error);
      return false;
    }
  };

  const importFiles = async (): Promise<string[]> => {
    setImporting(true);
    try {
      return (await window.electronAPI?.memo.import()) ?? [];
    } catch (error) {
      message.error("导入失败");
      console.error(error);
      return [];
    } finally {
      setImporting(false);
    }
  };

  const openInExplorer = async (filename: string): Promise<void> => {
    try {
      await window.electronAPI?.memo.openInExplorer(filename);
    } catch (error) {
      message.error("打开失败");
      console.error(error);
    }
  };

  return {
    files,
    loading,
    importing,
    loadFiles,
    readFile,
    writeFile,
    deleteFile,
    importFiles,
    openInExplorer,
  };
}
