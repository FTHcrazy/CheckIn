/**
 * 地形渲染器 —— **PixiJS v8** 实现（MapPage/map-gl）
 *
 * 选型理由（对比原生 WebGL1 手写上下文管理）：
 * - **资源托管**：program / buffer / texture 生命周期由 Pixi 管理，避免手写 GL 的泄漏
 * - **场景图红利**：Mesh 是 ViewContainer ⇒ 后续 RM5「大小图嵌套」可直接把子图作为
 *   子 Container 挂载，跨尺度过渡复用 transform/opacity，无需重写渲染器
 * - **双后端**：v8 同时支持 WebGL 与 WebGPU；标注层未来若迁到 Pixi 可共享批次
 *
 * 渲染结构：
 *   stage
 *     └ worldContainer (Container)   ← RM5 嵌套层预留
 *          └ Mesh（全屏 quad + 自定义 Shader，uniform 驱动视口）
 *
 * 为什么视口走 uniform 而不是 mesh.position/scale：
 * Pixi 自定义 vertex shader 需自行应用 uProjectionMatrix/uTransformMatrix 等内部矩阵，
 * 强耦合内部命名。本项目把世界→屏幕换算写进自己的 uniform（uViewOffset/uViewScale），
 * 与后端实现解耦 —— 代价是暂不用场景图位移，收益是不依赖 Pixi 内部约定。
 * ⚠️ uniform 语义必须与 Canvas2D 层**完全同构**（screen = world * scale + t），
 * 否则平移/缩放后地形会与河流 ribbon、地点钉反向错位（详见 shaders.ts 顶点着色器注释）。
 *
 * ⚠️ 踩过的两个坑（已在代码里固化，勿回退）：
 * 1. **顶点属性必须叫 `aPosition`**：Pixi 用 `MeshGeometry` 固定属性名做校验，写成
 *    自定义名会在每次 `render()` 抛 "geometry missing the ... attribute" —— 而首帧
 *    校验失败会连带 shader 反复重建，把主线程占满（表现为整窗无响应）。
 * 2. **`dispose()` 会 loseContext**（Pixi `GlContextSystem.destroy` 内部强制调用）：
 *    所以**同一个 canvas 不能跨实例复用**，必须一个渲染器一个 canvas（见 useTerrainGl）。
 *
 * 自检：首帧做「空场清屏 vs 有地形」两次 5 点回读比对，全等即判定空帧并抛错，
 * 由 hook 降级 Canvas2D —— 保证任何 GL 失效都不会留下「一片空白的画布」。
 */
import { Application, BufferImageSource, Container, Mesh, MeshGeometry, Shader } from "pixi.js";
import type { BuiltWorld } from "../map-terrain";
import { paintedCells } from "../map-terrain";
import { COAST_LINE, COAST_SAND, TERRAIN_BORDER_COLORS, TERRAIN_COLORS } from "../map-symbols";
import { FRAG_SRC, GL_BACKGROUND, VERT_SRC } from "./shaders";
import {
  buildSplatMaps,
  hexToRgb01,
  patchSplatMaps,
  MAX_TERRAIN_TYPES,
  type SplatMaps,
} from "./terrain-splat";

/** 大尺度域扰动幅度（单位：格；越大轮廓越「手绘」） */
const DEFAULT_WARP = 1.0;
/** 子格域扰动：打碎 1 格栅格台阶的关键（幅度 / 频率 格⁻¹） */
const DEFAULT_WARP2 = 0.18;
const DEFAULT_WARP2_FREQ = 0.62;
/** GL 层最大设备像素比（地形是软边界，无需满 DPR；这是 60fps 的关键闸门） */
const MAX_DPR = 1.5;
/** 空帧自检的采样点（归一化坐标） */
const PROBE_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

export interface TerrainViewport {
  tx: number;
  ty: number;
  scale: number;
}

export interface DrawOptions {
  /** 动画时间（秒） */
  time: number;
  /** 是否运行流动动画 */
  animate: boolean;
}

export interface TerrainRenderer {
  setWorld(world: BuiltWorld): void;
  patchCells(dirty: Iterable<number>): void;
  draw(viewport: TerrainViewport, opts: DrawOptions): void;
  /** 同步画布尺寸（CSS px + DPR）；尺寸未变时为空操作 */
  resize(cssWidth: number, cssHeight: number, dpr: number): boolean;
  /**
   * 调参：域扰动幅度（单位：格）。
   * @param low 大尺度轮廓扰动（默认 1.0）
   * @param high 子格细碎扰动（默认 0.18；调大 → 台阶被打得更散，但线条更毛）
   * @param highFreq 子格扰动频率 格⁻¹（默认 0.62）
   */
  setWarp(low: number, high?: number, highFreq?: number): void;
  /** 上下文/渲染器是否已失效 */
  isLost(): boolean;
  dispose(): void;
}

/** uniform 容器的最小形状（Pixi 的 resources 是 any-indexed，这里显式收窄） */
interface UniformGroupLike {
  uniforms: Record<string, number | number[]>;
}

export interface TerrainRendererOptions {
  /**
   * 软覆盖度模糊轮数：0 = 关闭（直接用 one-hot + LINEAR 的 1 纹素过渡带）。
   * 默认 SOFT_PASSES；用于对比「硬边界 + 子格扰动」与「软场」两种观感。
   */
  softPasses?: number;
}

/**
 * 创建 Pixi 地形渲染器；初始化失败（无 WebGL/WebGPU）返回 null，调用方走 Canvas2D 回退。
 * 注意：**异步**，Pixi 的 Application.init 本身就是 Promise。
 * canvas 由调用方提供且**必须是一次性的**（dispose 会 loseContext，不可复用）。
 */
export async function createTerrainRenderer(
  canvas: HTMLCanvasElement,
  options: TerrainRendererOptions = {},
): Promise<TerrainRenderer | null> {
  const app = new Application();
  try {
    await app.init({
      canvas,
      width: Math.max(1, canvas.clientWidth || 1),
      height: Math.max(1, canvas.clientHeight || 1),
      resolution: 1,
      autoDensity: false,
      background: GL_BACKGROUND,
      antialias: false,
      preference: "webgl",
      powerPreference: "high-performance",
      // 不需要 Pixi 自带 ticker：地形层由调用方按需 render（静止即零开销）
      autoStart: false,
    });
  } catch (err) {
    console.error("[map-gl] pixi init failed:", err);
    return null;
  }
  app.ticker.stop();

  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // ── geometry：覆盖世界矩形的 quad（triangle-strip）──
  // attribute 名 aPosition / aUV 由 MeshGeometry 固定，shader 里必须同名引用
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2, 3]),
    topology: "triangle-strip",
  });

  // ── splat 贴图（1×1 占位，setWorld 时按 cols×rows 重建）──
  // ⚠️ 3 个必踩的坑（都已固化，勿回退）：
  // 1. **必须用 BufferImageSource**：裸 `new TextureSource({resource: Uint8Array})` 的
  //    uploadMethodId 是 "unknown"，Pixi 走 _initEmptyTexture2D 只分配**空贴图**，
  //    缓冲区永远不会上传（画面退化成一片地形 0 = 纯海色）。
  // 2. **必须 alphaMode: "no-premultiply-alpha"**：Pixi 默认是
  //    "premultiply-alpha-on-upload"，上传时置 UNPACK_PREMULTIPLY_ALPHA_WEBGL，
  //    把 RGB 乘以 alpha/255。而本项目的 splat **把 alpha 当作第 4 个地形通道**
  //    （地形 3/7 所在格 alpha=255，其余格 alpha=0）⇒ 非 alpha 通道的地形数据
  //    全被乘成 0，画面只剩「海 + 沙漠 + 雪山」三种颜色。
  // 3. **顶点属性必须叫 aPosition**（见 shaders.ts 注释）。
  const sources: BufferImageSource[] = [];
  for (let i = 0; i < 3; i++) {
    sources.push(
      new BufferImageSource({
        resource: new Uint8Array([0, 0, 0, 255]),
        width: 1,
        height: 1,
        format: "rgba8unorm",
        alphaMode: "no-premultiply-alpha",
        scaleMode: "linear",
        addressMode: "clamp-to-edge",
        antialias: false,
      }),
    );
  }

  const shader = Shader.from({
    gl: { vertex: VERT_SRC, fragment: FRAG_SRC },
    resources: {
      terrainUniforms: {
        uViewOffset: { value: [0, 0], type: "vec2<f32>" },
        uViewScale: { value: 1, type: "f32" },
        uCanvasSize: { value: [1, 1], type: "vec2<f32>" },
        uCell2: { value: [16, 16], type: "vec2<f32>" },
        uGridSize: { value: [1, 1], type: "vec2<f32>" },
        uTime: { value: 0, type: "f32" },
        uAnim: { value: 0, type: "f32" },
        uWarp: { value: DEFAULT_WARP, type: "f32" },
        uWarp2: { value: DEFAULT_WARP2, type: "f32" },
        uWarp2Freq: { value: DEFAULT_WARP2_FREQ, type: "f32" },
        uSeed: { value: 0, type: "f32" },
        uCoastSand: { value: hexToRgb01(COAST_SAND), type: "vec3<f32>" },
        uCoastLine: { value: hexToRgb01(COAST_LINE), type: "vec3<f32>" },
        ...colorUniforms("uColor", TERRAIN_COLORS),
        ...colorUniforms("uBorder", TERRAIN_BORDER_COLORS),
      },
      uSplat0: sources[0],
      uSplat1: sources[1],
      uSplat2: sources[2],
    },
  });

  const mesh = new Mesh({ geometry, shader });
  worldContainer.addChild(mesh);

  let world: BuiltWorld | null = null;
  let maps: SplatMaps | null = null;
  let disposed = false;
  /** 已应用的画布尺寸（CSS px / DPR），用于「尺寸未变即空操作」 */
  let lastCssW = 0;
  let lastCssH = 0;
  let lastDpr = 0;
  /** 首帧空场自检是否已完成 */
  let verified = false;

  const group = shader.resources.terrainUniforms as UniformGroupLike;
  const gl = (app.renderer as unknown as { gl: WebGLRenderingContext }).gl;

  function uploadAll(): void {
    if (!world || !maps) return;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      // 上传的是软覆盖度场（模糊 + 加权），one-hot 原始场只用于 patch 语义
      // 顺序要紧：先换 resource 再 resize，否则 resize 事件会拿旧缓冲按新尺寸上传
      src.resource = maps.soft[i];
      src.resize(world.cols, world.rows);
      src.update();
    }
  }

  /** 读回 canvas 上 5 个采样点的像素（需与 render 同一 task 内调用） */
  function samplePoints(): Uint8Array {
    const w = canvas.width;
    const h = canvas.height;
    const out = new Uint8Array(PROBE_POINTS.length * 4);
    for (let i = 0; i < PROBE_POINTS.length; i++) {
      const x = Math.min(w - 1, Math.max(0, Math.round(PROBE_POINTS[i][0] * w)));
      const y = Math.min(h - 1, Math.max(0, Math.round(PROBE_POINTS[i][1] * h)));
      const px = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.set(px, i * 4);
    }
    return out;
  }

  function isSameSample(a: Uint8Array, b: Uint8Array): boolean {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /**
   * 自检专用视口：把**整幅世界**缩进画布。
   *
   * ⚠️ 必须与用户视口解耦：早先直接用调用方传来的 viewport，一旦视口落在世界之外
   * （刚打开时的历史视口、平移到图外）整帧就是清屏色，自检会把「用户看不到地形」
   * 误判成「渲染器坏了」→ 永久回退 Canvas2D（地图之后一直是方块感）。
   */
  function selfCheckViewport(): TerrainViewport {
    const cw = Math.max(1, lastCssW || canvas.clientWidth);
    const ch = Math.max(1, lastCssH || canvas.clientHeight);
    const w = world?.width ?? 1;
    const h = world?.height ?? 1;
    const scale = Math.min(cw / w, ch / h);
    // 与 2D 层同构：screen = world * scale + t
    return { tx: (cw - w * scale) / 2, ty: (ch - h * scale) / 2, scale };
  }

  /**
   * 首帧自检：先渲染一次「隐藏地形」拿清屏色，再渲染正常帧并比对 5 个采样点。
   * 全部与清屏色完全一致 ⇒ 地形一个像素都没画出来 ⇒ 抛错交 hook 回退 Canvas2D。
   * 只在每个渲染器实例上跑一次（约 0.1ms），不进入稳态热路径。
   */
  function verifyFirstFrame(): void {
    const vp = selfCheckViewport();
    mesh.visible = false;
    uploadAll();
    applyViewport(vp, 0, false);
    app.render();
    const clearSample = samplePoints();

    mesh.visible = true;
    applyViewport(vp, 0, false);
    app.render();
    const framebufferSample = samplePoints();

    if (isSameSample(clearSample, framebufferSample)) {
      console.error(
        "[map-gl] 自检失败样本 " +
          JSON.stringify({
            clear: Array.from(clearSample),
            frame: Array.from(framebufferSample),
            backing: [canvas.width, canvas.height],
            css: [canvas.clientWidth, canvas.clientHeight],
            selfCheckVp: vp,
            grid: world ? [world.cols, world.rows] : null,
          }),
      );
      throw new Error("map-gl: 首帧为空（地形未产生任何像素），回退 Canvas2D");
    }
  }

  function applyViewport(viewport: TerrainViewport, time: number, animate: boolean): void {
    if (!world) return;
    const u = group.uniforms;
    u.uViewOffset = [viewport.tx, viewport.ty];
    u.uViewScale = viewport.scale;
    u.uCanvasSize = [lastCssW || canvas.clientWidth || 1, lastCssH || canvas.clientHeight || 1];
    u.uCell2 = [world.cell, world.cell];
    u.uGridSize = [world.cols, world.rows];
    u.uTime = time;
    u.uAnim = animate ? 1 : 0;
    u.uSeed = (world.snum % 9973) / 97;
  }

  return {
    setWorld(next) {
      if (disposed) return;
      const needGeo = !world || world.width !== next.width || world.height !== next.height;
      world = next;
      // ⚠️ splat 必须喂**地表底质**（河格已回填）：河由 2D 层按 pts 单独绘制，
      //    若这里继续用含河格的 cells，就会刷出一片宽水面与 2D 水带并排错位
      //    —— 这正是「水道不连贯、水里还有山」的老病根（详见 map-render 文件头）。
      maps = buildSplatMaps(paintedCells(next), next.cols, next.rows, options.softPasses);
      if (needGeo) {
        geometry.positions = new Float32Array([
          0, 0,
          next.width, 0,
          0, next.height,
          next.width, next.height,
        ]);
      }
      // 世界换了（含尺寸/种子），自检重跑一次
      verified = false;
      uploadAll();
    },

    patchCells(dirty) {
      if (disposed || !world || !maps) return;
      patchSplatMaps(maps, dirty, paintedCells(world));
      uploadAll();
    },

    draw(viewport, opts) {
      if (disposed || !world) return;
      // 视口必须是有限值且缩放为正：NaN/Infinity 会让顶点变换全变 NaN，
      // 整帧为空并触发首帧自检 → 永久回退（用户表现为地图忽然变回方块感）
      if (!Number.isFinite(viewport.tx) || !Number.isFinite(viewport.ty) || !(viewport.scale > 0)) return;
      // 尚未完成布局（尺寸为 0）时跳过本轮：此时自检必然误判为空帧
      const cw = lastCssW || canvas.clientWidth;
      const ch = lastCssH || canvas.clientHeight;
      if (cw < 2 || ch < 2) return;
      if (!verified) {
        verifyFirstFrame();
        verified = true;
      }
      applyViewport(viewport, opts.time, opts.animate);
      app.render();
    },

    resize(cssWidth, cssHeight, dpr) {
      if (disposed) return false;
      const w = Math.max(1, Math.round(cssWidth));
      const h = Math.max(1, Math.round(cssHeight));
      const d = Math.min(Math.max(dpr, 1), MAX_DPR);
      // 与「上次请求值」比对：Pixi 的 renderer.width 是 dpr 后的背衬尺寸，不能拿来比
      if (w === lastCssW && h === lastCssH && d === lastDpr) return false;
      lastCssW = w;
      lastCssH = h;
      lastDpr = d;
      app.renderer.resolution = d;
      app.renderer.resize(w, h);
      (group.uniforms as Record<string, number | number[]>).uCanvasSize = [w, h];
      return true;
    },

    setWarp(low, high, highFreq) {
      const u = group.uniforms;
      u.uWarp = Math.max(0, low);
      if (high !== undefined) u.uWarp2 = Math.max(0, high);
      if (highFreq !== undefined) u.uWarp2Freq = Math.max(0.01, highFreq);
    },

    isLost() {
      return disposed || gl.isContextLost();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // 首个参数为 renderer destroy 选项：保留 canvas 本身，由调用方决定是否摘除。
      // Application.destroy 在类型上声明为无参（运行时由 mixin 扩展），故此处收窄断言。
      type AppDestroy = (
        rendererOptions?: { removeView?: boolean },
        stageOptions?: { children?: boolean; texture?: boolean; textureSource?: boolean },
      ) => void;
      (app.destroy as unknown as AppDestroy)(
        { removeView: false },
        { children: true, texture: true, textureSource: true },
      );
    },
  };
}

/** 地形配色 → Pixi uniform 声明（与 TERRAIN_COLORS 同源，禁止在此另写一份） */
function colorUniforms(
  prefix: string,
  colors: readonly string[],
): Record<string, { value: number[]; type: "vec3<f32>" }> {
  const out: Record<string, { value: number[]; type: "vec3<f32>" }> = {};
  for (let i = 0; i < MAX_TERRAIN_TYPES; i++) {
    out[`${prefix}${i}`] = {
      value: hexToRgb01(colors[i] ?? "#cccccc"),
      type: "vec3<f32>",
    };
  }
  return out;
}
