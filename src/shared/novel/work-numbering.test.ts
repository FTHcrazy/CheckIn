import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./constants";
import {
  applyWorkNumbering,
  fetchWorkNumbering,
  parseWorkNumbering,
  saveWorkNumberingRule,
  workNumberingOf,
} from "./work-numbering";

/** config 的读写替身：内存里一个字符串，模拟 config 表 */
let store: string | null = null;
const configGet = vi.fn(async () => store);
const configSet = vi.fn(async (_key: string, value: string) => {
  store = value;
  return true;
});

beforeEach(() => {
  store = null;
  configGet.mockClear();
  configSet.mockClear();
  vi.stubGlobal("window", {
    electronAPI: { novel: { configGet, configSet } },
  });
});

describe("parseWorkNumbering", () => {
  it("正常解析多条记录", () => {
    expect(
      parseWorkNumbering(
        JSON.stringify({
          w1: { numberStyle: "chinese", chapterSuffix: "回" },
          w2: { chapterSuffix: "节" },
        }),
      ),
    ).toEqual({
      w1: { numberStyle: "chinese", chapterSuffix: "回" },
      w2: { chapterSuffix: "节" },
    });
  });

  it("空值 / 损坏 JSON / 非对象一律回退空表", () => {
    expect(parseWorkNumbering(null)).toEqual({});
    expect(parseWorkNumbering("")).toEqual({});
    expect(parseWorkNumbering("{ 坏掉的 json")).toEqual({});
    expect(parseWorkNumbering("[1,2,3]")).toEqual({});
    expect(parseWorkNumbering('"字符串"')).toEqual({});
  });

  it("逐字段校验：非法值被丢弃，合法字段保留", () => {
    expect(
      parseWorkNumbering(
        JSON.stringify({
          w1: { numberStyle: "roman", chapterSuffix: "", volumeSuffix: "部" },
          "": { chapterSuffix: "章" },
          w2: null,
        }),
      ),
    ).toEqual({ w1: { volumeSuffix: "部" } });
  });

  it("某条记录所有字段都非法时整条丢弃", () => {
    expect(parseWorkNumbering(JSON.stringify({ w1: { numberStyle: 42 } }))).toEqual({});
  });
});

describe("fetchWorkNumbering", () => {
  it("从 config 表按固定键读取并解析", async () => {
    store = JSON.stringify({ w1: { chapterSuffix: "回" } });
    await expect(fetchWorkNumbering()).resolves.toEqual({ w1: { chapterSuffix: "回" } });
    expect(configGet).toHaveBeenCalledWith(STORAGE_KEYS.workNumbering);
  });

  it("IPC 抛错时返回空表（上层回退默认规则）", async () => {
    configGet.mockRejectedValueOnce(new Error("库未就绪"));
    await expect(fetchWorkNumbering()).resolves.toEqual({});
  });
});

describe("saveWorkNumberingRule（读改写）", () => {
  it("写入一本新书的规则，不动其它书", async () => {
    store = JSON.stringify({ w1: { chapterSuffix: "回" } });
    await expect(saveWorkNumberingRule("w2", { numberStyle: "arabic" })).resolves.toBe(true);
    expect(JSON.parse(store!)).toEqual({
      w1: { chapterSuffix: "回" },
      w2: { numberStyle: "arabic" },
    });
  });

  it("同书再次写入是字段合并而非整体替换", async () => {
    store = JSON.stringify({ w1: { chapterSuffix: "回" } });
    await saveWorkNumberingRule("w1", { numberStyle: "arabic" });
    expect(JSON.parse(store!)).toEqual({
      w1: { chapterSuffix: "回", numberStyle: "arabic" },
    });
  });

  it("传 null / 空对象删除该书记录，回退全局默认", async () => {
    store = JSON.stringify({ w1: { chapterSuffix: "回" }, w2: { numberStyle: "arabic" } });
    await saveWorkNumberingRule("w1", null);
    expect(JSON.parse(store!)).toEqual({ w2: { numberStyle: "arabic" } });

    await saveWorkNumberingRule("w2", {});
    expect(JSON.parse(store!)).toEqual({});
  });

  it("workId 为空时拒绝写入，不碰存储", async () => {
    await expect(saveWorkNumberingRule("", { chapterSuffix: "回" })).resolves.toBe(false);
    expect(configSet).not.toHaveBeenCalled();
  });

  it("IPC 失败返回 false", async () => {
    configSet.mockResolvedValueOnce(false);
    await expect(saveWorkNumberingRule("w1", { chapterSuffix: "回" })).resolves.toBe(false);
  });
});

describe("applyWorkNumbering（叠加到全局基线）", () => {
  const base = { numberStyle: "arabic" as const, chapterSuffix: "章", volumeSuffix: "卷" };

  it("无该书记录 → 原样返回全局基线（同一引用）", () => {
    expect(applyWorkNumbering(base, "w9", {})).toBe(base);
  });

  it("有记录 → 覆盖对应字段，未提及的字段保留全局值", () => {
    expect(applyWorkNumbering(base, "w1", { w1: { chapterSuffix: "回" } })).toEqual({
      numberStyle: "arabic",
      chapterSuffix: "回",
      volumeSuffix: "卷",
    });
    expect(
      applyWorkNumbering(base, "w1", {
        w1: { numberStyle: "chinese", volumeSuffix: "部" },
      }),
    ).toEqual({ numberStyle: "chinese", chapterSuffix: "章", volumeSuffix: "部" });
  });

  it("workId 为空 / 映射里是别的书 → 退回全局基线", () => {
    expect(applyWorkNumbering(base, "", { w1: { chapterSuffix: "回" } })).toBe(base);
    expect(applyWorkNumbering(base, "w2", { w1: { chapterSuffix: "回" } })).toBe(base);
  });

  it("不修改传入的基线对象", () => {
    const snapshot = { ...base };
    applyWorkNumbering(base, "w1", { w1: { chapterSuffix: "回" } });
    expect(base).toEqual(snapshot);
  });

  it("泛型适配书架 Hero 的样式对象（多一个 dailyGoal 字段）", () => {
    const shelfStyle = {
      numberStyle: "arabic" as const,
      chapterSuffix: "章",
      volumeSuffix: "卷",
      dailyGoal: 2000,
    };
    expect(applyWorkNumbering(shelfStyle, "w1", { w1: { numberStyle: "chinese" } })).toEqual({
      numberStyle: "chinese",
      chapterSuffix: "章",
      volumeSuffix: "卷",
      dailyGoal: 2000,
    });
  });
});

describe("workNumberingOf", () => {
  it("取到规则 / 无记录返回 null", () => {
    const map = { w1: { chapterSuffix: "回" } };
    expect(workNumberingOf("w1", map)).toEqual({ chapterSuffix: "回" });
    expect(workNumberingOf("w2", map)).toBeNull();
    expect(workNumberingOf("", map)).toBeNull();
  });
});
