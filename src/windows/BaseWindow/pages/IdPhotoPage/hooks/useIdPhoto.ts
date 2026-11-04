/**
 * 证件照换底色的状态与像素编排（页面里唯一持有画布的地方）。
 *
 * 四级画布，各管一段，避免互相污染：
 * - `source`（离屏，原分辨率）：只读原图；
 * - `matte`（离屏，原分辨率）：抠好的透明前景，导出透明底就是它；
 * - `result`（离屏，目标尺寸）：铺了底色的成品，导出 JPG 就是它；
 * - `preview`（屏幕上那个）：缩放后的视图，只负责看。
 *
 * 抠图与合成拆成两段重算：改容差要重抠，改底色/尺寸只要重合成。
 * 前者是几百万像素的循环，必须 120ms 合并；后者只是一次 drawImage，立即执行。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/shared/utils/download";
import {
  BACKDROP_PRESETS,
  DEFAULT_OPTIONS,
  type IdPhotoOptions,
  type MatteStats,
  type PhotoImageInfo,
} from "../id-photo-types";
import { matteBackground, isPlainBackdrop } from "../id-photo-matting";
import { composePhoto, toJpegBlob, toPngBlob } from "../id-photo-render";
import { buildIdPhotoName, clampDimension, clampOffset, fitRect, normalizeHex, panDelta } from "../id-photo-utils";

/** 预览画布的逻辑上限（成品放不下时按比例缩） */
const PREVIEW_MAX_WIDTH = 620;
const PREVIEW_MAX_HEIGHT = 460;
/** 成品小于这个尺寸时允许放大，否则 295×413 在预览区里小得看不清 */
const PREVIEW_MAX_ZOOM = 1.6;
/** 抠图参数连续变化时的合并窗口 */
const MATTE_DELAY_MS = 120;

export type PhotoView = "original" | "result" | "cutout";

function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** 透明底棋盘格：取主题面板色，暗色主题下不会突然闪一块纯白 */
function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const cell = 10;
  const light = themeColor("--app-surface", "#ffffff");
  const dark = themeColor("--app-surface-alt", "#dddddd");
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? dark : light;
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

export function useIdPhoto() {
  const [options, setOptions] = useState<IdPhotoOptions>(DEFAULT_OPTIONS);
  const [image, setImage] = useState<PhotoImageInfo | null>(null);
  const [stats, setStats] = useState<MatteStats | null>(null);
  const [view, setView] = useState<PhotoView>("original");
  const [error, setError] = useState("");
  /** 换图计数：区分「首次抠图」与「参数微调」 */
  const [version, setVersion] = useState(0);
  /** 各阶段完成计数，用来串起「抠图 → 合成 → 预览」 */
  const [matteTick, setMatteTick] = useState(0);
  const [composeTick, setComposeTick] = useState(0);

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const matteRef = useRef<HTMLCanvasElement | null>(null);
  const resultRef = useRef<HTMLCanvasElement | null>(null);
  const appliedVersionRef = useRef(-1);

  const patch = useCallback((next: Partial<IdPhotoOptions>) => {
    setOptions((prev) => ({ ...prev, ...next }));
  }, []);

  // ① 抠图：容差 / 羽化 / 去色边 / 换图
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || !image) return;

    const firstApply = appliedVersionRef.current !== version;
    const timer = window.setTimeout(
      () => {
        appliedVersionRef.current = version;
        const ctx = source.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;

        const frame = ctx.getImageData(0, 0, source.width, source.height);
        const outcome = matteBackground(frame.data, source.width, source.height, {
          tolerance: options.tolerance,
          feather: options.feather,
          decontaminate: options.decontaminate,
        });

        const canvas = matteRef.current ?? document.createElement("canvas");
        matteRef.current = canvas;
        canvas.width = source.width;
        canvas.height = source.height;
        const matteCtx = canvas.getContext("2d");
        if (!matteCtx) return;

        const output = matteCtx.createImageData(source.width, source.height);
        output.data.set(outcome.data);
        matteCtx.putImageData(output, 0, 0);

        setStats(outcome.stats);
        setMatteTick((value) => value + 1);
      },
      firstApply ? 0 : MATTE_DELAY_MS,
    );

    return () => window.clearTimeout(timer);
  }, [
    image,
    version,
    options.tolerance,
    options.feather,
    options.decontaminate,
  ]);

  // ② 合成：底色 / 尺寸 / 缩放方式 / 上一步的新前景
  useEffect(() => {
    const matte = matteRef.current;
    if (!matte) return;

    const canvas = resultRef.current ?? document.createElement("canvas");
    resultRef.current = canvas;
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    composePhoto(ctx, {
      foreground: matte,
      foregroundSize: { width: matte.width, height: matte.height },
      options,
    });
    setComposeTick((value) => value + 1);
  }, [
    matteTick,
    // setOptions 恒新建对象，整包依赖足以覆盖底色/尺寸/缩放方式的所有变化
    options,
  ]);

  // ③ 预览：视图切换或任一阶段更新后重画
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const target =
      view === "original"
        ? sourceRef.current
        : view === "cutout"
          ? matteRef.current
          : resultRef.current;
    if (!target) return;

    const zoom = Math.min(
      PREVIEW_MAX_WIDTH / target.width,
      PREVIEW_MAX_HEIGHT / target.height,
      PREVIEW_MAX_ZOOM,
    );
    preview.width = Math.max(1, Math.round(target.width * zoom));
    preview.height = Math.max(1, Math.round(target.height * zoom));

    const ctx = preview.getContext("2d");
    if (!ctx) return;

    // 成品自己带底色，另两个视图靠棋盘格说明「这里是透明的」
    if (view === "result") {
      ctx.clearRect(0, 0, preview.width, preview.height);
    } else {
      drawCheckerboard(ctx, preview.width, preview.height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(target, 0, 0, preview.width, preview.height);
  }, [view, matteTick, composeTick, image, options.width, options.height]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件（JPG / PNG / WebP）");
      return;
    }
    setError("");
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      const source = sourceRef.current ?? document.createElement("canvas");
      sourceRef.current = source;
      source.width = element.naturalWidth;
      source.height = element.naturalHeight;
      const ctx = source.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        setError("无法创建画布上下文，当前环境不支持图片处理");
        URL.revokeObjectURL(url);
        return;
      }
      ctx.clearRect(0, 0, source.width, source.height);
      ctx.drawImage(element, 0, 0);

      setImage({
        name: file.name || "粘贴图片.png",
        width: source.width,
        height: source.height,
      });
      // 换照片就回到居中：新图的构图无从推断，沿用上一张的锚点只会更乱
      setOptions((prev) => ({ ...prev, offsetX: 0, offsetY: 0 }));
      setView("result");
      setVersion((value) => value + 1);
      URL.revokeObjectURL(url);
    };
    element.onerror = () => {
      setError("图片解码失败，格式可能不受支持");
      URL.revokeObjectURL(url);
    };
    element.src = url;
  }, []);

  /**
   * 预览画布上的拖动 → 锚点增量。
   *
   * 传屏幕位移即可，比例换算全在这里做：预览画布没有设 CSS 尺寸，
   * 它的 `width/height` 就是屏幕像素，因此 `dx` 可以直接和它相除。
   */
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const preview = previewRef.current;
      const current = image;
      if (!preview || !current) return;
      if (preview.width <= 0 || preview.height <= 0) return;
      if (dx === 0 && dy === 0) return;

      setOptions((prev) => {
        const scaled = fitRect(
          current.width,
          current.height,
          prev.width,
          prev.height,
          prev.fit,
          0,
          0,
        );
        const nextX = clampOffset(
          prev.offsetX + panDelta(dx, prev.width, preview.width, scaled.width),
        );
        const nextY = clampOffset(
          prev.offsetY + panDelta(dy, prev.height, preview.height, scaled.height),
        );
        if (nextX === prev.offsetX && nextY === prev.offsetY) return prev;
        return { ...prev, offsetX: nextX, offsetY: nextY };
      });
    },
    [image],
  );

  const reset = useCallback(() => {
    setOptions(DEFAULT_OPTIONS);
  }, []);

  const exportResult = useCallback(async (): Promise<boolean> => {
    const result = resultRef.current;
    if (!result) return false;
    const blob = await toJpegBlob(result, options.quality, options.dpi);
    if (!blob) return false;

    const current = normalizeHex(options.backdrop);
    const label =
      BACKDROP_PRESETS.find((preset) => normalizeHex(preset.color) === current)
        ?.label ?? "证件照";

    downloadBlob(
      blob,
      buildIdPhotoName(
        image?.name ?? "photo.png",
        options.width,
        options.height,
        label,
      ),
    );
    return true;
  }, [image, options.backdrop, options.dpi, options.height, options.quality, options.width]);

  /** 透明底按目标尺寸重排一次，和成品对齐（不是原图尺寸） */
  const exportTransparent = useCallback(async (): Promise<boolean> => {
    const matte = matteRef.current;
    if (!matte) return false;

    const canvas = document.createElement("canvas");
    canvas.width = options.width;
    canvas.height = options.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    composePhoto(ctx, {
      foreground: matte,
      foregroundSize: { width: matte.width, height: matte.height },
      options,
      transparent: true,
    });

    const blob = await toPngBlob(canvas);
    if (!blob) return false;
    downloadBlob(
      blob,
      buildIdPhotoName(
        image?.name ?? "photo.png",
        options.width,
        options.height,
        "",
        true,
      ),
    );
    return true;
  }, [image, options]);

  return {
    options,
    image,
    stats,
    view,
    error,
    previewRef,
    hasImage: image !== null,
    backdropReliable: stats ? isPlainBackdrop(stats.seedRatio) : true,
    loadFile,
    reset,
    panBy,
    exportResult,
    exportTransparent,
    setView,
    patch,
    setError,
    setWidth: (value: number) => patch({ width: clampDimension(value, options.width) }),
    setHeight: (value: number) => patch({ height: clampDimension(value, options.height) }),
  };
}
