# Changelog · 2.0.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.0.0] - 2026-10-19

### Changed

- **打包依赖归位**：`package.json` 的 production `dependencies` 由 23 个收到 **4 个** ——  
  只保留主进程运行期真正 `require` 的 `better-sqlite3` / `docx` / `jszip` / `mammoth`。  
  `antd`（57.08 MiB）、`@ant-design/icons`（11.59）、`react-dom`（6.98）、  
  `framer-motion`（4.44）、`react-router`（3.61）、`motion-dom`（3.10）、  
  `lunar-typescript`（1.22）、`@codemirror/*`、`@dnd-kit/*`、`codemirror`、`dayjs`、  
  `marked`、`react`、`react-virtuoso`、`zustand` 共 19 个纯渲染层依赖迁到  
  `devDependencies`（版本区间不变，只换 section）。依据：这些包在 `electron/**` 中  
  零导入，且早已被 Vite 打进 `dist`。electron-builder 会把 `dependencies` 整棵依赖树  
  塞进 `app.asar`，这份是 100% 冗余，**没有任何运行期症状，只有安装包悄悄胖 5 倍**。
- **`app.asar` 117.34 MiB → 13.78 MiB（−88.3%，123,035,304 → 14,447,397 B）**；  
  其中 `node_modules` 逻辑体积 121.89 MiB → 11.81 MiB（−90.3%），asar 内文件数  
  19,579 → 1,162（−94.1%），包数 160 → 62。剩下的全部是上面 4 个包及其真实传递依赖  
  （`docx` 4.32 MiB / `mammoth` 2.26 / `better-sqlite3` 1.86 / `pako` 759.5 KiB /  
  `jszip` 721.9 / `underscore` 594.6 / `xml-js` 375.2 KiB，其余 55 个包均 < 200 KiB）。
- **`asarUnpack` 收窄到原生模块本体**：`node_modules/**/*.node` →  
  `node_modules/better-sqlite3/build/Release/*.node`。原写法命中一条 `.node` 即触发  
  smartUnpack 把整个包外置，连带 `deps/sqlite3.c`（9.8 MB）、`src/*.cpp`（162 KB）等  
  编译期物料一起进安装包。`app.asar.unpacked` 因此从 11.73 MiB 降到 **1.86 MiB（−84.2%）**，  
  目录里只剩 `build/Release/better_sqlite3.node` + `lib/` + `LICENSE` + `package.json`。
- **`build.files` 增加 node_modules 冗余排除**：`*.map` / `*.md` / `*.d.ts` /  
  `{test,tests,__tests__,spec,docs,example,examples,benchmark}/**` / `@types/**` /  
  `better-sqlite3/{deps,src}/**`。其中 `@types` 一条针对 docx 把 `@types/node` 声明成  
  运行时依赖（纯类型，无运行期用途）。
- **locale 裁减前置到打包阶段**：新增 `build.electronLanguages: ["zh-CN","en-US"]`，  
  替代 `after-pack.js` 事后删 53 个 `.pak` 的兜底；`locales/` 由 55 个文件（48 MB）  
  降到 2 个，`afterPack` 的 locale 清理退化为兜底（配置被改回默认时仍能收口）。
- **`release/win-unpacked` 383 MiB → 269 MiB（−29.7%，401,103,686 → 282,160,683 B）**。
- **安装包 101.48 MiB → 85.26 MiB（−16.0%，106,407,729 → 89,402,895 B）**，  
  `compression: "maximum"` 不变；剩余大头是 Electron 自身的 `CheckIn.exe`（232 MB）  
  与 `icudtl.dat` / `resources.pak`，非本次治理范围。
- **`scripts/after-pack.js` 清理逻辑可核对**：删除清单移除死条目 `LICENSE.electron.txt`  
  并显式保留 `LICENSE`（Electron 的 MIT 许可证必须随分发保留）；`dxil.dll`（1.44 MB）  
  明确不删 —— 它与已删的 `dxcompiler.dll` 配套，本次不升级 Electron、无法实机验证  
  GPU 回退路径，1.44 MB 收益不值得白屏风险（待 Electron 44 实机回归后评估）。  
  缺失文件不再静默（debug 级），结尾打印「共节省 X MB / 剩余 locales 数量」  
  （本次实测：删除 Chromium 物料 54.54 MB，剩余 locales 2）。

### Added

- **`scripts/analyze-asar.mjs` + `pnpm analyze:asar`**：读 asar header（`getRawHeader()`，  
  不解包）输出顶层分区体积、node_modules 按包排序（≥ 200 KiB）、分区小计与总逻辑体积；  
  `--json` 便于前后对比，末尾固定打印 `ASAR_BYTES=<磁盘真实字节>` 供脚本取数。  
  用途：改动打包配置后一条命令留痕，不再靠猜。
- **`electron/packaging-guard.test.ts`（5 组 / 10 个测试用例）**：钉死四条不变量 ——  
  production `dependencies` 严格等于 `['better-sqlite3','docx','jszip','mammoth']`；  
  `vite.config.ts` 里 external 的包必须都在 `dependencies` 且双向一致（防「打包后  
  Cannot find module」）；`build.files` 必带 `@types` 与 `better-sqlite3/{deps,src}` 排除；  
  `asarUnpack` 只允许 better-sqlite3 的 `.node`；`version` 为合法 semver 且 major ≥ 2。  
  解析源码做断言前统一 `stripComments()`（§6.6）。
- **`AGENTS.md` §6.8「打包与依赖归位规范（2.0.0）」**：三条铁律 ——  
  ① 判断 `dependencies` / `devDependencies` 的唯一标准是「主进程运行时是否 `require` 它」，  
  渲染层依赖即使被 import 也必须进 `devDependencies`；② 新的主进程 Node 依赖必须**同时**  
  进 `vite.config.ts` 的 external 与 `package.json` 的 `dependencies`；③ 原生模块  
  `asarUnpack` 必须精确到 `.node`，改动打包配置后必须 `pnpm analyze:asar` 留痕。  
  同步更新 §8.5 的 external 清单说明。
- **`docs/packaging/bundle-slimming-2.0.0.md`**：本次治理的完整取证记录 ——  
  问题定位（四条证据链）、改动清单（文件:位置 + 为什么）、优化前后体积对比表、  
  可复制的验证命令、未做项与后续（Electron 44 / `dxil.dll` / electron-builder 26）。
- **`@electron/asar@^3.4.1` 显式进 `devDependencies`**：`analyze-asar.mjs` 直接用到  
  它的 `getRawHeader()` / `listPackage()`，不再依赖「electron-builder 的传递依赖恰好被  
  hoist 到根目录」这种运气；同时补上 `scripts/split-changelog.mjs` 在「无需分流」  
  场景下直接退出的分支（原来会在 `archived[0]` 上抛 TypeError）。

### Fixed

- **`pnpm-lock.yaml` 的 importers 与依赖归位不一致**：`pnpm install --lockfile-only`  
  重写 `importers['.']`，19 个包从 `dependencies` 落到 `devDependencies`（锁版本不变）。
