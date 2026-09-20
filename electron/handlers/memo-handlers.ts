/**
 * 备忘文件管理 IPC handlers（用户级文件系统）
 *
 * 数据源：用户数据目录下的 memos/*.md。
 * 全部文件名经 path.basename 防护，禁止跨目录写入。
 */
import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import mammoth from "mammoth";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { getUserDataDir, getCurrentUserEmail } from "../db";
import {
  collapseBlankLines,
  markdownToDocxBlocks,
  markdownToPlainText,
} from "../memo-doc-utils";

// ── 目录管理 ──

function getMemosDir(): string {
  return path.join(getUserDataDir(getCurrentUserEmail()), "memos");
}

function ensureMemosDir(): string {
  const memosDir = getMemosDir();
  if (!fs.existsSync(memosDir)) fs.mkdirSync(memosDir, { recursive: true });
  return memosDir;
}

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
}
