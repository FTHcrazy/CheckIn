/**
 * 备忘编辑器状态（模块级 Zustand store）
 *
 * 为什么抽到全局：`selected / content / 编辑态` 此前都在页面根的
 * `useMemoEditorState` 里，于是**每敲一个字**都会让 MemoPage 重渲染：
 * 侧栏虚拟列表、头部、预览、Modal 全部陪跑，还要对全文跑一次 escapeHtml。
 *
 * 放在 store 后：
 * - 编辑区（`MemoEditor`）订阅 content，预览区（`MemoPreview`）订阅原文，
 *   搜索框（`MemoHeader`）订阅搜索态——各自只被自己关心的变化叫醒
 * - 页面根只订阅低频项（选中文件 / 编辑态 / 弹窗），打字不再波及侧栏
 * - 顺带解决跨路由保活：切走再回来，选中的文件与未保存草稿都还在
 *
 * 边界（沿用 useSearchStore 的 runner 范式）：文件读写与 toast 都是外部能力，
 * 由页面注册 runner 提供；store 不 import service，注册动作不触发任何请求。
 */

import { create } from "zustand";

/** 文件读写与提示能力，由页面注册 */
export interface MemoRunner {
  loadFiles: () => Promise<void>;
  readFile: (filename: string) => Promise<string | null>;
  writeFile: (filename: string, content: string) => Promise<boolean>;
  renameFile: (oldFilename: string, newFilename: string) => Promise<boolean>;
  deleteFile: (filename: string) => Promise<boolean>;
  importFiles: () => Promise<string[]>;
  exportFile: (filename: string, format: "txt" | "docx") => Promise<boolean>;
  notify: (level: "success" | "warning" | "info", text: string) => void;
}

export interface MemoState {
  selected: string | null;
  /** 正在编辑的草稿 */
  content: string;
  /** 最近一次落库的内容（判断是否脏、预览的数据源） */
  originalContent: string;
  saving: boolean;
  isEditing: boolean;
  createModalOpen: boolean;
  newFileName: string;

  selectFile: (filename: string) => Promise<void>;
  setContent: (next: string) => void;
  save: () => Promise<void>;
  create: () => Promise<void>;
  rename: (oldFilename: string, name: string) => Promise<boolean>;
  importFiles: () => Promise<void>;
  exportFile: (format: "txt" | "docx") => Promise<void>;
  remove: (filename: string) => Promise<void>;
  /** 失焦即存（内容为空或与原文一致时不写） */
  saveOnBlur: () => Promise<void>;
  setIsEditing: (editing: boolean) => void;
  setCreateModalOpen: (open: boolean) => void;
  setNewFileName: (name: string) => void;
}

let runner: MemoRunner | null = null;

export function registerMemoRunner(next: MemoRunner | null): void {
  runner = next;
}

/** 统一提示入口：runner 未注册时静默（不影响逻辑分支） */
function notify(
  level: "success" | "warning" | "info",
  text: string,
): void {
  runner?.notify(level, text);
}

/** 文件名补 .md 后缀 */
function withExt(name: string): string {
  return name.endsWith(".md") ? name : `${name}.md`;
}

export const useMemoStore = create<MemoState>()((set, get) => ({
  selected: null,
  content: "",
  originalContent: "",
  saving: false,
  isEditing: false,
  createModalOpen: false,
  newFileName: "",

  selectFile: async (filename) => {
    if (get().selected === filename) return;
    if (!runner) return;
    const nextContent = await runner.readFile(filename);
    if (nextContent === null) return;
    set({
      selected: filename,
      content: nextContent,
      originalContent: nextContent,
      isEditing: false,
    });
  },

  setContent: (next) => set({ content: next }),

  save: async () => {
    const { selected, content } = get();
    if (!selected || !runner) return;
    if (!content.trim()) {
      notify("warning", "内容不能为空");
      return;
    }

    set({ saving: true });
    const saved = await runner.writeFile(selected, content);
    if (saved) {
      set({ originalContent: content, isEditing: false });
      notify("success", "保存成功");
      void runner.loadFiles();
    }
    set({ saving: false });
  },

  create: async () => {
    const name = get().newFileName.trim();
    if (!name || !runner) {
      if (!name) notify("warning", "请输入文件名");
      return;
    }

    const filename = withExt(name);
    const initContent = `# ${name.replace(/\.md$/, "")}\n\n`;
    const created = await runner.writeFile(filename, initContent);
    if (!created) return;

    notify("success", "创建成功");
    set({
      createModalOpen: false,
      newFileName: "",
      selected: filename,
      content: initContent,
      originalContent: initContent,
      isEditing: true,
    });
    await runner.loadFiles();
  },

  rename: async (oldFilename, name) => {
    const trimmed = name.trim();
    if (!trimmed || !runner) {
      if (!trimmed) notify("warning", "请输入文件名");
      return false;
    }

    const newFilename = withExt(trimmed);
    if (oldFilename === newFilename) return true;

    const renamed = await runner.renameFile(oldFilename, newFilename);
    if (!renamed) return false;

    if (get().selected === oldFilename) set({ selected: newFilename });
    notify("success", "重命名成功");
    await runner.loadFiles();
    return true;
  },

  importFiles: async () => {
    if (!runner) return;
    const imported = await runner.importFiles();
    if (imported.length === 0) return;
    notify("success", `已导入 ${imported.length} 个备忘文件`);
    await runner.loadFiles();
    await get().selectFile(imported[0]);
  },

  exportFile: async (format) => {
    const { selected } = get();
    if (!selected || !runner) {
      notify("warning", "请先选择要导出的备忘");
      return;
    }
    const saved = await runner.exportFile(selected, format);
    if (saved) notify("success", `已导出为 ${format.toUpperCase()}`);
  },

  remove: async (filename) => {
    if (!runner) return;
    if (!(await runner.deleteFile(filename))) return;
    notify("success", "删除成功");
    if (get().selected === filename) {
      set({
        selected: null,
        content: "",
        originalContent: "",
        isEditing: false,
      });
    }
    void runner.loadFiles();
  },

  saveOnBlur: async () => {
    const { selected, content, originalContent } = get();
    if (!selected || content === originalContent) return;
    if (!content.trim()) {
      notify("warning", "内容不能为空");
      return;
    }
    await get().save();
  },

  setIsEditing: (editing) => set({ isEditing: editing }),
  setCreateModalOpen: (open) => set({ createModalOpen: open }),
  setNewFileName: (name) => set({ newFileName: name }),
}));

/** 稳定动作入口：身份恒定，可安全当 props 透传 */
export const memoActions = {
  selectFile: (filename: string): Promise<void> =>
    useMemoStore.getState().selectFile(filename),
  setContent: (next: string): void => {
    useMemoStore.getState().setContent(next);
  },
  save: (): Promise<void> => useMemoStore.getState().save(),
  saveOnBlur: (): Promise<void> => useMemoStore.getState().saveOnBlur(),
  create: (): Promise<void> => useMemoStore.getState().create(),
  rename: (oldFilename: string, name: string): Promise<boolean> =>
    useMemoStore.getState().rename(oldFilename, name),
  importFiles: (): Promise<void> => useMemoStore.getState().importFiles(),
  exportFile: (format: "txt" | "docx"): Promise<void> =>
    useMemoStore.getState().exportFile(format),
  remove: (filename: string): Promise<void> =>
    useMemoStore.getState().remove(filename),
  setIsEditing: (editing: boolean): void => {
    useMemoStore.getState().setIsEditing(editing);
  },
  setNewFileName: (name: string): void => {
    useMemoStore.getState().setNewFileName(name);
  },
  setCreateModalOpen: (open: boolean): void => {
    useMemoStore.getState().setCreateModalOpen(open);
  },
};

/** 正文订阅（只有编辑区需要，页面根不要订阅它） */
export function useMemoContent(): string {
  return useMemoStore((state) => state.content);
}

/** 已落库原文订阅（预览区用） */
export function useMemoOriginal(): string {
  return useMemoStore((state) => state.originalContent);
}
