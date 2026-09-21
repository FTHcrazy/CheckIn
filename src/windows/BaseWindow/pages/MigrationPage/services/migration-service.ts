/**
 * 数据迁移 service：封装迁移 IPC（导出 zip / 导入 zip）
 *
 * 页面与组件不直接触碰 window.electronAPI，统一走这里拿语义化 API。
 */
import type {
  MigrationExportResult,
  MigrationImportResult,
  MigrationScope,
} from "@/shared/types/electron";

/** 非 Electron 环境（如单测/浏览器预览）下给出可读提示，避免 undefined 调用 */
function getMigrationApi() {
  const api = window.electronAPI?.migration;
  if (!api) throw new Error("当前环境不支持数据迁移，请在客户端中使用");
  return api;
}

/** 按勾选范围导出 zip；用户在保存框取消时返回 canceled: true */
export function exportMigration(scopes: MigrationScope[]): Promise<MigrationExportResult> {
  return getMigrationApi().export(scopes);
}

/** 选择 zip 并导入到本地（追加合并）；用户取消时返回 canceled: true */
export function importMigration(): Promise<MigrationImportResult> {
  return getMigrationApi().import();
}

/** 结果反馈：成功 / 中性提示（用户取消）/ 错误 */
export interface MigrationFeedback {
  type: "success" | "error" | "info";
  text: string;
}

/** 导出结果 → 结果反馈（含落盘路径，便于用户找到备份包；取消为中性提示） */
export function describeExportResult(result: MigrationExportResult): MigrationFeedback {
  if (result.canceled) return { type: "info", text: "已取消导出" };
  const detail = `已导出 ${result.counts.todo} 条待办、${result.counts.memo} 篇备忘`;
  return {
    type: "success",
    text: result.filePath ? `${detail}，文件：${result.filePath}` : detail,
  };
}

/** 导入结果 → 结果反馈（跳过条目一并提示；取消为中性提示） */
export function describeImportResult(result: MigrationImportResult): MigrationFeedback {
  if (result.canceled) return { type: "info", text: "已取消导入" };
  const detail = `已导入 ${result.counts.todo} 条待办、${result.counts.memo} 篇备忘`;
  return {
    type: "success",
    text:
      result.skipped.length > 0 ? `${detail}，跳过 ${result.skipped.length} 个异常条目` : detail,
  };
}
