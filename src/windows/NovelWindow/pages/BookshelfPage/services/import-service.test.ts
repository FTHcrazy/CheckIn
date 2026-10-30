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
/** config 表替身：序号规则按书落库走这里 */
let configStore: string | null = null;
const configGetMock = vi.fn(async () => configStore);
const configSetMock = vi.fn(async (_key: string, value: string) => {
  configStore = value;
  return true;
});
(globalThis as unknown as { window: unknown }).window = {
  electronAPI: {
    novel: {
      importBook: importBookMock,
      configGet: configGetMock,
      configSet: configSetMock,
    },
  },
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
    numberingRule: null,
    ...overrides,
  };
}

describe("commitImport", () => {
  beforeEach(() => {
    importBookMock.mockClear();
    configGetMock.mockClear();
    configSetMock.mockClear();
    configStore = null;
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

describe("commitImport · 按书落库序号规则（1.34.0）", () => {
  beforeEach(() => {
    importBookMock.mockClear();
    configGetMock.mockClear();
    configSetMock.mockClear();
    configStore = null;
  });

  it("识别出规则时写入该书的记录（后缀 + 数字样式）", async () => {
    const parsed = makeParsed({
      numberingRule: { suffix: "回", numberStyle: "chinese" },
    });
    const result = await commitImport(parsed, "规则书");

    expect(configSetMock).toHaveBeenCalledTimes(1);
    const map = JSON.parse(configStore!);
    expect(map[result.workId]).toEqual({
      numberStyle: "chinese",
      chapterSuffix: "回",
      volumeSuffix: "卷",
    });
  });

  it("每本书各写各的记录，互不覆盖", async () => {
    const first = await commitImport(
      makeParsed({ numberingRule: { suffix: "回", numberStyle: "chinese" } }),
      "甲书",
    );
    const second = await commitImport(
      makeParsed({ numberingRule: { suffix: "节", numberStyle: "arabic" } }),
      "乙书",
    );

    const map = JSON.parse(configStore!);
    expect(map[first.workId].chapterSuffix).toBe("回");
    expect(map[second.workId].chapterSuffix).toBe("节");
    expect(Object.keys(map)).toHaveLength(2);
  });

  it("识别不出规则时不写记录（沿用全局默认）", async () => {
    await commitImport(makeParsed({ numberingRule: null }), "无规则书");
    expect(configSetMock).not.toHaveBeenCalled();
  });

  it("空标题兜底也走本书规则，而不是硬编码「章」", async () => {
    const parsed = makeParsed({
      volumes: [],
      numberingRule: { suffix: "回", numberStyle: "arabic" },
      chapters: [{ title: "", content: "x", volumeIndex: 0, wordCount: 1 }],
    });
    await commitImport(parsed, "空标题回目书");
    expect(lastPayload().chapters[0].title).toBe("第1回");
  });

  it("空标题 + 中文数字规则 → 兜底出中文序号", async () => {
    const parsed = makeParsed({
      volumes: [],
      numberingRule: { suffix: "章", numberStyle: "chinese" },
      chapters: [{ title: "", content: "x", volumeIndex: 0, wordCount: 1 }],
    });
    await commitImport(parsed, "空标题中文书");
    expect(lastPayload().chapters[0].title).toBe("第一章");
  });

  it("写规则失败不影响导入本身（退化成默认规则）", async () => {
    configSetMock.mockResolvedValueOnce(false);
    const result = await commitImport(
      makeParsed({ numberingRule: { suffix: "回", numberStyle: "arabic" } }),
      "写失败书",
    );
    expect(result.chapterCount).toBe(3);
    expect(importBookMock).toHaveBeenCalledTimes(1);
  });
});
