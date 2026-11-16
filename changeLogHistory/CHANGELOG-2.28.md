# Changelog · 2.28.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.28.0] - 2026-11-05

> 地图渲染观感对齐：**批次 A（海岸内缩 + z 分层基线）** 与 **批次 B（陆地纹理平铺 + 边缘羽化）**，
> 外加两轮实机反馈修掉的观感问题（素材过大、等深线一侧缺失、旋转不和谐、波浪线越界、地图库列表不刷新）。
> 一句话：素材不再压海岸线、森林不再被山压住、陆地从「一块死板纯色」变成**有颗粒、且颗粒在岸边淡出**的纸。

### Added

- **海岸内缩带**：`land.ts` 新增 `COAST_INSET = 14` 与 `insetLand()`——按**每环各自顶点均值中心**
  等比内缩（绕全局中心缩放会把卫星岛朝主陆拖移、顶点越出原岸线，多岛时素材会漏进海峡）。
  `generator.ts` 新增 `footprintInLand()`，素材落位从「只判锚点」改为**锚点 + 四角**都在内缩轮廓内，
  宽素材的左右脚不再越岸。
- **z 分层基线**：`generator.ts` 新增 `TERRAIN_LAYER`（`Record<TerrainKind, number>`，20 地形全档位：
  森林/丛林/沼泽 0 → 水体/地表 1 → 丘陵/山谷 1.5 → 山地/火山/高原 2 → 聚落/遗迹/绿洲 3），
  `placements.sort` 改为「先按层、同层再按 y」的二级排序。`Record` 的完整性让漏写地形在编译期就报错。
- **陆地纹理平铺**：纸纹从单张 `Sprite` 拉伸铺满约 1152² 烘焙矩形（放大 2.25 倍、颗粒糊成色块）
  改为 `TilingSprite` 按 512² 原尺寸重复，并用 `tilePosition` 把相位对齐**世界坐标**（重烘时纸纹不跳变）。
- **陆地纹理边缘羽化**：新增 `LAND_TEXTURE_FEATHER = 40` 与 `LAND_TEXTURE_STEPS = 5`——
  第 i 层遮罩取「内缩 `i × FEATHER/STEPS`」的陆地填充、各自 `alpha = LAND_TEXTURE_ALPHA/STEPS`，
  叠出离岸 40 单位内 5 级淡出。`textureMaskPolygons()` 做**逐环**退化兜底（小岛内缩后坍缩时退回原轮廓，
  宁可保留硬边纹理，也不要岛心出现光板）。

### Changed

- **素材体量整体压低**：`generator.ts` 新增 `TERRAIN_SCALE_OVERALL = 0.42`（在 `clusterScale` 末尾统一乘上，
  等价「全表等比缩小」而**不动 20 项相对排序**）。此前最大山体渲染宽约 331 世界单位、占陆地宽度 63%~90%，
  压到约 140 单位后，陆地不再像「小岛」。
- **素材旋转改为「大稳小活」**：`ROT_LARGE` 7 → 5、`ROT_SMALL` 15 → 9（原来是小素材 ±15°、大素材 ±7°，
  方向正好反了）。
- **等深线缩放基准**：从 `land.bounds`（整张纸 1024²）改为**陆地实测包围盒**（`landBBox`），缩放原点同步改为
  包围盒中心。旧基准的半幅是纸的 512、缩放原点却是陆地顶点均值中心，两者不匹配，导致等深线离岸距离被系统性
  算小、且在不规则团块的凹陷方向缩进陆地内部被 fill 盖住。
- **纸纹颗粒加强**：`PAPER_GRAIN_LUMA` 0.88 → 0.82，三层权重 0.5/0.32/0.18 → 0.62/0.26/0.12（加大粗粒），
  `LAND_TEXTURE_ALPHA` 0.55 → 0.7。实测亮度均值 238 → 229、标准差 3.71 → 5.76。
- **地图库测试拆分**：`MapEditorPage/index.test.tsx`（2214 行 / 51 用例 / **722s**）拆成
  `index.{coords,land-labels,regions,generate}.test.tsx` 四个可并行文件 + `__pixi-mock.ts` / `__test-utils.tsx`
  两个共享工具，51 个用例逐条比对**零丢失、零弱化**；MapWindow 全量墙钟降到约 **310s**。

### Fixed

- **等深线「一侧有、一侧没有」**：即上面的「等深线缩放基准」错误——凹陷方向的等深线缩进陆地后被 fill 盖住。
- **波浪线 / 海岸发光越过纸边**：新增 `clampIsobathDistance()`，把等深线离岸距离 clamp 到
  「陆地顶点到纸边框的最小余量」（`minLandToPaperClearance`）以内；只 clamp 等深线，浅滩与外发光本就离岸更近、
  不会越界，改它们反而会动到已验证的模糊参数。
- **删除地图后「列表不刷新 + 二次确认框不关」**（根因是窗口缺 antd `<App>` 容器）：
  `MapWindow/App.tsx` 从未包过 antd 的 `<App>`，而页面与 `useMapPersistence` 都靠
  `AntApp.useApp()` 取 `message` / `modal` —— antd 的 `AppContext` 默认值是
  `{ message: {}, notification: {}, modal: {} }`，**缺容器不报错，只给三个空对象**。于是
  `deleteDoc` 末尾的 `message.success(...)` 直接 `TypeError`：
  ① 写操作其实已成功，但 `onConfirm` 的 promise 变成 **reject**；
  ② antd 的 `ActionButton` 只在 promise **resolve** 时才关闭二次确认框 → 弹窗挂着不消失；
  ③ `await load()` 在抛错点之后 → 永不执行 → 列表停在旧数据。
  影响面比这一个按钮大得多：页面上 20 余处 `message.*` / `modal.confirm`（清空画布、合并子区块、
  重建分区、导出回执、绑定已有子图的占位提示）**全部是哑弹**。修复 = 窗口根补 `<App component={false}>`
  （不额外套 div，避免打断 `.window-shell__body` 的 `height:100%` 链）。
  另把地图库的写操作统一收进 `runWrite`：失败只记日志、`finally` 必重拉列表，**promise 一律 resolve**
  —— 即使将来某次写真的失败，确认框也会收起、列表也会刷。
  守卫：`src/windows/MapWindow/app-shell.test.ts`（源码级，钉 `<AntApp>` 与 `component={false}`）、
  `MapLibraryModal/delete-flow.test.tsx`（真 `useMapPersistence` + 真弹窗，钉「删完 → 行消失 →
  确认框收起 → 当前图切走」）。
- **订正上一条的初版归因**：先前记为「删除当前图时 `onClose()` 抢跑，刷新作用在已卸载组件上」——
  该写法确实是个缺陷（已一并修掉），但**不是**「点了没反应」的真因；真因是上面那个空 `message`。
  两处都改，但排查顺序应为「先看窗口有没有挂 `<App>`，再怀疑时序」。

### 备注

- 纹理羽化**没有**采用「给遮罩 Graphics 挂 `BlurFilter`」：pixi 8.22 里 Graphics 遮罩只能走 stencil（无 alpha），
  挂上 filters 会让 `isSimple = false`、遮罩几何被渲进临时纹理，导致**遮罩整块失效、纸纹消失**且不报错。
  结论已沉淀到 `docs/review/map-vs-reference-render-analysis.md` §9.4 负向约束第 9 条。
