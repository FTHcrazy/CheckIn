import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  registerMemoRunner,
  useMemoStore,
  type MemoRunner,
} from "./useMemoStore";

const state = () => useMemoStore.getState();

/** 记录被通知的提示，用来断言「空内容不落库」这类分支 */
let notices: string[] = [];
let files: Record<string, string> = {};
let loaded = 0;

function runner(overrides: Partial<MemoRunner> = {}): MemoRunner {
  return {
    loadFiles: async () => {
      loaded += 1;
    },
    readFile: async (filename) => files[filename] ?? null,
    writeFile: async (filename, content) => {
      files[filename] = content;
      return true;
    },
    renameFile: async (oldFilename, newFilename) => {
      if (!(oldFilename in files)) return false;
      files[newFilename] = files[oldFilename];
      delete files[oldFilename];
      return true;
    },
    deleteFile: async (filename) => {
      if (!(filename in files)) return false;
      delete files[filename];
      return true;
    },
    importFiles: async () => [],
    exportFile: async () => true,
    notify: (_level, text) => {
      notices.push(text);
    },
    ...overrides,
  };
}

function reset(): void {
  registerMemoRunner(null);
  useMemoStore.setState({
    selected: null,
    content: "",
    originalContent: "",
    saving: false,
    isEditing: false,
    createModalOpen: false,
    newFileName: "",
  });
}

describe("useMemoStore（备忘编辑状态）", () => {
  beforeEach(() => {
    notices = [];
    loaded = 0;
    files = { "a.md": "# 标题\n\n正文" };
    reset();
  });

  afterEach(() => {
    reset();
  });

  it("选择文件会读入正文并写入原文快照", async () => {
    registerMemoRunner(runner());

    await state().selectFile("a.md");

    expect(state().selected).toBe("a.md");
    expect(state().content).toBe("# 标题\n\n正文");
    expect(state().originalContent).toBe("# 标题\n\n正文");
    expect(state().isEditing).toBe(false);
  });

  it("重复选择同一文件不再读盘", async () => {
    let reads = 0;
    registerMemoRunner(
      runner({
        readFile: async (filename) => {
          reads += 1;
          return files[filename] ?? null;
        },
      }),
    );

    await state().selectFile("a.md");
    await state().selectFile("a.md");
    expect(reads).toBe(1);
  });

  it("读不到内容时不切换选中项", async () => {
    registerMemoRunner(runner());
    await state().selectFile("missing.md");
    expect(state().selected).toBeNull();
  });

  it("保存成功后刷新列表并退出编辑态", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");
    state().setIsEditing(true);
    state().setContent("改过的正文");

    await state().save();

    expect(files["a.md"]).toBe("改过的正文");
    expect(state().originalContent).toBe("改过的正文");
    expect(state().isEditing).toBe(false);
    expect(loaded).toBe(1);
    expect(notices).toContain("保存成功");
  });

  it("内容为空时不落库并给出提示", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");
    state().setContent("   ");

    await state().save();

    expect(files["a.md"]).toBe("# 标题\n\n正文");
    expect(notices).toContain("内容不能为空");
  });

  it("新建文件补 .md 后缀、写入标题并直接进入编辑态", async () => {
    registerMemoRunner(runner());
    state().setNewFileName("随笔");

    await state().create();

    expect(files["随笔.md"]).toBe("# 随笔\n\n");
    expect(state().selected).toBe("随笔.md");
    expect(state().isEditing).toBe(true);
    expect(state().createModalOpen).toBe(false);
    expect(state().newFileName).toBe("");
  });

  it("文件名为空时提示且不落库", async () => {
    registerMemoRunner(runner());
    state().setNewFileName("  ");

    await state().create();

    expect(Object.keys(files)).toEqual(["a.md"]);
    expect(notices).toContain("请输入文件名");
  });

  it("重命名跟随选中项：改的是当前文件则 selected 一起更新", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");

    const ok = await state().rename("a.md", "新名字");

    expect(ok).toBe(true);
    expect(state().selected).toBe("新名字.md");
    expect(files["新名字.md"]).toBe("# 标题\n\n正文");
    expect(files["a.md"]).toBeUndefined();
  });

  it("新名与原名相同时直接返回 true，不落库", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");

    expect(await state().rename("a.md", "a")).toBe(true);
    expect(notices).not.toContain("重命名成功");
  });

  it("删除当前文件时清空编辑态", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");
    state().setContent("改过的正文");

    await state().remove("a.md");

    expect(state().selected).toBeNull();
    expect(state().content).toBe("");
    expect(state().isEditing).toBe(false);
    expect(loaded).toBe(1);
  });

  it("失焦保存：内容没变就不写盘", async () => {
    registerMemoRunner(runner());
    await state().selectFile("a.md");

    await state().saveOnBlur();
    expect(notices).not.toContain("保存成功");

    state().setContent("改了");
    await state().saveOnBlur();
    expect(notices).toContain("保存成功");
  });

  it("未注册 runner 时所有动作静默失败，不抛错", async () => {
    await expect(state().selectFile("a.md")).resolves.toBeUndefined();
    await expect(state().save()).resolves.toBeUndefined();
    expect(state().selected).toBeNull();
  });
});
