# Changelog

> 历史归档：1.46.1 之前的版本已按次版本拆到 `changeLogHistory/`  
> （当前归档到 1.45.1，索引见 `changeLogHistory/README.md`）。  
> 主文件只保留最近若干个次版本，超过 800 行时按 AGENTS.md §8.6 继续分流。

## [2.1.1] - 2026-10-20

### Fixed

- **修复 pnpm 9 环境下 `pnpm install` 必然失败（`gyp ERR! find VS`）**。  
  `better-sqlite3@13` 已无 `install` 脚本，但包内保留 `binding.gyp`；npm/pnpm 的既有约定是
  「有 `binding.gyp` 且无 `install` 脚本 → 默认执行 `node-gyp rebuild`」，于是没有 VS C++
  工作负载的机器会 `gyp ERR! find VS` 并让整个安装以 `exit 1` 结束。  
  根因是白名单位置：`pnpm-workspace.yaml` 里的 `allowBuilds` / `onlyBuiltDependencies`
  **pnpm 9 完全不读**（实测 9.15.9，连 `nodeLinker` 也不读，布局靠 `.npmrc` 的
  `node-linker=hoisted` 兜住）。现改为在 `.npmrc` 用 `only-built-dependencies[]` 声明 ——
  这是 pnpm 9 唯一生效的位置，pnpm 10+ 侧仍读 `pnpm-workspace.yaml` 的 `allowBuilds`，
  两套并存且语义一致。  
  同时移除 `package.json` 的 `pnpm` 字段：pnpm 11 已完全不读它，每次安装都会打印
  `The "pnpm" field in package.json is no longer read by pnpm` 警告。
- **修正文档中一条错误结论**：原文称「`better-sqlite3` 13 起无 install 脚本，白名单对它
  不再起作用」——没有 `install` 脚本不等于不会构建。AGENTS.md §8.7 已改为
  「必须显式 `allowBuilds: better-sqlite3: false`」，并补了 pnpm 9 / 11 配置来源对照表。

### Changed

- `README.md` 新增排查项「pnpm 9 安装失败 `gyp ERR! find VS`」，含现象、根因、处理与两个
  附带注意（pnpm 9 会重写 `pnpm-lock.yaml` 丢掉 pnpm 11 的 peer 后缀，装完应
  `git checkout -- pnpm-lock.yaml`；根治办法是 `corepack enable` 统一到 11）。

## [2.1.0] - 2026-10-20

### Changed

- **Electron `42.4.1` → `44.9.0`**（Chromium 148 → 152、Node 24.15 → 24.22、ABI 146 → 149）。  
  **业务代码零改动**：44 的破坏性变更（渲染进程不再暴露 `clipboard`、移除 Win ia32 / macOS 12
  预编译、`net.request` 强制 `Sec-Fetch-Mode`、移除 Unity、`select-client-certificate` 等）本仓
  **一条都没命中** —— 6 处复制全走 `navigator.clipboard`，全仓无 `net.request` / `net.fetch`，
  仅出 win-x64，preload 未透出 clipboard。  
  44 把 ANGLE 改为静态链入，`libEGL.dll` / `libGLESv2.dll` 不再分发（−8.09 MiB），但
  `electron.exe` 232,313,344 → 247,184,896 B（+14.18 MiB）、`resources.pak` 6,876,399 →
  12,436,085 B（+5.30 MiB）、`chrome_*_percent.pak` +1.59 MiB。**分发包未压缩合计
  300.82 → 314.13 MiB（+13.31 MiB）**，`release/win-unpacked` 269.09 → 282.17 MiB（+13.08 MiB）。
  即：**升级本身不带来瘦身，省下的 8 MiB 被 Electron 自身的增长吃掉**。安装包
  85.26 → **99.78 MiB（+14.52 MiB / +17.0%）** —— 增量集中在 `electron.exe` 与
  `resources.pak`，两者压缩率低于均值，所以安装包增幅略高于未压缩增幅。
- **`better-sqlite3` `12.11.1` → `13.0.3`（NAN → Node-API）**：13.0 起改为 N-API，8 个平台的
  预编译二进制随 npm 包分发（`prebuilds/*.node`），**与 Electron ABI 彻底解耦**，升 Electron
  不再需要按 ABI 重编译。
- **移除整条原生模块重编译链路**：删除 `scripts/rebuild-native.mjs`、`electron:rebuild` 脚本、
  `@electron/rebuild` 直接依赖，`electron:setup` 简化为 `pnpm install && pnpm ensure:electron`；
  `dev-doctor` 的检查路径由 `better-sqlite3/build/Release/better_sqlite3.node` 改为
  `better-sqlite3/prebuilds/win32-x64.node`。
- **`electron-builder` `25.1.8` → `26.17.0`**：v26 移除 `app-builder-bin`，原生模块处理改由
  `@electron/rebuild` 接管（已是 `app-builder-lib` 的直接依赖）。本项目 `npmRebuild: false`，
  打包时**不会**触发重建 —— 这正是 N-API 方案"零重编译"能成立的前提。
- **打包白名单跟进新二进制路径（关键）**：`asarUnpack` 由
  `node_modules/better-sqlite3/build/Release/*.node` 改为
  `node_modules/better-sqlite3/prebuilds/win32-x64.node`。13.x 里 `build/Release` **根本不存在**
  （解析路径见 `lib/binding.js` 的 `getPrebuildPath()`），不改就是**静默失效**、运行期
  `Cannot locate the bindings file`。  
  同时 `build.files` 增加 4 条排除，剔除另外 7 个平台的预编译（`darwin-*` / `linux-*` /
  `linuxmusl-*` / `win32-arm64`，合计约 18 MiB 纯冗余）。实测产物：`app.asar` 14,447,397 →
  14,338,215 B（−0.10 MiB），`app.asar.unpacked` 里**只有一个** `prebuilds/win32-x64.node`
  （1,989,632 B），非本平台 `.node` 数量为 0。
- **pnpm 侧三处修正**（否则 `pnpm install` 直接 exit 1）：
  - `allowBuilds.better-sqlite3: false`：13.x 包内没有 install 脚本却留着 `binding.gyp`，
    而 npm/pnpm 的既有约定是「有 `binding.gyp` 且无 install 脚本 → 默认执行 `node-gyp rebuild`」，
    无 VS C++ 工作负载的机器会 `gyp ERR! find VS` 把整个安装带崩。显式拒绝构建即可直接用预编译。
    ⚠️ **该字段是 pnpm 11 才认的**，`pnpm -v` 为 9.x 时会被忽略（本次踩到），需用
    `npx pnpm@11.25.0 install`。
  - `overrides.fast-uri: 3.1.8`：ajv 的传递依赖 3.1.9 发布于安装当天，触发 pnpm 11 的
    `minimumReleaseAge` 供应链策略拦截；钉到上一个补丁版，而不是给新包开豁免口子。
  - `overrides.electron-builder-squirrel-windows: 26.17.0`：对齐 `app-builder-lib@26` 的精确
    peer，消除告警并清掉整棵 `app-builder-lib@25` 老树（本项目只用 nsis）。

### Fixed

- **`packaging-guard.test.ts` 的 `asarUnpack` 断言路径**同步更新（原来写死
  `build/Release/`，升级后会假红），并新增「排除非本平台预编译」不变量。
- **`after-pack.js` 注释按 44 复核**：清单内 7 个文件在 44 的 dist 中全部仍存在、且**没有新增**
  可清理文件；`dxil.dll`（1.44 MiB）继续保留 —— ANGLE/Dawn 的 HLSL 编译有 DXC
  （`dxcompiler.dll`+`dxil.dll`）与 FXC（`d3dcompiler_47.dll`）双路径，删掉本地 DXC 会回退到
  系统目录自带的 FXC，留 1.44 MiB 作回滚缓冲。实测 afterPack 单次清理 54.76 MB。

### 待实机验证（沙箱无法启动 GUI，无法代跑）

升级后必须人工确认：① 6 个透明无边框圆角窗口的四角渲染与阴影；② 托盘反复显示/隐藏是否闪白；
③ `图形` 相关崩溃（若白屏，优先把 `dxcompiler.dll` 从 `DELETE_FILES` 移除）；④ 模板下载落盘位置
与 toast「已下载到「下载」文件夹」是否一致；⑤ SQLite 读写与用户切换。完整 14 项清单见
`docs/electron-44-upgrade-precheck.md` §7。

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

## [1.46.2] - 2026-10-19

### Changed

- **NovelWindow 最小尺寸 800×560 → 960×640**：下限按书架的真实需求反推 ——  
  960 宽才够「主列 640 + 灵感栏 320」摆下四连统计卡与三列书卡，640 高才够  
  首屏完整露出一排书卡。原 800 宽下统计卡文字被压到临界、顶栏五个控件挤成  
  一串纯文字。改动只动 `BrowserWindow` 的 `minWidth` / `minHeight`，默认启动  
  尺寸 1200×760 不变。
- **书架在最小窗口下的密度收敛**（`BookshelfPage` / `ShelfStats` /  
  `ContinueHero` / `ShelfTopBar`）：新增 `max-width: 1080px` 与  
  `max-height: 680px` 两条媒体查询，只收间距、图标尺寸与网格下限  
  （书卡 178 → 164），字号 / 圆角 / 配色一律不动 —— 窄窗是「同一套设计更紧凑」，  
  不是另一套视觉。最小窗口首屏从「书卡只露一条边」回到「完整一排」。
- **书架顶栏两颗次级按钮恢复描边 pill**（「全局设定中心」/「导入书籍」）：  
  清零点 mixin 会把 antd 的边框宽度、高度、内边距一起归零，此前这里只补了圆角，  
  于是两颗按钮退化成纯文字、与主色「新建作品」挤成一串（深色主题下尤其明显）。  
  现在按「高度 32 / 内边距 14 / 描边 1px + 主题色三态」显式声明回来，  
  层级仍是「次级描边 < 主色实底」。
- **右栏分段切换统一到 antd `Segmented`**（新增 `NvSegmented`）：大纲的  
  「章节 / 伏笔」与伏笔三态、检索的「全书 / 本章 / 要素名」、敏感词的  
  「检测结果 / 词库」「关闭 / 自动 / 手动」「本章 / 全书」，以及右栏五 Tab 的  
  分段条全部换掉。收敛前是 `.nv-sub` + 清零 Button + `.is-on` 手搓选中态，  
  Tab 条还带一条绝对定位滑块与 ResizeObserver 重量宽度；换成组件库后滑块动画、  
  radio 语义、键盘左右键都由组件库负责，外观用 `--ant-segmented-*` 变量逐项  
  复刻（轨道 `--app-surface-hover`、滑块 `--app-surface` + 卡片投影、25px 滑块  
  = control-height 31 − 2×3、五 Tab 40px = 48 − 2×4），肉眼无差别。  
  带计数的切换（大纲的「章节 / 伏笔」「待回收 / 已回收 / 全部」）改用组件库  
  `Badge` 承载数字（中性底色，不再自绘灰字）；右栏五 Tab 既有的角标也收进  
  同一套密度变量。
- **书架视图切换（网格 / 列表）改用 `Segmented`**：同样是「轨道 + 选中格」的  
  手搓实现；轨道描边（antd 不接管）保留，选中格仍是 `--app-primary-weak` 底
  - 主色图标，尺寸与改前一致（22px 滑块）。
- **`AGENTS.md` §8.6 新增「CHANGELOG 体积分流」规则**：主文件超过 800 行时，  
  更早的版本按次版本拆到 `changeLogHistory/CHANGELOG-<major>.<minor>.md`，  
  索引落在 `changeLogHistory/README.md`；附 `scripts/split-changelog.mjs`  
  一键拆分。**本次已按规则执行**：`CHANGELOG.md` 由 2106 行降到 600 行量级，  
  1.31 – 1.45 拆成 15 个次版本文件，`CHANGELOG1.md` 更名为  
  `CHANGELOG-1.0-to-1.30.md`。

### Fixed

- **右侧要素 Tab 第一个分类名展示不全**：类型 chips 行是 `flex` + 横向滚动容器，  
  chip 缺省 `flex-shrink: 1`，宽度不够时浏览器先把第一颗「全部 6」压扁  
  （只剩一个「6」）而不是让整行滚动 —— 面板拖到 280 宽即可复现。  
  改为 `flex: none` 后 chip 宽度回归内容，溢出交给容器滚动与两端渐隐。

## [1.46.1]


### Added

- **敏感词检测（工具箱）**：小说编辑器新增发布前自检能力，入口在右栏  
  「工具」启动器第二张卡，底部状态条另有常驻角标可直达。
  - **算法**：自建 AC 自动机（`sensitive/ac-automaton.ts`，Trie + 失败指针 +  
    词库编译缓存），扫描复杂度 O(正文长度 + 命中数)，与词库规模无关；  
    命中区间「同起点长词优先 + 互不重叠」，可直接建 CodeMirror RangeSet。
  - **内置词库**：`sensitive/builtin-words.ts` 收录涉黄 / 暴力血腥 / 违禁品 /  
    赌博 / 自伤自残 / 违法犯罪 / 迷信邪教七类通用红线词（不含广告法极限词，  
    不收政治类词条）。内置词只读，用户可「屏蔽」并在词库底部一键恢复。
  - **自维护词库**：新增 / 行内重命名 / 删除；支持导入 `.txt` / `.json`  
    （JSON 数组、`{words:[]}`、每行一词三种格式，忽略注释与空行）。  
    词库、屏蔽列表与扫描模式合并存 `novel_config` 的 `novel_sensitive_config` 键，  
    不新增数据表、不新增 IPC 通道。
  - **两种检测机制**（用户在面板内切换，持久化）：`自动`（停止输入 500ms 后  
    扫当前章，正文按词库实时标）/ `手动`（只在点扫描时统计，**只标扫描结果**，  
    没扫过正文保持干净）/ `关闭`。**「标什么」与「何时统计」是两件事**：  
    自动吃词库、手动吃扫描结果，正文红字与面板列表、状态条计数永远同源。  
    手动扫描支持**本章**与**全书**，全书走分批调度（每批 200 章后让出主线程），  
    面板顶部显示进度。
  - **正文高亮**：独立 Decoration 层（`sensitive-editor.ts`，自有 facet /  
    compartment，与要素标注层互不干扰），沿用 IME 组合期冻结 + 300ms 防抖 +  
    `addToHistory(false)` 强制刷新；外观为**描边圈注**（细红边 + 淡底纹 + 悬停加深），  
    与要素标注的「填充色块 + 底部实线」在形态上区分开，两层同开也不混；  
    不改字宽、不加 border，不引起重排。点面板结果行可跳到正文对应位置。
  - **面板控件与其它 Tab 同源**：视图切换 / 检测机制 / 结果范围统一用 `.nv-sub`  
    分段条（不用 antd `Segmented`），输入行走 `.nv-field`，动作按钮走 `.nv-ghost`，  
    空态走 `.nv-empty` —— 与大纲、检索、要素三个 Tab 是同一套视觉语言。
  - **变体归一化预留接入口**：`sensitive/normalize.ts` 已落地「归一化 → 扫描 →  
    坐标回映原文」完整链路，当前为恒等实现；第二批接入全半角 / 繁简 /  
    干扰字符剥离 / 同音形近时只替换该文件内核，调用方零改动。
  - 纯函数（自动机 / 词库清洗 / 扫描聚合 / 高亮开关口径）共 45 条单测。
- **全局设定中心窗口 UI 与交互重设计**（REQ-033 系列，设计过程与取舍见本文件  
  1.45.x 记录）：全局设定中心从「复用书本侧设定中心的  
  两栏布局」改为**窗口私有的专属布局**，四个痛点一次治完 ——
  - **R1 左栏搜索**：分类名 + 说明纯前端过滤，不触发 IPC、不改 `sortOrder`；  
    0 命中给专用空态 + 清空入口。
  - **R2/R13 筛选与排序**：全部 / 境界体系 / 自定义 / 已被引用 / 暂无引用 与  
    按名称 / 按引用数 / 自定义顺序；筛选态只存窗口私有 view 态，不落库。  
    **拖拽仅在「自定义顺序 + 无搜索 + 无筛选」下可用的 `canDrag` 三条件与门** ——  
    跨分类搬移按 `sorted` 全量算下标，只有全量按 `sortOrder` 显示时下标才对。
  - **R3/R4 引用两级可见性**：左栏每行引用徽标 + 右栏顶部常驻影响面条  
    （「被 N 部书引用 · 改动会即时同步到这 N 部书」）。文案一律由  
    `formatReferenceCountLabel` 唯一产出，不另拼字符串。
  - **R5/R6 就地编辑**：双击分类名行内改名（非受控 Input + IME 三件套，Esc 先于  
    blur；失焦「非空提交、空则取消」）；右键菜单 rename / toggle kind / delete，  
    展开即自动选中。删除确认口径唯一 —— 三条入口（面条 / 右键 / 键盘 Delete）  
    全部走 `useGlobalSetting.onDeleteCategory(id)`，不出现第二套确认文案。
  - **R7 空态引导**：空库给「说明 + 套用内置预设 + 新建空白分类」；装载失败态  
    **不退化成空态**（错误态与空库是两件事）。
  - **R8 窄窗三档**：≥1080 / 960–1079 / ≤959（含 minWidth 920）分别 240 / 200 / 160px，  
    依次隐藏别名、说明列；编辑态 `:has(.ant-input)` 兜底恢复全列。
  - **R9 快捷键**：Ctrl/⌘+F 聚焦搜索、↑/↓ 在**当前过滤结果内**移动、F2/Enter 改名、  
    Delete 删除、Esc 级联；焦点在输入控件 / antd 弹层内时全局快捷键全部不响应。
  - **R10 等级批量选择**：`LevelSequence` 新增 3 个**可选** prop（`selectable` /  
    `selectedIds` / `onToggleSelect`）—— 不传即等于今天的全部行为，书本侧 DOM  
    逐节点一致；批量删除串行 `onDeleteLevel` 后只 `reload()` 一次。
  - **R11 影响面分档**：refCount 0 / 1–2 / ≥3；≥3 档在影响面条上加 ⚠ Tooltip  
    （不进删除确认框，确认文案保持唯一出口）。
  - **R12 引用方名单**：新增只读 IPC 通道 `novel-global-setting-refs`  
    （`listGlobalRefs`，与 `countGlobalRefs` 同口径，`GROUP BY c.work_id` 保证  
    名单条数恒等于 `refCount`）+ `GsRefsDrawer` antd Drawer 列书名，  
    `refCount===0` 时不渲染入口。
  - **异常路径三条出口**：Drawer 加载中只给 Spin（不显示「暂无引用」）、  
    口径不一致给 warning Alert、IPC reject / preload 缺通道给 error Alert + 重试 ——  
    **没有一条允许白屏或静默**。
  **架构取舍**：继续以 shared `useSettingCenter` 为唯一状态机（它只与  
  `SettingCenter.tsx:318-342` 的「关闭清草稿」effect 有关，固定传 `open: true` 即绕开），  
  窗口自绘左栏 + `GsImpactBar` / `GsToolbar` / `GsEmptyGuide`，右栏原样复用  
  `CategoryCard` + `LevelSequence`，三个弹窗（模板库 / 批量生成 / 拆分）由窗口挂载。  
  **否决**「改造共享 `SettingCenter` 抽公共外壳」方案——本次能力 100% 全局窗口特有  
  （书本侧的「引用」是反向语义，早已由 `referenced` + 只读态 + 自动同步徽标解决），  
  且共享组件 38 个回归用例已把书本侧 DOM 钉死，改共享结构必然先改测试。  
  **`src/windows/GlobalSettingWindow/hooks/useGlobalSetting.ts` 仅新增  
  `loadCategoryRefs`（永不抛 / 缺通道返回 []）一个成员，写操作与确认文案零改动。**
- **行囊「主角信息看板」L0 首页**（UI 需求稿 UI-01）：行囊打开首屏从「十模块  
  编辑器平铺」转为「一屏看懂主角当前状态」的只读看板，四个分区常驻不收起 ——  
  B 境界卡（大读数 +「实体面板显示」对照条）/ C 核心属性总览（`base → 最终` +  
  被动 / 持续 / 映射增量段，点行开来源明细）/ D 生效状态（仅列 `active`，行内  
  开关）/ E 关键设定摘要行（一行一模块，点击即展开并**滚动到**该模块）。
  - 编辑能力零删减：十模块仍在看板下方（E 区一行即入口），看板只负责「看」，  
    L1 负责「改」，职责分开但入口不缺。
  - 纯函数落在 `pack-layout.ts`：`dashboardAttrLimit`（默认条数随档位  
    宽 8 / 中 6 / 窄 4）、`dashboardSummaryModules`（原样透传启用模块，保作者  
    拖拽顺序）、`dashboardActiveStatuses`（只留 `ownerType=status && active`）。
  - 属性增量片段 `attrSegments` 从 `SummaryModule` 提到 `pack-utils.ts`，看板  
    C 区与总属性模块**同源**，避免「同一项属性两处显示不一致」的静默分叉；  
    `.cpk-seg` 色板同步收敛到公共原语 `pack-common.scss`。
  - 新增组件 `components/PackDashboard/`（`index.tsx` + `index.scss`）；  
    **不新增数据表、不改表结构**（`compat` 语义成立）。
- **行囊空态分层引导**（UI-03）：看板各区分层空态从「纯文字说明」改为  
  「说明 + 下一步动作按钮」：无属性 → 「套用通用 / 玄幻 / 网游模板」+  
  「自己建属性」；无等级体系 → 「去设定中心创建」；未绑定主角 →  
  「设为主角」（展开选择器，无候选时置灰并说明）；无生效状态 →  
  「+ 持续 / + 被动」。
  - 新增跨窗口导航频道 `novel-open-setting-center`（`src/shared/novel/
    open-setting-center.ts`）：行囊窗口（独立窗口）自己开不了小说窗口的设定  
    中心，靠此频道把「打开设定中心并定位到等级分类」的意图送过去。
  - 投递路径沿用既有范式：渲染层 `send` → preload 白名单 → 主进程 focus /  
    拉起 NovelWindow 并把负载**点对点**转发回去（`sendTo`，不是 broadcast）  
    → NovelWindow 侧 `subscribeDualChannel` 订阅消费、`openSettingCenter`  
    定位。负载带 `workId`（多作品过滤）+ `categoryId`（无体系时为 `null`，  
    接收方回落默认态，不报错）。
- **行囊境界卡「阶 + 小层」直选**（UI 需求稿 UI-02）：境界卡新增两条直选路径 ——  
  阶（阶梯尺 chip；阶数 > 8 时以阶下拉为主路径）与小层（层号条 `1..N`；  
  N > 12 时改下拉），保留原有 `± 1 层` 微调。选定「阶 + 小层」≤ 2 次点击、  
  全程不离开行囊窗口。
  - 阈值抽成纯函数（`REALM_RUNG_DROPDOWN_THRESHOLD=8` /  
    `REALM_SUB_DROPDOWN_THRESHOLD=12` / `realmLadderUsesDropdown` /  
    `realmSubUsesDropdown` / `realmSubBarVisible` / `realmSubAriaLabel`），  
    组件与测试读同一份。
  - 层号条与下方「阶内进度条」**分开成两块 DOM**：进度条仍是纯读数（沿用  
    「无按钮」守卫），层号条是可点选择，视觉与语义都不混淆；`subMax <= 1` 时  
    整块层号区不渲染（单选项 `[1]` 是噪声）。
  - 严格走 REQ-048：读写仍只经 `writeRealm → setRealm`，toast 文案取  
    `plan.position` 不二次计算；层号按钮带可读名（「元婴 第 2 层（中期）」）  
    与 `aria-current`。
- **行囊模块渐进披露与钉选**（UI-04）：非核心模块**默认收成摘要行**（点击就地  
  展开为 L1 编辑器），作者可把常用模块**钉选常驻**（打开行囊即展开）。
  - `PackUiPrefs` 新增 `pinned: PackModuleKey[]`（走 `novel_pack_ui`，即改即存，  
    不计未保存改动）；旧偏好文件无本字段按空数组处理，不弹迁移、不丢既有偏好。
  - `isAutoCollapsed` 默认策略从「仅窄档折叠」改为「全档一致」（钉选优先 >  
    核心三块永不折叠 > 作者显式表态 > 未表态默认收起）。
  - `withEffectiveCollapse` 代理改为**按生效值翻转**折叠（`setModuleCollapsed`）：  
    否则未表态模块的 `prefs.collapsed[key]` 是 `undefined`，`!undefined` 翻出来  
    仍是收起，表现为「点了展不开」。
  - 模块壳头部新增钉选按钮（`PushpinOutlined/Filled`），钉选态 `aria-pressed`
    - `is-pinned`；核心三块不参与钉选（永远展开）。
- **弱提示补齐 T-05 / T-06 / T-07**（UI 需求稿 UI-06）：`guide-copy.ts` 里这三条文案  
  早已定义却一直没挂载，新手在对应场景里看不到任何提示。本次接入：
  - T-05 大纲：挂在**全局第一个「梗概还空着」的章行**的「＋ 一句话梗概」上。只挑一行  
    是因为每行各包一层会产生十几个 400ms 定时器同时起跳，冒出多个气泡；虚拟化下这行  
    可能在可视区外，滚到时才出现 —— 可接受，总比同屏多个气泡好。
  - T-06 标注层：包在高亮词悬浮卡（`HoverEntityCard`）自身 —— 它出现的地方正是  
    「高亮词能点」这句要解释的对象。
  - T-07 排序确认：做成 `ReorderConfirmModal` 标题旁的**常驻说明图标**（气泡只弹一次，  
    图标一直点得到），解释「这个确认是防误触排序的，可在排版与偏好里关掉」。
  - 三处都走新增的统一入口 `consumeGuideTooltip(id)`：先让位给正在播的 Tour  
    （让位时**不记账**，Tour 结束后同点位仍会弹），再走窗口 store 的**同步**判定 +  
    打字保护。不走 `GuideTooltip` 默认的异步落盘判定，是因为这三处宿主会**反复挂载**  
    （虚拟列表滚进滚出 / 悬浮卡随指针进出 / 弹窗可多次打开），每次挂载读一次  
    `novel_config` 是白花的 IPC。


### Changed

- **行囊大窗布局重排为「概览带 + 分区面板 + 贴底页脚」三条带**（UI-08，真机截图：  
  2560×1392 下内容只占上半屏、下半截一整片空底，像没加载完；一屏八张同等重量的  
  描边圆角卡，视线没有主次）：
  - **量尺 1600 → 1760**：2560 窗口下两侧各留 400，既保住「两栏各 ~800」的舒适  
    行宽，也不至于让版心缩成窗口中间的一条窄带。
  - **概览带**：L0 四区（境界 / 核心属性 / 生效状态 / 关键设定）从 2×2 四张卡  
    合成**一条横贯量尺的带** —— 外面只有一个框，四段之间发丝线分栏。实现上 DOM  
    不动（两列包装在宽档 `display: contents` 退场，四张卡直接成为四列），中窄档  
    仍按列堆叠；空态文案按档收短，免得一句话在窄列里折成三行。
  - **分区面板**：L1 的每一区升格成一张面板卡（栏头「分区名 + N 个模块」/ 栏目 /  
    卡片流），**吃掉概览带以下的剩余高度**，页脚 `margin-top: auto` 贴住窗口底。  
    面板既已铺 `--app-surface`，里面的模块就退化成**发丝线分节**（描边 / 圆角 /  
    底色清零），不做「卡里套卡」。编排全在纯函数 `zonePanels() / panelModuleCount()
    / disabledModuleCount()` 里，渲染层只照 `columns` 铺 DOM。
  - **单分区仍是一块面板占满整条量尺**，内部由 `soloColumns()` 拆两栏 —— 不再有  
    「只剩一栏就缩成居中窄带」的变体，拆两栏时补一条通到面板底沿的竖分隔线。
  - **页脚**只报两个事实（草稿即存 / 模块开了几个），不放第二条「模块管理」入口：  
    那是与概览带同入参的重复控件。
  - 守卫同步改口径：UI-05 的「看板与模块区共用 44:56 竖线」随概览带改版失效，  
    改为钉**新意图** —— 三段落同处一条量尺、双分区 44:56 / 单分区 1fr、宽档内容  
    撑满高度且页脚贴底（`pack-ui-kit.test.ts`）。
  - 视觉核对：`designs/pack-window-v2.html`（真 SCSS 编译 + 手写 DOM，三种档位  
    可切换），2560×1392 / 1080×872 / 520×760 三张截屏核几何。
- **行囊宽屏布局统一到一条内容量尺**（真机反馈：大窗口下「上面的固定卡片和下面的  
  单侧面板很割裂，模块多的时候是和谐的」）：
  - **成因不是「只有一栏」，是上下两级各用一套宽度**：看板（`.cpk-board`）四张卡  
    铺满整窗 —— 2560 窗口下实测卡宽 2521px，行内「标题 …… 按钮」隔着近 2000px；  
    而 L1 单分区被 `max-width: 720px` 收成居中的一条窄带（实测 x 913→1633）。  
    模块多到两栏都在时两栏刚好铺满，于是「看着和谐」。
  - **统一量尺**：新增 `.cpk__content`（上界 `--cpk-measure: 1600px`，超宽窗口整体  
    居中），看板、模块区共用同一列左右边界；头部内容带 `.cpk-head` 用**同一个变量**  
    算左右内边距（写死 14px 会让头部横贯 2560、内容只有 1600，又是一次「上下不是  
    一个界面」）。窗口 2560 实测三级边界为 x=473 / 473 / 480 —— 头部那 7.5px 是  
    body 滚动条槽宽的一半，macOS 覆盖式滚动条下自然为 0。
  - **单分区不再退化成窄带**：新增纯函数 `soloColumns()`，把唯一一栏按「前一半 /  
    后一半」拆成两列（核心三块 → 2 + 1），与双栏模式共用 44:56 栅格和同一条竖向  
    分界线；「对面模块都还没开」的引导卡挂到右列末尾，正好占住它本该在的位置。  
    用前后对半而不是交替落位：交替会让作者拖出来的顺序在视觉上变成 1、3、2、4。
  - **看板自己也排两栏**：左「读数」（境界 / 核心属性）、右「清单」（生效状态 /  
    关键设定），44:56 与模块区同值。中窄档两列退回单列纵向流，DOM 顺序仍是  
    B → C → D → E，不出现「为了宽档好看而改乱窄档顺序」。
- **色块阶梯改按「基面」记，浮层里的槽不再跨层**（真机反馈：蓝 / 黄主题下  
  「红框里的背景跟其余模块对比度不一致，很割裂」）：  
  底色 token 都是**绝对色**，「差多少档」取决于它贴在谁身上 —— 同一支  
  `--app-surface-alt` 贴内容面只差一档（aurora 1.027 / cream 1.052 / mint 1.030），  
  贴纯白浮层就**跨过 `surface` 一整层**（1.071 / 1.087 / 1.064），比同屏兄弟块重一倍  
  而且丢掉蓝 / 暖色相。三张真机截图分别是三处成因，用纯 Python 解 PNG 采样 + WCAG  
  对比度比定位（不靠肉眼比截图）：
  - **行囊窗口底越级**（图1）：`.cpk` 铺的是 `--app-surface`，而全仓其它页面  
    （打卡 / 备忘 / 资讯 / 账本 / 书架 / 写作）一律 `--app-bg` —— 页面底被抬高  
    整整一档，于是 L1 模块壳与底**同色 1.00** 只剩描边撑着；为救场，看板卡  
    `.cpk-board__card` 借了 `--app-surface-elevated`，是**全仓唯一一处把浮层  
    token 用在流内卡片**上。真机 1080px 截图实测：看板卡 `#ffffff`、  
    下方模块 `#f5f7fd`，同窗口两种卡片重量。改为 `.cpk → --app-bg` +  
    看板卡 `→ --app-surface`，「谁浮谁沉」交给已有的 `--app-shadow-card`。
  - **浮层里的块借了「相对内容面」的档**（图2）：`设定中心` 弹窗是浮层（底 =  
    纯白），里面的「进位规则条」却取 `--app-surface-alt`（1.071），而旁边「阶段」  
    容器取 `--app-surface`（1.043）—— 同一弹窗内两种档。同类一并修掉：  
    行囊的 `SourceDetailDrawer` / `RecordDrawer` 行与空态、`CategoryManager`  
    引导条（它原本取 `--app-surface-elevated`，与弹窗**同色 1.00**，其实完全  
    没显形、只剩一圈描边）。浮层里的槽一律改用 `--app-surface`。
  - **antd 组件槽位从未主题化**（图3）：**修复前**全仓 `--ant-slider-*` / `--ant-segmented-*`  
    **零覆盖**，落到出厂值 —— `Slider.railBg = colorFillTertiary`（黑透明 4%，在  
    白浮层上退化成**无彩度**中性灰 `#f5f5f5`，实测 1.090，是全屏唯一没有色相的  
    元素）、`Segmented.trackBg = colorBgLayout`（= 页面底，比内容面还深一档，1.089）。  
    两者都比浮层应有的 1.043 重一倍。在 `.nv-setting` 作用域里显式指回  
    `--app-surface`（与同面板 chip 按钮的 `--ant-button-default-bg` 同档）。
  - **antd `colorBorder` 补上主题化**：此前只给了 `colorBorderSecondary`，  
    输入框 / 选择器 / 默认按钮走的是 **antd 出厂中性灰 `#d9d9d9`**（真机图2 的  
    「＋ 新建」按钮实测到 `#f5f5f5` 底 + `#d9d9d9` 边，与同排输入框的 `#f9fafe`  
    不是一族）。四套主题全部补 `colorBorder = --app-border`，并在 ThemeProvider  
    接线。
- **静态色块统一到「常驻色阶」，不再借交互态色**（真机反馈：新界面比其余界面"重"）：  
  `--app-surface-hover` / `--app-surface-active` 的本义是**相对所在面的交互态**（hover  
  加深、按下更深），不是色阶里的一档。全仓有 **14 处**把它们当常驻填充用，于是这些色块  
  直接跳过全站色阶 —— cream 下 `surface-active` 的对比度比是 **1.20**，而同主题最重的  
  常驻弱底 `--app-primary-weak` 才 1.13、凹槽 `--app-surface-alt` 只有 1.05。
  - 最刺眼的一处是行囊看板 E 区「已展开的模块行」：整行铺 `surface-active`，几个模块  
    同时展开就是一列深棕（真机截图里占屏 10.5%，而基线界面最深的常驻块只有 1.04）。
  - 同族对照更能说明这是系统性误用：`.cpk-bdg` 四个效果性质徽标里 `被`（灰）用 1.20，  
    另外三个用强调色弱底 ≈1.05；`.cpk-seg` 四个来源分段同理 —— **「灰」的那个永远  
    比兄弟深一档**。
  - 按语义重新分派：常驻中性底 → `--app-surface-alt`（贴在 surface / elevated 上的槽）；  
    贴在页面底 `--app-bg` 上的槽（状态条 / 书架 Hero 的进度条轨道）→  
    `--app-surface-hover`（alt 与 bg 在浅色主题下近乎同色，会直接消失）；禁用态底 →  
    `--app-surface-alt` + `--app-border`（禁用应当更**弱**，不是更深）；凹槽小标签 /  
    页码输入底 / 抽屉来源行标记 → `--app-surface-alt`。
  - **立规矩并加守卫**：`themes.test.ts` 新增「静态色块不用按下态色」——递归扫描全仓  
    SCSS，`var(--app-surface-active)` 只允许出现在最近祖先选择器带 `:hover / :active /
    :focus` 的规则里，或写在属性名自带状态的 `--ant-*-hover-bg / *-active-bg` 上；配套  
    一条数值用例钉住「浅色主题下 `surface-active` 必须严格重于最重的常驻弱底」。规矩  
    同步写进 `themes.scss` 文件头；`themes.test.ts` 的 WCAG 工具提到模块级供两组守卫共用。
- **浅色主题「内容面 vs 浮层」拉开一档**：三个浅色主题（aurora / cream / mint）的  
  `--app-surface` 与 `--app-surface-elevated` 此前都是 `#ffffff` —— 看板卡、模块壳  
  与下拉 / 弹窗只能靠 1px 描边分家，「浮层压在内容之上」这层关系在浅色下完全看不见  
  （只有暗色 midnight 分了层）。
  - 改法不是把浮层调暗（那会连累所有下拉 / 弹窗的纯白观感），而是给**内容面**  
    `--app-surface` 轻染主题色（aurora `#f9fafe` / cream `#fdfbf7` / mint `#f9fcfa`），  
    并同步下调 `surface-alt` / `header-bg` / `sidebar-bg` / `input-bg`，保持既有  
    「比 surface 再退一档」的凹槽语义；`elevated` 保持纯白。浅色下的层次方向是  
    「越低越深」：elevated(纯白) > surface > alt/header > bg。
  - antd 侧 `colorBgContainer` 逐值跟随 `--app-surface`（否则 antd 组件底色与应用  
    自绘面不一致，边界又糊回去）；`colorBgElevated` / `colorBgLayout` 不动。
  - **分层不变量数值化**：新增 5 条守卫（`themes.test.ts`「面板分层」），用 WCAG  
    相对亮度算对比度比 —— elevated vs surface ≥ 1.025、bg / surface-alt 对 surface  
    ≥ 1.02、顶栏 chip 默认→hover ≥ 1.05、hover→激活 ≥ 1.03。人眼比对截图判不准这种  
    3% 的差，数值判据才挡得住「谁把 surface 改回纯白」的回潮。
- **顶栏图标激活态补主色内描边**（UI 需求稿 UI-07 收尾）：三档层次（默认 chip 底 /  
  hover 加深 / 持久激活主色弱底）本已齐全，但默认底与主色弱底都是「极浅底」——  
  aurora 下两者亮度只差约 1.2%，激活与否只能靠图标换色分辨，整排扫过去仍然糊。
  - `.is-on` 上补 `--ant-button-default-shadow: inset 0 0 0 1px var(--app-primary)`：  
    1px 内描边是不依赖亮度的几何信号。走这个变量而不是直接写 `box-shadow` 属性，  
    是因为 antd 只在 outlined / solid / dashed 变体上把它落成 `box-shadow`，  
    且**不分状态**，hover / active 也不会掉。
  - 4 颗开关型图标（章节栏 / 支撑面板 / 历史快照 / 排版偏好）补 `aria-pressed`，  
    屏幕阅读器能听出当前态；行囊与小说设定是唤起型入口，语义上没有「开 / 关」，  
    不加该属性。
- **「今日」字数读数口径统一**（UI 需求稿 UI-08）：同一指标此前在三处各写各的  
  术语与取值 —— 书架统计条卡「今日新增（字）」、继续写作 Hero「今日 N / M 字」、  
  编辑器状态条「今日 +N」。现在统一为：术语`今日新增`（单位`字`跟在数字后，  
  不写进标签，与同排「12 部 / 48.2 万 / 5 天」一致）、取值同一来源  
  （`usage_log` 净增聚合 + 会话内续加）、格式统一走 `formatThousands`。
  - 口径真相源落在 `src/shared/novel/today-stats.ts`（术语与单位常量 + 决策说明），  
    任一消费方就地写文案即由守卫测试拦下。
  - `docs/novel-editor-prd.md` 开放问题「今日字数口径：净增 vs 保存累计」正式拍板为  
    **净增**（删字扣回，即现状口径，无历史数据迁移）。
- **设定中心单体拆分**（UI-10）：`SettingCenter/index.tsx` 1494 行单体按功能拆为  
  子组件目录（左栏分类列表 / 分类卡 / 等级序列 / 顶部工具头 / 四个弹窗），状态机与  
  全部提交动作收敛到 `hooks/useSettingCenter.ts`，父组件只做组合。
  - **对外契约零变化**：`SettingCenter` 的 props 接口、`export default`、  
    既有回归用例涉及的全部回调时机与参数保持原样 —— 只搬移内部结构，不改对外行为。
  - 样式随组件就近：公共块级零件收在 `setting-primitives.scss`，其余各归组件  
    `index.scss`；自带造型按钮的清零点（`__set-realm` / `__sub-chip` / `__ins-btn`）  
    一并迁移，`novel-ui-kit.test.ts` 守卫全绿。
- **设定中心信息架构去术语化**（UI-05）：把「境界体系 = `kind='realm'` 的一条  
  等级序列」翻译成新手能按常识找到的入口 —— 左栏分组名从中性的「设定分类」改为  
  「等级序列」，并在该区顶部补一句人话说明「境界 / 品阶 / 功法等级都在这里 ——  
  一种体系建一个分类」；右侧阶梯小节标题同步改称「阶梯」，避免与分组名重复。
  - 不向用户暴露 `kind='realm'` / `level` / `rank` 等内部字段名；**不新增数据表、  
    不改表结构、不改 IPC 契约**（纯前端信息架构调整）。
  - 保留并确认 FR-05 订正过的提示「重命名与删除在右侧卡片的「编辑 / 删除」按钮」，  
    不回潮到已废弃的「右键 / 行尾菜单」承诺。

### Removed

- 编辑器 store 的 `todayAdded`（会话内新增字数）字段：状态条改用今日累计后它不再  
  有任何渲染消费方，留着就是「同一个今日两个数」的复发温床。要新增「本次写作字数」  
  这类读数请另起字段并显式命名，不要再挂回今日口径。


### Fixed

- **手动模式下把敏感词改掉之后，红字仍留在原地（改成了别的字也照样标红）**：  
  `RangeSet.map` 只做坐标运算 —— 它保证「区间跟着文本走」，保证不了  
  「区间里还是那个词」。把「血腥」改成「血型」，标记会原样搬到新文本上，  
  位置分毫不差、结论已经错了；从面板看上去就是「敏感词都改了，高亮还不消失」。
  - 每次平移后拿区间原文跟词条比一次（`pruneStale()`），对不上就当场丢掉；  
    `build()` 重建时做同样校验，切章 / 外部整段改写留下的错位快照因此  
    不会标出一块「错位的红字」。
  - 判据取「区间原文 == 命中词」而不是「词还在附近」：词被拆开（中间插字）  
    之后 AC 也不会再命中，丢弃才是对的；在词前后插字由 `map` 的 assoc 处理，  
    区间仍是原词，不会误删。比对走 `normalizeForMatch`，第二批变体匹配启用后  
    （「血 腥」这类命中带干扰字符）不会被误删。
  - 丢掉的标记同时从上报区间里消失 → 面板处的计数、状态条角标、跳转位置  
    同步下降，不会留下「列表里还有这一处、正文里已经没有」的鬼影。
  - 新增守卫 5 条（整词替换 / 中间插字 / 只改写一处不牵连另一处 /  
    丢弃后不再上报 / 错位快照不标）。用未加校验的版本跑会红在  
    `expected [ '阁楼', '血型' ] to deeply equal [ '阁楼' ]` —— 即截图里的现象。
- **手动模式下改了几个字，敏感词高亮停在旧位置、后面全偏，关掉重扫也修不好**：  
  两个独立缺陷叠在一起，缺一条都治不干净。
  - **中文输入法整段输入从未上报「正文脉搏」**：CodeMirror 自己的 `compositionend`  
    监听先于应用层执行，它在那一刻把候选文本刷进文档，于是 `updateListener` 收到  
    `docChanged` 时 `composingRef` 还是 true —— 按「组合期不上报」的守卫直接早退，  
    而 `compositionend` 回调只补了 `onChange`、**没补脉搏**。后果是 `latestDraft`  
    停在输入之前的正文上：自动模式对中文输入完全不重扫（作者的主要输入方式），  
    手动模式点「扫描本章」扫的也是旧文本，算出来的坐标整体偏移 N 个字 ——  
    这正是「重扫也修不好」的根因。现在 `compositionend` 在提交草稿后补一次  
    `onDraftPulse`。
  - **高亮层在组合期早退、连坐标平移也一起跳过**：`docChanged` 分支把 IME 判断写在  
    平移之前，组合期的每次改字都不 map；组合结束后的强制重建又直接吃 facet 里的  
    **扫描快照**（旧坐标），于是标注跳回原位。现在：① 平移到 IME 判断之前（坐标运算  
    O(命中数)，组合期做也不抖动）；② 插件本地持有一份平移后的区间，`build()` 用手上  
    这份而不是陈旧 facet；③ facet 换身份（重扫 / 切章 / 切模式）才整个采纳新快照。
  - 平移结果按 400ms 防抖上报回 store（`syncChapterRanges`），只接受本章的上报。  
    面板的「N 处 · M 词」、状态条角标、点结果行的跳转位置因此始终与正文红字同源 ——  
    删掉一处命中，计数当场跟着降，不会留下已不存在的命中。
  - 新增守卫 5 条（`sensitive-editor.test.ts`：命中词前插字 / IME 组合期改字 /  
    删掉命中词 / 新快照采纳 / 平移上报）与 4 条（`useSensitiveStore.test.ts`：  
    上报对齐、删命中降计数、跨章丢弃、未扫描不凭空标注）。
- **拼音还在候选框里时，要素（人名 / 地名）高亮压在相邻的字上，上屏后才跳回正位**：  
  标注层的 `docChanged` 分支只排了一次 300ms 后的重扫，**没有 `decorations.map`**  
  —— 而组合期的候选文本是**逐步**写进文档的（CodeMirror 按  
  `input.type.compose` 提交），拼音打多久，高亮就在错的位置停多久。把坐标平移提到  
  IME 判断之前（冻结的是**重扫**，不该冻结**平移**），正文一变先 map、普通输入也  
  不必再等那 300ms 防抖；组合期仍不重扫（候选文本可能命中词库、造成抖动），  
  `compositionend` 后照旧重算一次。  
  新增守卫 `novel-editor.test.ts`：用旧实现跑会精确地红在  
  「expected [ '嗯，沈' ] to equal [ '沈长青' ]」—— 即用户看到的偏移量。
- **切到「手动」模式时正文凭空全文标红，而面板写着「尚未扫描」、状态条写着「敏感 0」**：  
  编辑器高亮层只看了「是否挂载」，然后无条件按**词库**扫可视区 —— 于是从「关闭」  
  切到「手动」的瞬间，全文所有内置词条都被标出，而这些红色不对应任何一次扫描，  
  面板列表与计数自然还是空的。同一类错误的第二次（上一次是手动模式整层不挂，  
  扫出 15 处却一个字不标）。
  - 把「标什么」从「标不标」里拆出来：新增 `resolveHighlightSource(mode)` ——  
    `auto` → `live`（按词库实时标）、`manual` → `scan`（只标扫描结果）、  
    `off` → `none`。编辑器层新增 `sensitiveRangesFacet`：`null` 表示实时扫，  
    数组表示只标这些区间，**空数组就是一个字不标**。
  - 扫描结果新增 `chapterMatches`（逐处原文区间）：`SensitiveHit` 是按词聚合、  
    每个词只留首个位置，标红不够用。聚合与区间来自同一次扫描  
    （`scanChapterWithMatches`），面板列表、正文红字、状态条计数三者同源。
  - 全书扫描完成后顺手刷新「本章」结果与区间，否则扫完全书会是「正文标红了、  
    角标还是 0」；切到自动模式时补一次扫描，消掉「正文已标、计数还是上一次」  
    的窗口期。
  - 手动模式下正文编辑不再按旧坐标重建标注，改为随文本 map（CodeMirror 不会  
    自动映射插件装饰，之前的写法会让标注越敲越偏）。
  - 面板空态区分「尚未扫描」与「扫了 0 命中」—— 前者不再误报「这一章没有命中  
    词库里的词」。
  - 新增守卫：`sensitive-editor.test.ts`（真实 CodeMirror 实例断言 DOM 里有没有  
    标记）、`store/useSensitiveStore.test.ts`（切换模式不产生标注 / 扫描后两者同源 /  
    关闭一起清）、`sensitive/types.test.ts`（模式 → 数据源的映射）。
- **敏感词高亮把段落顶断（命中词独占一行）**：装饰节点的类名原本是 `nv-sm`,  
  而 `nv-sm` 同时是右栏敏感词面板的 BEM 块名 —— 面板根节点那条  
  `display: flex; flex-direction: column` 于是命中了正文里的行内 `<span>`，  
  命中的词被撑成块级元素、独占整行，前后文被挤到上下两行。类型检查、ESLint、  
  单测全绿，只有打开正文才看得见（项目是普通 CSS，没有 CSS Module 隔离，  
  跨模块块名撞车就是这么静默）。
  - 装饰类名改为 `nv-sm-mark`；同时把面板样式的作用域从裸 `.nv-sm` 收窄到  
    `.nv-panel .nv-sm`，让面板规则在结构上不可能命中正文节点。
  - 新增守卫 `sensitive-mark-guard.test.ts`：编译两处 SCSS 后断言「装饰类名不被  
    任何单类选择器命中」「面板选择器一律以 `.nv-panel` 开头」「高亮规则不声明  
    display / width / margin / line-height / font-size / padding-inline」  
    —— 这三条对应「被别人的布局劫持」「样式泄漏到正文」「高亮引起重排」。
- **顶栏「行囊」按钮首次点击像是没反应、要补点一次**（REQ-054，`pack-window-shown` 回执）：  
  「排版与偏好 / 历史快照开着 → 关掉 → 立刻点行囊 → 第一次点不动」。**根因不在点击**  
  —— 这两张抽屉都是 `.nv-page__stage` 的子元素，而 stage 写了 `overflow: hidden`，  
  抽屉关闭时 `translateX(100%)` 整块被裁在 stage 右侧外面，**几何上永远碰不到顶栏那一行**；  
  快照抽屉同理。页内其余浮层也逐个核过：`NovelToast` / `HoverEntityCard` 根节点  
  `pointer-events: none`，`EntityContextMenu` 的 mask 同样在 stage 内被裁 ——  
  **没有任何元素能盖住顶栏**（能盖住顶栏的只有 antd Modal 的 `fixed; inset: 0`，即 REQ-053）。
  - 真因在窗口侧：行囊是独立 BrowserWindow，首次创建要等整个行囊 SPA 装载完（dev 下  
    1–3s），这段时间屏幕上**一点变化都没有**，作者只会补点一次 —— 第二击正好撞在装载完成  
    前后，于是被记成「要点两次才弹出」。已开窗口的情形则更直接：`focus()` 在 Windows 上  
    对 `transparent + frame:false` 的窗口经常拿不到前台，窗口起来了却被小说窗口压着。
  - 修法三件套：`raiseWindow()`（`restore → show → focus → moveTop`，`moveTop` 与焦点  
    无关地抬 z 序，补上「显示成功但仍看不见」那一击）；主进程在窗口 `show` 时回一条  
    `pack-window-shown`；渲染层据它把顶栏按钮从「正在打开行囊…」态复位（另有 8s 兜底，  
    回执丢了不会把按钮永久钉住）。
  - 「正在打开」态**只换内容不换可点性**（图标换成转圈 + `aria-busy`），刻意不用 antd  
    `Button` 的 `loading`：那会连 onClick 一起吞掉，而「再点一次」正是窗口落到后面时的  
    唯一退路（主进程已开分支会 `raiseWindow`）。
  - **不改成「按钮动作挂 mousedown」**：那等于给一个并不存在的「点击丢失」打补丁，  
    还会丢掉「按下后拖走可取消」的语义。点击链路本来就是通的，缺的是「第一击已生效」  
    的可观测性。
  - 顺带把 `pack-window-open` 的**到达日志**补上（与 `global-setting-window-open` 同口径）：  
    「点了没反应」时第一件事是分清「点击没到主进程」与「窗口没起来」。
- **顶栏「行囊 / 小说设定」在浮层打开时要点两次**（REQ-053，REQ-050 的 Modal 补漏）：  
  设定中心或「自定义类型管理」开着时，点顶栏功能按钮**第一击没反应**。根因是  
  antd 6 Modal 的 `.ant-modal-wrap`（`position: fixed; inset: 0` +  
  `z-index: 1000 + 100`，嵌套弹窗再 +100）把整个视口连同顶栏一起盖住，wrap 自己  
  「点空白即关」→ 第一击被它收走，按钮根本没收到 click。REQ-050 当时只修了  
  **无遮罩抽屉**那条路径。
  - 修法：浮层打开时把顶栏抬到遮罩之上（`.nv-page.is-overlay .nv-page__head`，  
    `z-index: 1600`），并在顶栏的 **click 捕获阶段**调 `dismissPageOverlays()` ——  
    点击顶栏即「离开当前浮层」，同一次点击既收浮层又执行按钮动作。
  - 不用「遮罩点击穿透」：浮层不透明，穿透会让「点空白关浮层」顺手误触正文 /  
    章节树。只在 `is-overlay` 期间抬顶栏，确认类弹窗（排序确认 / 删除确认）  
    仍然按原样挡住顶栏。
  - 不能用 mousedown 收浮层：遮罩会立刻回到「退场中但仍铺满视口」的状态，  
    mouseup / click 又被吃掉，等于白改一层。
  - 「小说设定」自己带 `data-page-overlay-keep-open` 例外（它就是那颗浮层的开关，  
    否则「先关、再被 toggle 打开」= 点了没反应）。
- **工具 Tab 的「规划中」占位卡点了没反应**（UI 需求稿 UI-09）：右栏「工具」Tab 的  
  「人物关系网络」「架空地图」两张卡此前是 `<div>` —— 没有按钮语义，键盘 Tab 到不了，  
  鼠标点了也一片安静，与旁边的「起名器」摆在一起像是坏了。改为 antd `Button`  
  （虚线描边 + 显式弱化配色），点击给一次 info toast  
  （「「人物关系网络」还在规划中，上线后会出现在这里」），**不触发**既有的工具回调。
  - 弱化不再靠整卡 `opacity: .68`（那会把文字一起糊掉、对比度掉到读不清），改为分别  
    下调前景 / 底色 / 描边三色，文字保持可读。
- **编辑器状态条里的「今日」自相矛盾**：状态条显示的是**会话内**计数（`todayAdded`），  
  紧挨着的今日目标进度条却按今日累计（`todayTotal`）走 —— 打开编辑器时左边「今日 +0」、  
  右边进度条却已填了大半，且两个数都和书架的「今日新增」对不上。改为一律读今日累计。  
  同一根因还顺带修掉：继续写作 Hero 用 `toLocaleString()` 格式化（跟着系统区域设置变，  
  千分位可能不是逗号），改为与其它两处同一格式化函数。
- **行囊看板与 L1 编辑器之间没有间距**（看板落地后的版式回归）：看板 `.cpk-board`  
  与下方 `.cpk__zones` / `.cpk__flow` 都是滚动容器 `.cpk__body` 的直接子项，块级流  
  没有默认外边距 → 看板最后一行摘要**贴着**第一个模块卡上沿，两级结构糊成一片。  
  补相邻兄弟外边距（宽 / 中档 14px、窄档 8px）。不用「容器上 flex + gap」是因为  
  滚动容器改成 flex 会让子项默认 `flex-shrink: 1`，内容超高时反而把看板压扁。
- **看板点摘要行「没反应」**：看板在上、编辑器在下，点摘要行只改折叠状态时，变化  
  发生在**视口之外** —— 手点了、画面没动，用户以为按钮坏了，得自己往下滑才找到刚  
  展开的模块。改为**导航语义**：点行 = 确保该模块展开 + 平滑滚动到它（已展开则只滚动）。  
  收起一律留给 L1 模块壳自己的折叠按钮（那儿松手就见效）—— 从看板「远程收起」一个  
  视口外的模块，只是把「点了没反应」换个方向再犯一次。
  - 判据抽成纯函数 `moduleScrollDelta(target, viewport)`：目标已完整可见返回 `null`  
    （一像素都不动，避免「点了画面乱跳」），否则返回把目标顶部对齐到可视区顶部所需的  
    位移（留 8px 呼吸）。抽出来是因为 jsdom 没有布局引擎，`getBoundingClientRect` 与  
    元素级 `scrollTo` 在渲染测试里量不出真值。
  - 模块外层新增 `.cpk__module` 定位块（挂 `data-pack-module`）。渲染端与查询端是  
    **成对字符串**，改一边会静默失效，故加了源码断言守卫 `pack-board-nav-guard.test.ts`。
- **境界卡上的「收起」点了没变化**：B 境界卡按展开态把按钮文案切成「收起」，但它切的是  
  **下方 L1 的境界模块**，而这张卡本身没有可收起的内容 → 观感是「这颗按钮没用」。  
  改为恒显示「调整」，语义统一为「展开并跳到境界编辑器」。
- **看板身份卡与头部逐项重复**：头部横向概览带（设计稿 §8.6.1）已完整承担  
  「我是谁 + 存没存 + 工具」，看板的 A 区身份卡把名字 / 境界 / 绑定态 / 改动计数又  
  抄了一遍，两行叠着纯属噪音。删掉看板这边的 A 卡；它唯一独有的「角色首字头像」上移到  
  头部头像位（名字为空才退回人形图标），改动计数由头部既有的「全部已读 N」承担。
- **行囊境界关联「半保存」**（审查报告 TX-01）：改境界原本分两步落库——先  
  `novel-pack-save` 写文档，再单独调 `novel-link-set` 写 `novel_links`。两步之间  
  任一步失败（进程被杀 / 库忙 / 校验抛错）即留下「文档已变、关联未变」的半保存态，  
  下次打开行囊读到的境界与实体面板对不上。
  - 渲染层保存折叠为**一次 `novel-pack-save`**：`realmLink` 随文档一起进  
    `PackSavePayloadDto`，仅在「与上次保存态有净变化」时才带上（避免每次保存都重写  
    `novel_links`）。`usePackData.save()` 不再单独调 `writeRealmLink`。
  - 主进程在 `novel-pack-save` 事务内新增第 ③ 步 `upsertRealmLinkRow()`（先删后插，  
    复用 `dbRun` 并入外层事务），与清草稿、写文档同生共死——要么都成功、要么都回滚。
  - `novel-link-set` 处理器同步改走同一 helper，消除两处 SQL 漂移。
- **卸载时 flush 与保存竞态**（审查报告 TX-13）：行囊在**保存进行中**被关闭/卸载时，  
  卸载 flush 会把保存前的旧草稿再抖一次写回，覆盖刚落库的新内容。
  - 新增 `savingRef` 同步闸门：`save()` 进入即置位（同步，卸载 flush 读得到）并取消  
    在途草稿防抖；`flushDraft()` 开头 `if (savingRef.current) return;` 直接跳过；  
    保存结束复位。
- **灌入正文触发的字数基线漂移**（审查报告 TX-02）：打开章时 CodeMirror 把库中原正文  
  灌进编辑器，该次 `setContent` 被当作「用户编辑」，以旧 draft/base 当 `previous`  
  基线、把灌入本身算成净增，导致「本章字数 / 今日 +N」在上手瞬间虚高。
  - `setContent(chapterId, next, baseContent, source)` 新增第 4 参 `source:
    "user" | "hydrate"`；`"hydrate"` 分支只按 `baseContent` 刷新基线、零草稿写入。  
    好处：灌入路径不再污染字数统计，切换章时基线始终等于库内真值。

### Tests

- 色块阶梯新增 **4 条守卫**（`themes.test.ts` 18 → **22 例**），并逐条做**变异测试**  
  （改坏必红，证明非空转）：
  - 「窗口 / 页面根一律铺 `--app-bg`」：扫 `src/windows/*/pages/*/index.scss`  
    （9 个页面骨架）+ 行囊窗口内容根，取**最外层规则**的 `background` 断言 ——  
    不写可以（窗口壳已铺 bg），写了就必须是 bg。**M1**（行囊 `.cpk` 退回  
    `--app-surface`）→ RED。
  - 「`--app-surface-elevated` 只出现在白名单里的浮层文件」：11 个文件白名单  
    （下拉 / 弹窗 / 抽屉 / 悬浮卡 / portal 浮层）+ 反向自证「至少 6 个文件真在用」。  
    **M2**（看板卡退回 elevated）→ RED。防的是本轮行囊看板那类「流内卡片借浮层  
    token」的复发。
  - 「浮层里的槽一律用 `--app-surface`」：6 处定点断言（进位规则条 / 两个弹窗  
    的行与空态 / 分类引导条 / `.nv-setting` 的两个组件槽位 token），并检查该规则  
    **自身**声明里不得出现 `background: var(--app-surface-alt)`（嵌套子规则如  
    `&.is-base` 属 surface 上的合法一档，排除在外）。**M3**（进位规则条退回 alt）、  
    **M5**（滑块轨道退回 antd 出厂 `#f5f5f5`）→ RED。
  - 「antd 边框色与 `--app-border` 同步」+「ThemeAntdTokens 每个字段都被  
    ThemeProvider 透传」：后者防「加了 token 忘接线」这类静默失效。  
    **M4**（aurora 去掉 `colorBorder`）→ RED。
  - 数值依据用例补第二条：同一支 `alt` 贴浮层 > 贴内容面 + 0.02、`surface` 贴浮层  
    < 1.06、`alt` 贴 `bg` < 1.02 —— 把「按基面记」这条结论钉成数字。
- `usePackData.test.tsx` 补 TX-01（境界净变化才提交 / 随保存同事务 / 未变不带）与  
  TX-13（保存中卸载不 flush 旧草稿）回归用例；`beforeEach` 加 `mockReset()` 修复  
  `mockResolvedValueOnce` 队列跨用例泄漏。全套 25 文件 500 用例通过。
- UI-02 / UI-04 新增守卫与用例：`pack-layout.test.ts`（全档默认折叠 + 钉选优先）、  
  `pack-utils.test.ts`（阈值边界 / 层号可读名）、`types.test.ts`（`pinned` 缺省安全）、  
  `RealmModule/index.test.tsx`（层号条 / 阶下拉 / 小层直选）、  
  `PackModuleShell/index.test.tsx`（钉选按钮显隐与态）、  
  `pack-close-guard.test.ts`（`writeRealm` 调用点计数随 UI-02 更新为 3，  
  并新增「带 carry 的推进只允许一处」断言）。行囊套件 24 文件 496 用例通过。
- UI-03 / UI-01 新增用例与守卫：`open-setting-center.test.ts`（频道负载归一出  
  与脏负载拒绝）、`pack-window-guards.test.ts`（新增「preload 白名单放行 +  
  主进程 focus 后点对点转发、不得 broadcast」断言）、`pack-layout.test.ts`  
  （看板条数 / D 区过滤 / E 区透传）、`PackDashboard/index.test.tsx`（五区关键  
  行为：默认条数、点行开明细、只列 active、摘要行触发展开）、  
  `RealmModule/index.test.tsx`（空态「去设定中心创建」与「设为主角」按钮）、  
  `AttributesModule/index.test.tsx` + `StatusModule/index.test.tsx`（空态动作按钮）；  
  `pack-ui-kit.test.ts` 收录新增自带造型按钮（`cpk-emptyblock__cta`、  
  `cpk-board__*`）。行囊套件 26 文件 529 用例通过。
- UI-08 新增口径守卫 `src/shared/novel/today-stats.test.ts`：钉住术语与单位常量；  
  断言三处消费方都引用常量（不硬编码文案）；断言状态条读 `todayTotal` 而非会话内计数；  
  **全仓扫描「今日新增」字面量只允许出现在真相源模块**（防第四次分叉）；  
  断言三处都不用 `toLocaleString`。`useNovelEditorStore.test.ts` 随字段删除调整  
  （断言由等效的 `todayTotal` 承担，另有一例改写为「水合只写 todayTotal、不动恢复横幅开关」）。
- 浅色分层 / UI-06 / UI-07 / UI-09 用例：`themes.test.ts` 新增「面板分层」5 条（亮度 +  
  对比度比数值判据，含 antd `colorBgContainer / colorBgElevated / colorBgLayout` 与  
  token 逐值一致）；`novel-ui-kit.test.ts` 新增「顶栏图标三档层次」（读编译产物，取  
  **最后一次** `--ant-button-*` 声明再比对 —— 清零点 mixin 自己就会写一行  
  `--ant-button-default-bg: transparent`，用 `toContain` 会被它糊弄过去）；  
  新建 `NovelTopBar/index.test.tsx`（六图标结构契约 + `aria-pressed` + 回调互不串扰）、  
  `useGuideStore.test.ts`（T-05/06/07 消费入口：只吃一次 / 点位互不影响 / Tour 在播时  
  让位且不记账 / 打字保护期内不记账）、`ToolLauncher/index.test.tsx`（三卡皆按钮 +  
  占位 toast 不触发既有回调）；`OutlinePanel/index.test.tsx` 补 T-05「全屏只弹一个气泡」  
  （含「多章都空着」与「都填满」两端）；`guide-guard.test.ts` 补三处挂载点 + 统一消费  
  入口 + `guide-copy.ts` 文案同源的源码路径断言。
- 本轮变异验证（证明用例非 vacuous）：浅色 `surface` 改回 `#ffffff` → 2 例 RED；  
  antd `colorBgContainer` 改回 `#ffffff` → 1 例 RED；T-05 改成「每行都挂」→ 守卫 RED；  
  T-06 去掉 `consume` 回调 → 守卫 RED。还原后全绿。
- 静态色块守卫（`themes.test.ts`）自带反向自证：断言扫描到的 SCSS 文件数 > 20、  
  交互态里 `--app-surface-active` 的真实使用处 > 3（否则「零违规」可能只是因为全仓  
  没人用它）。变异：把行囊展开行改回 `surface-active` → RED（且报错行号与真实文件一致，  
  因为新增的 `stripCommentsKeepLines` 按原行数换空行）；把 cream 的 `--app-primary-weak`  
  调深到越过 1.15 → 数值用例 RED。还原后 16/16 GREEN。

### Removed

- **novel 域三窗口（NovelWindow / GlobalSettingWindow / PackWindow）死代码清理**：删除全仓零引用的  
  `TypeBadge` 组件、只被自身测试引用的纯函数（`calcSpeed` / `removeLevel` / `replaceInContent` /  
  `saveTextOf` / `useModuleSummary`）、未被任何界面消费的服务与 IPC  
  （`fetchPackDraft` + `novel-pack-draft-get`、`fetchNamingCustomPools` / `saveNamingCustomPools` +  
  `namingCustomPools` 配置键、`importSetting` 包装），以及行囊 `types.ts` / `pack-config.ts`  
  中无引用的类型别名与常量（`PackLevelRung` / `PackDraft` / `PackBundle` / `PackProtagonist` /  
  `PackOwnerType` / `ItemCategory` / `PackRarity` / `NATURE_SEGMENT_COLOR` / `PACK_LEVEL_RELATION` /  
  `UnitKind` / `PackChapterInserter`）。`novel-setting-import` 通道本身保留 ——  
  `electron/global-setting-qa.test.ts` 仍在守护它的 replace 语义。
- **已交付功能的设计 / 产品稿归档清理**：删除 `designs/`（原型页、预览样式、三张截图）与  
  `docs/` 下的类图 / 时序图、两代全局设定中心 PRD 与设计稿、小说编辑器 / 新手引导 / 行囊看板  
  PRD、审查报告、UI 需求稿、窗口池预研；仅保留 `docs/novel-onboarding-guide.html`  
  （应用内帮助中心的数据同源件）。

### Changed

- 上述文档删除后，源码注释中指向已删文件的引用（全局设定重设计、新手引导 PRD、行囊 PRD）  
  改为指向 CHANGELOG / 本文件内的事实源，避免留下断链。
