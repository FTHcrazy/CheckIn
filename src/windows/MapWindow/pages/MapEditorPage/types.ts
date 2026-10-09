/**
 * 地图画布文档模型
 *
 * 与 PRD §7 的 `novel_maps.content` JSON 结构对齐，便于后续接持久化。
 * 本阶段仅内存态（不落库），但结构保持一致，避免后续迁移。
 */

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
}

/** 画布文档 */
export interface MapDocument {
  /** 文档结构版本号，便于后续迁移 */
  version: number;
  /** 底图标识 */
  baseImageId: string;
  /** 已放置的素材 */
  elements: MapElement[];
}

/** 创建空文档 */
export function createEmptyDocument(): MapDocument {
  return {
    version: 1,
    baseImageId: "base-1",
    elements: [],
  };
}

/** 生成实例 id（时间戳 + 随机后缀，会话内足够唯一） */
export function createElementId(): string {
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
