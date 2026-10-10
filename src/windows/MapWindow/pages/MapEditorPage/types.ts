/**
 * 地图画布文档模型
 *
 * 与 PRD §7 的 `novel_maps.content` JSON 结构对齐，便于后续接持久化。
 * 本阶段仅内存态（不落库），但结构保持一致，避免后续迁移。
 */
import type { MapRegion } from "./regions";

/** 已放置的素材实例 */
export interface MapElement {
  /** 实例唯一 id */
  id: string;
  /** 素材类型 id（对应 sprites.ts 的 SPRITES[].id） */
  spriteId: string;
  /** 世界坐标：水平中心 */
  x: number;
  /** 世界坐标：底部锚点（贴图"脚底"位置，便于地形贴合） */
  y: number;
  /** 元素自身缩放（相对 baseWidth/baseHeight） */
  scale: number;
  /** 旋转角度（度），本阶段恒为 0，预留给后续 */
  rotation: number;
  /**
   * 放置时所处的层级序号（0 = 大陆 … 3 = 郡，见 lod.ts 的 `activeLevel`）。
   *
   * 【为什么素材要记层级】素材不是"浮在地图上的一层贴纸"，而是某个尺度下的地形：
   * 在郡那一级摆的山，属于郡的世界；缩到洲/国家去看时它就该退场，否则会看到
   * 一堆与当前尺度不匹配的小山散在整张图上。
   * 渲染时按该层级的权重做 alpha（见 `elementWeight`），因此素材与区块边界
   * 同呼吸 —— 层级淡出它就淡出，切到别的层级它就消失。
   *
   * `null` = 层级无关：在生成区块之前放置的素材（那时还没有任何层级可言），
   * 任何缩放下都可见。缺字段同样按 `null` 读，老数据不会因此消失。
   */
  level: number | null;
}

/** 画布文档 */
export interface MapDocument {
  /** 文档结构版本号，便于后续迁移 */
  version: number;
  /** 底图标识 */
  baseImageId: string;
  /** 已放置的素材 */
  elements: MapElement[];
  /** 随机生成的区块划分（空数组 = 未分区） */
  regions: MapRegion[];
}

/** 创建空文档 */
export function createEmptyDocument(): MapDocument {
  return {
    version: 1,
    baseImageId: "base-1",
    elements: [],
    regions: [],
  };
}

/** 生成实例 id（时间戳 + 随机后缀，会话内足够唯一） */
export function createElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
