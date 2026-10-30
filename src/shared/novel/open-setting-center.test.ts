/**
 * open-setting-center 行为测试（UI-03 跨窗口导航频道）
 *
 * 契约要点：
 * 1. 发起侧只做 fire-and-forget 的 `send`（不等待回执，故不宣告成功）；
 * 2. 接收侧 `parseOpenSettingCenterRequest` 必须对脏负载返回 null —— 宁可不开面板，
 *    也不要打开一个 workId 是 undefined 的错书设定中心；
 * 3. categoryId 缺失/非法一律回落 null（默认态），不抛错。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOVEL_OPEN_SETTING_CENTER_CHANNEL,
  parseOpenSettingCenterRequest,
  requestOpenSettingCenter,
} from "./open-setting-center";

const originalAPI = window.electronAPI;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  window.electronAPI = originalAPI;
});

describe("requestOpenSettingCenter", () => {
  it("以固定频道名 send workId + categoryId", () => {
    const send = vi.fn();
    window.electronAPI = { send } as unknown as typeof window.electronAPI;

    requestOpenSettingCenter("w1", "cat-realm");

    expect(send).toHaveBeenCalledWith(NOVEL_OPEN_SETTING_CENTER_CHANNEL, {
      workId: "w1",
      categoryId: "cat-realm",
    });
  });

  it("categoryId 传 null 时原样发出（默认态语义）", () => {
    const send = vi.fn();
    window.electronAPI = { send } as unknown as typeof window.electronAPI;

    requestOpenSettingCenter("w1", null);

    expect(send).toHaveBeenCalledWith(NOVEL_OPEN_SETTING_CENTER_CHANNEL, {
      workId: "w1",
      categoryId: null,
    });
  });

  it("空 workId 直接忽略（不发出会让接收方落到错书的请求）", () => {
    const send = vi.fn();
    window.electronAPI = { send } as unknown as typeof window.electronAPI;

    requestOpenSettingCenter("", "cat-realm");

    expect(send).not.toHaveBeenCalled();
  });

  it("electronAPI 缺失（非 Electron 环境）不抛错", () => {
    window.electronAPI = undefined as unknown as typeof window.electronAPI;
    expect(() => requestOpenSettingCenter("w1", null)).not.toThrow();
  });
});

describe("parseOpenSettingCenterRequest", () => {
  it("裸对象负载（跨窗口 IPC 路径）解析成功", () => {
    expect(
      parseOpenSettingCenterRequest([{ workId: "w1", categoryId: "c1" }]),
    ).toEqual({ workId: "w1", categoryId: "c1" });
  });

  it("CustomEvent 负载（同窗口路径）从 detail 取出", () => {
    const event = new CustomEvent(NOVEL_OPEN_SETTING_CENTER_CHANNEL, {
      detail: { workId: "w2", categoryId: "c2" },
    });
    expect(parseOpenSettingCenterRequest([event])).toEqual({
      workId: "w2",
      categoryId: "c2",
    });
  });

  it("categoryId 非字符串回落 null", () => {
    expect(
      parseOpenSettingCenterRequest([{ workId: "w1", categoryId: 123 }]),
    ).toEqual({ workId: "w1", categoryId: null });
  });

  it("categoryId 空串回落 null", () => {
    expect(
      parseOpenSettingCenterRequest([{ workId: "w1", categoryId: "" }]),
    ).toEqual({ workId: "w1", categoryId: null });
  });

  it("缺 workId 返回 null（脏负载不开面板）", () => {
    expect(parseOpenSettingCenterRequest([{ categoryId: "c1" }])).toBeNull();
    expect(parseOpenSettingCenterRequest([{ workId: "", categoryId: "c1" }])).toBeNull();
  });

  it("非对象负载返回 null", () => {
    expect(parseOpenSettingCenterRequest([null])).toBeNull();
    expect(parseOpenSettingCenterRequest(["w1"])).toBeNull();
    expect(parseOpenSettingCenterRequest([])).toBeNull();
  });
});
