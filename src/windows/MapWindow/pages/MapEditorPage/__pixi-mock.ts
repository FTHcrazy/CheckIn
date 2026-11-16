import { vi } from "vitest";

/**
 * pixi.js 的 mock 工厂（**纯函数**，供拆分后的 index*.test.tsx 共用）。
 *
 * 【为什么单独抽出来】`index.test.tsx` 原先是单个 2214 行的大文件，pixi mock
 * 占了近 200 行且**每个拆分文件都要一份**。`vi.mock` 的工厂不能引用 import 进来的
 * 变量（会被提升到 import 之前执行），所以本文件不能直接 export 一个"成品 mock
 * 对象"给 `vi.mock` 用 —— 而是 export 一个纯工厂 `createPixiMock(probes)`，由各
 * 测试文件在**异步** `vi.mock("pixi.js", async () => ...)` 里 `await import()` 进来，
 * 再把自己 `vi.hoisted` 出来的探针数组传进去（见各 index*.test.tsx 顶部）。
 *
 * 【探针为什么要由调用方注入】`spritePositions` / `labelNodes` 是"渲染层写、断言
 * 读"的观察口，必须与断言共享同一份实例。若写死在本模块里，`vi.mock` 工厂通过
 * 异步 import 拿到的是否与测试文件的静态 import 同一实例，取决于 Vitest 的模块
 * 隔离实现，风险不可控；由调用方 `vi.hoisted` 后显式传参，语义一目了然。
 */

/** 素材精灵位置写入记录（假 Sprite 的 position.set） */
export interface MapEditorProbes {
  spritePositions: { x: number; y: number }[];
  /** 标注文字节点的创建与销毁记录（见 index.test.tsx 原注释） */
  labelNodes: {
    text: string;
    destroyed: boolean;
    /** 字号档（TextStyle.fontSize），用来钉住"手动选字号"真的传到了渲染层 */
    style: { fontSize?: number } | null;
  }[];
}

/**
 * 可 `set` 也可读回 `x/y` 的坐标对象。
 *
 * pixi 的 `ObservablePoint` 就是"用 `.set()` 写、用 `.x/.y` 读"的对象；
 * mock 里如果只给一个空 `set`，断言就读不到写入值（平铺相位这类纯数值断言
 * 全靠它），所以写读两用必须一起给。
 */
function readablePoint() {
  return {
    x: 0,
    y: 0,
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
    },
  };
}

/** 构建 pixi.js 模块替身。只声明被测代码真正用到的成员。 */
export function createPixiMock(probes: MapEditorProbes) {
  const { spritePositions, labelNodes } = probes;
  /** 只声明被测代码真正用到的成员，类型宽松以便子类覆写 */
  type Setter = { set: (...args: number[]) => void };

  class FakeContainer {
    children: unknown[] = [];
    alpha = 1;
    /** 剔除写的就是它；默认 true = 不剔 */
    visible = true;
    /** 风格滤镜挂载点 */
    filters: unknown[] = [];
    scale: Setter = { set: () => {} };
    position: Setter = { set: () => {} };
    addChild(...kids: unknown[]) {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild() {}
    destroy() {}
    /** 剔除读的**局部**包围盒（与视口无关，可缓存）：原点零矩形 ⇒ 默认不剔 */
    getLocalBounds() {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    /** 局部 → 舞台：jsdom 无真实变换，恒等即可 */
    toGlobal(point: { x: number; y: number }) {
      return { x: point.x, y: point.y };
    }
    /** 静态层缓存（jsdom 无 WebGL）：只记"调过" */
    cacheAsTexture = vi.fn();
    updateCacheTexture = vi.fn();
  }

  class FakeSprite extends FakeContainer {
    anchor: Setter = { set: () => {} };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
    /**
     * 素材精灵的缩放（可读写的 x/y）：P1-4 镜像翻转写的就是 `scale.x` 的符号，
     * mock 必须给数值字段让断言能读回翻面方向（父类只有 noop 的 `set`）。
     */
    scale = { x: 1, y: 1, set: () => {} };
    /** 素材精灵的落位写入即"元素当前世界坐标"，供断言读取 */
    position: Setter = {
      set: (x: number, y: number) => {
        spritePositions.push({ x, y });
      },
    };
  }

  /**
   * 纸纹平铺精灵替身（`coastBake` 的纸纹层用它，见 `LAND_TEXTURE_STEPS`）。
   *
   * 【`position` 必须覆写回空 setter】`FakeSprite.position.set` 会把写入推进
   * `spritePositions` 探针 —— 那是"素材落位坐标"的观察口。海岸烘焙每烘一次都会
   * 写一次纸纹位置，探针一旦被污染，`index.coords.test.tsx` 里
   * `spritePositions.at(-1)` 读到的就是纸纹坐标而不是素材坐标（表现为"素材位置
   * 断言随机失败"）。纸纹的坐标不是素材落位，不该进这个探针。
   */
  class FakeTilingSprite extends FakeSprite {
    kind = "TilingSprite";
    position: Setter = { set: () => {} };
    tilePosition = readablePoint();
    tileScale = readablePoint();
    constructor(options?: { texture?: unknown; width?: number; height?: number }) {
      super();
      this.texture = options?.texture ?? null;
      this.width = options?.width ?? 0;
      this.height = options?.height ?? 0;
    }
  }

  /**
   * Graphics 替身。
   *
   * 除了既有的 rect/poly/fill/stroke，还要有 `moveTo` / `bezierCurveTo` /
   * `closePath` —— 海岸路径走的是 Catmull-Rom → 贝塞尔（见 land.ts 的
   * `drawLandPath`），不是 `poly()` 直弦。缺了它们会在"生成陆地"那一刻抛
   * "g.moveTo is not a function"，而报错栈指向烘焙，很容易被误判成渲染问题。
   */
  class FakeGraphics extends FakeContainer {
    clear() {}
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    bezierCurveTo() {
      return this;
    }
    closePath() {
      return this;
    }
    rect() {
      return this;
    }
    poly() {
      return this;
    }
    /**
     * 手画草稿的顶点圈（R-REG-03）。
     *
     * 草稿层用 `circle()` 画顶点，用 `moveTo/lineTo` 画折线与预览虚线 ——
     * 少了 `circle` 时，"在画布上单击落点"这一步就会抛
     * "layer.circle is not a function"，而栈指向 Pixi 渲染，极易被误判成渲染问题。
     */
    circle() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  }

  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
    /** 渲染器替身：海岸烘焙会调用它，本测试不关心烘出什么 */
    renderer = { render: vi.fn() };
    // 立刻 resolve：测试只关心坐标与手势，不关心 Pixi 生命周期
    init = vi.fn(async () => {});
    destroy = vi.fn();
  }

  /**
   * 以下是 pixi.js 的**模块面补全**，不是被测代码用到的类。
   *
   * `vi.mock` 的工厂缺导出会在 import 阶段直接抛错：coastBake.ts 在模块顶层
   * import 了 RenderTexture / BlurFilter，只要页面引入了海岸烘焙，这两个导出
   * 就必须存在。先补齐，避免改渲染代码时被"5 个文件集体红"误导成环境问题。
   */
  class RenderTexture {
    static create = vi.fn((options: { width: number; height: number }) => ({
      ...options,
      destroy: vi.fn(),
    }));
    destroy = vi.fn();
  }
  class BlurFilter {
    constructor(options?: unknown) {
      void options;
    }
  }
  class ColorMatrixFilter {
    matrix: number[] = [];
    /** 切风格时旧实例要被销毁（累乘会让来回切换不可逆） */
    destroy = vi.fn();
  }
  /**
   * 子图羽化的隔离滤镜替身（`submapRender` 给 content 挂 AlphaFilter，让
   * `erase` 只擦子图自己的纹理）。挂载行为本身由真实 Pixi 负责，替身只需
   * 「能被 new、能被赋给 filters」。
   */
  class AlphaFilter {
    alpha = 1;
  }
  /**
   * 样式替身：把构造参数**铺到实例上**。
   *
   * 真实 `Text` 把 `style` 存成 `TextStyle` 实例，所以"几号字"只能从实例字段读。
   * 只留 `options` 的话，断言就只能去翻全局数组，读不出"哪个节点是几号字"。
   */
  class TextStyle {
    fontSize?: number;
    constructor(options?: Record<string, unknown>) {
      Object.assign(this as object, options ?? {});
    }
  }
  /**
   * 文字替身（标注层）。
   *
   * `anchor` 必须有：`labelSync` 建节点时会 `anchor.set(0.5, 0.5)`。
   * `destroy` 要留痕：删除素材时联动标注是否真的消失，只能靠这里观察。
   */
  class Text extends FakeContainer {
    text = "";
    resolution = 1;
    style: { fontSize?: number } | null = null;
    anchor: Setter = { set: () => {} };
    destroyed = false;
    constructor(options?: unknown) {
      super();
      const o = options as
        | { text?: string; style?: { fontSize?: number } }
        | undefined;
      this.text = typeof o?.text === "string" ? o.text : "";
      this.style = o?.style ?? null;
      labelNodes.push(this as unknown as (typeof labelNodes)[number]);
    }
    destroy() {
      this.destroyed = true;
    }
  }

  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Sprite: FakeSprite,
    TilingSprite: FakeTilingSprite,
    Graphics: FakeGraphics,
    Texture,
    RenderTexture,
    BlurFilter,
    ColorMatrixFilter,
    AlphaFilter,
    TextStyle,
    Text,
  };
}
