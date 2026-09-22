/**
 * 备忘文件管理 IPC handlers（用户级文件系统）
 *
 * 数据源：用户数据目录下的 memos/*.md。
 * 全部文件名经 path.basename 防护，禁止跨目录写入。
 *
 * 备份包（原「数据迁移」模块并入本页）：memo-backup-export 打包
 * manifest.json + memos/*.md 弹保存框写盘；memo-backup-import 弹打开框
 * 校验清单后「追加合并」——重名自动追加序号，不覆盖已有备忘。
 */
import { ipcMain, dialog, shell, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import JSZip from "jszip";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { ensureMemosDir } from "../user-paths";
import { getCurrentUserEmail } from "../db";
import {
  BACKUP_MANIFEST_FILE,
  BACKUP_MEMOS_DIR,
  buildExportFilename,
  buildManifest,
  dedupeMemoName,
  listMemoEntries,
  parseManifest,
  sanitizeMemoName,
} from "../backup-utils";
import {
  collapseBlankLines,
  markdownToDocxBlocks,
  markdownToPlainText,
} from "../memo-doc-utils";

export interface MemoBackupExportResult {
  canceled: boolean;
  /** 取消时为 null */
  filePath: string | null;
  count: number;
}

export interface MemoBackupImportResult {
  canceled: boolean;
  count: number;
  /** 包内存在但未能写入的备忘条目名 */
  skipped: string[];
}

function pickWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

const BACKUP_ZIP_FILTERS = [{ name: "数据备份包", extensions: ["zip"] }];

/** 生成不重名的备忘文件名（.md 统一后缀；重名自动追加序号，避免覆盖已有备忘） */
function uniqueMemoName(base: string): string {
  const memosDir = ensureMemosDir();
  let candidate = `${base}.md`;
  for (let i = 1; fs.existsSync(path.join(memosDir, candidate)); i += 1) {
    candidate = `${base} (${i}).md`;
  }
  return candidate;
}

/** markdown → docx 段落对象：纯函数返回块模型，这里映射为 docx 包 API */
function toDocxParagraphs(markdown: string): Paragraph[] {
  return markdownToDocxBlocks(markdown).map((block) => {
    if (block.type === "heading") {
      const headings = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
      ];
      return new Paragraph({
        text: block.text,
        heading: headings[block.level - 1],
      });
    }
    if (block.type === "bullet") {
      return new Paragraph({ text: block.text, bullet: { level: 0 } });
    }
    return new Paragraph({ text: block.text });
  });
}

export function registerMemoHandlers(): void {
  ipcMain.handle("memo-list", () => {
    const memosDir = ensureMemosDir();
    const files = fs.readdirSync(memosDir).filter((f) => f.endsWith(".md"));
    return files
      .map((name) => {
        const stat = fs.statSync(path.join(memosDir, name));
        return { name, updatedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  });

  ipcMain.handle("memo-read", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    if (!fs.existsSync(filePath)) throw new Error("文件不存在");
    return fs.readFileSync(filePath, "utf-8");
  });

  ipcMain.handle("memo-write", (_event, filename: string, content: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  });

  ipcMain.handle(
    "memo-rename",
    (_event, oldFilename: string, newFilename: string) => {
      const oldSafe = path.basename(oldFilename);
      const newSafe = path.basename(newFilename);
      const memosDir = ensureMemosDir();
      const oldPath = path.join(memosDir, oldSafe);
      const newPath = path.join(memosDir, newSafe);

      if (!fs.existsSync(oldPath)) throw new Error("文件不存在");
      if (oldSafe !== newSafe && fs.existsSync(newPath)) {
        throw new Error("目标文件已存在");
      }

      fs.renameSync(oldPath, newPath);
      return true;
    },
  );

  ipcMain.handle("memo-delete", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  });

  ipcMain.handle("memo-open-in-explorer", (_event, filename: string) => {
    const safe = path.basename(filename);
    const filePath = path.join(ensureMemosDir(), safe);
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("memo-import", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ["openFile", "multiSelections"] as Array<
        "openFile" | "multiSelections"
      >,
      filters: [
        { name: "文档文件", extensions: ["md", "txt", "docx"] },
      ],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];

    const importedFiles: string[] = [];
    for (const sourcePath of result.filePaths) {
      const ext = path.extname(sourcePath).toLowerCase();
      const base = path.basename(sourcePath, path.extname(sourcePath));

      // txt 直读；docx 用 mammoth 抽取段落纯文本；md 原样读。
      // 全部统一转存为 .md 备忘（memo 列表只收 .md）
      let text: string;
      if (ext === ".docx") {
        const { value } = await mammoth.extractRawText({ path: sourcePath });
        text = collapseBlankLines(value);
      } else {
        text = fs.readFileSync(sourcePath, "utf-8");
        if (ext === ".txt") text = collapseBlankLines(text);
      }

      const filename = uniqueMemoName(base);
      fs.writeFileSync(path.join(ensureMemosDir(), filename), text, "utf-8");
      importedFiles.push(filename);
    }
    return importedFiles;
  });

  ipcMain.handle(
    "memo-export",
    async (
      event,
      filename: string,
      format: "txt" | "docx",
    ): Promise<boolean> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const safe = path.basename(filename);
      const filePath = path.join(ensureMemosDir(), safe);
      if (!fs.existsSync(filePath)) throw new Error("文件不存在");

      const markdown = fs.readFileSync(filePath, "utf-8");
      const base = path.basename(safe, path.extname(safe));
      const ext = format === "docx" ? "docx" : "txt";
      const filters =
        ext === "docx"
          ? [{ name: "Word 文档", extensions: ["docx"] }]
          : [{ name: "纯文本", extensions: ["txt"] }];
      const options = {
        defaultPath: `${base}.${ext}`,
        filters,
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return false;

      let target = result.filePath;
      if (!target.toLowerCase().endsWith(`.${ext}`)) target += `.${ext}`;

      if (ext === "docx") {
        const doc = new Document({
          sections: [{ children: toDocxParagraphs(markdown) }],
        });
        const buffer = await Packer.toBuffer(doc);
        fs.writeFileSync(target, buffer);
      } else {
        fs.writeFileSync(target, markdownToPlainText(markdown), "utf-8");
      }
      return true;
    },
  );

  // 备份导出：memos 目录全量打包 manifest + memos/*.md，弹保存框写盘
  ipcMain.handle(
    "memo-backup-export",
    async (event): Promise<MemoBackupExportResult> => {
      const memosDir = ensureMemosDir();
      const files = fs.readdirSync(memosDir).filter((name) => name.endsWith(".md"));

      const zip = new JSZip();
      for (const name of files) {
        zip.file(`${BACKUP_MEMOS_DIR}/${name}`, fs.readFileSync(path.join(memosDir, name)));
      }
      zip.file(
        BACKUP_MANIFEST_FILE,
        JSON.stringify(
          buildManifest({
            scope: "memo",
            count: files.length,
            exportedAt: new Date().toISOString(),
            email: getCurrentUserEmail() || undefined,
          }),
          null,
          2,
        ),
      );

      const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const win = pickWindow(event);
      const options = {
        defaultPath: buildExportFilename(new Date(), "memo"),
        filters: BACKUP_ZIP_FILTERS,
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) {
        return { canceled: true, filePath: null, count: files.length };
      }

      const target = result.filePath.toLowerCase().endsWith(".zip")
        ? result.filePath
        : `${result.filePath}.zip`;
      fs.writeFileSync(target, buffer);
      return { canceled: false, filePath: target, count: files.length };
    },
  );

  // 备份导入：选 zip → 校验清单 → 追加合并（重名自动追加序号，不覆盖已有备忘）
  ipcMain.handle(
    "memo-backup-import",
    async (event): Promise<MemoBackupImportResult> => {
      const win = pickWindow(event);
      const openOptions = {
        properties: ["openFile"] as Array<"openFile">,
        filters: BACKUP_ZIP_FILTERS,
      };
      const picked = win
        ? await dialog.showOpenDialog(win, openOptions)
        : await dialog.showOpenDialog(openOptions);
      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true, count: 0, skipped: [] };
      }

      const zip = await JSZip.loadAsync(fs.readFileSync(picked.filePaths[0]));
      const manifestFile = zip.file(BACKUP_MANIFEST_FILE);
      if (!manifestFile) throw new Error("压缩包内缺少清单文件 manifest.json");
      const parsed = parseManifest(await manifestFile.async("string"));
      if (!parsed.ok) throw new Error(parsed.error);
      if (!parsed.manifest.scopes.includes("memo")) {
        throw new Error("该备份包不包含备忘数据");
      }

      const memosDir = ensureMemosDir();
      // 已占用名集合：既有文件 + 本次已写入，保证同批重名也互不覆盖
      const taken = new Set(fs.readdirSync(memosDir));
      const counts = { count: 0, skipped: [] as string[] };
      for (const entry of listMemoEntries(Object.keys(zip.files))) {
        const file = zip.file(entry);
        if (!file) {
          counts.skipped.push(entry);
          continue;
        }
        const safeName = sanitizeMemoName(entry.slice(BACKUP_MEMOS_DIR.length + 1));
        const finalName = dedupeMemoName(safeName, taken);
        taken.add(finalName);
        fs.writeFileSync(path.join(memosDir, finalName), await file.async("string"), "utf-8");
        counts.count += 1;
      }

      return { canceled: false, count: counts.count, skipped: counts.skipped };
    },
  );
}
