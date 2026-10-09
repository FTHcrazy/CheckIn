import { useEffect, useState } from "react";
import { Assets, Texture } from "pixi.js";
import { BASE_IMAGE, SPRITES } from "../sprites";

/** 已加载纹理表：key = 素材 id（底图用 BASE_IMAGE.id） */
export type TextureMap = Record<string, Texture>;

/**
 * 纹理预加载（PixiJS Assets）。
 *
 * 与 Canvas 2D 版本的区别：这里加载的是 GPU 纹理而非 HTMLImageElement。
 * Pixi v8 的 `Assets.load` 自带缓存，同一 URL 重复加载不会重复解码，
 * 所以切窗口/重挂载的开销很小。
 *
 * 全部素材共 6 张（含底图），总量约 270KB，一次性加载即可。
 *
 * ── 生命周期（重要）──
 * 这里**故意不使用「只跑一次」的 ref 守卫**。
 * React 19 的 StrictMode（本项目 MapWindow/main.tsx 用
 * `createRoot().render(<StrictMode>)` 挂载）会把 effect 跑成
 * 「挂载 → 卸载 → 再挂载」。若用 ref 拦住第二次挂载，而第一次的加载
 * 又已被 cleanup 判为失效（alive=false），两边就都不会把结果写回 state
 * —— `ready` 恒为 false，画布永久停在「素材加载中…」。
 *
 * 因此：每次挂载都发起一次加载，cleanup 的 `alive` 只判定
 * 「本次挂载是否仍然有效」。重复调用由 `Assets.load` 的缓存兜底。
 */
export function useTextureCache() {
  const [textures, setTextures] = useState<TextureMap>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 只标记「本次挂载」是否有效；重挂载会产生新的闭包，互不干扰
    let alive = true;

    const targets: { id: string; src: string }[] = [
      { id: BASE_IMAGE.id, src: BASE_IMAGE.src },
      ...SPRITES.map((s) => ({ id: s.id, src: s.src })),
    ];

    (async () => {
      const map: TextureMap = {};
      // 逐张加载：单张失败不阻塞整体，缺图时绘制层跳过该元素
      await Promise.all(
        targets.map(async ({ id, src }) => {
          try {
            const texture = await Assets.load<Texture>(src);
            // 底图与素材都可能被非整数倍缩放，线性过滤更平滑
            texture.source.scaleMode = "linear";
            map[id] = texture;
          } catch (err) {
            console.warn(`[map] 素材加载失败: ${id} (${src})`, err);
          }
        }),
      );
      if (!alive) return;
      setTextures(map);
      setReady(true);
    })();

    return () => {
      alive = false;
    };
  }, []);

  return { textures, ready };
}
