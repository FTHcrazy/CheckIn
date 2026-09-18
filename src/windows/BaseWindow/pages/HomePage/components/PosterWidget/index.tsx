import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/shared/theme/theme-context";
import { resolvePosterColors } from "./posterArtwork";
import { createPosterEngine, type PosterEngine } from "./posterEngine";
import "./index.scss";

/**
 * 主页右下角的海报装饰件：WebGL 柔性卷曲纸张，悬停舒展、离开回卷。
 *
 * - 主题切换时通过 setColors 重绘贴图（不重建 GL 上下文）
 * - WebGL 不可用时整体隐藏（纯装饰件，无降级占位）
 * - rAF 仅在弹簧动画期间运行，静止即停
 */
export default function PosterWidget() {
  const { meta } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PosterEngine | null>(null);
  const [available, setAvailable] = useState(true);

  // 创建（仅首次）与主题换色；deps 用 meta：首帧创建引擎，之后只重绘贴图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const existing = engineRef.current;
    if (existing) {
      existing.setColors(resolvePosterColors(meta));
      return;
    }

    let engine: PosterEngine | null;
    try {
      engine = createPosterEngine(canvas, resolvePosterColors(meta));
    } catch (err) {
      console.error("[PosterWidget] 引擎创建异常:", err);
      engine = null;
    }
    if (!engine) {
      console.warn("[PosterWidget] WebGL 不可用，海报装饰件已降级隐藏");
      setAvailable(false);
      return;
    }
    engineRef.current = engine;
  }, [meta]);

  // 卸载：释放 GL 资源 / 事件 / 动画
  useEffect(() => {
    const engine = engineRef.current;
    return () => {
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, []);

  if (!available) return null;
  return (
    <canvas ref={canvasRef} className="poster-widget" aria-hidden="true" />
  );
}
