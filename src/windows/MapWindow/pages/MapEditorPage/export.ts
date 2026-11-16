/**
 * 导出 PNG（B5 / PRD §6.6.3）
 *
 * 【为什么要切块】WebGL 纹理有单边上限（浏览器 canvas 更保守），而地图是"按长边
 * 定尺寸"的：一张 1024×2048 的纸想导成 4096 长边，短边就 2048、长边 4096 —— 还算
 * 安全；但纸张比例极端、或者将来放开尺寸档时，一次 `extract` 就会超出上限而**静默
 * 出黑图**。所以先算 `tilePlan`，必要时分块拼。
 *
 * 【为什么先搬 world 再 extract，而不是用 `frame` 直接截】`extract` 截的是节点的
 * 局部包围盒，纸张之外还有投影与海岸余量，直接截会带上一圈多余留白、且拼缝对不齐。
 * 把 `world` 的 `position/scale` 摆成"这一块正好铺满输出画布"，再用 `frame` 把
 * 输出画布框死，每一块的像素位置就是确定的整数格 —— 拼缝天然对齐。
 *
 * 【⚠️ 落盘绝不能用文本通道】`novel-export-file` 是 `writeFile(..., "utf8")`，
 * 写 PNG 会**文件损坏且零报错**（AGENTS §2.1 有记录）。这里只走
 * `exportBinary`（主进程按 `Buffer.from()` 原样写字节）。
 */
import { Rectangle } from "pixi.js";
import type { Container } from "pixi.js";
import type { Rect } from "./types";

/** 导出尺寸档（长边像素）。默认 2048 —— 4096 的图约 30MB，不该是默认动作 */
export const EXPORT_SIZES = [1024, 2048, 4096] as const;
export type ExportSize = (typeof EXPORT_SIZES)[number];
export const EXPORT_DEFAULT_SIZE: ExportSize = 2048;

/**
 * 单块的最大边长（像素）。
 *
 * 8192 取的是"比浏览器 canvas 的常见上限保守、又大于我们最大的尺寸档"之间：
 * 4096 档永远不会触发切块（1×1），这个值是留给"纸张比例极端 / 将来放开尺寸档"的护栏。
 */
export const EXPORT_TILE_MAX = 8192;

/** 一张图要切几块、每块多少像素 */
export interface TilePlan {
  cols: number;
  rows: number;
  /** 单块输出像素 */
  tilePxW: number;
  tilePxH: number;
  /** 整幅输出像素 */
  width: number;
  height: number;
  /** 世界单位 → 输出像素的倍率 */
  scale: number;
}

/**
 * 切块方案（纯函数）。
 *
 * @param world    要导出的世界矩形（纸张）
 * @param longSide 目标长边像素
 * @param tileMax  单块上限（默认 `EXPORT_TILE_MAX`）
 *
 * 长边决定倍率，短边按同一倍率取整 —— 两张图并排比对时比例必须一致，
 * 分别按各自长边缩放会让"方形纸"和"长方形纸"看起来畸变不同。
 */
export function tilePlan(
  world: Rect,
  longSide: number,
  tileMax: number = EXPORT_TILE_MAX,
): TilePlan {
  const safeW = Math.max(1, world.width);
  const safeH = Math.max(1, world.height);
  const scale = Math.max(1e-6, longSide) / Math.max(safeW, safeH);
  const width = Math.max(1, Math.round(safeW * scale));
  const height = Math.max(1, Math.round(safeH * scale));

  // 下限 256：阈值被传成 0 时不至于把图切成上千条 1px 的缝
  const max = Math.max(256, Math.trunc(tileMax));
  const cols = Math.max(1, Math.ceil(width / max));
  const rows = Math.max(1, Math.ceil(height / max));

  return {
    cols,
    rows,
    tilePxW: Math.ceil(width / cols),
    tilePxH: Math.ceil(height / rows),
    width,
    height,
    scale,
  };
}

/** 渲染器的取图能力（鸭子类型：测试里不需要真 WebGL） */
export interface ExportRenderer {
  extract: {
    canvas(options: {
      target: Container;
      frame?: Rectangle;
      resolution?: number;
      antialias?: boolean;
    }): unknown;
  };
}

/** 导出要用到的场景节点（由 `MapCanvas` 通过 `onSceneReady` 交出） */
export interface ExportScene {
  renderer: ExportRenderer;
  /** ⚠️ 必须是 `app.stage`：`world` 之上还有投影等外层内容 */
  stage: Container;
  /** 承载视口变换的容器：导出期间会被临时改写 */
  world: Container;
  /** 纸张在世界坐标里的矩形 */
  worldRect: Rect;
  /** 导出前清空选中框（不能把"选中框"画进成品） */
  clearOverlay?: () => void;
  /** 导出后重绘选中框（`clear()` 之后不重绘，框会一直消失到下次点选） */
  redrawOverlay?: () => void;
}

/** 把 canvas 编码成 PNG 字节；环境不支持（jsdom / 无 2D 上下文）时返回 null */
function encodePng(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(null);
        return;
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(() => resolve(null));
    }, "image/png");
  });
}

/**
 * 渲染成 PNG 字节（不落盘）。
 *
 * 【`finally` 里恢复视口】中途任何一步抛错（取图失败、上下文丢失）都必须把
 * `world` 摆回去 —— 否则一次失败的导出会把画面永久留在"某个切块的偏移"上，
 * 用户看到的是"图歪了、还没法撤销"，比导出失败本身更难受。
 *
 * @returns PNG 字节；环境不支持 2D 上下文时返回 null
 */
export async function exportMapPng(
  scene: ExportScene,
  longSide: number,
): Promise<Uint8Array | null> {
  const plan = tilePlan(scene.worldRect, longSide);
  const prevX = scene.world.position.x;
  const prevY = scene.world.position.y;
  const prevScale = scene.world.scale.x;

  // 输出画布：整幅尺寸，逐块 drawImage 拼上去
  const out = document.createElement("canvas");
  out.width = plan.width;
  out.height = plan.height;
  const ctx = out.getContext("2d");

  // 导出期间不该有选中框（它是交互指示，不是地图内容）
  scene.clearOverlay?.();

  try {
    if (!ctx) return null; // jsdom / 无 2D 上下文：交给调用方给可读提示

    for (let row = 0; row < plan.rows; row += 1) {
      for (let col = 0; col < plan.cols; col += 1) {
        const originX = scene.worldRect.x + (col * plan.tilePxW) / plan.scale;
        const originY = scene.worldRect.y + (row * plan.tilePxH) / plan.scale;

        // 把这一块的世界左上角搬到输出画布左上角，再按导出倍率放大
        scene.world.scale.set(plan.scale);
        scene.world.position.set(-originX * plan.scale, -originY * plan.scale);

        const tile = scene.renderer.extract.canvas({
          target: scene.stage,
          frame: new Rectangle(0, 0, plan.tilePxW, plan.tilePxH),
          // 倍率已经在 world 的 scale 上，这里保持 1 免得乘两遍
          resolution: 1,
          antialias: true,
        });
        ctx.drawImage(
          tile as CanvasImageSource,
          col * plan.tilePxW,
          row * plan.tilePxH,
          plan.tilePxW,
          plan.tilePxH,
        );
      }
    }
  } finally {
    // 无论成败都必须复原：失败的导出不能把画面留在奇怪的视口上
    scene.world.scale.set(prevScale);
    scene.world.position.set(prevX, prevY);
    scene.redrawOverlay?.();
  }

  return encodePng(out);
}

/**
 * 弹保存框并落盘，返回写入路径（用户取消时返回 null）。
 *
 * ⚠️ `data` 必须是**字节**。主进程按 `Buffer.from(data)` 原样写盘，
 * 走 `exportFile`（utf8）会得到一个打不开的 PNG 且**不报错**。
 */
export async function savePng(
  bytes: Uint8Array,
  defaultName: string,
): Promise<string | null> {
  const api = window.electronAPI?.novel;
  if (!api?.exportBinary) return null;
  try {
    const result = await api.exportBinary(defaultName, bytes, "png", "PNG 图片");
    return result?.path ?? null;
  } catch {
    return null;
  }
}
