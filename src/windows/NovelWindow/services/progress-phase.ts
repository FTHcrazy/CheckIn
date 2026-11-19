/**
 * 窗口级进度阶段契约（D-13）
 *
 * 书架导入（useBookImport）与编辑器导出（useNovelPage）分属两个 page，
 * 按 AGENTS §2.2.3「页面之间无直接依赖」互不导入；但两者的 phase 文案必须
 * 同源，否则「正在整理目录」与「正在排版正文」会被用户当成两个功能。
 * 故把契约下沉到窗口级 services，两个 page 都向下依赖它。
 *
 * `import-service.ts` 会 re-export 本模块，保持「phase 从导入 service 导出」
 * 的既有口径与测试落点不变。
 */

/**
 * 进度阶段 → 中文文案。
 *
 * 索引签名保留 `string`：worker 上报的 phase 是运行期字符串，消费侧仍需
 * `?? 兜底`，与抽出前 useBookImport 的行为逐字一致。
 */
export const PHASE_TEXT: Record<string, string> = {
  // 导入阶段（书架 useBookImport 消费）
  decode: "正在识别编码…",
  parse: "正在拆分章节…",
  finalize: "正在整理目录…",
  // 导出阶段（D-13，编辑器 useNovelPage 消费）
  idle: "",
  collecting: "正在收集章节…",
  formatting: "正在排版正文…",
  writing: "正在写入文件…",
  done: "导出完成",
  cancelled: "已取消导出",
};

/** 导出阶段（D-13：与导入 PHASE_TEXT 同源，文案不内联） */
export type ExportPhase =
  | "idle"
  | "collecting"
  | "formatting"
  | "writing"
  | "done"
  | "cancelled";

/** 导出进行中态：给入口按钮做 loading / 阶段文案 */
export interface ExportProgress {
  exporting: boolean;
  phase: ExportPhase;
  /** 0~1；-1 表示空闲（与导入 ratio 同口径） */
  ratio: number;
  /** 由 PHASE_TEXT 映射，不内联硬编码 */
  label: string;
}

/** 导出空闲态的常量（避免每个调用点重复写对象字面量） */
export const IDLE_EXPORT_PROGRESS: ExportProgress = {
  exporting: false,
  phase: "idle",
  ratio: -1,
  label: "",
};

/** 导出阶段 → 文案（唯一映射入口） */
export function exportPhaseText(phase: ExportPhase): string {
  return PHASE_TEXT[phase] ?? "";
}
