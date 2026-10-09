import { StrictMode, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * useTextureCache 的 React StrictMode 回归测试。
 *
 * ── 真实缺陷 ──
 * 地图窗口永远停在「素材加载中…」：6 张素材全部加载成功、Promise.all 也已
 * settle，但覆盖层不消失 —— 说明 setReady(true) 根本没执行（alive 为 false）。
 *
 * 根因：原实现用「只跑一次的 ref 守卫」+「cleanup 里 alive=false」的组合。
 * 而 React 19 的 StrictMode（`createRoot().render(<StrictMode>)`，即本项目
 * MapWindow/main.tsx 的真实挂载方式）在开发模式下会把 effect 跑成
 * 「挂载 → 卸载 → 再挂载」：
 *   1. 首次挂载：started=false → 放行，置 started=true，发起加载
 *   2. 首次卸载：cleanup 把 alive 置 false
 *   3. 再次挂载：started 已是 true → 直接 return，不再发起加载
 *   4. 第 1 步那次加载完成后 `if (alive)` 为假 → 既不 setTextures 也不 setReady
 * 净效果：没有任何一次加载能把结果写回 state → ready 恒为 false → 永久 loading。
 *
 * 修复：去掉 ref 守卫，改为「每次挂载都发起一次加载」，cleanup 的 alive
 * 只判定「本次挂载是否仍有效」。Pixi 的 Assets.load 自带缓存，
 * 重复调用不会真的重复解码。
 *
 * ⚠️ 必须用 render() 而不是 renderHook()：
 * renderHook 的 wrapper 不会触发 StrictMode 的 effect 双调用
 * （实测 mountRuns=1/cleanups=0），会导致缺陷被漏测。
 */

/** 挂起中的 resolve/reject 回调（6 张素材并发，故用数组） */
let pending: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
let loadCalls = 0;

vi.mock("pixi.js", () => ({
  Assets: {
    load: vi.fn(() => {
      loadCalls += 1;
      return new Promise((resolve, reject) => {
        pending.push({
          resolve: () => resolve({ width: 10, height: 10, source: {} }),
          reject,
        });
      });
    }),
  },
  Texture: class {},
}));

import { useTextureCache } from "./useTextureCache";

/** 记录 hook 每次渲染后的最新状态（在 effect 中写入，避免 render 期写外部变量） */
const observed = { ready: false, textureCount: 0 };

function Probe() {
  const { textures, ready } = useTextureCache();
  useEffect(() => {
    observed.ready = ready;
    observed.textureCount = Object.keys(textures).length;
  }, [ready, textures]);
  return null;
}

/** 反复放行所有挂起的加载，直到不再产生新的 */
async function flushLoads() {
  for (let i = 0; i < 40; i += 1) {
    const batch = pending;
    pending = [];
    batch.forEach((p) => p.resolve());
    await Promise.resolve();
    if (batch.length === 0) break;
  }
}

describe("useTextureCache（StrictMode 双挂载）", () => {
  it("StrictMode 下仍能把 ready 置为 true（回归：永久 loading）", async () => {
    loadCalls = 0;
    pending = [];
    observed.ready = false;
    observed.textureCount = 0;

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );

    // 初始必然未就绪
    expect(observed.ready).toBe(false);

    // 等加载发起（StrictMode 下两轮都会发起，不锁定具体次数）
    await waitFor(() => expect(loadCalls).toBeGreaterThan(0));

    await flushLoads();

    // 关键断言：StrictMode 下也必须最终 ready，否则画布永久卡在加载态
    await waitFor(() => expect(observed.ready).toBe(true), { timeout: 3000 });
    expect(observed.textureCount).toBeGreaterThan(0);
  });

  it("单张素材失败不阻塞整体就绪", async () => {
    loadCalls = 0;
    pending = [];
    observed.ready = false;
    observed.textureCount = 0;

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await waitFor(() => expect(loadCalls).toBeGreaterThan(0));

    // 让其中一张 reject，其余放行
    const failed = pending.pop();
    failed?.reject(new Error("模拟素材加载失败"));
    await flushLoads();

    await waitFor(() => expect(observed.ready).toBe(true), { timeout: 3000 });
  });
});
