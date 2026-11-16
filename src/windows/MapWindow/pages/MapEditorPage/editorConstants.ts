/**
 * 地图编辑器页面级配置（EditorState 层的常量与文案）。
 *
 * 领域常量、展示文案与草稿形状集中在此，避免散落在 JSX 分支里。
 */
import { REGION_TOTAL_LIMIT } from "./regions";
import type { ManualRegionRejectCode } from "./regionEdit";
import type { MapSaveStatus } from "./store/useMapFileStore";
/** 权重低于此值的层级不再出现在工具栏的指示里（与渲染层的阈值同源） */
export const LEVEL_CHIP_EPSILON = 0.004;

/**
 * 方向键 / WASD 的方向表（微移，R-MAP-25）。
 *
 * 值是**单位方向**（乘步长后用）：步长档位（精调 4 / 加速 16）与方向解耦，
 * 改步长不用回来动这张表。世界坐标 y 向下为正，所以"上"是 -1。
 */
export const NUDGE_DIRS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};

/** 微移步长：精调（默认）与加速（Shift）两档，世界单位 */
export const NUDGE_STEP_FINE = 4;
export const NUDGE_STEP_FAST = 16;

/**
 * 存档状态 → 一句话说明（工具栏保存指示的 title）。
 *
 * 【为什么集中在一张表】状态机有 6 个值，散在 JSX 的三元里必然漏一个
 * （最典型的是漏掉 `conflict`，于是"冲突"显示成"已保存"——正好相反）。
 */
export const MAP_SAVE_STATUS_TEXT: Record<MapSaveStatus, string> = {
  idle: "还没有装载地图",
  dirty: "有改动，正在等待自动保存…",
  saving: "正在保存…",
  saved: "已保存到本地",
  conflict: "库里的版本比当前画面新（点保存可选择覆盖）",
  error: "保存失败，请检查磁盘空间后重试",
};

/**
 * 画布当前的工具（R-REG-03 / B4-2）。
 *
 * 【为什么是"工具"而不是一个 `drawMode` 布尔】画区、画折线与选择是**互斥的指针语义**：
 * 同一个左键，在 select 下是"点选/拖拽"，在 draw 下是"落一个顶点"（构成一个面），
 * 在 polyline 下是"落一个控制点"（构成一条线）。布尔只能表达"某种绘制开着"，
 * 表达不了"三种里现在是哪一种"；多一个值就不可能同时成立。
 *
 * 第三个落位意图（「加标注」`pendingLabel` / 待放置素材 `pendingSpriteId`）没有并进来：
 * 它们的生命周期由各自面板决定（选素材即进入、落位即退出），而 tool 是工具栏状态。
 * 三者互斥靠"进入任一个就清掉另外两个"保证（见 `handlePickTool` / `handlePickSprite`）。
 */
export type MapTool = "select" | "draw" | "polyline";

/**
 * 手画拒绝原因 → 中文提示（架构 §5「文案映射（唯一出处）」）。
 *
 * 【为什么在页面这一层】`checkManualRegion` 返回的是**枚举**（`ManualRegionRejectCode`），
 * 纯函数层不该产出面向用户的句子 —— 否则改一句文案要动纯函数、还要改它的用例。
 *
 * 【为什么是函数而不是常量表】三条文案要插值（区块名 / 层级数 / 总数上限），
 * 常量表做不到；用 `switch` 还能让 TS 在新增 code 时**报错**（`never` 兜底），
 * 而 `Record<Code, string>` 只能保证键齐、保证不了插值正确。
 */
export function rejectTextOf(
  code: ManualRegionRejectCode,
  conflict: { id: string; name: string } | undefined,
  levelCount: number,
): string {
  // 名字可能为空串（脏数据 / 老文档）：那样文案里出现「」比直接缺字更像 bug
  const name = conflict?.name?.trim() || "上级区块";
  switch (code) {
    case "too-few-points":
      return "至少需要 3 个顶点";
    case "degenerate-edge":
      return "有两个顶点重合了，请撤销上一点重画";
    case "self-intersect":
      return "边线交叉了（区块不能自交），请撤销后重画";
    case "overlap-sibling":
      return `与「${name}」重叠`;
    case "overlap-ancestor":
      return `与上级区块「${name}」重叠`;
    case "outside-parent":
      return `超出「${name}」的范围`;
    case "level-out-of-range":
      return `已达最深层级（共 ${levelCount} 级）`;
    case "total-limit":
      return `区块总数已达上限 ${REGION_TOTAL_LIMIT}，请先合并或清除`;
    default: {
      // 穷尽性检查：新增 code 而忘了加文案时，这里会编译失败
      const exhaustive: never = code;
      return `无法创建区块（${String(exhaustive)}）`;
    }
  }
}

/**
 * 正在编辑的地名草稿。
 *
 * 【为什么要有 `id: null` 这一态】「加标注」是"先给位置、拿到文字才落库"的两段式：
 * 空文本不许进文档（看不见也点不中的幽灵对象）。所以草稿要么是"改一条已有的"
 * （id 有值），要么是"还没建的"（id 为 null，提交时才 `addLabel`）。
 */
export interface LabelDraft {
  /** 已有标注 id；`null` = 尚未落库的新地名 */
  id: string | null;
  /** 输入框定位点（画布本地 CSS 像素） */
  screen: { x: number; y: number };
  /** 落位世界坐标（新建时写进文档；改文案时用不到） */
  world: { x: number; y: number };
  /** 输入框当前内容 */
  text: string;
}
