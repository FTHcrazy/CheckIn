import { describe, expect, it } from "vitest";
import {
  MAP_REVISION_KEEP,
  MAP_TITLE_FALLBACK,
  MAP_TITLE_MAX,
  createMapDocId,
  isRevConflict,
  normalizeMapTitle,
  parseViewport,
  revisionsToDrop,
  serializeViewport,
  shouldSnapshotRevision,
  thumbToDataUrl,
} from "./map-utils";

describe("地图名归一", () => {
  it("压掉换行与连续空格、去首尾空白", () => {
    expect(normalizeMapTitle("  东洲\n全图  ")).toBe("东洲 全图");
    expect(normalizeMapTitle("北境\t\t王国")).toBe("北境 王国");
  });

  it("空 / 非字符串 / 纯空白一律兜底", () => {
    for (const raw of ["", "   ", "\n\t", null, undefined, 42, {}]) {
      expect(normalizeMapTitle(raw)).toBe(MAP_TITLE_FALLBACK);
    }
  });

  it("超长截断到上限（不把整段古文塞进列表卡片）", () => {
    const long = "沧".repeat(200);
    expect(normalizeMapTitle(long)).toHaveLength(MAP_TITLE_MAX);
  });
});

describe("乐观锁判据", () => {
  it("版本一致不冲突，不一致冲突", () => {
    expect(isRevConflict(3, 3)).toBe(false);
    expect(isRevConflict(3, 4)).toBe(true);
    expect(isRevConflict(0, 1)).toBe(true);
  });
});

describe("历史版本节奏", () => {
  it("第 10 / 20 版留档，第 0 版与中间版本不留", () => {
    expect(shouldSnapshotRevision(0)).toBe(false);
    expect(shouldSnapshotRevision(1)).toBe(false);
    expect(shouldSnapshotRevision(9)).toBe(false);
    expect(shouldSnapshotRevision(10)).toBe(true);
    expect(shouldSnapshotRevision(20)).toBe(true);
    expect(shouldSnapshotRevision(21)).toBe(false);
  });

  it("裁剪只丢最老的，保留最近 keep 条", () => {
    expect(revisionsToDrop([10, 20, 30], 10)).toEqual([]);
    const revs = Array.from({ length: 13 }, (_, i) => (i + 1) * 10);
    const dropped = revisionsToDrop(revs, 10);
    expect(dropped).toHaveLength(3);
    // 丢的必须是最小的三个（10/20/30），不是随便三条
    expect(dropped.sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(revisionsToDrop([], MAP_REVISION_KEEP)).toEqual([]);
  });
});

describe("视口快照", () => {
  it("合法 JSON 往返一致", () => {
    const json = serializeViewport({ x: -120, y: 40, scale: 2.5 });
    expect(json).not.toBeNull();
    expect(parseViewport(json)).toEqual({ x: -120, y: 40, scale: 2.5 });
  });

  it("坏数据回 null（交给「适应窗口」兜底，而不是编一个位置）", () => {
    expect(parseViewport(null)).toBeNull();
    expect(parseViewport("")).toBeNull();
    expect(parseViewport("{oops")).toBeNull();
    expect(parseViewport("[1,2,3]")).toBeNull();
    expect(parseViewport('{"x":1,"y":2}')).toBeNull();
    expect(parseViewport('{"x":1,"y":2,"scale":0}')).toBeNull();
    expect(parseViewport('{"x":"1","y":2,"scale":1}')).toBeNull();
  });

  it("序列化非法输入返回 null（不写库，保住上次位置）", () => {
    expect(serializeViewport({ x: 0, y: 0, scale: -1 })).toBeNull();
    expect(serializeViewport(null)).toBeNull();
  });
});

describe("缩略图转 data URL", () => {
  it("Buffer / Uint8Array 都转成 png data URL", () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    expect(thumbToDataUrl(bytes)).toBe("data:image/png;base64,iVBORw==");
    expect(thumbToDataUrl(new Uint8Array(bytes))).toBe("data:image/png;base64,iVBORw==");
  });

  it("空 / 非二进制一律 null（列表走占位图）", () => {
    expect(thumbToDataUrl(null)).toBeNull();
    expect(thumbToDataUrl(Buffer.alloc(0))).toBeNull();
    expect(thumbToDataUrl("not-bytes")).toBeNull();
    expect(thumbToDataUrl({ length: 3 })).toBeNull();
  });
});

describe("文档 id", () => {
  it("带 mp_ 前缀（与 el_ / lb_ / sm_ 同一命名体系）", () => {
    expect(createMapDocId("abc")).toBe("mp_abc");
  });
});
