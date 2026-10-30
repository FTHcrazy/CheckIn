import { describe, expect, it } from "vitest";
import {
  buildNovelBackupFilename,
  buildNovelBackupManifest,
  emptyNovelCounts,
  isLikelySqliteFile,
  isNovelTrashExpired,
  NOVEL_TRASH_RETENTION_DAYS,
  normalizeNovelCounts,
  novelTrashDaysLeft,
  novelTrashExpiresAt,
  parseNovelBackupManifest,
} from "./novel-safety-utils";

const DAY = 24 * 60 * 60 * 1000;

function manifestText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: "checkin",
    kind: "novel-db",
    format: 1,
    exportedAt: "2026-10-23T02:00:00.000Z",
    counts: { works: 2, volumes: 3, chapters: 12, words: 34567 },
    ...over,
  });
}

describe("novel 备份清单（P0 数据安全）", () => {
  it("构造的清单带 app / kind / format 三要素，后续解析能原样读回", () => {
    const manifest = buildNovelBackupManifest({
      counts: { ...emptyNovelCounts(), works: 2, chapters: 12, words: 34567 },
      exportedAt: "2026-10-23T02:00:00.000Z",
      email: "a@b.com",
      appVersion: "2.2.3",
    });
    expect(manifest.app).toBe("checkin");
    expect(manifest.kind).toBe("novel-db");
    expect(manifest.format).toBe(1);
    expect(manifest.email).toBe("a@b.com");
    expect(manifest.appVersion).toBe("2.2.3");

    const parsed = parseNovelBackupManifest(JSON.stringify(manifest));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.manifest.counts).toEqual(manifest.counts);
    expect(parsed.manifest.exportedAt).toBe("2026-10-23T02:00:00.000Z");
  });

  it("拒绝别家应用的包（app 不符）", () => {
    const parsed = parseNovelBackupManifest(manifestText({ app: "other" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("CheckIn");
  });

  it("拒绝待办 / 备忘的备份包（kind 不符）—— 用户最容易选错的就是这一类", () => {
    const parsed = parseNovelBackupManifest(manifestText({ kind: "todo" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("小说");
  });

  it("拒绝更高格式版本的包（结构可能已不兼容）", () => {
    const parsed = parseNovelBackupManifest(manifestText({ format: 9 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("9");
  });

  it("清单不是 JSON / 缺格式版本时给出可读错误，而不是抛异常", () => {
    expect(parseNovelBackupManifest("not json").ok).toBe(false);
    expect(parseNovelBackupManifest(manifestText({ format: 0 })).ok).toBe(false);
  });

  it("计数归一化：脏值（负数 / NaN / 缺失）一律归 0，不穿透到 UI", () => {
    const counts = normalizeNovelCounts({
      works: -3,
      volumes: "abc",
      chapters: Number.NaN,
      words: 1234.9,
    });
    expect(counts).toEqual({
      works: 0,
      volumes: 0,
      chapters: 0,
      words: 1234,
      entities: 0,
      settings: 0,
      packCharacters: 0,
    });
  });

  it("导出文件名带时间戳，且以 .zip 结尾", () => {
    const name = buildNovelBackupFilename(new Date(2026, 9, 23, 10, 15, 0));
    expect(name).toBe("checkin-novel-20261023-101500.zip");
  });
});

describe("SQLite 文件头校验（恢复前最后一道闸门）", () => {
  it("合法头 + 足够长度通过", () => {
    const bytes = new Uint8Array(200);
    bytes.set(new TextEncoder().encode("SQLite format 3\u0000"), 0);
    expect(isLikelySqliteFile(bytes)).toBe(true);
  });

  it("空字节 / 截断文件 / 头不对全部拒绝 —— 这类包写进库路径等于清空数据", () => {
    expect(isLikelySqliteFile(new Uint8Array(0))).toBe(false);
    const short = new Uint8Array(40);
    short.set(new TextEncoder().encode("SQLite format 3\u0000"), 0);
    expect(isLikelySqliteFile(short)).toBe(false);
    const wrong = new Uint8Array(200);
    wrong.set(new TextEncoder().encode("PK\u0003\u0004"), 0);
    expect(isLikelySqliteFile(wrong)).toBe(false);
  });
});

describe("回收站保留期", () => {
  const deletedAt = 1_000_000_000_000;

  it("保留期就是 30 天", () => {
    expect(NOVEL_TRASH_RETENTION_DAYS).toBe(30);
    expect(novelTrashExpiresAt(deletedAt)).toBe(deletedAt + 30 * DAY);
  });

  it("刚删除时剩余 30 天；不足一天按 1 天（文案是「今天内到期」而不是 0）", () => {
    expect(novelTrashDaysLeft(deletedAt, deletedAt)).toBe(30);
    expect(novelTrashDaysLeft(deletedAt, deletedAt + 29.5 * DAY)).toBe(1);
  });

  it("到点即过期，边界前后各判一次", () => {
    expect(isNovelTrashExpired(deletedAt, deletedAt + 30 * DAY - 1)).toBe(false);
    expect(isNovelTrashExpired(deletedAt, deletedAt + 30 * DAY)).toBe(true);
    expect(novelTrashDaysLeft(deletedAt, deletedAt + 31 * DAY)).toBe(0);
  });

  it("删除时间缺失（0 / NaN）视为已过期，避免坏行永远占着回收站", () => {
    expect(isNovelTrashExpired(Number.NaN, deletedAt)).toBe(true);
    expect(isNovelTrashExpired(0, deletedAt)).toBe(true);
  });
});
