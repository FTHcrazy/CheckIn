import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// 顺序的**唯一定义处**在实现里，测试只消费它 —— 早期这里手抄了一份 7 项数组，
// 结果 T5 加 `draftLayer` 时两份清单同时要改，忘一处就变成"测试说 7 层、代码有 8 层"。
import { WORLD_LAYER_ORDER, worldLayerIndexOf } from "./layers";

/**
 * MapCanvas 场景图 z 序守卫（源码级）。
 *
 * 【为什么要有这种测试】z 序错位的表现是"素材钻进区块底下""文字被陆地盖住"，
 * 而且**不报错** —— 运行期断言很难覆盖（要真建一棵场景图去比对）。
 * 直接在源码上钉顺序，成本最低、也最早失败。
 *
 * 【两条书写禁忌（项目里已踩过）】
 *   1. 不要断死一整行：格式化会把一行拆成多行，硬编码整行必然假红；
 *      这里一律用 `[\s\S]{0,N}?` 这种**容错**连接。
 *   2. 读源码用 `path.resolve(process.cwd(), ...)`，不要用 `new URL(..., import.meta.url)`
 *      —— 沙箱的 fs 代理只认 file scheme。
 *
 * 【禁止裸下标】不要再出现 `toHaveLength(7)` / `children[4]` / `at(-1)` 这类魔数位置。
 * 加一层就必然连带红，而失败信息只是"长度不对"，很容易被误判成新功能写错
 * （架构 §6-1 已点名）。取图层一律走 `worldLayerIndexOf(name)`。
 */

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/index.tsx",
);

/** CRLF 归一化：跨行断言前必须先做，否则 Windows 上必然假红 */
const SRC = readFileSync(SOURCE_PATH, "utf8").replace(/\r\n/g, "\n");

/** 缓存组内部的顺序：投影在下、海面在上（海面不透明，投影靠四周留白透出来） */
const STATIC_STACK = ["sheet", "sea"] as const;

describe("MapCanvas 场景图 z 序", () => {
  it("图层顺序的唯一定义处是 layers.ts（不是测试里手抄的一份）", () => {
    // 8 层：static / coast / region / element / submap / label / overlay / draft
    expect(WORLD_LAYER_ORDER).toHaveLength(8);
    // 无重复（重复会让 addChild 拿到同一个 Container 两次，z 序静默错位）
    expect(new Set(WORLD_LAYER_ORDER).size).toBe(WORLD_LAYER_ORDER.length);
    // 海岸必须在区块**之下**（区块是"地表的划分"，要透出陆地材质）
    expect(worldLayerIndexOf("coast")).toBeLessThan(worldLayerIndexOf("regionLayer"));
    // 素材必须在区块之上（山是"长在地表上的东西"，不能被分区线切断）
    expect(worldLayerIndexOf("elementLayer")).toBeGreaterThan(worldLayerIndexOf("regionLayer"));
  });

  it("草稿层排在 overlay 之后（用户正在画的线必须压过选中高亮）", () => {
    // 画子区块时父块常处于选中态（0.16 的淡填充会盖淡草稿线）
    expect(worldLayerIndexOf("draftLayer")).toBeGreaterThan(worldLayerIndexOf("overlay"));
    expect(worldLayerIndexOf("draftLayer")).toBe(WORLD_LAYER_ORDER.length - 1);
  });

  it("world.addChild 按 WORLD_LAYER_ORDER 一次性加入，且清单里每个名字都在映射表上", () => {
    // ① 唯一一次挂载必须是"按清单映射"，而不是一串实参 ——
    //    后者每加一层都要改测试，而失败信息读不出"谁排错了谁"
    expect(SRC).toMatch(/world\.addChild\(\.\.\.WORLD_LAYER_ORDER\.map\(/);

    // ② `layersByName` 字面量里每个名字都要出现，且**书写顺序与清单一致**。
    //    对象字面量的键序就是求值顺序，所以这一条等价于"映射表没接错线"。
    //    用 indexOf 递进比较而不是断死整段：格式化随便换行都不会假红。
    const literal = SRC.match(/const layersByName[\s\S]{0,600}?\};/);
    expect(literal).not.toBeNull();
    const text = literal?.[0] ?? "";
    let cursor = -1;
    for (const name of WORLD_LAYER_ORDER) {
      const at = text.indexOf(name);
      expect(at, `layersByName 里缺少 ${name}`).toBeGreaterThan(-1);
      expect(at, `layersByName 里 ${name} 的书写顺序与 WORLD_LAYER_ORDER 不一致`).toBeGreaterThan(
        cursor,
      );
      cursor = at;
    }
  });

  it("缓存组内部是 sheet → sea（且只能加入一次）", () => {
    const pattern = new RegExp(
      `staticLayer\\.addChild\\(${STATIC_STACK.map((name) => `[\\s\\S]{0,120}?${name}`).join(",")}[\\s\\S]{0,120}?\\)`,
    );
    expect(SRC).toMatch(pattern);
    const hits = SRC.match(/staticLayer\.addChild\(/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("world.addChild 只允许出现一次（后续 effect 不得再挂节点）", () => {
    // z 序一旦变成"effect 执行顺序的函数"，就再也排不回来了 —— 这条是硬约束
    const hits = SRC.match(/world\.addChild\(/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("初始化处留着「后续 effect 不得再 addChild」的纪律说明", () => {
    expect(SRC).toMatch(/后续 effect[\s\S]{0,120}?不得再\s*addChild/);
  });

  it("海岸层是容器 + 精灵，而不是把四层 Graphics 挂上来（否则每帧三次高斯模糊）", () => {
    expect(SRC).toMatch(/const coast = new Container\(\);/);
    expect(SRC).toMatch(/coast\.addChild\(coastSprite\);/);
  });

  it("烘焙只依赖「陆地 / 风格 / 纸纹 / 分辨率」，依赖数组里不得出现 viewport", () => {
    // 视口一进依赖，滚轮每格都会重烘一次（三次高斯模糊），帧率直接塌
    const deps = SRC.match(/\}, \[bakeKey,[^\]]*\]/);
    expect(deps).not.toBeNull();
    expect(deps?.[0]).not.toMatch(/viewport/);
    expect(deps?.[0]).toMatch(/app/);
  });

  // ── B4 风格滤镜的挂载纪律（PRD §6.4）──
  //
  // 这几条是"静默出错"的重灾区：挂错节点不会报错，只会让某一块颜色不对，
  // 而且要来回切几次风格、盯着海面才看得出来。源码级钉死最省事。
  it("运行期 filters 只赋给 regionLayer / elementLayer / labelLayer（海岸在烘焙期上色）", () => {
    const assigns = SRC.match(/\.filters\s*=/g) ?? [];
    // 只有风格 effect 里那一处赋值
    expect(assigns).toHaveLength(1);
    // 赋值的对象是 targets 数组，逐个点名在那三个 ref 上
    expect(SRC).toMatch(/regionLayerRef\.current,\s*\n\s*elementLayerRef\.current,/);
    expect(SRC).toMatch(/elementLayerRef\.current,\s*\n\s*labelLayerRef\.current,/);
  });

  it("海岸不挂运行期滤镜（风格已在 bakeCoast 里乘进纹理，再挂一次就等于乘两遍）", () => {
    // 断言风格 effect 的 targets 数组里没有 coastRef
    const targets = SRC.match(/const targets = \[[\s\S]{0,200}?\];/);
    expect(targets).not.toBeNull();
    expect(targets?.[0]).not.toMatch(/coastRef/);
    // 而烘焙调用必须把 style 传下去
    expect(SRC).toMatch(/const next = bakeCoast\(\{[\s\S]{0,400}?style,/);
  });

  it("绝不把 filters 挂在 world / overlay / staticLayer / sea 上", () => {
    // world：会把 overlay 与四周留白一起过滤
    // overlay：选中框是交互指示，染色会让"选中"看起来变淡
    // staticLayer / sea：被缓存 / 本就该保持原色
    expect(SRC).not.toMatch(/world[A-Za-z]*\.filters\s*=/);
    expect(SRC).not.toMatch(/overlay[A-Za-z]*\.filters\s*=/);
    expect(SRC).not.toMatch(/staticLayer[A-Za-z]*\.filters\s*=/);
    expect(SRC).not.toMatch(/sea[A-Za-z]*\.filters\s*=/);
  });

  it("每次切风格都造新滤镜，并销毁上一个（累乘会让来回切换不可逆）", () => {
    expect(SRC).toMatch(/const filter = filterFor\(style\);/);
    expect(SRC).toMatch(/prev\?\.destroy\(\);/);
  });

  // ── B5 剔除与缓存的纪律 ──
  it("剔除只遍历三层各自的层级容器，不碰 coast / staticLayer / overlay", () => {
    const deps = SRC.match(/cullLayers\(levelContainers[\s\S]{0,80}?\);/);
    expect(deps).not.toBeNull();
    expect(SRC).not.toMatch(/cullLayers\(\s*\[[^\]]*coastRef/);
    expect(SRC).not.toMatch(/cullLayers\(\s*\[[^\]]*staticLayerRef/);
    expect(SRC).not.toMatch(/cullLayers\(\s*\[[^\]]*overlayRef/);
  });

  it("静态层缓存不随 viewport 重烤（只在跨档 / 纸纹变化时）", () => {
    const deps = SRC.match(/\}, \[zoomTier, paperTexture, app\]\);/);
    expect(deps).not.toBeNull();
    expect(SRC).toMatch(/layer\.cacheAsTexture\(/);
    expect(SRC).toMatch(/layer\.updateCacheTexture\(\)/);
  });

  it("剔除缓存的是**局部**包围盒，绝不缓存舞台包围盒（S-1 的根因）", () => {
    // `getBounds()` 返回父级变换已乘进去的矩形，**随视口变化**；
    // 把它按"内容没变就不用重算"缓存下来，就会在换视口后拿到旧结果、
    // 把整层判成不可见且再也不会自愈。所以 CullCache 只允许存 getLocalBounds()。
    const cullSrc = readFileSync(
      path.resolve(
        process.cwd(),
        "src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/cull.ts",
      ),
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(cullSrc).toMatch(/container\.getLocalBounds\(\)/);
    expect(cullSrc).not.toMatch(/container\.getBounds\(\)/);
    // 局部矩形必须经容器的当前全局变换搬到舞台空间再比较
    expect(cullSrc).toMatch(/container\.toGlobal\(/);
  });
});
