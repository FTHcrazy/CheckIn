/**
 * MapCanvas 场景图 z 序的**唯一出处**。
 *
 * 【为什么单独一个模块，而不是写在 index.tsx 里】两个原因：
 *   ① `render-stack-guard.test.ts` 与几个渲染用例要"按名字取图层索引"，但它们
 *      不该为此把 pixi.js 整个 import 进来（那需要一套 mock，而源码级守卫的价值
 *      就在于它连渲染器都不需要）；本文件**零依赖**，谁都能引。
 *   ② z 序此前散落在测试的裸下标里（`children[4]`、`children.at(-1)`、
 *      `toHaveLength(7)`）。加一层 `draftLayer` 会同时打掉三处断言，而失败信息
 *      只是"长度不对"，很容易被误判成新功能写错。抽成清单后，插层只改这里。
 *
 * 【顺序含义】数组下标即 world 的子节点下标（从下往上画）：
 *   · `staticLayer` 投影 + 海面（被 cacheAsTexture 烤成一张图）
 *   · `coast` 海岸烘焙层（一张 RenderTexture 精灵）
 *   · `regionLayer` 区块填充/边界（按层级分容器）
 *   · `polylineLayer` 折线：道路 / 河流 / 山脊 / 势力边界（按层级分容器）
 *   · `elementLayer` 素材（按层级分容器）
 *   · `submapLayer` 区块内嵌子图（递归子树）
 *   · `labelLayer` 地名（按层级分容器）
 *   · `overlay` 选中框等交互指示
 *   · `draftLayer` 手画草稿（★ 最上层）
 *
 * 【折线为什么插在区块与素材之间（B4-2 的第一次"中间插层"）】
 * 线是"地表的划分与路径"，必须压在区块之上（不被 0.16 的填充盖淡），
 * 又必须在素材之下（路不能盖住山 —— 与逆向目标的 POLYGON→LINE→POINT 一致）。
 * 追加到数组末尾会得到"路盖住山"，而这是本项目此前唯一用过的加层方式。
 * 插层只改这一处，三处断言（本文件、`render-stack-guard`、`bake.test`）同步即可。
 *
 * 【草稿为什么压在最上面】画子区块时父块常处于选中态（正在被高亮），草稿线若
 * 压在高亮之下会被 0.16 的填充盖淡 —— 而草稿是用户此刻正在操作的线，优先级最高。
 */
export const WORLD_LAYER_ORDER = [
  "staticLayer",
  "coast",
  "regionLayer",
  "polylineLayer",
  "elementLayer",
  "submapLayer",
  "labelLayer",
  "overlay",
  "draftLayer",
] as const;

/** 图层名（`WORLD_LAYER_ORDER` 的元素类型） */
export type WorldLayerName = (typeof WORLD_LAYER_ORDER)[number];

/**
 * 按名字取 z 序下标。
 *
 * 【测试与运行期共用】禁止再在任何地方写裸下标 —— 那是"加一层就打掉一片断言"的
 * 根源。返回 `number` 而不是字面量联合，调用方拿去索引数组即可。
 */
export function worldLayerIndexOf(name: WorldLayerName): number {
  return WORLD_LAYER_ORDER.indexOf(name);
}
