import { describe, expect, it } from "vitest";
import {
  FAVORITES_STORAGE_KEY,
  pruneFavorites,
  readFavorites,
  toggleFavorite,
  writeFavorites,
} from "./favorites-storage";

/** 最小 Storage 实现：jsdom 的 localStorage 是共享的，用例之间会串味 */
function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length(): number {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) ?? null) : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

/** 写入即抛错的存储，用来模拟配额满 / 隐私模式 */
function createBrokenStorage(): Storage {
  return {
    length: 0,
    clear: () => undefined,
    getItem: () => {
      throw new Error("storage unavailable");
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
}

describe("readFavorites", () => {
  it("空存储返回空集", () => {
    expect(readFavorites(createMemoryStorage()).size).toBe(0);
  });

  it("读回已写入的 id 集合", () => {
    const storage = createMemoryStorage({
      [FAVORITES_STORAGE_KEY]: JSON.stringify(["js-event-loop", "css-bfc"]),
    });
    const ids = readFavorites(storage);
    expect(ids.has("js-event-loop")).toBe(true);
    expect(ids.has("css-bfc")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("JSON 损坏时静默返回空集，不抛错", () => {
    const storage = createMemoryStorage({ [FAVORITES_STORAGE_KEY]: "{不是 JSON" });
    expect(readFavorites(storage).size).toBe(0);
  });

  it("结构不是字符串数组时（旧版本或手工改坏）返回空集", () => {
    const asObject = createMemoryStorage({
      [FAVORITES_STORAGE_KEY]: JSON.stringify({ a: 1 }),
    });
    expect(readFavorites(asObject).size).toBe(0);

    const mixed = createMemoryStorage({
      [FAVORITES_STORAGE_KEY]: JSON.stringify(["ok", 42]),
    });
    expect(readFavorites(mixed).size).toBe(0);

    const asString = createMemoryStorage({
      [FAVORITES_STORAGE_KEY]: JSON.stringify("js-event-loop"),
    });
    expect(readFavorites(asString).size).toBe(0);
  });

  it("剔掉空串 id", () => {
    const storage = createMemoryStorage({
      [FAVORITES_STORAGE_KEY]: JSON.stringify(["", "js-event-loop", ""]),
    });
    expect([...readFavorites(storage)]).toEqual(["js-event-loop"]);
  });

  it("存储读取抛错时返回空集", () => {
    expect(readFavorites(createBrokenStorage()).size).toBe(0);
  });
});

describe("writeFavorites", () => {
  it("写入的是 JSON 数组，可被 readFavorites 原样读回", () => {
    const storage = createMemoryStorage();
    writeFavorites(new Set(["a", "b"]), storage);
    expect(storage.getItem(FAVORITES_STORAGE_KEY)).toBe('["a","b"]');
    expect([...readFavorites(storage)]).toEqual(["a", "b"]);
  });

  it("写入失败不抛错（收藏只在本次会话生效）", () => {
    expect(() => writeFavorites(new Set(["a"]), createBrokenStorage())).not.toThrow();
  });
});

describe("toggleFavorite", () => {
  it("未收藏则加入，已收藏则移除", () => {
    const start = new Set<string>();
    const added = toggleFavorite(start, "js-event-loop");
    expect(added.has("js-event-loop")).toBe(true);
    const removed = toggleFavorite(added, "js-event-loop");
    expect(removed.has("js-event-loop")).toBe(false);
  });

  it("不修改入参集合", () => {
    const start = new Set<string>(["a"]);
    toggleFavorite(start, "b");
    expect([...start]).toEqual(["a"]);
  });
});

describe("pruneFavorites", () => {
  it("剔除题库里已不存在的 id", () => {
    const ids = new Set(["keep", "gone"]);
    const known = new Set(["keep"]);
    expect([...pruneFavorites(ids, known)]).toEqual(["keep"]);
  });
});
