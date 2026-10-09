/**
 * 地形素材登记表（PNG 资源）
 *
 * 素材文件位于 `src/windows/MapWindow/assets/sprites/`（窗口自包含，
 * 遵循窗口隔离规范 AGENTS §2.2.0）。经 Vite 静态导入后自动带 hash 落盘，
 * 开发与打包期路径一致。
 *
 * 新增素材：把 PNG 放进 sprites/ 目录 → 在 SPRITES 里登记一条即可，
 * 面板会自动分组展示（按 category 归类）。
 */

import baseImage from "../../assets/sprites/基底1.jpg";
import forest from "../../assets/sprites/森林.png";
import forest2 from "../../assets/sprites/森林2.png";
import hill from "../../assets/sprites/小山1.png";
import mountain19 from "../../assets/sprites/山19.png";
import mountain20 from "../../assets/sprites/山20.png";

/** 素材分类（决定左侧面板分组） */
export type SpriteCategory = "mountain" | "forest";

/** 单条素材定义 */
export interface SpriteDef {
  /** 稳定标识，持久化时存这个值（不存路径，避免换图后失效） */
  id: string;
  /** 展示名 */
  label: string;
  /** 分类 */
  category: SpriteCategory;
  /** 图片地址（Vite 处理后的 URL） */
  src: string;
  /**
   * 世界坐标下的基准尺寸（像素）。
   * 素材原始尺寸差异较大（100~232px），这里归一化到统一的视觉量级，
   * 避免"种一棵树比山还大"。渲染时按此宽高 * 元素自身 scale 绘制。
   */
  baseWidth: number;
  baseHeight: number;
}

/** 分类展示元信息 */
export const SPRITE_CATEGORIES: { key: SpriteCategory; label: string }[] = [
  { key: "mountain", label: "山" },
  { key: "forest", label: "森林" },
];

/**
 * 素材总表。
 *
 * baseWidth/baseHeight 做了统一缩放：原始 PNG 尺寸不一（山 131×76、
 * 森林 232×232 等），直接按原尺寸摆会出现严重比例失衡。
 * 这里按"视觉重量"手工归一，让山明显大于树。
 */
export const SPRITES: SpriteDef[] = [
  {
    id: "mountain-19",
    label: "山（大）",
    category: "mountain",
    src: mountain19,
    baseWidth: 160,
    baseHeight: 93,
  },
  {
    id: "mountain-20",
    label: "山（中）",
    category: "mountain",
    src: mountain20,
    baseWidth: 120,
    baseHeight: 70,
  },
  {
    id: "hill-1",
    label: "小山",
    category: "mountain",
    src: hill,
    baseWidth: 80,
    baseHeight: 35,
  },
  {
    id: "forest-1",
    label: "森林",
    category: "forest",
    src: forest,
    baseWidth: 90,
    baseHeight: 90,
  },
  {
    id: "forest-2",
    label: "森林（大）",
    category: "forest",
    src: forest2,
    baseWidth: 130,
    baseHeight: 130,
  },
];

/** 底图（画布背景） */
export const BASE_IMAGE = {
  id: "base-1",
  label: "基底 1",
  src: baseImage,
  /** 底图在世界坐标下的尺寸（1024×1024 原图，作为画布基准） */
  width: 1024,
  height: 1024,
} as const;

/** 按 id 快速查素材 */
export const SPRITE_MAP: Record<string, SpriteDef> = Object.fromEntries(
  SPRITES.map((s) => [s.id, s]),
);
