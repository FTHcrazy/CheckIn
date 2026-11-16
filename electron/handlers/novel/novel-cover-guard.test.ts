import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 作品封面数据层的源码守卫（2.56.0）。
 *
 * 封面是「不报错但书架上看不见」的高发区：少一列 / 少一条通道 / 装载时
 * 漏映射，界面都会静默回落到程序化渐变封面，用户只会说「导入没生效」。
 * 这里把「建表 + 迁移 + 压缩落库 + 装载回传 + preload 暴露」逐环钉住。
 */
const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

const DB = read("electron/novel/novel-db.ts");
const HANDLERS = read("electron/handlers/novel/novel-handlers.ts");
const PRELOAD = read("electron/preload.ts");
const TYPES = read("src/shared/types/electron.d.ts");

describe("封面列：新库有、老库补", () => {
  it("novel_works 建表带可空 cover 列", () => {
    expect(DB).toContain("cover TEXT");
  });

  it("增量迁移按列名检测后补列（老库不回填）", () => {
    expect(DB).toContain('column.name === "cover"');
    expect(DB).toContain("ALTER TABLE novel_works ADD COLUMN cover TEXT");
  });
});

describe("导入通道：选图 → 压缩 → 落库", () => {
  it("主进程用 nativeImage 解码，只缩不放", () => {
    expect(HANDLERS).toContain('"novel-work-cover"');
    expect(HANDLERS).toContain("nativeImage.createFromPath");
    expect(HANDLERS).toContain("COVER_MAX_WIDTH");
    expect(HANDLERS).toContain("image.isEmpty()");
    expect(HANDLERS).toContain("toJPEG(COVER_JPEG_QUALITY)");
  });

  it("落的是 data URL 整串（备份 / 恢复天然带走封面）", () => {
    expect(HANDLERS).toContain("data:image/jpeg;base64,");
    expect(HANDLERS).toContain("UPDATE novel_works SET cover = ? WHERE id = ?");
  });

  it("全量装载把封面回传给书架", () => {
    expect(HANDLERS).toContain("cover: row.cover ?? undefined");
  });
});

describe("导出通道：只取单部作品的卷章正文", () => {
  it("独立通道 + 过滤回收站里的卷章", () => {
    expect(HANDLERS).toContain('"novel-work-content"');
    expect(HANDLERS).toContain("novel_volumes WHERE work_id = ? AND deleted_at IS NULL");
    expect(HANDLERS).toContain("novel_chapters WHERE work_id = ? AND deleted_at IS NULL");
    expect(HANDLERS).toContain("toChapterDto(row, true)");
  });
});

describe("渲染层契约", () => {
  it("preload 暴露两条通道", () => {
    expect(PRELOAD).toContain("'novel-work-cover'");
    expect(PRELOAD).toContain("'novel-work-content'");
  });

  it("DTO 与 API 类型都带封面 / 单书正文", () => {
    expect(TYPES).toContain("cover?: string");
    expect(TYPES).toContain("pickWorkCover: (id: string)");
    expect(TYPES).toContain("workContent: (workId: string)");
  });
});
