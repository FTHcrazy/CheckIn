/**
 * 连线埋点单测（R27 / S4 / W-18）
 *
 * 埋点最容易坏在「看不见」的地方：字段少一个、失败不记、报错把主流程带崩。
 * 这三件事都不需要真跑 Electron 才能钉住。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LINK_CREATED_EVENT,
  failReasonOf,
  logLinkCreated,
  relationLenOf,
} from "./link-telemetry";

function installApi(usageLog?: ReturnType<typeof vi.fn>) {
  const api = { novel: { usageLog } };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return api;
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("relationLenOf", () => {
  it("按码点算字数（中文一字一，emoji 不按 2 算）", () => {
    expect(relationLenOf("师徒")).toBe(2);
    expect(relationLenOf("🐉")).toBe(1);
    expect(relationLenOf("")).toBe(0);
  });
});

describe("failReasonOf", () => {
  it("三种主进程失败码各自映射，未知码归 db", () => {
    expect(failReasonOf("stale")).toBe("stale");
    expect(failReasonOf("invalid-target")).toBe("invalid-target");
    expect(failReasonOf("db")).toBe("db");
  });
});

describe("logLinkCreated", () => {
  it("成功：只带 5 个计数字段，不带 failReason", () => {
    const usageLog = vi.fn(async () => true);
    installApi(usageLog);

    logLinkCreated({ fromType: "character", toType: "location", relationLen: 2, merged: false, ms: 128.6 });

    expect(usageLog).toHaveBeenCalledWith(LINK_CREATED_EVENT, {
      fromType: "character",
      toType: "location",
      relationLen: 2,
      merged: false,
      ms: 129,
    });
  });

  it("失败也记一条，并带上原因（只记成功等于把噪声当信号）", () => {
    const usageLog = vi.fn(async () => true);
    installApi(usageLog);

    logLinkCreated({
      fromType: "character",
      toType: "character",
      relationLen: 0,
      merged: false,
      ms: 0,
      failReason: "cancelled",
    });

    expect(usageLog).toHaveBeenCalledWith(
      LINK_CREATED_EVENT,
      expect.objectContaining({ failReason: "cancelled", merged: false }),
    );
  });

  it("通道缺失时静默返回（不抛错）", () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { novel: {} };
    expect(() =>
      logLinkCreated({ fromType: "a", toType: "b", relationLen: 1, merged: false, ms: 1 }),
    ).not.toThrow();
  });

  it("上报本身抛错 / reject 都不影响建关系", async () => {
    installApi(vi.fn(() => Promise.reject(new Error("boom"))));
    expect(() =>
      logLinkCreated({ fromType: "a", toType: "b", relationLen: 1, merged: false, ms: 1 }),
    ).not.toThrow();

    installApi(
      vi.fn(() => {
        throw new Error("sync boom");
      }),
    );
    expect(() =>
      logLinkCreated({ fromType: "a", toType: "b", relationLen: 1, merged: false, ms: 1 }),
    ).not.toThrow();
  });
});
