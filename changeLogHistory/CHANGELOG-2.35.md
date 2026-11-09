# Changelog · 2.35.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.35.0] - 2026-11-06

> 地图 **观感批次 C · 序 4「镜像翻转破重复」**（`docs/review/map-vs-reference-render-analysis.md`
> §9.2.2 P1-4）：沼泽 / 雪原等档位素材只有 7 种，同屏重复肉眼可见 —— 左右镜像
> 让观感素材量**翻倍**，且不需要一张新图。

### Changed

- **`MapElement` 新增 `flipX?: boolean`（DTO / 存档）**：沿用 `opacity` / `tint` 的
  "可选字段 + 读点兜底"模式 —— `doc_json` 整存（`map.db` 无需表结构迁移），
  旧存档没有该字段时 `elementFlipXOf`（唯一读点）回落 `false` 原样渲染，
  不报错；迁移函数不补值（零写入原则）。
- **素材登记表新增 `flippable?: boolean`（缺省 `true`）**：有朝向的人造物登记
  `false`（帆船 / 码头 / 海港 / 石桥 / 荒废石门 / 关隘 / 雄关 —— 翻转后与
  "靠岸方向 / 门洞朝向"的语义冲突），自然地貌全部可翻；生成器（domain）经
  `SpriteSource.flippable` 注入取用，维持"禁止 import sprites.ts"的取料纪律。
- **一键成图按素材可翻性随机镜像 + 确定性去重**（`domain/generator.ts`）：每个可翻
  实例以 50% 概率翻面，掷骰走既有素材子流 `rng`（放尝试循环之前，同 seed 逐实例
  可复现）；`flipX` 随 `SpritePlacement` → `MapElement` 落档，五档重掷照常工作。
  **QA 实测后追加「确定性去重」**：翻转只是把同屏"像素完全一致"对的期望砍半
  （60 seeds 扫描实测 −46%），素材池最稀的沼泽/十万大山档下，(scale 0.01 /
  rotation 0.1°) 的量化抖动自身会碰撞，仍有 33% 的图含 ≥1 对一致素材。生成器
  布点时维护 `spriteId → { flip|量化scale|量化rotation }` 登记表：撞车实例先翻反
  flip（零成本），仍撞才重掷 rotation（**条件性消耗 rng**——只有真撞了才掷，
  同 seed 确定性不变）—— 把验收从"统计性"抬成"**任意 seed 恒 0**"的结构性保证。
- **渲染侧镜像**（`MapCanvas/index.tsx` 素材层 + `submapRender.ts` 子图素材）：
  `scale.x = |scale.x| × (flip ? −1 : 1)`。两个关键点：
  - pixi 8.22 的 `_setWidth` **保留 scale.x 符号**，符号必须在每次同步时显式
    重设，不能增量取反（否则上一次的翻面残留、撤销后翻不回去）；
  - 素材锚点是 `(0.5, 1)`（水平居中 + 脚底），翻转绕**竖直中轴**进行，
    外接盒与脚底点都不动 —— **命中区与选中框天然与原图一致**（"点哪选哪"），
    设计文档预案里"按 baseWidth 反算锚点 / 命中测试反算 x"在本项目的锚点
    模型下是空操作，无需改动 `coords.hitTestElement`。
- **验收**（同 seed 一键成图、真实 52 张池 + 全预设、繁密档）：同屏「像素完全
  一致」（spriteId + 翻面 + scale(0.01) + rotation(0.1°) 全等）的素材对数 = 0；
  经 QA 60 seeds 独立扫描证伪"统计性成立"后，补生成器确定性去重，守卫抬升为
  **20 seeds × 全预设 × dense 扫描恒 = 0**（结构性）；守卫测试全绿（生成器确定性 /
  不可翻白名单 / 旧档兼容 / 渲染符号 / 撤销不重建 / 脏档与移动保持 / 子图翻转），
  MapWindow 全量回归通过；tsc / eslint 干净。
