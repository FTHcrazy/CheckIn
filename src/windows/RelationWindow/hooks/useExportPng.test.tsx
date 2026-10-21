/**
 * 导出编排 hook（R27 / S5，RG-X 系列）
 *
 * 钉三件事，都是「测不出会直接给用户一张坏图」的：
 * ① 成功 / 失败 / 取消三条路径**都必须摘掉 is-exporting**（否则下一次导出
 *    会从一张没工具栏的图上再截一层）；
 * ② 取景矩形由根节点现算，DPR 现读（不缓存——窗口跨屏时都会变）；
 * ③ 连点导出只跑一次（busyRef 同步锁，state 会漏掉同帧第二次点击）。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExportPng } from "./useExportPng";
import { EXPORT_CLASS } from "../utils/export-png";

interface ApiOptions {
  captureWindow?: () => Promise<unknown>;
  exportBinary?: () => Promise<unknown>;
}

function makeRoot() {
  const root = document.createElement("div");
  Object.defineProperty(root, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  });
  return root;
}

function installApi(options: ApiOptions = {}) {
  const captureWindow = vi.fn(
    options.captureWindow ??
      (async () => ({ ok: true, png: new Uint8Array(8), width: 800, height: 600 })),
  );
  const exportBinary = vi.fn(options.exportBinary ?? (async () => ({ path: "/tmp/x.png" })));
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    novel: { captureWindow, exportBinary },
  };
  return { captureWindow, exportBinary };
}

function renderExport(workName = "夜行记") {
  const rootRef = { current: null as HTMLElement | null };
  const hook = renderHook(() => useExportPng({ rootRef, workName }));
  return { ...hook, rootRef };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("useExportPng：导出编排", () => {
  it("成功路径：取景 → 落盘 → 摘掉 is-exporting", async () => {
    const api = installApi();
    const { result, rootRef } = renderExport();
    rootRef.current = makeRoot();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.exportPng();
    });

    expect(outcome).toBe("ok");
    expect(api.captureWindow).toHaveBeenCalledTimes(1);
    expect(api.exportBinary).toHaveBeenCalledTimes(1);
    expect(rootRef.current.classList.contains(EXPORT_CLASS)).toBe(false);
    expect(result.current.exporting).toBe(false);
  });

  it("保存框取消：返回 cancelled，同样摘掉 is-exporting", async () => {
    const api = installApi({ exportBinary: async () => null });
    const { result, rootRef } = renderExport();
    rootRef.current = makeRoot();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.exportPng();
    });

    expect(outcome).toBe("cancelled");
    expect(api.captureWindow).toHaveBeenCalledTimes(1);
    expect(rootRef.current.classList.contains(EXPORT_CLASS)).toBe(false);
  });

  it("取景失败：返回 failed，落盘不被调用，is-exporting 摘掉", async () => {
    const api = installApi({
      captureWindow: async () => ({ ok: false, code: "empty", message: "x" }),
    });
    const { result, rootRef } = renderExport();
    rootRef.current = makeRoot();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.exportPng();
    });

    expect(outcome).toBe("failed");
    expect(api.exportBinary).not.toHaveBeenCalled();
    expect(rootRef.current.classList.contains(EXPORT_CLASS)).toBe(false);
  });

  it("根节点还没挂上（rootRef.current 为 null）：直接 failed，不抛异常", async () => {
    installApi();
    const { result } = renderExport();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.exportPng();
    });

    expect(outcome).toBe("failed");
  });

  it("连点导出只跑一次（busyRef 同步锁，同帧第二次点击被挡）", async () => {
    installApi();
    const { result, rootRef } = renderExport();
    rootRef.current = makeRoot();

    let first: Promise<string> | undefined;
    let second: Promise<string> | undefined;
    await act(async () => {
      first = result.current.exportPng();
      second = result.current.exportPng();
      await Promise.all([first, second]);
    });

    // 第二次直接返回 failed，不触发第二次取景
    expect(await first).toBe("ok");
    expect(await second).toBe("failed");
  });

  it("captureWindow 抛异常（IPC 炸了）也会摘掉 is-exporting", async () => {
    installApi({ captureWindow: async () => Promise.reject(new Error("boom")) });
    const { result, rootRef } = renderExport();
    rootRef.current = makeRoot();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.exportPng();
    });

    expect(outcome).toBe("failed");
    expect(rootRef.current.classList.contains(EXPORT_CLASS)).toBe(false);
  });
});
