/**
 * 数据迁移 hook 单测：勾选状态、导出/导入执行与结果反馈
 *
 * 通过桩替换 window.electronAPI.migration，不触碰真实 IPC。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMigration } from "./useMigration";

interface ApiStub {
  export: ReturnType<typeof vi.fn>;
  import: ReturnType<typeof vi.fn>;
}

function stubApi(exportResult?: unknown, importResult?: unknown): ApiStub {
  const api = {
    export: vi.fn().mockResolvedValue(
      exportResult ?? { canceled: false, filePath: "D:/backup/a.zip", counts: { todo: 2, memo: 1 } },
    ),
    import: vi.fn().mockResolvedValue(
      importResult ?? { canceled: false, scopes: ["todo", "memo"], counts: { todo: 3, memo: 4 }, skipped: [] },
    ),
  };
  Object.defineProperty(window, "electronAPI", {
    value: { migration: api },
    configurable: true,
    writable: true,
  });
  return api;
}

afterEach(() => {
  Reflect.deleteProperty(window, "electronAPI");
  vi.restoreAllMocks();
});

describe("useMigration", () => {
  it("默认全选待办与备忘", () => {
    stubApi();
    const { result } = renderHook(() => useMigration());
    expect(result.current.scopes).toEqual(["todo", "memo"]);
  });

  it("toggleScope 可取消与恢复勾选", () => {
    stubApi();
    const { result } = renderHook(() => useMigration());
    act(() => result.current.toggleScope("todo"));
    expect(result.current.scopes).toEqual(["memo"]);
    act(() => result.current.toggleScope("todo"));
    expect(result.current.scopes).toEqual(["memo", "todo"]);
  });

  it("未勾选任何数据时直接给出错误反馈且不调用 IPC", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useMigration());
    act(() => result.current.toggleScope("todo"));
    act(() => result.current.toggleScope("memo"));
    await act(async () => {
      await result.current.runExport();
    });
    expect(api.export).not.toHaveBeenCalled();
    expect(result.current.feedback).toEqual({
      type: "error",
      text: "请至少勾选一项要导出的数据",
    });
  });

  it("导出成功时反馈条数与文件路径", async () => {
    stubApi();
    const { result } = renderHook(() => useMigration());
    await act(async () => {
      await result.current.runExport();
    });
    expect(result.current.feedback).toEqual({
      type: "success",
      text: "已导出 2 条待办、1 篇备忘，文件：D:/backup/a.zip",
    });
    expect(result.current.exporting).toBe(false);
  });

  it("用户取消导出时给出中性提示", async () => {
    stubApi({ canceled: true, filePath: null, counts: { todo: 0, memo: 0 } });
    const { result } = renderHook(() => useMigration());
    await act(async () => {
      await result.current.runExport();
    });
    expect(result.current.feedback).toEqual({ type: "info", text: "已取消导出" });
  });

  it("导入失败时透出主进程错误信息", async () => {
    const api = stubApi();
    api.import.mockRejectedValue(new Error("这不是 CheckIn 数据迁移包"));
    const { result } = renderHook(() => useMigration());
    await act(async () => {
      await result.current.runImport();
    });
    expect(result.current.feedback).toEqual({
      type: "error",
      text: "这不是 CheckIn 数据迁移包",
    });
  });

  it("导入结果含跳过项时一并提示", async () => {
    stubApi(undefined, {
      canceled: false,
      scopes: ["memo"],
      counts: { todo: 0, memo: 2 },
      skipped: ["memos/broken.md"],
    });
    const { result } = renderHook(() => useMigration());
    await act(async () => {
      await result.current.runImport();
    });
    expect(result.current.feedback?.text).toBe("已导入 0 条待办、2 篇备忘，跳过 1 个异常条目");
  });
});
