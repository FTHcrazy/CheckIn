/**
 * 证件照换底色的类型与常量（纯数据，无 DOM）。
 *
 * 尺寸与底色预设取自参考页的实际档位（1寸/2寸/小1寸/大1寸、白/红/蓝…），
 * 但色调做了证件照场景的收敛：参考页还给了绿/黄/紫，实务上没人拿它当证件照
 * 底色，这里换成浅蓝/灰/深蓝三档更常用的。
 */

export type BackdropRender = "solid" | "gradient-y" | "gradient-radial";

/** 前景在目标画布里的缩放方式 */
export type FitMode = "contain" | "cover";

/**
 * 图片在画框里的锚点，`-1` = 贴左上、`0` = 居中、`1` = 贴右下。
 *
 * 用连续值而不是三档枚举，是因为三档枚举解决不了「人脸正好卡在两个档位之间」
 * ——真人照片的头部位置没有规律，只能让作者自己拖到位。
 */
export const OFFSET_MIN = -1;
export const OFFSET_MAX = 1;

export interface PhotoSizePreset {
  key: string;
  label: string;
  /** 毫米尺寸，仅用于提示文案 */
  mm: string;
  width: number;
  height: number;
}

/** 300 DPI 下的像素尺寸 */
export const PHOTO_SIZE_PRESETS: PhotoSizePreset[] = [
  { key: "1inch", label: "1 寸", mm: "25×35mm", width: 295, height: 413 },
  { key: "2inch", label: "2 寸", mm: "35×49mm", width: 413, height: 579 },
  { key: "small-1inch", label: "小 1 寸", mm: "30×37mm", width: 358, height: 441 },
  { key: "large-1inch", label: "大 1 寸", mm: "33×48mm", width: 390, height: 567 },
];

export interface BackdropPreset {
  key: string;
  label: string;
  color: string;
}

export const BACKDROP_PRESETS: BackdropPreset[] = [
  { key: "white", label: "白底", color: "#FFFFFF" },
  { key: "red", label: "红底", color: "#D9001B" },
  { key: "blue", label: "蓝底", color: "#438EDB" },
  { key: "light-blue", label: "浅蓝", color: "#A4D3EE" },
  { key: "gray", label: "灰底", color: "#ECECEC" },
  { key: "deep-blue", label: "深蓝", color: "#1A5FB4" },
];

export interface IdPhotoOptions {
  /** 成品宽（像素） */
  width: number;
  /** 成品高（像素） */
  height: number;
  /** 底色，`#rrggbb` */
  backdrop: string;
  render: BackdropRender;
  fit: FitMode;
  /** 水平锚点 -1..1（拖动预览画布即改这个值） */
  offsetX: number;
  /** 垂直锚点 -1..1 */
  offsetY: number;
  /** 背景容差 0-100（百分比，与色键页同一把尺子） */
  tolerance: number;
  /** 边缘羽化半径（像素），0 = 硬切 */
  feather: number;
  /** 去色边强度 0-1（消除原底色在前景边缘留下的色环） */
  decontaminate: number;
  /** 输出 DPI，只写进 JPG 的 JFIF 头 */
  dpi: number;
  /** JPG 质量 0-1 */
  quality: number;
}

export const DEFAULT_OPTIONS: IdPhotoOptions = {
  width: 295,
  height: 413,
  backdrop: "#FFFFFF",
  render: "solid",
  fit: "contain",
  offsetX: 0,
  offsetY: 0,
  tolerance: 12,
  feather: 2,
  decontaminate: 0.6,
  dpi: 300,
  quality: 0.92,
};

export interface PhotoImageInfo {
  name: string;
  width: number;
  height: number;
}

/** 抠图结果的可视化统计 */
export interface MatteStats {
  /** 判为背景的像素占比 0-1 */
  removedRatio: number;
  /** 边缘过渡像素数 */
  feathered: number;
  /** 采样到的背景色（`#rrggbb`），供「底色建议」展示 */
  borderColor: string;
  /** 边界可用种子占比 0-1；过低说明背景不是纯色，自动抠图不可靠 */
  seedRatio: number;
}
