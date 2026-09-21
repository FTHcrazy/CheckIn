/**
 * 数据迁移页面业务逻辑：勾选范围 + 导出/导入执行与结果反馈
 *
 * 只负责状态编排与文案组织，具体 IPC 调用下沉到 services/migration-service.ts。
 */
import { useCallback, useState } from "react";
import type { MigrationScope } from "@/shared/types/electron";
import {
  describeExportResult,
  describeImportResult,
  exportMigration,
  importMigration,
  type MigrationFeedback,
} from "../services/migration-service";

export type { MigrationFeedback };

/** 默认全选：迁移通常是一次性全量备份 */
const DEFAULT_SCOPES: MigrationScope[] = ["todo", "memo"];

export function useMigration() {
  const [scopes, setScopes] = useState<MigrationScope[]>(DEFAULT_SCOPES);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState<MigrationFeedback | null>(null);

  const toggleScope = useCallback((scope: MigrationScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope],
    );
  }, []);

  const runExport = useCallback(async () => {
    if (scopes.length === 0) {
      setFeedback({ type: "error", text: "请至少勾选一项要导出的数据" });
      return;
    }
    setExporting(true);
    setFeedback(null);
    try {
      setFeedback(describeExportResult(await exportMigration(scopes)));
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "导出失败" });
    } finally {
      setExporting(false);
    }
  }, [scopes]);

  const runImport = useCallback(async () => {
    setImporting(true);
    setFeedback(null);
    try {
      setFeedback(describeImportResult(await importMigration()));
    } catch (err) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "导入失败" });
    } finally {
      setImporting(false);
    }
  }, []);

  return {
    scopes,
    toggleScope,
    exporting,
    importing,
    feedback,
    busy: exporting || importing,
    runExport,
    runImport,
  };
}
