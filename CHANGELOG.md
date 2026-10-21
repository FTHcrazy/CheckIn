# Changelog

> 历史归档：2.0.0 之前的版本已按次版本拆到 `changeLogHistory/`
> （当前归档到 1.46.2，索引见 `changeLogHistory/README.md`）。
> 主文件只保留最近若干个次版本，超过 800 行时按 AGENTS.md §8.6 继续分流。

## [2.2.0] - 2026-10-21

### Added

- **人物关系网络独立窗口（R27）**：新窗口 `RelationWindow`（`novel` / `full` 打包，`lite` 不打包），
  左侧要素资料池 + 中间力导向画布 + 右侧节点 / 边详情三栏；池子列出本书全部要素并常驻
  「未上图 N」，按类型分组可折叠，支持名称 / 别名 / 简介检索、拖入拖回与一键上图。
- **图上建关系走单事务通道 `novel-graph-commit`**：一次提交写入「新建关系 + 备注 + 画布坐标」，
  `rev` 由主进程接管做乐观锁（`stale` 整体回滚），同 id 重复提交幂等；成功后广播
  `novel-links-changed` 增量，主窗口右栏三处（关联数 / 关系列表 / 面板）就地更新，不重载 bundle。
- **画布记忆按作品单键持久化**（`novel_config` 的 `novel_rel_graph_v1:<workId>:g1`）：成员集合、
  节点坐标与视口（缩放 + 平移）一并存住，重开窗口恢复上次的位置与视野；首次打开按布局自动铺开一次。
- **导出 PNG**：`capturePage` 取景 + 独立的二进制落盘通道（`writeFile` 不带 encoding），
  可选「先适应画布再导出」；导出期间工具栏整块不渲染，另用纯 CSS 抑制缩放控件、
  密度提示条与选中态，图面一个像素都不挪。
- **资料卡「在主窗口打开」的三态跳转**：书架主页 → 直接切到目标作品并开卡；同一本书 →
  直接开卡；另一本书 → 只把主窗口抬到最前，弹确认（**取消 / 保存后跳转**），确认后先
  `flushSave` 落库再切书；主窗口已被关闭时由 `window-send-to` 的 `create` 拉起。
  画布节点双击走同一入口。
- **跨窗口消息统一的待投递队列**（`electron/window-pending.ts`）：`window-send-to` 支持
  `create`（窗口没开就拉起）与 `queue`（先入队），新窗口装载后由 preload drain 并补投给
  监听者。此前每种跳转都要在主进程单独维护一对 IPC，现在主进程只认识窗口名。
- **跳转判定堵死「静默切书」的最后两条通道**：① 能力句柄增加 `ready()`——编辑器数据
  装载完成前 `activeWorkId()` 恒为空串，此前被当成「空态直开」，判定与执行之间状态一变
  就成了无声切书；现在未就绪一律挂起，就绪后按真实作品 id 重判。② 主窗口若是**刚被这条
  跳转拉起来的**，不再走「书架直切」——先按上次位置恢复编辑器，把跳转挂起，句柄就绪后
  重判：同书直开卡，异书照常弹确认框。判定与执行改用同一份快照，不再中途重读 getter。
- **跳转状态机收口 `useEntityJumpStore`（zustand）**：视图 / 编辑器挂载 / 打开请求 /
  能力句柄 / 挂起与待确认跳转全部进 store，判定永远读当下状态。修掉三类真机时序故障：
  IPC 监听随视图切换反复摘挂导致消息静默丢失（只唤起、不切书不弹窗）；挂起的跳转在
  「返回书架」的视图切换间隙被重判成书架直切（返回书架却切书、书架页冒确认框）；挂起后
  稳定态再无依赖变化、永远等不到重判。现在监听只注册一次、回书架**同步**作废挂起跳转、
  句柄就绪立即重判 + 300ms 兜底重试。

### Changed

- 版本升到 `2.2.0`（新增独立窗口与新数据通道，按 §8.6 升次版本号）。
- 移除未被任何生产代码调用的 `rebaseOnRemote`（死代码会让人误以为图窗口已有跨窗口冲突合并）。
- `useNovelData` 的 `novel-links-changed` 监听按 `workId` 过滤：图窗口停在 A 书、主窗口已切到 B 书时，
  A 的增量不再并进 B 的 `bundle.links`（缺省 workId 仍按 id 合并）。

### Fixed

- **关系写入路径补齐守卫**：自环、空关系名、超长关系名（>24 字）在事务第一步直接拒绝
  （`invalid-link`），不再只依赖渲染层 `checkDraft()`；入库前统一 `trim`。
- **导出的 PNG 里不再出现右上角操作按钮**：三处一起修 —— ① `is-exporting` 由 `exporting`
  声明式驱动（React 重渲染按模板重写 class 时不会把命令式类名抹掉）；② 工具栏在导出态
  `display:none`（用户点的正是那颗「导出」，菜单挂在 body portal、退场动画没走完就会进图）；
  ③ 取景前多等 120ms 并让窗口 `invalidate()` 重绘 —— `capturePage` 会返回「上一帧」，
  此前截到的就是点按钮那一刻的画面。
- **异书跳转不再「先切书、再弹确认」**：`rel-open-entity` 只在窗口根监听一次，判定走
  纯函数 `resolveEntityJumpAction`（书架 / 同书 / 异书 / 挂起 / 忽略），`confirm` 分支只挂起弹窗，
  切书严格发生在「保存成功」之后。另补两处同源隐患：① 编辑器正在重挂载（HMR / StrictMode）时
  能力句柄短暂为空，旧兜底会「直接切过去开卡」——现在改为挂起，句柄就绪后按真实作品 id 重判；
  ② 同一条消息被重复投递（收件箱补投 + 实时投递）时只处理一次，不会二次切书或弹第二个框。
- **`window-send-to` 的 `create` 以前从未生效**：preload 把 `raise` 与 `options` 摆在两个位置参数上，
  主进程只按第 4 位读，`{create:true}` 被丢掉 —— 主窗口关掉后点「在主窗口打开资料卡」既不创建
  也不入队，只回一个 `delivered:false`，用户看到「主窗口没能打开」。选项读写收进
  `electron/window-send-options.ts`（`buildWindowSendOptions` / `readWindowSendOptions`），
  两侧互逆 + 旧位置参数形状各有单测；主进程同时读第 4 / 第 5 位，两份产物热重启错位也不会复发。
- **类型分类 tab 不再被切成一半**：切筛选时只在选中项被遮住时挪动，且只挪到「整颗可见 +
  8px 留白」；原先的「居中」必然把左邻 chip 推出容器，第一个分类只剩半个字。
- **去重改为无向判定**：A→B 与 B→A 的同名关系视为同一对，与渲染层「重复 → 合并」的口径一致，
  不再出现「弹层说合并 +1、库里却新插一行」。
- **画布记忆读失败不再按「首次打开」处理**：读取异常时按空白画布打开、只给提示，
  不再重新布局 / 播种 / 立刻写回（一次瞬时故障就会覆盖用户摆好的坐标）；该状态下禁止写回，
  「刷新 / 重新载入」成功后才恢复写。
- **坐标写库串行化**：多次 flush 挂在同一条 promise 链上，避免并发写导致磁盘 `rev` 倒退
  （之后每次提交都被误判 `stale`）；`dirty` 只在最后一次写入成功后清零。
- **坐标没写进去就中止提交**：`flush` 失败时不再带本地旧 `rev` 继续提交，
  错误提示改为「坐标没能保存」，与 `stale`（别处改过）区分开。
- 画布节点不进 Tab 序（`nodesFocusable={false}`）：200 个节点不再堵死键盘焦点序列，
  键盘路径统一由左侧池子承担。
- 「重新载入」不再恒报成功：`reload` 返回 `false` 时提示失败原因，避免用户在同一个
  `stale` 错误上反复重试。
- 窗口标题带作品名（`<作品名> · 关系网络`），多窗口切换时能分清是哪本书。
- 重复唤起图窗口不再静默换书：主窗口切到 B 后点开已存在的图窗口（主进程会补发
  `relation-window-context`），现在与 `novel-work-changed` 同口径挂起、由横幅确认，
  未确认的连线与未落库坐标不会被跳过。
- `electron/window-load-guard.test.ts` 补登记 `createRelationWindow`：此前装载守卫未纳入清单，
  失败时只会静默黑窗，测试也不会红。
- **更新日志分流脚本分组键修正**：`scripts/split-changelog.mjs` 此前只按数字 `minor` 分组，
  `1.46 > 2.0` 于是 1.46 被当成「最新次版本」留在主文件、2.0.0 反被归档（指针写着
  「归档到 2.0.0」却只保留 1.46.1 之后）。改为按 `major.minor` 双键分组与排序，
  并修掉「块之间不空行」的问题；新增 `electron/changelog-archive-guard.test.ts` 钉住
  「主文件保留的次版本必须严格新于所有归档」等 4 条不变量。

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
