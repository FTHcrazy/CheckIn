/**
 * 路径 A′「绑定已有地图」的**拷贝构造**（nested-submap-main.md §4.1.1）。
 *
 * 【为什么是拷贝而不是引用】三个开放问题在这里一次答完（总览 §3.2-A′ 行）：
 *   ① 引用还是拷贝 → **拷贝**。子图内部编辑本就按「独立事务 + 深拷贝快照」实现
 *      （主方案 §2 关键设计点 4），引用语义需要一条「源图变更 → 同步子图」的通道，
 *      v1 没有也不该有；拷贝语义下绑定完成即与源图脱钩，所见即所得。
 *   ② 绑定的图被删除怎么办 → 零影响（内容已落进当前文档，随当前图一起保存）。
 *   ③ 子图能否反向跳转 → 拷贝后与源图无关联，不存在「跳回」；想看源图从地图库打开。
 *
 * 【id 重映射】拷贝进来的区块 / 素材 / 地名 / 折线 id 全部加前缀（前缀 = 新子图 id）。
 * 当前渲染层只有「顶层带子图区块」按 id 建索引（`submapNodeByIdRef`），撞 id 暂时
 * 无害；但「子图内编辑」（R-REG-10）落地后所有选中/撤销都会按 id 找对象 —— 现在
 * 花一个 Map 的成本，把「同一文档里两份拷贝共享 id」这一类问题整类消灭。
 */
import type { MapRegion } from "./regions";
import {
  createSubmapId,
  type MapDocument,
  type MapLabel,
  type MapPolyline,
  type MapSubmap,
} from "./types";

/**
 * 子图标准纸：与父图同一张 1024² 的纸（中心在原点）。
 *
 * 【为什么不是源图的陆地区域】海岸烘焙的四层参数（浅海带 28 / 外发光 10 / 白边 2.4
 * 世界单位）按整张纸的尺度标定（见 submapRender.ts 头注）；绑定进来的图按「标准纸 →
 * 区块包围盒」贴合缩进区块，烘焙参数才与父图同口径。
 */
export const SUBMAP_PAPER_BOUNDS = { x: -512, y: -512, width: 1024, height: 1024 } as const;

/** 把一列带 id 的对象整体换成「前缀 + 原 id」，返回 旧id → 新id 映射 */
function remapIds<T extends { id: string }>(items: T[], prefix: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) map.set(item.id, `${prefix}${item.id}`);
  for (const item of items) item.id = map.get(item.id) ?? item.id;
  return map;
}

/**
 * 递归重映射一张子图内容里的全部 id（含嵌套子图）。
 *
 * 前缀 = 新子图 id（全局唯一）+ 原 id ⇒ 任意两份拷贝、拷贝与宿主文档之间都不会撞。
 * `parentId` 引用同层区块树，用同一次生成的映射表解析；解析不到保持原值
 * （脏数据的容错：坏一个引用好过整棵丢）。
 */
function remapSubmapContent(
  sub: Pick<MapSubmap, "regions" | "elements" | "labels" | "polylines">,
  prefix: string,
): void {
  const regionMap = remapIds(sub.regions, prefix);
  for (const region of sub.regions) {
    if (region.parentId) region.parentId = regionMap.get(region.parentId) ?? region.parentId;
    if (region.submap) remapSubmapContent(region.submap, prefix);
  }
  remapIds(sub.elements, prefix);
  remapIds(sub.labels, prefix);
  if (sub.polylines) remapIds(sub.polylines as MapPolyline[], prefix);
}

/**
 * 把一张完整地图文档拷贝成可绑定的 `MapSubmap`。
 *
 * 【零写入同款口径】源文档没有 `polylines` 字段时，子图也不写该字段
 * （读点统一走 `submapPolylines`），保持「老子图不带新键」的一致性。
 * 源图自身的 `regionSchema` 同理不拷 —— 子图缺省继承宿主文档的层级定义
 * （`MapSubmap.regionSchema` 的既有约定）。
 */
export function submapFromDoc(source: MapDocument): MapSubmap {
  // structuredClone 一步到位：绑定完成后子图与源文档零共享引用，
  // 之后任一侧的编辑都不会串到另一侧（拷贝语义的根基）
  const clone = structuredClone(source);
  const submap: MapSubmap = {
    id: createSubmapId(),
    bounds: { ...SUBMAP_PAPER_BOUNDS },
    land: clone.land,
    regions: clone.regions,
    elements: clone.elements,
    labels: clone.labels,
    style: clone.style,
    baseImageId: clone.baseImageId,
  };
  if (clone.polylines) submap.polylines = clone.polylines;
  remapSubmapContent(submap, `${submap.id}_`);
  return submap;
}

/** 供测试断言用的类型再导出（避免测试文件直接 import 三个类型源头） */
export type { MapDocument, MapLabel, MapRegion };
