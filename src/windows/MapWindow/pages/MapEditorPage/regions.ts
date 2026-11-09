/**
 * 随机区块生成（层级版：国家 → 郡 → 城，2.40.0 起默认三级）
 *
 * 【用途】把地图切成若干层级的行政区划：最粗一级把整张地图切开，下一级在
 * **父区块内部**再切，如此递归。渲染时按缩放做交叉淡入淡出（见 `lod.ts`），
 * 于是"缩得越远越概括、缩得越近越详细"是连续的，而不是一级一级地跳。
 *
 * 【算法分四步】
 *   1) 撒点：抖动网格 + 低频域扭曲，让区块有大有小（疏密相间，不是蜂巢）。
 *   2) 分区：Voronoi 图，用半平面裁剪求每个种子点的单元。
 *   3) 崎岖化：把每条直边细分成折线，用 fbm 噪声场做横向位移。
 *   4) 继承：子块的**外轮廓原样沿用父级已经算好的曲线**（见下）。
 *
 * 【第 4 步为什么必须"沿用"而不是"重算"】
 * 子块的外轮廓和父块的边界是同一条线。如果父子各按自己的振幅算一遍，
 * 两条曲线会错开（父级的振幅按父级的尺度算，子级的按子级算），
 * 交叉淡化时就会看到两条平行的边界线在"重影"。
 * 因此本文件把每条边抽象为一条 **基线边（HostEdge）**：
 *   · 振幅、噪声频率、采样密度全部由**这条基线边自身**决定，与"谁来用它"无关；
 *   · 基线边算出的折线只算一次，子块按**参数区间**从父级的折线上切一段下来。
 * 于是子块的外轮廓是父级折线的**子折线**（外加两个落在线段上的切点），
 * 逐点严丝合缝，连浮点误差都没有。
 *
 * 【兄弟之间为什么天然一致】
 * 相邻两块共享的边落在两者种子点的垂直平分线上，线上任意点到两侧种子距离相等，
 * 因此"边中点到种子点的距离"这个振幅上限对两侧是同一个值。为了让这条性质
 * 不被崎岖化后的端点位移破坏，振幅取的是**未位移的基线中点**（见 `makeHost`
 * 的 capMid 参数）。
 *
 * 【确定性】mulberry32 伪随机数发生器：同一 seed 必产出同一棵层级树。
 *
 * 【已知的残余缺陷（实测 24 种子 × 四级共 5352 块）】
 *   · 自交 0.09%、有顶点越出父块的区块 0.6%，最大越出 3.2 世界单位（地图宽 0.3%）。
 *   成因：子块的 Voronoi 单元是在父块的**基线**（凸）上切的，而父块的**显示**多边形
 *   会因为继承更粗一级的曲线而向内凹出"湾"；单元中"两条中垂线交点"式的内部顶点，
 *   以及连接它们的直边，可能正好落在湾里。`settleInside` 把这类**顶点**拉了回来，
 *   但**边**本身（两个都在湾外的点之间的弦）仍可能横穿湾。
 *   要彻底消除，需要把子块的显示多边形与父块的显示多边形做真正的多边形求交
 *   （Greiner–Hormann 一类），成本与风险都不成比例 —— 0.2% 的区块、亚像素级的
 *   越出，在郡一级的可视范围内几乎不可能被看到，故按"已知可接受"处理。
 *   注意：**不能**用"把子块顶点拉到父块内"的思路修补共享边 —— 任何对共享边几何的
 *   单侧修改都会破坏父子/兄弟的逐点重合（见上文第 4 步）。
 *
 * 【边界】纯函数模块（不依赖 React / Pixi / DOM），必须覆盖单元测试。
 */

/** 世界坐标点 */
export interface Point {
  x: number;
  y: number;
}

/** 一个区块（层级树上的一个节点） */
export interface MapRegion {
  /** 全局唯一 id */
  id: string;
  /** 父区块 id；最顶层为 null */
  parentId: string | null;
  /**
   * 层级序号：0 = 国家，1 = 郡，2 = 城（2.40.0 起的默认三级方案）。
   *
   * 【为什么不再是 0 = 大陆 / 1 = 洲】用户反馈"洲跟大陆重合"——两者在整图视角
   * 都是"一大片色块"，谁也读不出区别，而参考实现里第一眼看到的就是**国家**。
   * 于是砍掉"大陆/洲"两个层级，让国家直接铺满陆地。老文档里的 4 级区块仍然
   * 按 level 原值渲染（`levelCountsOf` 从实际数据统计层级数，不假定 3 级）。
   */
  level: number;
  /** 展示名（阶段三会开放重命名） */
  name: string;
  /** 生成该区块的种子点（世界坐标） */
  seed: Point;
  /** 区块多边形顶点（世界坐标，已含崎岖化）；**主块**，承担命中与国名落点 */
  polygon: Point[];
  /**
   * 同一区块的**附加块**（飞地）多边形，不含 `polygon` 那块。
   *
   * 【为什么需要】区块是"父块被 Voronoi 半平面切下来的那一片"，而父块一凹
   * （陆地环有深湾、上层切出的块也常是凹的），一片就会被切成几块互不相连的
   * 部分。丢掉它们会留下没有区块色的空地；硬把几块连成一条环又会造出横穿湾口
   * 的飞线（2.40.0 及以前反复出现的那两种缺陷）。
   *
   * 【缺省 = 只有主块】单块是常态；老文档没有这个字段，读作 `undefined`。
   */
  pieces?: Point[][];
  /** 填充色（0xRRGGBB，供 Pixi 直接使用） */
  color: number;
  /**
   * 区块内嵌的子地图；`undefined` = 该区块没有子图（老数据兼容）。
   *
   * 【为什么是可选字段而不是放进 polygon 同级】子图是「另一张完整地图」，
   * 与区块几何无耦合；缺字段的老文档读作 `undefined`，migrateDoc 的「未知字段
   * 原样保留」策略天然覆盖，无需迁移。
   */
  submap?: import("./types").MapSubmap;
  /**
   * 子图「渐入」的父图缩放阈值（可选）。父图缩放 ≥ 此值，子图才开始淡入；
   * 低于它时只显示「绑定态轮廓」。缺省 = 按区块屏幕尺寸自动反推
   * （见 `enterScaleForRegion`）。
   */
  submapEnterScale?: number;
  /**
   * 来源标记：`"generated"`（一键生成）/ `"manual"`（手画落库）。
   *
   * 【缺省读作 `"generated"`】老数据全是生成的，缺字段即老数据，不需要迁移；
   * 只有手画落库时才写值（`useMapEditor.addManualRegion`，T5）。
   *
   * 【为什么要它】① 重新生成区块时"手画成果要不要保留"必须有判据（PRD §8-Q4）；
   * ② 后续"顶点微调"只对手画区块开放时也要靠它分流（R-REG-06）。
   */
  origin?: "generated" | "manual";
}

/** 世界矩形范围 */
export interface RegionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 层级定义与默认数量：**只有国家一级**（2.42.0，用户裁决）。
 *
 * 【为什么从三级砍到一级】逆向目标（makeamap）的区划就只有 `countries ≤ 20` 一级
 * （`decoded.js`：`20<J&&(J=20)`），没有郡/城的逐级细分；此前为对齐它的观感做的
 * 三级 + 无级缩放（LOD 帽函数交叉淡化）在单级下**没有任何对应物**。用户裁决：
 * 关闭「无级缩放 / 层级 / 区域逐级生成」，区域只保留国家一级 —— 与参考实现
 * 完全同构，也更贴近截图里"一块大陆十来个国家、每国一色"的政治地图读法。
 *
 * 【老数据不再支持（2.42.0）】多级文档的 `regionSchema`（长度 > 1）在
 * `normalizeRegionSchema` 里直接判非法、回落本默认值；`doc.regions` 里
 * level > 0 的旧区块由渲染层按"并入国家层"兜底显示，不再逐级维护。
 *
 * 【数量 12】延续 2.41.0 的口径：参考的 20 只是上限，观感密度是"一块大陆
 * 十来个国家"；12 配 9 格色板满足"每国一色"（`regions.test.ts` 相邻色差守卫）。
 */
export const REGION_LEVELS = [
  { label: "国家", count: 12 },
] as const;

/** 最多支持的层级数（= 1：层级功能已关闭，只剩国家一级） */
export const REGION_MAX_LEVELS = REGION_LEVELS.length;

/**
 * 一级区域的定义（顺序即层级序号，0 起）。字段名按 PRD §5.1 用 `name`。
 *
 * 【与 `REGION_LEVELS` 的关系】`REGION_LEVELS` 是**生成器的默认值来源**（历史常量，
 * 字段叫 `label`），本类型是**文档级可配置的层级定义**（字段叫 `name`）。
 * 两者的唯一适配点是 `DEFAULT_REGION_SCHEMA`（下一行），见那里的注释。
 */
export interface RegionLevelDef {
  /** 展示名：进 `region.name` 前缀、工具栏层级胶囊、面板文案。空串回落为 `L{level+1}` */
  name: string;
  /** 目标数量：生成时用；手画模式下仅作参考（不参与校验） */
  count: number;
}

/**
 * 默认层级定义（老文档的回落值，也是"未改过 schema"的等价基准）。
 *
 * 【label ↔ name 的唯一适配点】`REGION_LEVELS` 的字段叫 `label`（历史），PRD 的
 * `RegionLevelDef` 叫 `name`。改字段名要动 9 个消费点 + `regions.test.ts` 的断言，
 * 风险远大于收益 —— 保留双名，只在这一行做适配，两处注释互指（见 `REGION_LEVELS`）。
 *
 * 【为什么是常量数组而不是函数】它同时被 `regionSchemaOf` 的回落与测试当作
 * "改前的等价基准"；每次新数组会让 `===` 断言失效，也让 `useMemo` 的依赖白抖动。
 */
export const DEFAULT_REGION_SCHEMA: readonly RegionLevelDef[] = REGION_LEVELS.map((l) => ({
  name: l.label,
  count: l.count,
}));

/**
 * 规范化外部数据（落库文档 / 子图 / 用户输入）。
 *
 * 合法 → 返回**新数组**（调用方拿到的一定是可安全持有的副本）；任一不合法 → `null`。
 * 校验：数组、长度 ∈ [1, REGION_MAX_LEVELS]、每项 `count` 为正整数、`name` 为 string
 * （空串合法 —— 读时回落 `L{n}`）。
 *
 * 【为什么要它】`migrateDoc` 不做白名单校验，脏 schema 会一路穿到生成器
 * （`count: NaN` ⇒ `generateHierarchy` 直接返回空数组，"点了生成没反应"）。
 */
export function normalizeRegionSchema(raw: unknown): RegionLevelDef[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length < 1 || raw.length > REGION_MAX_LEVELS) return null;
  const out: RegionLevelDef[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const rec = item as { name?: unknown; count?: unknown };
    if (typeof rec.name !== "string") return null;
    if (typeof rec.count !== "number" || !Number.isInteger(rec.count) || rec.count <= 0) {
      return null;
    }
    out.push({ name: rec.name, count: rec.count });
  }
  return out;
}

/**
 * **读时回落的唯一出口**：文档 / 子图 → 有效 schema。
 *
 * 缺失、非数组、非法 ⇒ `DEFAULT_REGION_SCHEMA`（**同一份引用**，避免每次新数组）。
 *
 * 【为什么回落放在这里而不是 store 初始化】
 *   ① 回落只有一处实现、一处断言；
 *   ② 老文档 `doc` 形状一字不改（不写 `regionSchema`），"改前逐字节一致"才可证；
 *   ③ 子图缺 schema 时继承调用方传进来的那份，不需要第二条回落链。
 */
export function regionSchemaOf(
  source: { regionSchema?: readonly RegionLevelDef[] } | null | undefined,
): readonly RegionLevelDef[] {
  return normalizeRegionSchema(source?.regionSchema) ?? DEFAULT_REGION_SCHEMA;
}

/**
 * 层级名：越界 / 空名一律回落 `L{level+1}`（不抛错、不留空白段）。
 *
 * 【为什么统一回落而不是返回空串】它进 `region.name` 前缀、工具栏胶囊、面板文案；
 * 空串会让界面出现"「 」 3"这种读不出东西的标签，也让面包屑出现空段（PRD §6-A-④）。
 */
export function levelLabelOf(
  schema: readonly RegionLevelDef[] | undefined,
  level: number,
): string {
  const fallback = `L${Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)) + 1}`;
  if (!schema || !Number.isFinite(level) || level < 0) return fallback;
  const name = schema[Math.floor(level)]?.name;
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

/** 单张地图的区块总数上限（渲染与内存的护栏） */
export const REGION_TOTAL_LIMIT = 600;

/** 层级数的可调范围（工具栏用） */
export const REGION_LEVEL_COUNT_LIMITS = {
  min: 1,
  max: REGION_MAX_LEVELS,
  default: REGION_MAX_LEVELS,
} as const;

/**
 * 区块填充不透明度。
 *
 * 【0.30 —— 2.38 取证的旧口径，2.43.0 起作废】参考实现早先的区块样式是
 * `{ alpha: 0.3, border_size: 3, border_color: "#73562d" }`（`decoded.js@131642`）。
 * 本项目 2.27.0 曾把它降到 0.10（"填充重了会变成行政区划拼图"），2.38.0 回到 0.30。
 *
 * 【0.55（2.43.0 再对齐）—— 用户裁决「完全对齐逆向目标的渲染效果」后逐图比对】
 * 参考的国家块是**比较实的粉彩色**（低饱和但盖得住纸色），叠加内阴影与纹理后
 * 整体收进同一灰调。0.30 的旧值配粉彩色板会把色差压进纸色里（合成色差只剩
 * 十几），邻接校正无差可校 —— **色板换成粉彩与填充提浓是一对，拆开单独调
 * 只会在"分不出块"和"艳成拼图"之间来回摆**（教训同下段：3px↔0.30 那一对）。
 *
 * 【为什么压 alpha 是错的杠杆】alpha 同时作用于填充和边界：为了不让"几百个
 * 色块铺满画面"而降 alpha，结果是边界也一起淡掉。症状正是**读不出分界、
 * 陆地一片单一**。
 *
 * 【真正压数量的是层级与数量，不是这里】渲染层已把 `lod.ts` 的 `levelAlphas`
 * 写进每一级容器的 alpha（帽函数 Σα ≡ 1：同一时刻只有一级接近 1、相邻一级刚冒头）。
 * 2.42.0 层级收成国家单级 12 块后，**全图视角主导层级 = 国家、同屏 ≤ 20**，
 * 与参考的 `countries ≤ 20` 同量级 —— 这条由 `regions.test.ts` 守卫钉住。
 *
 * ⚠️ 不要再拿 `LOD_BLOCK_PX` 去压同屏块数（2.39.0 的待办已作废）：同屏块数峰值
 * 由**最细一级的数量**封顶。**不要**回到"降 alpha"这条老路，也不要只调 LOD 常量。
 *
 * 【2.43.0 第三轮 0.55 → 0.80】用户对照西幻参考成图判定"发白发平"：粉彩本身
 * 高明度，0.55 叠在米黄纸上等于把色相稀释掉。0.8 让"颜料"盖得住纸、再由
 * multiply 纸纹把它压成旧画布 —— **浓度必须与纸纹层成对调**（纸纹越强、
 * 底色越要实，否则整片只剩灰）。
 */
export const REGION_FILL_ALPHA = 0.8;

/**
 * 区块边界线宽 —— 单位是**屏幕像素**。
 *
 * 渲染时换算成世界单位（`px / viewport.scale`）：区块的可见缩放跨了 40 倍
 * （最远一级到最近一级），用世界单位做线宽会导致缩远了线细到看不见、
 * 放到最大线比山脉还宽。
 *
 * 1 px（2.43.0）—— 分风格 `paint_shadow` 表的 `stroke: 1`（decoded.js
 * `MapStyleEnum.*` 段，见 review 序 11 / E2）。参考的国家块靠**内阴影 + 白外影**
 * 分块，界线本身是一根细笔划；3px 深线叠加在粉彩上就是"拼图格"的另一半根因。
 */
export const REGION_BORDER_PX = 1;

/**
 * 区块边界的不透明度。
 *
 * 1 —— 逆向源码 `border_alpha: 1` 的原值。屏幕上的实际浓度还要再乘两层：
 *   · `REGION_LEVEL_FILL_SCALE` 的层级系数（0.80 ~ 1.00）；
 *   · 渲染层写进容器 alpha 的 LOD 权重 `levelAlphas[i]`（活跃层级 ≈ 0.91 ~ 1）。
 * 因此活跃层级上的有效浓度落在 **0.73 ~ 1.00**；跨层级交叉淡化时两级各自再减半，
 * 合起来仍是一根连续的线，不会出现"两倍黑"的接缝（`MapCanvas` 的共享边去重
 * 也在同一侧收掉了相邻区块重复描边的问题）。
 *
 * 【为什么以前是 0.32】低填充（0.10）时代为了免"蛛网感"顺手压过线。现填充回到
 * 0.30，线与面的浓度比回到源值的 3.33 : 1，边界才是"手绘界线"而不是
 * "若隐若现的肌理"。
 */
export const REGION_BORDER_ALPHA = 1;

/** 区块边界颜色 —— 分风格 `paint_shadow` 表的 `stroke_color: "#4d3200"`（深褐细线，见 E2） */
export const REGION_BORDER_COLOR = 0x4d3200;

/**
 * 区块「白外影」（2.43.0，对齐 `paint_shadow.shadow: 2~5, #ffffff`，见 E2）。
 *
 * 白色细晕沿块缘外扩半宽：相邻块之间的接缝被抬成一道**浅光边**、海岸外圈一道
 * 白晕 —— 这是参考实现"手绘上色感"的第三件（前两件是内阴影与细描边）。
 * 渲染层把它画在**填充之下**（rim Graphics 排在 fill 前面）：外半晕铺白底、
 * 内半晕被半透明填充罩住，接缝处两侧的白互相透出来，天然是均匀的浅色缝。
 */
export const REGION_RIM_PX = 4;
export const REGION_RIM_COLOR = 0xffffff;
export const REGION_RIM_ALPHA = 0.85;

/**
 * 区块「内阴影」（2.43.0，对齐 `paint_shadow.inner_shadow`，见 E2）。
 *
 * 沿块缘向内的暗退晕（Pixi stroke `alignment: 1` = 全画在多边形内侧），
 * **渲染层用多层同心 stroke 画成渐隐的**（见 `REGION_INNER_SHADOW_PASSES`）——
 * ⚠️ 2.43.0 首版用"单层均匀带"近似，实测（用户成图截图）读作一条贴着边界的
 * **深灰公路**：均匀带的硬外沿 + 接缝两侧 2×宽度叠加，观感是"路"不是"影"。
 * **这是消灭平涂感的关键**：色块因此读作"上过色的区域"而不是"拼图片"。
 * 相邻块的退晕在接缝两侧各画各的 —— 参考实现同样如此；渐隐之后接缝处是
 * 两侧对称的自然加深，分块感来自光影而不是粗线。
 *
 * 【第二轮修正（用户截图：阴影"还是跟逆向目标不一致"）】
 *  - `#414040` 是**中性灰**，压在粉彩色块上读作"脏灰雾"。源表的色值属于
 *    它自己的画布合成语境（页面 CSS inset shadow）；我们的退晕直接叠在
 *    α0.55 的粉彩上，取色必须随自己的底色走 —— **暖化为深褐 `#4d4134`**
 *    （与描边 `#4d3200` 同族），退晕读作"旧地图的阴影"而不是"灰"。
 *  - 深度 15 → 12 → 9、贴边累计 α 0.14 → 0.11：退晕是辅光，存在感只该
 *    到"边界两侧比块心深一点"，再重就抢戏。
 *
 * `ALPHA` 的语义 = **贴边处的累计不透明度**（渲染层按层数拆成单层 alpha）。
 */
export const REGION_INNER_SHADOW_PX = 9;
export const REGION_INNER_SHADOW_COLOR = 0x4d4134;
export const REGION_INNER_SHADOW_ALPHA = 0.11;

/**
 * 内阴影的同心 stroke 层数。
 *
 * 每层宽度 = 深度 × (1 - i/层数)、每层 alpha 由累计目标反解 —— 贴边处四层
 * 叠加到 `REGION_INNER_SHADOW_ALPHA`，向内逐层脱落，近似线性渐隐。
 * 4 层是在"阶梯感不可辨"与 draw call（12 国 × 4 = 48，可忽略）之间的取值；
 * 再多层与真高斯模糊的差距肉眼已分不出，真模糊（BlurFilter + 掩膜）的管线
 * 成本不成比例。
 */
export const REGION_INNER_SHADOW_PASSES = 4;

/**
 * 「跳线」判定：单段长度超过该级**中位边长**的这个倍数，就认为它不是边界，
 * 而是多边形拼装时的一次跳接。
 *
 * 【为什么需要这条判据（3.40 之前的实测）】区块的 display 多边形由"每条边切一段
 * 宿主折线"拼成。Voronoi 单元退化（种子点几乎共线 / 落在父块内凹湾里）时，
 * `arcBetween` 的参数窗口会外推出边界，拼出来的多边形**自交**。实测（用户实际
 * 文档、223 块、四级）：**57/223 个多边形自交**，最长边 106 世界单位，而该级边的
 * 中位数只有 3.4、p99 只有 16 —— 也就是说几十条 100 单位级的直线横穿整块地。
 * 用户截图里"一束近乎平行、呈扇形散开的细线"就是它们：描边把每一次跳接画成了
 * 一根长直笔划，看起来像飞线。
 *
 * 【为什么在渲染层判、不去修几何】修几何要重排顶点顺序（或重建 Voronoi 单元），
 * 那会动到"父子/兄弟逐点重合"这条铁律 —— 风险远大于收益，且自交的多边形**填充**
 * 在 non-zero 环绕规则下基本互相抵消，画面看不出问题（只有描边会暴露）。
 * 因此在描边时把跳接段整段丢掉：线的连续性由掩膜与相邻段兜住，视觉上就是
 * "边界在那一处断开"，比横穿整块地的飞线可接受得多。
 */
export const REGION_JUMP_MEDIAN_RATIO = 10;

/** 「跳线」判定的绝对下限（世界单位）：小岛上中位数极小，别把正常长边也砍了 */
export const REGION_JUMP_MIN_WORLD = 30;

/**
 * 某一级边界的单段长度上限（世界单位）。
 *
 * @param medianEdge 该级所有边的长度中位数（渲染层先扫一遍得到）
 */
export function regionJumpLimit(medianEdge: number): number {
  const base = Number.isFinite(medianEdge) && medianEdge > 0 ? medianEdge : 0;
  return Math.max(REGION_JUMP_MIN_WORLD, base * REGION_JUMP_MEDIAN_RATIO);
}

/** 该段是否是"跳线"（长到不可能是边界本身） */
export function isRegionJump(
  a: { x: number; y: number },
  b: { x: number; y: number },
  limit: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!Number.isFinite(len2)) return true;
  return len2 > limit * limit;
}

/**
 * 区块填充/边界的**静态层次系数**（按 level 索引，0 = 国家）。
 *
 * 【2.42.0 起只剩一项】层级功能已关闭（区域只有国家一级），静态层次差随郡/城
 * 一并移除 —— 单级下所有区块同级同浓，系数表退化为 `[1]`（老文档 level > 0
 * 的区块越界回落 1，与国家同浓）。表保留为常量而不是删掉函数：渲染落点
 * （`regionFillAlphaOf` / `regionBorderAlphaOf`）与其守卫测试仍走这条链路。
 */
export const REGION_LEVEL_FILL_SCALE: readonly number[] = [1];

/**
 * 层级的静态层次系数（读点兜底的唯一出口）。
 *
 * 越界（负数 / 非有限 / 超过表长）回落 1：系数缺失朝"不衰减"兜底——
 * 区块偶尔出现比预期重的底色，远比"整层区块悄悄消失"可恢复。
 */
export function regionLevelScaleOf(level: number): number {
  const i = Math.trunc(level);
  if (!Number.isFinite(level) || i < 0 || i >= REGION_LEVEL_FILL_SCALE.length) return 1;
  return REGION_LEVEL_FILL_SCALE[i] ?? 1;
}

/** 该层级区块填充的实际不透明度（全局填充 × 静态层次系数） */
export function regionFillAlphaOf(level: number): number {
  return REGION_FILL_ALPHA * regionLevelScaleOf(level);
}

/**
 * 该层级区块边界的实际不透明度。
 *
 * 与填充**共用同一张静态系数表**（不是第二张表）—— "边界面一起调"在结构上
 * 成立：想单独调边界比例，改 `REGION_BORDER_ALPHA`；想整体改层次落差，
 * 改 `REGION_LEVEL_FILL_SCALE`。任何一处都不允许出现"只乘一边"的写法
 * （守卫测试钉住两个渲染落点都走这对函数）。
 */
export function regionBorderAlphaOf(level: number): number {
  return REGION_BORDER_ALPHA * regionLevelScaleOf(level);
}

/* ────────────────────────────── 区块配色 ────────────────────────────── */

/**
 * 区块色板 —— 9 格"旧地图政治区划"用色（`[色相, 饱和, 明度]`，HSL）。
 *
 * 【为什么从"连续 HSL 取色"换成固定色板】2.38.0 之前每块自己算一个色相
 * （父色相 ±`hueSpread`、饱和 0.13~0.21、明度 0.62），本意是"同色系的深浅"。
 * 但 α 0.30 的填充会把这点差异压进纸色里：同级区块的合成色差只有个位数，
 * 实测最接近的一对只有 0.1/255 —— 用户看到的就是"每个国家的色块颜色差距很小，
 * 像是国内的大区域"。
 *
 * 参考目标（2.43.0 重新取证，`decoded.js` 省名配色映射段，见 review 序 11 / E3）
 * 的国家色是**低饱和粉彩固定表**（`#c5e3d3` 灰绿 / `#fffdd7` 米黄 / `#fbe0be`
 * 暖沙 / `#f8c8dd` 粉 / `#c8cde6` 灰紫 …），叠上内阴影与纹理后整体收进同一灰调；
 * 相邻国靠色相差 2~3 度 + 光影（内阴影 / 白外影 / 细描边）区分，而不是靠强对比。
 * 对齐它就该是**离散粉彩色板**，不是连续函数，也不是高饱和强对比。
 *
 * 【为什么是这 9 格】E3 粉彩表的 5 格原值 + 同族补 4 格（黄绿 / 灰青 / 浅褐 /
 * 藕紫），全部保持「高明度（L 0.83~0.92）+ 中低饱和」的粉彩区间，刻意不含
 * 高饱和"现代数据可视化"的颜色。配 `REGION_FILL_ALPHA 0.55` 的填充与内阴影，
 * 合成后就是参考成图那种"淡彩罩纸"的观感。
 *
 * 【为什么不是"随机取 HSL"】随机必然出现两个相邻块恰好接近的情况。色板 +
 * 邻接校正（`assignRegionColors`）才能给出**可断言**的相邻色差下限
 * （见 `REGION_NEIGHBOR_MIN_DIST`）。
 */
export const REGION_PALETTE = [
  [14, 0.45, 0.66], // 陶土 #c2755c（西幻主色）
  [38, 0.52, 0.72], // 赭石 #d9a962
  [75, 0.32, 0.58], // 橄榄 #a8a463
  [120, 0.2, 0.78], // 苔绿 #b7c9a6
  [352, 0.34, 0.82], // 藕粉 #dcb3b9
  [45, 0.5, 0.9], // 米黄 #e9d8a6
  [205, 0.22, 0.78], // 石青 #aebfc9
  [30, 0.38, 0.82], // 暖沙 #d9bda2
  [280, 0.16, 0.8], // 藕紫 #c9bed3
] as const;

/**
 * 色板对应的 `0xRRGGBB`（模块级算一次）。
 *
 * 色板是常量，转换结果也是常量：放在模块作用域既省掉每次生成时的 9 次换算，
 * 也让"色板里到底有哪几个真实颜色"在调试时一眼可见。
 */
export const REGION_PALETTE_RGB: readonly number[] = REGION_PALETTE.map(([h, s, l]) =>
  hslToRgb(h, s, l),
);

/**
 * 相邻区块填充色的最小 RGB 距离（合成到纸色后 ≈ 15 × 0.55 ≈ 8/255）。
 *
 * 【为什么用 RGB 距离而不是色相差】区块色之间有明暗差，纯色相差看不出来。
 * RGB 欧氏距离同时覆盖色相与明度，且与 Pixi 的 alpha 合成在同一个空间里 ——
 * 合成是线性的，距离按 α 等比缩放。
 *
 * 【15 是怎么定的（2.43.0 重校）】粉彩色板任意两格的距离最小 16.4（灰紫/灰青）、
 * 平均 ≈ 40 —— 粉彩族天然紧凑，参考实现也不靠色差分块，靠的是内阴影 + 细描边 +
 * 白外影三层光影。阈值取「贪心一定找得到」的上限（< 16.4）再留半格余量；
 * 分块的**可读性下限**由光影三层兜住，不再指望色差本身。
 */
export const REGION_NEIGHBOR_MIN_DIST = 15;

/** 两个 `0xRRGGBB` 的 RGB 欧氏距离 */
export function rgbDistance(a: number, b: number): number {
  return Math.hypot(
    ((a >> 16) & 255) - ((b >> 16) & 255),
    ((a >> 8) & 255) - ((b >> 8) & 255),
    (a & 255) - (b & 255),
  );
}

/**
 * 共享边的归一化键（1/100 世界单位）。
 *
 * 与渲染层的共享边去重（`MapCanvas` 的 `keyOf`）同一个口径：兄弟区块的公共边是
 * **逐位相同**的两个端点（见文件头"第 4 步为什么必须沿用"），归一化后必然同键。
 */
function edgeKeyOf(a: Point, b: Point): string {
  const ax = Math.round(a.x * 100);
  const ay = Math.round(a.y * 100);
  const bx = Math.round(b.x * 100);
  const by = Math.round(b.y * 100);
  return ax < bx || (ax === bx && ay <= by)
    ? `${ax},${ay}|${bx},${by}`
    : `${bx},${by}|${ax},${ay}`;
}

/**
 * 同层邻接表（共享至少一条边即相邻）。
 *
 * 【为什么逐层算】跨层级的多边形是父子关系（子块外轮廓**就是**父块的一段），
 * 一律算邻居的话每一块都会和自己所有的父/子相邻，等于没有约束。而 LOD 帽函数
 * 保证同一时刻只有一个层级清晰可见，跨层撞色本来就看不出。
 */
function buildAdjacency(regions: MapRegion[], idxs: readonly number[]): Map<number, Set<number>> {
  const byEdge = new Map<string, number[]>();
  for (const i of idxs) {
    const poly = regions[i].polygon;
    for (let k = 0; k < poly.length; k += 1) {
      const key = edgeKeyOf(poly[k], poly[(k + 1) % poly.length]);
      const list = byEdge.get(key);
      if (list) list.push(i);
      else byEdge.set(key, [i]);
    }
  }
  const out = new Map<number, Set<number>>();
  const link = (a: number, b: number): void => {
    const set = out.get(a);
    if (set) set.add(b);
    else out.set(a, new Set([b]));
  };
  for (const list of byEdge.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        link(list[a], list[b]);
        link(list[b], list[a]);
      }
    }
  }
  return out;
}

/**
 * 邻接校正：把**与已着色邻居太近**的区块换到色板里更远的一格，并尽量让同层不重色。
 *
 * 【两个目标，主次分明】
 *   · 硬约束（主）：与**相邻**块的色差 ≥ `REGION_NEIGHBOR_MIN_DIST`；
 *   · 软约束（次）：同层尽量不重复用同一格 —— 12 块用 5 种颜色，整体仍会读成
 *     "几块拼图"而不是"十来个国家"。物理上色板只有 9 格，超过 9 块必然复用，
 *     复用的位置由邻接约束保证不会出现在相邻处（四种颜色画地图的老结论）。
 * 只在软约束也不满足时才动 `regions[i].color`，于是随机流给出的"色彩分布随机"
 * 这一层观感被保留，校正只做局部纠错。
 *
 * 【顺序】按 `regions` 的生成顺序（父 → 子、同层按落点），相邻关系天然是"先来的
 * 已经定了色"。每块只需和已着色的邻居比：一条共享边恰好被后画的那一侧检查一次，
 * 约束对每条边都成立一次，不需要再回扫。
 *
 * 【纯函数、确定性】同输入必同输出（无 rng、无时间）；相邻色差由
 * `REGION_NEIGHBOR_MIN_DIST` 钉住，`regions.test.ts` 有守卫。
 */
export function assignRegionColors(regions: MapRegion[]): void {
  const byLevel = new Map<number, number[]>();
  for (let i = 0; i < regions.length; i += 1) {
    const list = byLevel.get(regions[i].level);
    if (list) list.push(i);
    else byLevel.set(regions[i].level, [i]);
  }

  for (const idxs of byLevel.values()) {
    const neighbors = buildAdjacency(regions, idxs);
    const placed = new Map<number, number>();
    /** 本层已用过的色板格（软约束：优先不重色） */
    const used = new Set<number>();
    for (const i of idxs) {
      const own = regions[i].color;
      const nb = neighbors.get(i);
      // 到"已着色的邻居"的最小色差；邻居还没着色时返回 Infinity
      const scoreOf = (c: number): number => {
        let min = Infinity;
        if (!nb) return min;
        for (const j of nb) {
          const done = placed.get(j);
          if (done === undefined) continue;
          const d = rgbDistance(c, done);
          if (d < min) min = d;
        }
        return min;
      };
      const ownScore = scoreOf(own);
      const ownStrict = ownScore >= REGION_NEIGHBOR_MIN_DIST;
      if (ownStrict && !used.has(own)) {
        used.add(own);
        placed.set(i, own);
        continue;
      }

      // 候选打分：先看"是否满足相邻硬约束"，再看"是否本层没用过"，最后看色差
      let best = own;
      let bestStrict = ownStrict;
      let bestFresh = !used.has(own);
      let bestScore = ownScore;
      for (const candidate of REGION_PALETTE_RGB) {
        if (candidate === own) continue;
        const score = scoreOf(candidate);
        const strict = score >= REGION_NEIGHBOR_MIN_DIST;
        const fresh = !used.has(candidate);
        const better = strict !== bestStrict
          ? strict
          : fresh !== bestFresh
            ? fresh
            : score > bestScore + 1e-9;
        if (!better) continue;
        best = candidate;
        bestStrict = strict;
        bestFresh = fresh;
        bestScore = score;
      }
      if (best !== own) regions[i].color = best;
      used.add(best);
      placed.set(i, best);
    }
  }
}

/**
 * 边界"崎岖度"参数（凡是以 R 表示的比例，R = `sqrt(该区块面积 / 子区块数)`，
 * 即"这一级一块有多大"的尺度基准 —— 用相对量而非绝对像素，换地图尺寸不用重调）。
 */
export const REGION_WOBBLE = {
  /**
   * 基础振幅 0.108R。
   *
   * 振幅与波长必须一起定：位移沿边长的梯度若 ≥ 1，折线就会自交（多边形
   * "打结"，填充出现空洞）。层叠噪声的梯度实测约为 (振幅/波长) 的 1.2 倍（均方），
   * 峰值不超过 3.2 倍 —— 0.108 / 0.34 ≈ 0.32，峰值约 1.0，再叠加交汇点收敛带
   * 与振幅封顶后才留有余量。
   */
  amplitude: 0.108,
  /**
   * 噪声波长 0.34R。
   *
   * 这个值前后调过两次：1.15R 比典型边长还长，一条边连一个完整起伏都走不完，
   * 位移几乎为零（看起来还是直线）；0.5R 时仍有边整条落在噪声"平坦格"里。
   * 0.34R 保证每条边至少跨过一个完整噪声格，崎岖程度才稳定。
   */
  wavelength: 0.34,
  /**
   * 采样步长 = R/24（取**最细一级**的 R，见 `generateHierarchy`）。
   *
   * 用最细一级的尺度来采样全局的基线边：父级的曲线会被子级原样切走一段，
   * 若按父级自己的尺度采样，缩到最深处时那段折线会显得是一根根直线段。
   */
  segmentsPerRadius: 24,
  /** 单条基线边最多细分多少段（防极端长边产生上千顶点） */
  maxSegments: 128,
  /** 分形叠加层数：2 层足够给出"大起伏 + 小锯齿"，再多会欠采样 */
  octaves: 2,
  /** 每层频率倍增 / 振幅衰减 */
  lacunarity: 2.1,
  gain: 0.45,
  /** 振幅封顶一：不超过"边中点到本区块种子点的距离"的 35%（见 organicEdge 注释） */
  maxAmplitudeRatio: 0.35,
  /** 振幅封顶二：不超过边长的 20%（短边跟着大振幅走必然自交） */
  maxEdgeRatio: 0.2,
  /**
   * 振幅封顶四：不超过"边中点到父块边界距离"的 60%。
   *
   * 【为什么必须有】单元是精确裁剪出来的（顶点与贴岸段恒在父块内），但内部边
   * 的曲折位移是沿法线**双向**的：一条大致平行于海岸、距岸只有几单位的内部边，
   * 起伏会直接拱到海面上（实测最远越岸 6.2 单位，就是本封顶缺失造成的）。
   * 老实现靠"径向把每个点投影回岸线"兜底，那是**事后**修补；按离岸余量封顶
   * 是**事前**约束 —— 边界自然收直、不需要任何投影，也就不可能把点投到对岸。
   */
  coastClearanceRatio: 0.6,
  /**
   * 振幅封顶三：不超过 `fineAmpCap × 最细一级的 R`。
   *
   * 【为什么必须有】最粗一级的边界会被**一路继承到最细一级**：某个郡的外轮廓
   * 可能就是大陆的边界。而振幅按各自的 R 算，大陆的振幅（0.108×591 ≈ 64）几乎
   * 等于一个郡的尺度（81）。一旦某段边界的起伏超过子块的厚度，就会把子块的
   * 种子甩到自己的多边形外面、乃至让多边形自交 —— 实测 4 级时会大面积发生。
   * 因此振幅还要受"最深处的子块能承受多少起伏"约束。
   * 3 级（最细 R≈148）时这一条不生效，观感与之前一致；4 级时才收窄。
   */
  fineAmpCap: 0.45,
  /**
   * 种子内缩的上限：不超过父块内切半径的这一比例。
   *
   * 内缩是为了让种子离"会起伏的父级边界"足够远，但内缩一旦超过父块的内切半径，
   * 所有种子都会被拉到质心重叠 → 每个子块的 Voronoi 单元都退化成整个父块
   * （实测最细一级面积之和会变成父块的 4 倍）。所以必须封顶。
   */
  insetCapRatio: 0.5,
  /**
   * 振幅的缓变调制范围 [1 - variation, 1 + variation]。
   *
   * 真实疆界并不均匀崎岖：有的段沿山脊/河谷走、扭得厉害，有的段是勘界直线。
   * 用一张比区块尺度更缓的噪声按"边的位置"调制振幅，就能得到这种疏密相间的观感。
   */
  ampVariation: 0.45,
  /**
   * 交汇点收敛带：基线边的两端各 22% 范围内，位移从 0 平滑升到满值。
   *
   * 单条边自己的位移沿固定法线做，是弦上的单值函数，永远不会自交。真正的自交
   * 只发生在**两条共享交汇顶点的边之间**：夹角可能很小，各自朝对方鼓出就会在
   * 顶点附近交叉。让位移在两端归零，顶点附近两条边都是直线、只交于顶点本身。
   *
   * 还顺带保证了另一件事：基线边的折线**端点恰好等于基线端点**，
   * 于是子级从父级折线上切下来的切口两端也落在父级折线的线段上，不会错位。
   */
  vertexTaper: 0.22,
  /** 种子点域扭曲强度（相对网格单元尺寸） */
  seedWarp: 0.32,
  /**
   * 种子点距父级边界的最小内缩，取 `max(采样步长×2, 父级边界最大振幅×1.25)`。
   *
   * 子块会继承父级边界的起伏，起伏最大可达父级振幅。若子块种子离边界太近，
   * 这段起伏就会把边界推到种子另一侧 —— 表现为"种子点跑到自己区块外面"
   * 乃至多边形自交。1.25 倍是留出的安全余量。
   */
  seedInsetAmpRatio: 1.25,
  /**
   * 同父块内两个种子点的最小间距 = 这一比例 × 子块尺度 R。
   *
   * `pullInside` 在内缩要求苛刻时会把多个种子送到质心附近（裕度最大的点），
   * 导致它们的 Voronoi 单元几乎重合（实测最深一级出现面积完全相同的重复子块，
   * 父块的子块面积之和多出 26%）。采样之后加一道"成对推开"把间距撑到这个值。
   *
   * 0.5 是实测最优（24 个种子 × 四级共 5352 块）：
   *   0.35 → 自交 7、最大外溢 8.45；0.50 → 自交 5、最大外溢 3.25；
   *   0.65 → 自交 8、最大外溢 6.30。再大反而会把本来合理的种子硬推到贴边处。
   */
  minSeedSeparation: 0.5,
} as const;

/* ────────────────────────────── 噪声 ────────────────────────────── */

/**
 * mulberry32 —— 32 位确定性伪随机数发生器。
 *
 * 选用它而不是 Math.random：同种子必得同序列，测试才能断言具体结果。
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数格点哈希 → [0,1)。值噪声的格点随机值来源。 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (seed ^ Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h / 4294967296;
}

/** 五次平滑插值曲线（C2 连续）—— 比三次 smoothstep 更平顺，边界上看不到折角 */
function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * 二维值噪声（value noise），输出 [0,1)。
 *
 * 只在整数格点上取随机值、格点之间平滑插值。因为是**位置的连续函数**，
 * 相邻区块对同一条边界上的同一点必然算出同一个值 —— 这是"边界严丝合缝"的前提。
 */
export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smootherstep(x - x0);
  const fy = smootherstep(y - y0);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

/**
 * 分形布朗运动（fbm）：多个倍频值噪声叠加，输出 [0,1)。
 *
 * 单层噪声只有一种"波长"，起伏会显得单调；叠加 2 层后同时拥有大尺度的走向
 * 与小尺度的锯齿 —— 这正是真实海岸线/疆界线的自相似观感。
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  octaves = 3,
  lacunarity = 2.05,
  gain = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ─────────────────────────── 几何与裁剪 ─────────────────────────── */

/** 点到线段的最短距离 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 点到多边形边界的最短距离 */
function distToPolygonBoundary(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** 多边形轴对齐包围盒 */
function polygonBounds(poly: Point[]): RegionBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 线段上的参数 t（p 在 ab 直线上的投影，未钳制到 [0,1]） */
function paramOnSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
}

/**
 * HSL → 0xRRGGBB（h 单位为度，s/l 为 0~1）。
 *
 * 【为什么导出】手画落库的取色规则（`regionEdit.manualRegionColor`）必须与生成器
 * **同一口径**，否则同一张图上"生成的块"和"手画的块"会是两种色系。
 * 复制一份实现会让两边悄悄漂移，所以只留这一处。
 */
export function hslToRgb(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  // 色相落在哪个 60° 扇区，决定 RGB 三个分量的取值形态
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const m = l - c / 2;
  const to = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (to(rgb[0]) << 16) | (to(rgb[1]) << 8) | to(rgb[2]);
}

/** 半平面裁剪的容差：判定"在保留侧"时允许的浮点误差 */
const CLIP_EPS = 1e-9;

/** 去掉环里挨得太近的相邻点（半平面裁剪的退化交点会造出零长边） */
function dedupeRing(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
  while (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.abs(last.x - first.x) < 1e-9 && Math.abs(last.y - first.y) < 1e-9) out.pop();
    else break;
  }
  return out;
}

/**
 * 用一个半平面裁剪多边形，**允许切成多块**（返回若干条简单环）。
 *
 * 【为什么不能用 Sutherland–Hodgman —— 这是"色块盖湾 / 飞线越海"的真因】
 * S-H 逐边连一条链，隐含假设"裁剪结果仍是一条环"。可凹多边形被直线切开时，
 * 结果经常是**两块甚至更多**；S-H 只能用一条沿裁剪线的弦把它们硬连成一条环。
 * 那条弦就是用户截图里"横穿整块地、甚至跨过海湾"的细线；而 non-zero 填充
 * 又会把弦围出来的湾口一起涂上区块色。**两种缺陷是同一个根因**：把多连通
 * 的结果硬塞进单环。
 *
 * 【算法】沿裁剪线求出全部交点 →
 *   ① 按**环上顺序**配对（进→出）得到若干条"保留链"；
 *   ② 再按**线上顺序**配对（出→进）用线段把链连起来。
 * 两个配对都是一一映射，顺着走就得到若干条互不相交、各自闭合的简单环。
 * 这正是逆向目标里 `country.shape` 恒为**单个简单多边形**的实现前提
 * （他们连 `removeNearPoint(shape, 8)` 的简化都省不掉，因为形状本来就不自交）。
 *
 * @param keep 线性函数：<= 0 的一侧保留（与 `voronoiCellPiecesIn` 的约定一致）
 */
function clipHalfPlanePieces(polygon: Point[], keep: (p: Point) => number): Point[][] {
  const n = polygon.length;
  if (n < 3) return [];
  const f = new Array<number>(n);
  let hasIn = false;
  let hasOut = false;
  for (let i = 0; i < n; i += 1) {
    const v = keep(polygon[i]);
    f[i] = v;
    if (v <= CLIP_EPS) hasIn = true;
    else hasOut = true;
  }
  // 整块都在保留侧 / 都在丢弃侧：不必求交，直接返回（保留原对象，省一次拷贝）
  if (!hasOut) return [polygon];
  if (!hasIn) return [];

  // 裁剪线的方向：`keep` 是线性函数，数值求一次梯度即可（垂直方向就是线方向）
  const gx = keep({ x: polygon[0].x + 1, y: polygon[0].y }) - f[0];
  const gy = keep({ x: polygon[0].x, y: polygon[0].y + 1 }) - f[0];
  const ux = -gy;
  const uy = gx;

  interface Cut {
    /** 交点所在边的起点序号 */
    edge: number;
    /** 边内参数（0~1） */
    t: number;
    p: Point;
    /** 该交点是"出去"（保留 → 丢弃）还是"进来" */
    out: boolean;
    /** 沿裁剪线的位置（配对用） */
    along: number;
  }
  const cuts: Cut[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const aIn = f[i] <= CLIP_EPS;
    const bIn = f[j] <= CLIP_EPS;
    if (aIn === bIn) continue;
    const t = f[i] / (f[i] - f[j]);
    const p = {
      x: polygon[i].x + (polygon[j].x - polygon[i].x) * t,
      y: polygon[i].y + (polygon[j].y - polygon[i].y) * t,
    };
    cuts.push({ edge: i, t, p, out: aIn, along: p.x * ux + p.y * uy });
  }
  if (cuts.length < 2) return hasIn ? [polygon] : [];

  // ① 环上顺序：每个"进来"后面紧跟的那个"出去"，是同一条保留链的另一端
  const byRing = cuts.map((_, i) => i);
  byRing.sort((a, b) => cuts[a].edge + cuts[a].t - (cuts[b].edge + cuts[b].t));
  const exitAfterEnter = new Map<number, number>();
  for (let k = 0; k < byRing.length; k += 1) {
    const cur = byRing[k];
    const nxt = byRing[(k + 1) % byRing.length];
    if (!cuts[cur].out && cuts[nxt].out) exitAfterEnter.set(cur, nxt);
  }
  // ② 线上顺序：交点沿裁剪线**成对**出现，每一对之间那一段落在多边形内部，
  //    就是裁剪结果的边界段。所以"出去"的那个交点必须回到**同一对**里的
  //    "进来"那一个 —— 这才是边界（[E,X] 这一段在环内）。
  //
  //    ⚠️ 这里曾写成"接到线上**下一个**进来的点"，那是错的：它把两对之间的
  //    水域（多边形外部）当成了边界，于是相邻两块各拉一条弦跨过湾口 —— 正是
  //    用户截图里"线横穿海面、湾里没有区块色"的最后一处来源。判据是
  //    "这一对之间的中点在环内"，几何上不可能错。
  const byLine = cuts.map((_, i) => i);
  byLine.sort((a, b) => cuts[a].along - cuts[b].along);
  const enterAfterExit = new Map<number, number>();
  for (let k = 0; k + 1 < byLine.length; k += 2) {
    const i0 = byLine[k];
    const i1 = byLine[k + 1];
    if (!cuts[i0].out && cuts[i1].out) {
      exitAfterEnter.set(i0, i1);
      enterAfterExit.set(i1, i0);
    } else if (cuts[i0].out && !cuts[i1].out) {
      exitAfterEnter.set(i1, i0);
      enterAfterExit.set(i0, i1);
    }
  }

  const out: Point[][] = [];
  const used = new Set<number>();
  for (const start of byRing) {
    if (cuts[start].out || used.has(start)) continue;
    const ring: Point[] = [];
    let cur = start;
    let guard = 0;
    while (guard <= cuts.length && !used.has(cur)) {
      used.add(cur);
      const exitIdx = exitAfterEnter.get(cur);
      if (exitIdx === undefined) break;
      const enter = cuts[cur];
      const exit = cuts[exitIdx];
      ring.push(enter.p);
      // 链上的实顶点：enter 所在边之后一路到 exit 所在边的起点
      const steps = (exit.edge - enter.edge + n) % n;
      for (let k = 1; k <= steps; k += 1) ring.push(polygon[(enter.edge + k) % n]);
      ring.push(exit.p);
      const next = enterAfterExit.get(exitIdx);
      if (next === undefined) break;
      cur = next;
      guard += 1;
    }
    const cleaned = dedupeRing(ring);
    if (cleaned.length >= 3 && polygonArea(cleaned) > 1e-6) out.push(cleaned);
  }
  return out;
}

/**
 * 求第 index 个种子点在 `region` 内的 Voronoi 单元，**按连通块返回**。
 *
 * 【为什么不再要求 `region` 是凸的】旧实现靠 Sutherland–Hodgman，只对凸裁剪框
 * 成立，于是只能给陆地环（星形、有深湾）打补丁：径向钳制 + 越湾绕行 + 接缝修复
 * 三套兜底。改用可切分的半平面裁剪后，**凹容器也能被精确切开**，那三套补丁
 * 全部不再需要 —— 单元天然 ⊆ 容器，边界天然贴岸。
 *
 * 层级生成时传入的仍是父块的**基线多边形**（而非崎岖化后的显示多边形）：
 * 子块是父块基线的一部分，曲线由子级继承父级的 host 重画，两侧才能逐点重合。
 */
function voronoiCellPiecesIn(index: number, seeds: Point[], region: Point[]): Point[][] {
  let pieces: Point[][] = [region];
  const me = seeds[index];
  for (let j = 0; j < seeds.length; j += 1) {
    if (j === index) continue;
    // 垂直平分线：保留"离 me 更近"的一侧。
    // 设中点 M，方向 d = other - me，则 p 在 me 侧等价于 (p - M)·d <= 0。
    const other = seeds[j];
    const dx = other.x - me.x;
    const dy = other.y - me.y;
    const mx = (me.x + other.x) / 2;
    const my = (me.y + other.y) / 2;
    const keep = (p: Point) => (p.x - mx) * dx + (p.y - my) * dy;
    const next: Point[][] = [];
    for (const piece of pieces) next.push(...clipHalfPlanePieces(piece, keep));
    pieces = next;
    if (pieces.length === 0) return [];
  }
  return pieces;
}

/** 点是否落在多边形内（射线法）。用于命中测试与单元测试。 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** 区块多边形的质心（用于后续在区块上叠加标签，也用于把种子点拉回区块内） */
export function polygonCentroid(polygon: Point[]): Point {
  if (polygon.length === 0) return { x: 0, y: 0 };
  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    signedArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  signedArea *= 0.5;
  if (signedArea === 0) return polygon[0];
  return { x: cx / (6 * signedArea), y: cy / (6 * signedArea) };
}

/** 多边形面积（绝对值） */
export function polygonArea(polygon: Point[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/* ────────────────────── 基线边（HostEdge）────────────────────── */

/** 生成过程共享的上下文 */
interface WobbleCtx {
  /** 整张地图的世界范围（画框收敛用） */
  bounds: RegionBounds;
  /** 噪声种子 */
  noiseSeed: number;
  /** 全局采样步长（世界单位） */
  step: number;
  /** 最细一级的尺度基准 R（振幅封顶用） */
  finestR: number;
}

/**
 * 一条"基线边" —— 崎岖化的最小共享单位。
 *
 * 关键性质：**它的振幅、频率、采样只由自己决定**，因此
 *   · 相邻两块对同一条边算出完全相同的折线；
 *   · 父块与子块对"同一段边"算出完全相同的折线（子块直接从父块折线上切片）。
 */
interface HostEdge {
  /** 基线端点（方向已按 (x,y) 字典序规范化，与"谁来用"无关） */
  a: Point;
  b: Point;
  /** 崎岖化振幅（世界单位）；0 表示保持笔直 */
  amp: number;
  /** 噪声采样频率 */
  freq: number;
  /** 振幅向地图画框收敛的距离 */
  frameTaper: number;
  /** 采样段数（折线共 n+1 个点）；越湾修复补点后与折线长度**同步更新** */
  n: number;
  /** 崎岖化后的折线，惰性计算一次 */
  line: Point[] | null;
  /**
   * 折线每个点的**基线参数**（u ∈ [0,1]，沿 a→b 直线投影）。
   *
   * 【为什么需要它】越湾修复会往折线里插入岸上绕行点 —— 插点之后"索引 ÷ n"
   * 不再等于基线参数，`pointAtU` / `arcBetween` 若还按索引均匀取点，子块切片
   * 会拿到**错位的几何**（实测越岸点反而变多）。参数表让"折线上有插点"这件事
   * 对所有消费方透明：u → 点的映射由表内插值给出，切片窗口 (lo,hi) 语义不变。
   * 恒与 line 同长；null 等价于均匀（frameHost 等不修复的场合）。
   */
  us: number[] | null;
}

/** 一条边的引用：用哪条基线边、从哪点走到哪点 */
interface EdgeRef {
  host: HostEdge;
  from: Point;
  to: Point;
}

/** 生成过程中的一个节点（含父块基线，供子块裁剪与继承用；不进文档） */
interface LocalNode {
  id: string;
  level: number;
  seed: Point;
  /** 基线多边形（**凸**，用于给子块做裁剪范围） */
  base: Point[];
  /** 基线每条边对应的基线边引用 */
  edges: EdgeRef[];
  /** 显示多边形（崎岖化之后） */
  display: Point[];
}

/**
 * 点到各边的最小距离 → 0~1 的收敛系数：越贴地图边框越接近 0。
 *
 * 目的在于让边界在画框附近自然收直，同时**数学上保证**位移不会越出地图：
 * 只需 smoothstep(0, taper, d) * amp ≤ d 对一切 d 成立，取 taper = 2.4·amp
 * 即恒成立（d ≥ taper 时 amp < 2.4amp = taper ≤ d）。
 */
function borderFade(p: Point, bounds: RegionBounds, taper: number): number {
  const d = Math.min(
    p.x - bounds.x,
    bounds.x + bounds.width - p.x,
    p.y - bounds.y,
    bounds.y + bounds.height - p.y,
  );
  if (d >= taper) return 1;
  if (d <= 0) return 0;
  const t = d / taper;
  return t * t * (3 - 2 * t);
}

/** 兜底钳制：正常情况下 borderFade 已保证不越界，这里只是最后一道保险 */
function clampToBounds(p: Point, bounds: RegionBounds): Point {
  return {
    x: Math.min(Math.max(p.x, bounds.x), bounds.x + bounds.width),
    y: Math.min(Math.max(p.y, bounds.y), bounds.y + bounds.height),
  };
}

/** 画框边：地图矩形的四条边，不崎岖化（它是画框，不是区块之间的界） */
function makeFrameHost(a: Point, b: Point): HostEdge {
  return { a, b, amp: 0, freq: 1, frameTaper: 1, n: 1, line: [a, b], us: [0, 1] };
}

/**
 * 建一条基线边。
 *
 * @param from/to  这条边**实际**的两个端点（可能已被父级边界推移过）
 * @param capMid   用**未位移**的基线中点算振幅上限 —— 它落在两侧种子点的垂直
 *                 平分线上，因此两侧算出的上限完全相同。若改用位移后的中点，
 *                 两侧会得到略不同的振幅 → 共享边界出现发丝级裂缝。
 * @param capSeed  本区块种子点（只用于振幅上限，不参与几何）
 * @param R        本级尺度基准
 */
function makeHost(
  from: Point,
  to: Point,
  capMid: Point,
  capSeed: Point,
  R: number,
  ctx: WobbleCtx,
  /** 边中点到父块边界的距离（缺省 Infinity = 不限；见 coastClearanceRatio） */
  capClearance = Infinity,
): HostEdge {
  // 规范方向：按 (x, y) 字典序，保证两侧区块得到同一个 a→b
  const flip = from.x > to.x || (from.x === to.x && from.y > to.y);
  const a = flip ? to : from;
  const b = flip ? from : to;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { a, b, amp: 0, freq: 1, frameTaper: 1, n: 1, line: [a, b], us: [0, 1] };

  const freq = 1 / (R * REGION_WOBBLE.wavelength);
  // 缓变调制：同样一条边，落在噪声高值区就扭得厉害，落在低值区就接近直线
  const ampScale =
    1 +
    (fbm(capMid.x * freq * 0.55, capMid.y * freq * 0.55, ctx.noiseSeed + 771, 1) * 2 - 1) *
      REGION_WOBBLE.ampVariation;
  const halfSpan = Math.hypot(capMid.x - capSeed.x, capMid.y - capSeed.y);
  const amp = Math.max(
    0,
    Math.min(
      R * REGION_WOBBLE.amplitude * ampScale,
      halfSpan * REGION_WOBBLE.maxAmplitudeRatio,
      len * REGION_WOBBLE.maxEdgeRatio,
      // 封顶三：这条曲线会被最深处的子块原样继承，起伏不能超过它们的承受能力
      ctx.finestR * REGION_WOBBLE.fineAmpCap,
      // 封顶四：留出"到父块边界"的余量，别把曲折拱到块外
      capClearance * REGION_WOBBLE.coastClearanceRatio,
    ),
  );

  const n = Math.max(1, Math.min(REGION_WOBBLE.maxSegments, Math.ceil(len / ctx.step)));
  return { a, b, amp, freq, frameTaper: Math.max(amp * 2.4, 1e-6), n, line: null, us: null };
}

/** 基线边在参数 u ∈ [0,1] 处的显示点（位移沿边的法线） */
function hostPointAt(h: HostEdge, u: number, ctx: WobbleCtx): Point {
  const bx = h.a.x + (h.b.x - h.a.x) * u;
  const by = h.a.y + (h.b.y - h.a.y) * u;
  if (h.amp <= 0) return { x: bx, y: by };

  const dx = h.b.x - h.a.x;
  const dy = h.b.y - h.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: bx, y: by };

  // fbm 输出 [0,1) → 映射到 [-1,1)：位移有正有负，边界两侧都会被"啃"到
  const noise =
    fbm(
      bx * h.freq,
      by * h.freq,
      ctx.noiseSeed,
      REGION_WOBBLE.octaves,
      REGION_WOBBLE.lacunarity,
      REGION_WOBBLE.gain,
    ) *
      2 -
    1;
  // 交汇点收敛 + 画框收敛
  const ramp =
    smootherstep(Math.min(1, u / REGION_WOBBLE.vertexTaper)) *
    smootherstep(Math.min(1, (1 - u) / REGION_WOBBLE.vertexTaper));
  const fade = borderFade({ x: bx, y: by }, ctx.bounds, h.frameTaper);
  const off = noise * h.amp * ramp * fade;
  return clampToBounds({ x: bx + (-dy / len) * off, y: by + (dx / len) * off }, ctx.bounds);
}

/** 基线边的折线（惰性计算并缓存） */
function hostLine(h: HostEdge, ctx: WobbleCtx): Point[] {
  if (h.line) return h.line;
  const pts: Point[] = [];
  for (let k = 0; k <= h.n; k += 1) pts.push(hostPointAt(h, k / h.n, ctx));
  // 两端位移恒为 0（ramp = 0），显式对齐可消掉浮点末位误差 ——
  // 这一点是"父子边界严丝合缝"的前提：基线端点必须逐位相等。
  pts[0] = { x: h.a.x, y: h.a.y };
  pts[h.n] = { x: h.b.x, y: h.b.y };
  // 采样点的基线参数本来是均匀的 k/n；越湾修复插点后由参数表接管（见 HostEdge.us）
  const us: number[] = [];
  for (let k = 0; k <= h.n; k += 1) us.push(k / h.n);
  h.line = pts;
  h.us = us;
  return pts;
}

/** 折线上按基线参数 u 取点（落在折线的线段上，因此与父级逐点一致） */
function pointAtU(h: HostEdge, u: number, ctx: WobbleCtx): Point {
  const line = hostLine(h, ctx);
  if (u <= 0) return { x: line[0].x, y: line[0].y };
  if (u >= 1) return { x: line[h.n].x, y: line[h.n].y };
  const us = h.us;
  if (!us) {
    // 未修复的折线：参数均匀，索引直取（与历史行为逐位一致）
    const pos = u * h.n;
    const i = Math.min(h.n - 1, Math.floor(pos));
    const f = pos - i;
    return {
      x: line[i].x + (line[i + 1].x - line[i].x) * f,
      y: line[i].y + (line[i + 1].y - line[i].y) * f,
    };
  }
  // 修复过的折线：按基线参数表二分定位线段，段内线性插值。
  // 同一条缓存折线 + 同一个 u → 同一个点，父子/兄弟的一致性不受插点影响。
  let lo = 0;
  let hi = us.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (us[m] <= u) lo = m;
    else hi = m;
  }
  const span = us[hi] - us[lo];
  const f = span > 1e-12 ? (u - us[lo]) / span : 0;
  return {
    x: line[lo].x + (line[hi].x - line[lo].x) * f,
    y: line[lo].y + (line[hi].y - line[lo].y) * f,
  };
}

/**
 * 取基线边折线上 from→to 之间的**中间点**（不含两端）。
 *
 * 方向由 from/to 决定：子块从父级折线上切一段下来时，父级折线的点序可能与
 * 子块的多边形绕向相反，这里按参数比较决定是否反转。
 */
function arcBetween(h: HostEdge, from: Point, to: Point, ctx: WobbleCtx): Point[] {
  const line = hostLine(h, ctx);
  const uf = paramOnSegment(h.a, h.b, from);
  const ut = paramOnSegment(h.a, h.b, to);
  const lo = Math.min(uf, ut);
  const hi = Math.max(uf, ut);
  const mid: Point[] = [];
  // 有参数表（越湾修复过）就按表取窗口内的点；没有（未修复）则参数 = k/n，
  // 与历史行为逐位一致。两种取法都是"同一条缓存折线上的同一段切片"。
  const us = h.us;
  const last = us ? us.length - 1 : h.n;
  for (let k = 1; k < last; k += 1) {
    const u = us ? us[k] : k / h.n;
    if (u > lo + 1e-9 && u < hi - 1e-9) mid.push(line[k]);
  }
  return uf <= ut ? mid : mid.reverse();
}

/**
 * 把落在 `poly` 外的点沿直线拉回 `target` 方向，直到进入 `poly`（含贴边）。
 *
 * 【为什么需要】子块的 Voronoi 单元是在父块的**基线**多边形（恒为凸）上算的，
 * 而父块的**显示**多边形会因为继承了更粗一级的曲线而向内凹出一个个"湾"。
 * 单元里那些"两条中垂线交点"式的**内部**顶点，就可能正好落进这些湾里 ——
 * 于是子块有一角捅到父块外面（实测最深一级能捅出 10 单位，并引发自交）。
 *
 * 【为什么不破坏父子/兄弟的严丝合缝】
 *   · 落在父块边界上的顶点（`pointAtU` 算出来的）本来就在显示多边形上，
 *     `outside` 判定为 false，原样返回，一个比特都不会动；
 *   · 目标点取父块**显示多边形**的质心，对所有兄弟完全相同，被修的又是同一个
 *     原始顶点，因此兄弟算出的新位置一致，不会裂开。
 */
function settleInside(p: Point, poly: Point[], target: Point): Point {
  const outside = (q: Point) => !pointInPolygon(q, poly) && distToPolygonBoundary(q, poly) > 1e-6;
  if (!outside(p)) return p;
  const STEPS = 8;
  for (let k = 1; k <= STEPS; k += 1) {
    const t = k / STEPS;
    const q = { x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t };
    if (!outside(q)) return q;
  }
  return { x: target.x, y: target.y };
}

/* ────────────────────────── 种子点采样 ────────────────────────── */

/** 点是否在多边形内、且距边界至少 inset */
function insideWithInset(p: Point, poly: Point[], inset: number): boolean {
  if (!pointInPolygon(p, poly)) return false;
  return inset <= 0 || distToPolygonBoundary(p, poly) >= inset;
}

/**
 * 把点拉进多边形内（沿指向质心的方向逐步靠近）。
 *
 * 抖动 + 域扭曲会把种子推到父块外面；贴边的种子还会长成"刀片状"区块。
 *
 * 【为什么是"一路放宽到 0"而不是"找不到就回质心"】内缩要求（躲开父级起伏）在
 * 层级深处可能根本无解 —— 父块被上一级的曲线啃掉一大块后，能同时满足内缩的点
 * 只剩质心附近一小片。此时若把种子退到质心，**多个种子会落到同一个坐标**，
 * 它们的 Voronoi 单元便完全重合：实测最细一级出现两个面积/顶点数一模一样的
 * 重复子块，整块父级的子块面积之和多出 26%。所以必须一路放宽到"只要在多边形内"
 * （对凸多边形而言质心必在内部，这条一定能满足），保留种子的彼此差异。
 */
function pullInside(p: Point, poly: Point[], centroid: Point, inset: number): Point {
  const STEPS = 16;
  let need = inset;
  for (let pass = 0; pass < 8; pass += 1) {
    for (let k = 1; k <= STEPS; k += 1) {
      const t = k / STEPS;
      const q = { x: p.x + (centroid.x - p.x) * t, y: p.y + (centroid.y - p.y) * t };
      if (insideWithInset(q, poly, need)) return q;
    }
    if (need <= 0) break;
    need = need <= 1 ? 0 : need * 0.5;
  }
  return { x: centroid.x, y: centroid.y };
}

/**
 * 在父块内撒 n 个种子点。
 *
 * 抖动网格保证疏密均匀（纯随机会出现极小/极大的畸形区块），网格之上再叠一层
 * **低频域扭曲**（同一张 fbm 噪声场把种子整体推一下）：均匀网格会让每块面积
 * 几乎一样、读起来像蜂巢；扭曲之后种子成团成疏，区块大大小小才像真实疆域。
 */
function sampleSeeds(
  poly: Point[],
  n: number,
  inset: number,
  rng: () => number,
  seed: number,
): Point[] {
  const bbox = polygonBounds(poly);
  const centroid = polygonCentroid(poly);
  const cols = Math.max(1, Math.round(Math.sqrt((n * bbox.width) / Math.max(bbox.height, 1e-6))));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = bbox.width / cols;
  const cellH = bbox.height / rows;

  const grid: Array<{ c: number; r: number }> = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) grid.push({ c, r });
  }
  // 行列取整会让格子数略多于 n，随机抽掉多余的，而不是简单截断
  // —— 截断会在区块里留下一个规则的空白角。
  while (grid.length > n) grid.splice(Math.floor(rng() * grid.length), 1);

  // 域扭曲的噪声频率取"约 1.8 个格子一个波"：波长比格子大，位移才会在相邻
  // 种子之间连续变化（否则会把整片种子揉成随机噪声，而不是形成疏密带）。
  const warpFreq = 1 / (Math.max(1e-6, Math.min(cellW, cellH)) * 1.8);

  const pts = grid.map(({ c, r }) => {
    const gx = bbox.x + (c + 0.18 + rng() * 0.64) * cellW;
    const gy = bbox.y + (r + 0.18 + rng() * 0.64) * cellH;
    const wx =
      (fbm(gx * warpFreq, gy * warpFreq, seed + 9173) * 2 - 1) * cellW * REGION_WOBBLE.seedWarp;
    const wy =
      (fbm(gx * warpFreq + 13.7, gy * warpFreq + 41.3, seed + 4327) * 2 - 1) *
      cellH *
      REGION_WOBBLE.seedWarp;
    return pullInside({ x: gx + wx, y: gy + wy }, poly, centroid, inset);
  });
  separateSeeds(pts, poly, centroid, rng);
  return pts;
}

/**
 * 把互相贴得太近的种子推开。
 *
 * 【为什么必须有这一道】内缩要求（躲开父级起伏）在层级深处可能只剩质心附近
 * 一小片能满足：父块被上一级的曲线啃掉一大块之后，"离边界足够远"的地方本就不多。
 * `pullInside` 于是把多个种子一起送到质心（裕度最大的点）—— 它们的 Voronoi 单元
 * 完全重合，父块的子块面积之和直接翻倍（实测最深一级 3 个郡种子落在同一点，
 * 每个的面积都等于整个父块）。
 *
 * 这里做若干轮"成对推开 + 拉回块内"，把间距撑到与子块尺度相称
 * （`REGION_WOBBLE.minSeedSeparation × R`）。
 * 因为只改种子位置、不改任何几何规则，父子边界的严丝合缝不受影响。
 */
function separateSeeds(seeds: Point[], poly: Point[], centroid: Point, rng: () => number): void {
  const minSep =
    REGION_WOBBLE.minSeedSeparation *
    Math.sqrt(polygonArea(poly) / Math.max(1, seeds.length));
  if (!(minSep > 0)) return;
  for (let iter = 0; iter < 6; iter += 1) {
    let moved = false;
    for (let i = 0; i < seeds.length; i += 1) {
      for (let j = i + 1; j < seeds.length; j += 1) {
        let dx = seeds[j].x - seeds[i].x;
        let dy = seeds[j].y - seeds[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= minSep) continue;
        if (d < 1e-9) {
          // 完全重合：必须给一个确定性的方向，否则"推开"永远推不开
          const ang = rng() * Math.PI * 2;
          dx = Math.cos(ang);
          dy = Math.sin(ang);
          d = 1;
        }
        const push = (minSep - d) / 2;
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        seeds[i] = { x: seeds[i].x - ux, y: seeds[i].y - uy };
        seeds[j] = { x: seeds[j].x + ux, y: seeds[j].y + uy };
        moved = true;
      }
    }
    if (!moved) break;
    // 被推到块外的拉回来（内缩要求已放宽到 0，只保证"在块内"）
    for (let i = 0; i < seeds.length; i += 1) {
      seeds[i] = pullInside(seeds[i], poly, centroid, 0);
    }
  }
}

/* ────────────────────────── 层级生成 ────────────────────────── */

export interface GenerateHierarchyOptions {
  /** 随机种子 */
  seed: number;
  /** 地图世界范围 */
  bounds: RegionBounds;
  /**
   * 每级区块数（长度即层级数）；**优先级高于 `schema.count`**
   * （多岛加权分配要用它逐岛缩放数量）。
   */
  levelCounts?: readonly number[];
  /**
   * 层级定义（**只为取名字**）。缺省 = `DEFAULT_REGION_SCHEMA`。
   *
   * 【为什么不从它读数量】数量的事实源是 `levelCounts`（上面的优先级说明）：
   * 多岛时每级数量要按面积份额缩放，`schema.count` 只是"用户设定的一整张图的目标数"。
   */
  schema?: readonly RegionLevelDef[];
  /**
   * 切分容器（陆地多边形的某一个环）。
   *
   * 【为什么需要】陆地生成之后，区块必须只在**陆地内**划分，否则会有一半区块
   * 飘在海里。这里只把根容器从 `bounds` 矩形换成陆地多边形，其余层级逻辑一行
   * 不改 —— 更深层级用的是 Voronoi 单元（恒凸），只有 level 0 会拿到非凸容器。
   *
   * 【缺省 = 老行为】不传时按 `bounds` 的四角走矩形路径，
   * `regions.test.ts` 的全部判据都不受影响。
   */
  container?: Point[];
  /**
   * id 前缀。**多岛时必须逐岛传不同的值**，否则 id 会重号。
   *
   * 【为什么】`nextId` 的计数器是**每次调用**新建的闭包变量（见下方），
   * 多个岛各调一次 `generateHierarchy` 就会各自从 1 开始编号，
   * 于是两岛的第 1 块都叫 `rg_<seed>_1` —— React key 冲突、撤销栈错乱，
   * 而且**测试不一定报**。缺省为空串 ⇒ 单次调用的 id 与改动前**一字不差**。
   */
  idPrefix?: string;
}

/** 把 total 尽量平均分给 parts 份 */
function shareCounts(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const rem = total % parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i += 1) out.push(base + (i < rem ? 1 : 0));
  return out;
}

/** 父级的边界上可能出现的最大振幅（决定子级种子要内缩多少） */
function maxBoundaryAmp(node: LocalNode): number {
  let best = 0;
  for (const e of node.edges) if (e.host.amp > best) best = e.host.amp;
  return best;
}

/**
 * 算一块 Voronoi 单元在**本层**的显示多边形（崎岖化之后的）与它的基线边。
 *
 * 显示多边形的构成（顺序即多边形绕向）：
 *   · 落在父级边界上的边 → **原样切下父级折线的一段**（这就保证了严丝合缝）
 *   · 内部边（与兄弟共享）→ 按本级规则崎岖化；振幅上限取未位移的基线中点，
 *     因此两侧算出的折线完全相同，只是点序相反
 *
 * 单元可以是父块被半平面切下来的**任意一块**（凹父块会切出多块），所以这里
 * 不假设它是凸的 —— 只要求它是一条简单环（`clipHalfPlanePieces` 的保证）。
 */
function buildCellDisplay(
  cell: Point[],
  parent: LocalNode,
  seedPoint: Point,
  R: number,
  ctx: WobbleCtx,
): { display: Point[]; edges: EdgeRef[] } | null {
  if (cell.length < 3) return null;
  // 父块显示多边形的质心：把"落进父块内凹湾里"的内部顶点拉回来的目标点
  const parentInner = polygonCentroid(parent.display);

  // ── 1) 每个顶点：判定它落在父级基线的**哪几条**边上 ──
  //
  // 【为什么是"哪几条"而不是"哪一条"】父级的一个顶点同时是它相邻两条边的端点。
  // 若每个顶点只记一条边，那么"从父级顶点出发、沿下一条边继续走"的那条子边
  // 就会因为两端记到了不同的边号而被误判成内部边 —— 于是它不再继承父级曲线，
  // 而是按自己的振幅重算一遍，父级边界上就出现一大段对不上的缺口（实测能到
  // 父级边界的四成）。记下全部候选边、再在**每条子边**上求交集，才是正确的判据。
  const verts = cell.map((v) => {
    const ons: number[] = [];
    for (let j = 0; j < parent.base.length; j += 1) {
      if (distToSegment(v, parent.base[j], parent.base[(j + 1) % parent.base.length]) < 1e-6) {
        ons.push(j);
      }
    }
    if (ons.length === 0) {
      // 内部顶点（两条中垂线的交点）：可能落在父块显示多边形的内凹湾里，拉回来
      return { raw: v, point: settleInside(v, parent.display, parentInner), ons };
    }

    // 锚点 = 父级折线上对应位置的点。父级顶点处两条边的折线端点都精确等于该
    // 顶点本身（见 hostLine 的端点对齐），因此取哪条边得到的是同一个点。
    const j = ons[0];
    const ref = parent.edges[j];
    const t = paramOnSegment(parent.base[j], parent.base[(j + 1) % parent.base.length], v);
    const uFrom = paramOnSegment(ref.host.a, ref.host.b, ref.from);
    const uTo = paramOnSegment(ref.host.a, ref.host.b, ref.to);
    return { raw: v, point: pointAtU(ref.host, uFrom + (uTo - uFrom) * t, ctx), ons };
  });

  // ── 2) 每条边：继承父级曲线，或新建一条内部基线边 ──
  const edges: EdgeRef[] = [];
  for (let k = 0; k < cell.length; k += 1) {
    const va = verts[k];
    const vb = verts[(k + 1) % cell.length];
    // 两端共处父级同一条边 → 该子边整段都在父级边界上，原样继承
    const shared = va.ons.find((j) => vb.ons.includes(j));
    if (shared !== undefined) {
      const host = parent.edges[shared].host;
      // 两端在父级**基线**上的位置 → 换算成基线边自身的参数区间
      const ref = parent.edges[shared];
      const uFrom = paramOnSegment(ref.host.a, ref.host.b, ref.from);
      const uTo = paramOnSegment(ref.host.a, ref.host.b, ref.to);
      const segA = parent.base[shared];
      const segB = parent.base[(shared + 1) % parent.base.length];
      const map = (p: Point) =>
        pointAtU(ref.host, uFrom + (uTo - uFrom) * paramOnSegment(segA, segB, p), ctx);
      edges.push({ host, from: map(va.raw), to: map(vb.raw) });
    } else {
      const capMid = { x: (va.raw.x + vb.raw.x) / 2, y: (va.raw.y + vb.raw.y) / 2 };
      edges.push({
        // 离父块边界多远决定这条边最多能扭多少（见 REGION_WOBBLE.coastClearanceRatio）
        host: makeHost(
          va.point,
          vb.point,
          capMid,
          seedPoint,
          R,
          ctx,
          distToPolygonBoundary(capMid, parent.display),
        ),
        from: va.point,
        to: vb.point,
      });
    }
  }

  // ── 3) 拼显示多边形 ──
  //
  // 【不需要任何"拉回岸线"的事后修补】单元是**精确裁剪**出来的（见
  // `clipHalfPlanePieces`），顶点与弧点天然落在父块之内；父块的边界那一段
  // 本来就是陆地环本身，所以区块边界天然贴岸。
  const display: Point[] = [];
  for (const e of edges) {
    display.push(e.from);
    for (const p of arcBetween(e.host, e.from, e.to, ctx)) display.push(p);
  }
  if (display.length < 3) return null;
  return { display, edges };
}

/**
 * 由父级的基线多边形长出子块，并算出子块的**显示多边形**。
 *
 * 显示多边形的构成（顺序即多边形绕向）：
 *   · 落在父级边界上的边 → **原样切下父级折线的一段**（这就保证了严丝合缝）
 *   · 内部边（与兄弟共享）→ 按本级规则崎岖化；振幅上限取未位移的基线中点，
 *     因此两侧算出的折线完全相同，只是点序相反
 */
function buildChildren(
  parent: LocalNode,
  level: number,
  count: number,
  regions: MapRegion[],
  seed: number,
  rng: () => number,
  ctx: WobbleCtx,
  nextId: () => string,
  schema: readonly RegionLevelDef[],
): LocalNode[] {
  const parentAmp = maxBoundaryAmp(parent);
  const area = polygonArea(parent.base);
  const R = Math.sqrt(Math.max(area, 1) / Math.max(1, count));
  // 内缩受**双重**约束：下界是"躲开父级边界的起伏"，上界是"别把种子全挤到质心"。
  // 少了上界，内缩会随父级振幅逐级放大（实测 8.9 → 25.8 → 111.7），远超父块
  // 内切半径，于是 pullInside 把每个种子都拉到质心重叠 —— 每个子块的 Voronoi
  // 单元退化成整个父块，最细一级面积之和会变成父块的 4 倍。
  const inset = Math.min(
    Math.max(ctx.step * 2, parentAmp * REGION_WOBBLE.seedInsetAmpRatio),
    R * REGION_WOBBLE.insetCapRatio,
  );

  const seeds = sampleSeeds(parent.base, count, inset, rng, seed + level * 7919);
  if (seeds.length === 0) return [];

  // 名字只来自 schema（缺省 = DEFAULT_REGION_SCHEMA ⇒ 与改前逐字相同）。
  // ⚠️ 这里**不碰 rng**：多取/少取一个随机数会把整张图重排（见下方 color 的注释）。
  const label = levelLabelOf(schema, level);
  const out: LocalNode[] = [];

  for (let i = 0; i < seeds.length; i += 1) {
    // ── 0) 单元可能被切成**多块** ──
    //
    // 父块一凹（陆地环天然是星形、有深湾；上一级切出来的块也常是凹的），
    // 半平面就会把它切成几块互不相连的部分。全部收下、主块 + 附加块分别画：
    // 主块承担"区块身份"（种子、名字、命中），附加块只是同一区块伸出去的飞地。
    // 丢掉附加块会在地图上留下没有区块色的空地，硬塞进一条环则会造出横穿湾口的
    // 飞线 —— 两种老缺陷都从这里来。
    const pieces = voronoiCellPiecesIn(i, seeds, parent.base);
    if (pieces.length === 0) continue;
    let mainIdx = pieces.findIndex((p) => pointInPolygon(seeds[i], p));
    if (mainIdx < 0) {
      // 种子正好落在裁剪线上（或采样被推进了缝里）：退回面积最大的那块
      let bestA = -1;
      for (let k = 0; k < pieces.length; k += 1) {
        const a = polygonArea(pieces[k]);
        if (a > bestA) {
          bestA = a;
          mainIdx = k;
        }
      }
    }
    const main = buildCellDisplay(pieces[mainIdx], parent, seeds[i], R, ctx);
    if (!main) continue;
    const display = main.display;
    const edges = main.edges;

    // 附加块（飞地）：面积不到主块 4% 的当成裁剪毛刺丢掉
    let extra: Point[][] | undefined;
    if (pieces.length > 1) {
      const mainArea = polygonArea(pieces[mainIdx]);
      for (let k = 0; k < pieces.length; k += 1) {
        if (k === mainIdx) continue;
        if (polygonArea(pieces[k]) < mainArea * 0.04) continue;
        const built = buildCellDisplay(pieces[k], parent, seeds[i], R, ctx);
        if (built) (extra ??= []).push(built.display);
      }
    }

    // 种子自己的显示多边形也可能内凹（它同样继承了父级的曲线）：种子若正好落在
    // 这个内凹湾里，标签就会飘到自块外。朝自块质心拉一点即可。父块用的是自己的
    // 质心、子块用的是子块质心，两者互不影响，兄弟之间也不会裂开。
    const seedPoint = settleInside(seeds[i], display, polygonCentroid(display));

    // ── 4) 取色：从固定色板里取一格（随机流只决定"从哪一格起步"）──
    //
    // 【随机数的**数量**必须与 2.38.0 逐位一致（3 个，level 0 另有 1 个）】
    // rng 是**串行**伪随机流：少取/多取一个数，后面所有区块的种子点与几何都会
    // 整体错位，同 seed 出图就变了 —— 而 2.38.0 的几何已被
    // `region-land-audit.test.ts` 的实测基线（越岸点数 / 最大越出）钉住。
    // 旧代码在这里消耗的是「色相抖动的 jitter(1) + level 0 的色相初值(1) + 取色的
    // 两个数(2)」，即 level > 0 三个、level 0 四个；下面用三个**有语义**的数
    // （主选格 / 格内抖动 / 微抖）对齐前两个，再给 level 0 补回那一个。
    const pick = rng();
    const wobble = rng();
    const drift = rng();
    if (level === 0) rng();
    const len = REGION_PALETTE_RGB.length;
    const slot = Math.round(
      pick * (len - 1) + (wobble - 0.5) * 1.6 + (drift - 0.5) * 0.8,
    );
    const color = REGION_PALETTE_RGB[Math.max(0, Math.min(len - 1, slot))];
    const id = nextId();
    const node: LocalNode = {
      id,
      level,
      seed: seedPoint,
      base: pieces[mainIdx],
      edges,
      display,
    };
    regions.push({
      id,
      parentId: parent.id === "root" ? null : parent.id,
      level,
      // 序号取全局计数而非"父级内序号"，否则不同父级下会出现同名区块
      name: `${label} ${id.slice(id.lastIndexOf("_") + 1)}`,
      seed: seedPoint,
      polygon: display,
      pieces: extra,
      /**
       * 填充色：**色板的一格**（不是连续 HSL）。
       *
       * 这里给出的只是**起始格**（随机流决定，整张图因此色彩分布随机、不成规律）；
       * 真正的"相邻块必须读得出不同"由 `assignRegionColors` 在整棵树建完之后做
       * 邻接校正。分工的理由见 `REGION_PALETTE` 的注释：α 0.30 会把"接近的两色"
       * 压成同一块，所以颜色必须来自**离散且互不相邻的几格**，而不是一个连续函数。
       */
      color,
    });
    out.push(node);
  }

  return out;
}

/**
 * 生成一棵完整的层级区块树，返回**扁平数组**（靠 parentId 串起来）。
 *
 * 为什么用扁平数组而不是嵌套容器：坐标只存在于一个空间里，命中测试、撤销快照、
 * 落库序列化都不用关心层级；渲染时按 level 分组即可。
 *
 * @returns 顶层优先、同级按生成顺序排列的区块列表
 */
export function generateHierarchy(options: GenerateHierarchyOptions): MapRegion[] {
  const { seed, bounds } = options;
  const counts = [...(options.levelCounts ?? REGION_LEVELS.map((l) => l.count))];
  // 名字来源：显式 schema 优先，缺省 = 与 `REGION_LEVELS` 逐项等价的默认 schema。
  // 这就是"改前逐字节一致"的实现依据（不传 schema 与传 DEFAULT_REGION_SCHEMA 同一条路径）。
  const schema = options.schema ?? DEFAULT_REGION_SCHEMA;

  if (counts.length === 0) return [];
  if (counts.some((c) => !Number.isFinite(c) || c <= 0)) return [];
  if (bounds.width <= 0 || bounds.height <= 0) return [];

  // 全局采样步长取**最细一级**的尺度：父级的曲线会被子级原样切片，
  // 若按父级自己的尺度采样，缩到最深处那段折线会是一根根显眼的直线段。
  const finest = Math.max(1, counts[counts.length - 1]);
  const finestR = Math.sqrt((bounds.width * bounds.height) / finest);
  const ctx: WobbleCtx = {
    bounds,
    noiseSeed: seed,
    step: finestR / REGION_WOBBLE.segmentsPerRadius,
    finestR,
  };

  const rng = createRng(seed);
  let counter = 0;
  const prefix = options.idPrefix ?? "";
  const nextId = () => {
    counter += 1;
    return `rg_${prefix}${(seed >>> 0).toString(36)}_${counter}`;
  };

  // 虚拟根：缺省是整张地图的四条画框边（笔直）；传了 container 就按陆地多边形切。
  // 两种路径共用后面全部逻辑 —— 区别只在"根容器是矩形还是多边形"。
  const rect: Point[] = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
  const rootPoly: Point[] = options.container ?? rect;
  let frontier: LocalNode[] = [
    {
      id: "root",
      level: -1,
      seed: { x: 0, y: 0 },
      base: rootPoly,
      edges: rootPoly.map((p, i) => {
        const q = rootPoly[(i + 1) % rootPoly.length];
        const host = makeFrameHost(p, q);
        return { host, from: p, to: q };
      }),
      display: rootPoly,
    },
  ];

  const regions: MapRegion[] = [];

  for (let level = 0; level < counts.length; level += 1) {
    if (frontier.length === 0) break;
    const budget = REGION_TOTAL_LIMIT - regions.length;
    if (budget <= 0) break;
    const target = Math.min(counts[level], budget);
    const per = shareCounts(target, frontier.length);

    const next: LocalNode[] = [];
    for (let i = 0; i < frontier.length; i += 1) {
      const parent = frontier[i];
      const n = per[i];
      if (n <= 0) continue;
      next.push(...buildChildren(parent, level, n, regions, seed, rng, ctx, nextId, schema));
    }
    frontier = next;
  }

  // 整棵树建完再做邻接校正：邻居可能来自不同的父块（跨父块相邻是常态），
  // 边生成边校正就只能看到"已生成的那一半"，跨父块的撞色会漏掉。
  assignRegionColors(regions);

  return regions;
}
