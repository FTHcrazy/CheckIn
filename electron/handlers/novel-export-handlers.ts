/**
 * 导出 PNG 的两条主进程通道（R27 / S5）
 *
 * 为什么是两条而不是一条：
 * - `relation-window-export` 只负责「把窗口那一块取成 PNG 字节」，它需要窗口与
 *   矩形，语义是**取景**；
 * - `novel-export-binary` 只负责「弹保存框 + 按字节落盘」，语义是**存盘**。
 *
 * 分开的直接理由是**二进制写入必须是一条独立通道**：现成的 `novel-export-file`
 * 是 `fsp.writeFile(path, content, "utf8")`，用它写 PNG 会「不报错但图坏了」——
 * 这是最难查的一类 bug（用户拿到打不开的文件，日志里一切正常）。所以这里新建
 * 一条只收字节的通道，`writeFile` 调用**不带任何 encoding**。
 *
 * 截图为什么放在主进程：`capturePage` 只有主进程有。它截的就是用户眼前那一帧，
 * 所以不存在「屏幕上一套、导出另一套」的第二渲染器（RG-X-02 的历史红线）。
 * 代价是首帧可能为空（Electron 生态的已知抖动），必须「判空 + 重试 + 兜底提示」，
 * 否则用户会拿到一张全黑的图还以为是主题 bug。
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import fsp from "node:fs/promises";

/** 首帧为空时的重试次数（Electron 生态通行做法：每次前作废 + 再截） */
const CAPTURE_ATTEMPTS = 3;
/** 重试间隔：给合成器一次新的帧，太短会连拿三张同一帧的空图 */
const CAPTURE_RETRY_DELAY_MS = 90;
/**
 * 主动重绘后的等待时间。
 *
 * `capturePage` 返回的是**合成器已 present 的那一帧**，而渲染层刚把工具栏
 * display:none 掉 —— 两者之间可能差一帧，截出来就带着「导出」按钮和下拉菜单
 * （真机复现过）。`invalidate()` 让 Chromium 丢掉当前帧重绘，再等一小段
 * 走完 present，取到的才是抑制之后的画面。
 */
const CAPTURE_REPAINT_DELAY_MS = 50;
/**
 * 「空图」的字节下界。
 *
 * `isEmpty()` 只说明图像没有像素，但**纯色帧不是空图**——全黑/全白一样能编码出
 * 合法 PNG。一张 1200×800 的图哪怕极度单调也在几十 KB 量级，而 1×1 或损坏帧
 * 只有几百字节，所以这里用字节数兜第二道。
 */
const MIN_PNG_BYTES = 2_000;

interface CaptureRectInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CapturePngResult =
  | { ok: true; png: Uint8Array; width: number; height: number }
  | { ok: false; code: "empty" | "invalid" | "unavailable" | "db"; message: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 渲染层传来的矩形不可信（可能 NaN / 负数 / 巨大）：一律收敛成整数且至少 1×1 */
function normalizeRect(raw: unknown): CaptureRectInput | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const read = (key: string): number => {
    const number = Number(value[key]);
    return Number.isFinite(number) ? Math.max(Math.round(number), 0) : 0;
  };
  const rect = { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  if (rect.width < 1 || rect.height < 1) return null;
  return rect;
}

/**
 * 从 PNG 头读像素尺寸（IHDR 在固定偏移：宽 16..20、高 20..24，大端）。
 *
 * 不用 `nativeImage.getSize()`：它给的是 DIP 尺寸，像素还要再乘
 * `getScaleFactors()`，两个值在部分平台/缩放组合下并不可靠。而 IHDR 是
 * PNG 规范强制的第一块，读它同时完成了「这张图确实是 PNG」的校验。
 */
function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.byteLength < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

/** 单次取景：空图 / 坏图都返回 null，由调用方决定要不要重试 */
async function captureOnce(
  win: BrowserWindow,
  rect: CaptureRectInput,
): Promise<Buffer | null> {
  const image = await win.webContents.capturePage(rect);
  if (!image || image.isEmpty()) return null;
  const buffer = image.toPNG();
  if (buffer.byteLength < MIN_PNG_BYTES) return null;
  return buffer;
}

function toBuffer(data: unknown): Buffer | null {
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data));
  return null;
}

export function registerNovelExportHandlers(): void {
  // ── 取景：把窗口的某一块截成 PNG 字节 ───────────────────────────────
  ipcMain.handle(
    "relation-window-export",
    async (event, rawRect: unknown): Promise<CapturePngResult> => {
      const rect = normalizeRect(rawRect);
      if (!rect) {
        // 入参非法不是数据库问题（原实现误报 "db"，排查时会往库方向跑偏）
        return { ok: false, code: "invalid", message: "画布尺寸无效，请调整窗口后重试" };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || win.isDestroyed()) {
        return { ok: false, code: "unavailable", message: "窗口已关闭，无法导出" };
      }
      // 最小化时用户点不到窗口里的按钮，但快捷键 / 恢复后立刻点仍可能撞上；
      // 文档说 capturePage 期间页面被视为可见，这里再 restore 一次是零成本的兜底。
      if (win.isMinimized()) win.restore();

      let lastError: unknown = null;
      for (let attempt = 0; attempt < CAPTURE_ATTEMPTS; attempt += 1) {
        try {
          // 每次尝试都强制重绘一次：不能赌「渲染层那两帧已经 present 了」
          // （invalidate 在个别平台是 no-op，失败也不该让整次导出让路）
          try {
            win.webContents.invalidate();
          } catch {
            // 忽略：直接截，最多回到「上一帧」的老问题，不影响主流程
          }
          await delay(CAPTURE_REPAINT_DELAY_MS);
          const buffer = await captureOnce(win, rect);
          if (buffer) {
            const size = readPngSize(buffer);
            if (size) {
              return { ok: true, png: new Uint8Array(buffer), width: size.width, height: size.height };
            }
            lastError = new Error("PNG 头无效");
          }
        } catch (cause) {
          lastError = cause;
        }
        if (attempt < CAPTURE_ATTEMPTS - 1) await delay(CAPTURE_RETRY_DELAY_MS);
      }

      const detail = lastError instanceof Error ? `（${lastError.message}）` : "";
      return {
        ok: false,
        code: "empty",
        message: `导出失败，请将窗口置于前台后重试${detail}`,
      };
    },
  );

  // ── 存盘：只收字节，绝不按文本写 ──────────────────────────────────
  ipcMain.handle(
    "novel-export-binary",
    async (
      event,
      defaultName: string,
      data: unknown,
      ext = "png",
      filterName = "PNG 图片",
    ): Promise<{ path: string } | null> => {
      const buffer = toBuffer(data);
      // 空 buffer 不弹框：弹了也只会写出一个 0 字节文件
      if (!buffer || buffer.byteLength === 0) return null;

      const suffix = ext.replace(/^\./, "").toLowerCase() || "png";
      const safeName = String(defaultName ?? "")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
      const fallback = "导出";
      const base = safeName || fallback;
      const stem = base.toLowerCase().endsWith(`.${suffix}`)
        ? base.slice(0, -(suffix.length + 1))
        : base;

      const options = {
        title: `导出 ${suffix.toUpperCase()}`,
        defaultPath: `${stem || fallback}.${suffix}`,
        filters: [{ name: filterName, extensions: [suffix] }],
      };
      const win = BrowserWindow.fromWebContents(event.sender);
      const result =
        win && !win.isDestroyed()
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;

      // ⚠️ 不带 encoding：带了就是「按文本写二进制」，图会坏且不报错
      await fsp.writeFile(result.filePath, buffer);
      return { path: result.filePath };
    },
  );
}
