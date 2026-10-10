/**
 * 导入服务的纯逻辑测试
 *
 * 只测「解析结果 → 落库 payload」这一段纯变换（不触 IPC / worker）：
 * 卷下标越界收敛、id 唯一性、排序连续。IPC 与 worker 由集成验证覆盖。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// 在引入被测模块前，先给 window.electronAPI 打桩
type ImportPayload = {
  work: { id: string; name: string };
  volumes: Array<{ id: string; name: string; sort: number }>;
  chapters: Array<{
    id: string;
    volumeId: string;
    title: string;
    sort: number;
  }>;
};

const importBookMock = vi.fn<(payload: ImportPayload) => Promise<{ ok: boolean }>>(
  async () => ({ ok: true }),
);
(globalThis as unknown as { window: unknown }).window = {
  electronAPI: { novel: { importBook: importBookMock } },
};

const { commitImport } = await import("./import-service");

import type { ImportParseResult } from "../import/import.worker";

/** 取最近一次落库 payload */
function lastPayload(): ImportPayload {
  const call = importBookMock.mock.calls.at(-1);
  if (!call) throw new Error("importBook 未被调用");
  return call[0];
}

function makeParsed(overrides: Partial<ImportParseResult> = {}): ImportParseResult {
  return {
    encoding: "utf-8",
    structured: true,
    volumes: [{ name: "第一卷" }, { name: "第二卷" }],
    chapters: [
      { title: "第一章", content: "aaa", volumeIndex: 0, wordCount: 3 },
      { title: "第二章", content: "bbb", volumeIndex: 0, wordCount: 3 },
      { title: "第三章", content: "ccc", volumeIndex: 1, wordCount: 3 },
    ],
    totalWords: 9,
    ...overrides,
  };
}

describe("commitImport", () => {
  beforeEach(() => {
    importBookMock.mockClear();
  });

  it("卷章结构正确映射，章归属对应卷", async () => {
    const result = await commitImport(makeParsed(), "测试书");
    expect(result.volumeCount).toBe(2);
    expect(result.chapterCount).toBe(3);
    expect(result.wordCount).toBe(9);

    const payload = lastPayload();
    expect(payload.work.name).toBe("测试书");
    expect(payload.volumes.map((v) => v.sort)).toEqual([1, 2]);
    // 前两章指向卷 0，第三章指向卷 1
    expect(payload.chapters[0].volumeId).toBe(payload.volumes[0].id);
    expect(payload.chapters[2].volumeId).toBe(payload.volumes[1].id);
    expect(payload.chapters.map((c) => c.sort)).toEqual([1, 2, 3]);
  });

  it("全部 id 唯一（同毫秒批量创建不碰撞）", async () => {
    await commitImport(makeParsed(), "测试书");
    const payload = lastPayload();
    const ids = [
      payload.work.id,
      ...payload.volumes.map((v) => v.id),
      ...payload.chapters.map((c) => c.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("卷下标越界时收敛到最后一卷（不产生悬空 volumeId）", async () => {
    const parsed = makeParsed({
      chapters: [{ title: "第一章", content: "x", volumeIndex: 99, wordCount: 1 }],
    });
    await commitImport(parsed, "越界书");
    const payload = lastPayload();
    expect(payload.chapters[0].volumeId).toBe(payload.volumes[payload.volumes.length - 1].id);
  });

  it("空标题回退到「第N章」占位", async () => {
    const parsed = makeParsed({
      volumes: [],
      chapters: [{ title: "", content: "x", volumeIndex: 0, wordCount: 1 }],
    });
    await commitImport(parsed, "空标题书");
    const payload = lastPayload();
    // 卷列表为空时兜底造一卷，避免 volumeId 悬空
    expect(payload.volumes).toHaveLength(1);
    expect(payload.chapters[0].title).toBe("第1章");
  });
});
