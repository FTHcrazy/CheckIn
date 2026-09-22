import { useCallback, useEffect, useState } from "react";
import { App } from "antd";
import type { MemoFile } from "../types";

export function useMemoData() {
  const { message, modal } = App.useApp();
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

  const renameFile = async (
    oldFilename: string,
    newFilename: string,
  ): Promise<boolean> => {
    try {
      return (await window.electronAPI?.memo.rename(oldFilename, newFilename)) ?? false;
    } catch (error) {
      message.error("重命名失败");
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

  /** 导出当前备忘为 .txt / .docx（保存位置由主进程保存对话框决定） */
  const exportFile = async (
    filename: string,
    format: "txt" | "docx",
  ): Promise<boolean> => {
    try {
      return (await window.electronAPI?.memo.exportFile(filename, format)) ?? false;
    } catch (error) {
      message.error("导出失败");
      console.error(error);
      return false;
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

  /** 备份导出：全部备忘打包 zip（manifest + memos/*.md，主进程弹保存框） */
  const exportBackup = useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI?.memo.exportBackup();
      if (!result || result.canceled) {
        message.info("已取消导出");
        return;
      }
      message.success(
        result.filePath
          ? `已导出 ${result.count} 篇备忘，文件：${result.filePath}`
          : `已导出 ${result.count} 篇备忘`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
      console.error(error);
    }
  }, [message]);

  /** 备份导入：确认后选 zip 追加合并（重名自动改写序号，不覆盖已有备忘），完成后刷新列表 */
  const importBackup = useCallback(async (): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        const result = await window.electronAPI?.memo.importBackup();
        if (!result || result.canceled) {
          message.info("已取消导入");
          return;
        }
        message.success(
          result.skipped.length > 0
            ? `已导入 ${result.count} 篇备忘，跳过 ${result.skipped.length} 个异常条目`
            : `已导入 ${result.count} 篇备忘`,
        );
        void loadFiles();
      } catch (error) {
        message.error(error instanceof Error ? error.message : "导入失败");
        console.error(error);
      }
    };

    modal.confirm({
      title: "导入备忘备份包？",
      content: "导入为追加合并：包内备忘会写入 memos 目录，重名自动追加序号，不会覆盖或删除现有备忘。",
      okText: "选择文件导入",
      cancelText: "取消",
      onOk: () => run(),
    });
  }, [loadFiles, message, modal]);

  return {
    files,
    loading,
    importing,
    loadFiles,
    readFile,
    writeFile,
    renameFile,
    deleteFile,
    importFiles,
    exportFile,
    openInExplorer,
    exportBackup,
    importBackup,
  };
}
