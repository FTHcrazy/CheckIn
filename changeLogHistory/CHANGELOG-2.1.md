# Changelog · 2.1.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.1.2] - 2026-10-20

### Changed

- **打包体积：`app.asar` 13.67 → 6.50 MiB（−52.5%），安装包 99.78 → 98.82 MiB（−0.96 MiB）**。  
  运行期依赖（`docx` / `mammoth` / `jszip` / `pako` / `bluebird` / `xml-js` / `underscore`）
  各自带了同一份代码的多种构建产物，而 Node `require` 只走 `exports.require` / `main` 指向的
  那一个 —— 浏览器 UMD/IIFE 版、ESM 版、包内 `dist/` 预打包副本、`node-addon-api` 纯头文件
  全是死重，合计 ~7 MiB 原始体积。逐条写进 `build.files` 排除，`docx` 只保留
  `dist/index.cjs`、`underscore` 只保留 `underscore-node.cjs` 链路。  
  同时补 `!**/node_modules/@types/**`：原有 `!node_modules/@types/**` 匹配不到
  `docx/node_modules/@types/**` 这类嵌套路径。
- **install 与运行期无任何行为变化**：打包产物解包后按包名（走 `exports`，与运行期一致）
  require 全部通过，并用「`docx` 生成 → `mammoth` 解析回来」的闭环 + `jszip` 往返 +
  `better-sqlite3` 真实 SQL 验证。`electron/packaging-guard.test.ts` 新增 11 条断言，
  含「任何运行期依赖不得被整包排除」的反向守卫。

### Docs

- 新增 `docs/packaging/bundle-slimming-2.1.2.md`：记录**压缩视角**的体积账
  （`app.asar` 压缩率 7.9:1、`.pak` 1.01:1、`CheckIn.exe` 占安装包 65.4%），
  解释「asar 再省 7.5 MiB 只换来 0.96 MiB 安装包」的原因，并列出剩余可动项
  （`resources.pak` 里 4.8 MiB Chromium 内置 FLAC 音效、`chrome_200_percent.pak`、
  `dxil.dll`、BCJ2 因 NSIS 内置解压器不支持而不可用）及其风险。

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
