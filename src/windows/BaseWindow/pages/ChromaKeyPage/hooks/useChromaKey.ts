/**
 * 色键抠图的状态与像素处理（页面唯一持有 canvas 的地方）。
 *
 * 三段画布：
 * - `source`（离屏，原分辨率）：只读的原图，吸管取值也从它上面取；
 * - `result`（离屏，原分辨率）：套用色键后的结果，导出 PNG 就是它；
 * - `preview`（屏幕上那个）：棋盘格 + 缩放后的结果，只负责看。
 *
 * 容差 / 软边改动会在 120ms 后重算：滑块拖动时每帧都跑一遍全分辨率像素循环，
 * 大图上会直接把窗口拖卡（参考实现就是每帧重算，本页刻意加了这一层合并）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/shared/utils/download";
import {
  DEFAULT_FEATHER,
  DEFAULT_KEY_COLOR,
  DEFAULT_TOLERANCE,
  applyChromaKey,
  buildCutoutName,
  removedRatio,
  type RgbColor,
} from "../chroma-key-utils";

/** 预览画布的尺寸上限（与原图分辨率解耦） */
const PREVIEW_MAX_WIDTH = 680;
const PREVIEW_MAX_HEIGHT = 420;
/** 参数连续变化时的合并窗口 */
const APPLY_DELAY_MS = 120;

export interface ChromaImageInfo {
  name: string;
  width: number;
  height: number;
}

function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** 透明底棋盘格：取主题的面板色，暗色主题下不会突然闪一块纯白 */
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

export function useChromaKey() {
  const [key, setKey] = useState<RgbColor>(DEFAULT_KEY_COLOR);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [feather, setFeather] = useState(DEFAULT_FEATHER);
  const [image, setImage] = useState<ChromaImageInfo | null>(null);
  const [removed, setRemoved] = useState(0);
  const [error, setError] = useState("");
  /** 换图计数：用来区分「首次应用」与「参数微调」 */
  const [version, setVersion] = useState(0);

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<HTMLCanvasElement | null>(null);
  const resultRef = useRef<HTMLCanvasElement | null>(null);
  const appliedVersionRef = useRef(0);

  const applyNow = useCallback(() => {
    const source = sourceRef.current;
    const preview = previewRef.current;
    if (!source || !preview) return;

    const sourceCtx = source.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx) return;
    const frame = sourceCtx.getImageData(0, 0, source.width, source.height);
    const outcome = applyChromaKey(frame.data, { key, tolerance, feather });

    if (!resultRef.current) resultRef.current = document.createElement("canvas");
    const result = resultRef.current;
    result.width = source.width;
    result.height = source.height;
    result.getContext("2d")?.putImageData(frame, 0, 0);

    const scale = Math.min(
      PREVIEW_MAX_WIDTH / source.width,
      PREVIEW_MAX_HEIGHT / source.height,
      1,
    );
    preview.width = Math.max(1, Math.round(source.width * scale));
    preview.height = Math.max(1, Math.round(source.height * scale));
    const previewCtx = preview.getContext("2d");
    if (previewCtx) {
      drawCheckerboard(previewCtx, preview.width, preview.height);
      previewCtx.imageSmoothingEnabled = true;
      previewCtx.imageSmoothingQuality = "high";
      previewCtx.drawImage(result, 0, 0, preview.width, preview.height);
    }

    setRemoved(removedRatio(outcome.removed, source.width, source.height));
  }, [key, tolerance, feather]);

  useEffect(() => {
    if (!sourceRef.current) return;
    // 换图后立刻出结果，参数微调才走合并窗口
    const firstApply = appliedVersionRef.current !== version;
    const timer = window.setTimeout(() => {
      appliedVersionRef.current = version;
      applyNow();
    }, firstApply ? 0 : APPLY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [version, applyNow]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
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
      setVersion((value) => value + 1);
      URL.revokeObjectURL(url);
    };
    element.onerror = () => {
      setError("图片解码失败，格式可能不受支持");
      URL.revokeObjectURL(url);
    };
    element.src = url;
  }, []);

  /** 吸管：点预览画布取原图对应位置的像素（按显示尺寸换算，CSS 缩放也准） */
  const pickAt = useCallback(
    (clientX: number, clientY: number, rect: DOMRect): void => {
      const source = sourceRef.current;
      if (!source || rect.width <= 0 || rect.height <= 0) return;
      const x = Math.floor(((clientX - rect.left) / rect.width) * source.width);
      const y = Math.floor(((clientY - rect.top) / rect.height) * source.height);
      if (x < 0 || y < 0 || x >= source.width || y >= source.height) return;
      const ctx = source.getContext("2d", { willReadFrequently: true });
      const pixel = ctx?.getImageData(x, y, 1, 1).data;
      if (!pixel || pixel[3] === 0) return;
      setKey({ r: pixel[0], g: pixel[1], b: pixel[2] });
    },
    [],
  );

  const reset = useCallback(() => {
    setKey(DEFAULT_KEY_COLOR);
    setTolerance(DEFAULT_TOLERANCE);
    setFeather(DEFAULT_FEATHER);
  }, []);

  const exportPng = useCallback(async (): Promise<boolean> => {
    const result = resultRef.current;
    if (!result) return false;
    const blob = await new Promise<Blob | null>((resolve) => {
      result.toBlob((value) => resolve(value), "image/png");
    });
    if (!blob) return false;
    downloadBlob(blob, buildCutoutName(image?.name ?? "image.png"));
    return true;
  }, [image]);

  return {
    key,
    tolerance,
    feather,
    image,
    removed,
    error,
    previewRef,
    hasImage: image !== null,
    loadFile,
    pickAt,
    reset,
    exportPng,
    setKey,
    setTolerance,
    setFeather,
  };
}
