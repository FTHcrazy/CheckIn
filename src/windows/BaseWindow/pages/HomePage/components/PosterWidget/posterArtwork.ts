import type { ThemeId, ThemeMeta } from "@/shared/theme/themes";

/**
 * 海报的程序化绘制（正面版式 + 纸背）。
 *
 * 画布内是具体像素，颜色必须为具体色值（与 antd token 同理，不能写 var()）：
 *   - accent / ink / muted 取自 THEME_LIST（与 CSS 变量同源）
 *   - paper / gray 是各主题专属的"纸张色调"，属于海报质感色，非业务变量
 *
 * 贴图约束（WebGL1）：上传纹理的画布两个维度必须是 2 的幂（POT），
 * 否则 generateMipmap 静默失败、采样全黑。绘制保持 512×768，上传前
 * blit 到 512×1024，采样时用 uTexRatio 缩放 v 区间。
 */

export const POSTER_W = 260;
export const POSTER_H = 360;
/** 贴图画布：内容区（宽 × 高） */
export const ART_W = 512;
export const ART_H = 768;
/** 上传纹理高度（POT），内容绘制在顶部 ART_H 区域 */
export const TEX_H = 1024;

/** 纹理采样比率：ART_H / TEX_H，顶点着色器据此缩放 vUv.y */
export const TEX_RATIO = ART_H / TEX_H;

/** 各主题的纸张色板。海报是"纸制品"：纸永远浅色、油墨永远深色，
 * 因此 ink/muted 不取主题 colorText（暗色主题下是浅色，会在浅纸上消失），
 * 而是每主题定义一组与主题色相同色相的深墨；midnight 同样用中性深墨。 */
const PAPER_TONES: Record<
  ThemeId,
  { paper: string; ink: string; gray: string; muted: string }
> = {
  aurora: { paper: "#f9fafc", ink: "#2b2f4a", gray: "#dde1ec", muted: "#5a5f7a" },
  cream: { paper: "#fdf9f0", ink: "#3d3629", gray: "#ece1cc", muted: "#6b6355" },
  mint: { paper: "#f4f9f5", ink: "#24352d", gray: "#dcebe1", muted: "#4a5c52" },
  midnight: { paper: "#f1f1ee", ink: "#2e3138", gray: "#d8d9d4", muted: "#6d7078" },
};

/** 海报绘制所需的一组主题色 */
export interface PosterColors {
  /** 主色：头图色块 / 底部强调条 */
  accent: string;
  /** 油墨色：报头 / 标题条（恒为深色，与主题明暗无关） */
  ink: string;
  /** 纸白（恒为浅色） */
  paper: string;
  /** 正文灰条 */
  gray: string;
  /** 次要文字（刊号 / 页脚，恒为中深色） */
  muted: string;
}

/** 从主题元数据解析海报色板：accent 跟随主题主色，纸张四色取主题专属纸板 */
export function resolvePosterColors(meta: ThemeMeta): PosterColors {
  return { accent: meta.antd.colorPrimary, ...PAPER_TONES[meta.id] };
}

/** #rrggbb → [0..1 × 3]；非法输入返回 [0,0,0] */
export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** #rrggbb + alpha → rgba() 字符串（画布内噪点 / 细线用） */
export function tintRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb01(hex);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(
    b * 255,
  )},${alpha})`;
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  radius: number,
): void {
  ctx.fillStyle = color;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

/** 随机油墨噪点，模拟纸张纤维（轻量，保持版面干净现代） */
function drawPaperGrain(
  ctx: CanvasRenderingContext2D,
  colors: PosterColors,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = tintRgba(colors.ink, 0.008 + Math.random() * 0.02);
    ctx.fillRect(Math.random() * ART_W, Math.random() * ART_H, 1.4, 1.4);
  }
}

/**
 * 正面：现代杂志版式（无衬线报头 + 单分隔线 + 头图色块 + 标题条 +
 * 双栏正文条 + 强调条 + 页脚）。版心避让右上卷角：报头下移至 y=150，
 * 版心 x=48 宽 416。无 serif / 双细线 / 重噪点等复古元素。
 */
export function drawPosterFront(
  ctx: CanvasRenderingContext2D,
  colors: PosterColors,
  opts: { grain?: boolean } = {},
): void {
  ctx.clearRect(0, 0, ART_W, ART_H);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, ART_W, ART_H);
  if (opts.grain !== false) drawPaperGrain(ctx, colors, 500);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = colors.ink;
  ctx.letterSpacing = "6px";
  ctx.font = '800 48px "Segoe UI", sans-serif';
  ctx.fillText("NEWS", 48, 150);
  ctx.letterSpacing = "3px";
  ctx.font = '600 11px "Segoe UI", sans-serif';
  ctx.fillStyle = tintRgba(colors.muted, 0.9);
  ctx.fillText("CHECKIN DAILY · 2026/09", 50, 174);

  ctx.fillStyle = colors.ink;
  ctx.fillRect(48, 186, 416, 2);

  fillRoundRect(ctx, 48, 210, 416, 180, colors.accent, 10);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(48, 210, 416, 26);

  fillRoundRect(ctx, 48, 414, 416, 20, colors.ink, 4);
  fillRoundRect(ctx, 48, 444, 344, 20, colors.ink, 4);
  for (let row = 0; row < 6; row++) {
    const yb = 488 + row * 22;
    fillRoundRect(ctx, 48, yb, 196, 9, colors.gray, 3);
    fillRoundRect(ctx, 260, yb, row === 5 ? 120 : 196, 9, colors.gray, 3);
  }

  fillRoundRect(ctx, 48, 634, 416, 10, colors.accent, 3);
  fillRoundRect(ctx, 48, 656, 300, 10, tintRgba(colors.ink, 0.22), 3);

  ctx.fillStyle = tintRgba(colors.muted, 0.85);
  ctx.letterSpacing = "3px";
  ctx.font = '600 11px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("#CHECKIN · DAILY", 256, 700);
  ctx.textAlign = "left";
  ctx.letterSpacing = "0px";
}

/** 纸背：纸白 + 轻噪点 + 5% 正面透墨（卷折翻面时可见） */
export function drawPosterBack(
  ctx: CanvasRenderingContext2D,
  colors: PosterColors,
  front: HTMLCanvasElement,
): void {
  ctx.clearRect(0, 0, ART_W, ART_H);
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, ART_W, ART_H);
  for (let i = 0; i < 800; i++) {
    ctx.fillStyle = tintRgba(colors.ink, 0.015 + Math.random() * 0.03);
    ctx.fillRect(Math.random() * ART_W, Math.random() * ART_H, 1.3, 1.3);
  }
  ctx.globalAlpha = 0.05;
  ctx.drawImage(front, 0, 0);
  ctx.globalAlpha = 1;
}

/** 把 ART 画布 blit 到 POT 高度的上传画布（内容对齐顶部） */
export function toPOTCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const pot = document.createElement("canvas");
  pot.width = ART_W;
  pot.height = TEX_H;
  pot.getContext("2d")?.drawImage(src, 0, 0);
  return pot;
}
