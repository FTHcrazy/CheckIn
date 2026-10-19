# 2.0.0 打包体积治理（bundle slimming）

> 目标：把「安装包 100 MB 但代码只有 2 MB」这件事查清并根治。
> 结果：`app.asar` 从 **117.34 MiB → 13.78 MiB**（−88.3%），
> `app.asar.unpacked` 从 **11.73 MiB → 1.86 MiB**（−84.2%），
> 安装包从 **101.48 MiB → 85.26 MiB**（−16.0%）。
> 所有数字均为本机实跑值（Electron 42.4.1 / electron-builder 25.1.8 / Windows x64）。

---

## 1. 问题

上一次打包产物（`release/win-unpacked`，2026-10-15，版本 1.44.0）的分区数据：

| 指标 | 数值 |
|---|---|
| `resources/app.asar` 磁盘字节 | 123,035,304 B（117.34 MiB） |
| 其中 `node_modules` 逻辑体积 | 121.89 MiB |
| 其中 `dist` | 2.20 MiB |
| 其中 `dist-electron` | 126.0 KiB |
| asar 内文件数 | 19,579 |
| `app.asar.unpacked` | 12,302,158 B（11.73 MiB） |
| `release/win-unpacked` 合计 | 401,103,686 B（383 MiB） |
| 安装包 `CheckIn Setup 1.44.0.exe` | 106,407,729 B（101.5 MiB） |

渲染层产物（`dist`）只有 2.20 MiB，`node_modules` 却有 121.89 MiB —— 99% 的 asar 是
永远不会被 `require` 的东西。

---

## 2. 定位：四条证据链

### 2.1 electron-builder 默认塞入整棵 production 依赖树

electron-builder 不看你「实际上 require 了什么」，它读 `package.json` 的
**production `dependencies`**，把整棵依赖树打进 asar。1.44.0 的 `dependencies` 里有
19 个纯渲染层依赖，按 asar header 统计的体积：

| 包 | 体积 |
|---|---|
| `antd` | 57.08 MiB |
| `@ant-design/icons` | 11.59 MiB |
| `react-dom` | 6.98 MiB |
| `framer-motion` | 4.44 MiB |
| `react-router`（`react-router-dom` 的传递依赖） | 3.61 MiB |
| `motion-dom` | 3.10 MiB |
| `lunar-typescript` | 1.22 MiB |
| `@codemirror/view` | 1.03 MiB |
| …… | …… |

这些包**早已被 Vite 打进 `dist`**（`dist` 合计才 2.20 MiB，含 antd 的 1.4 MiB
`antd-*.js` chunk）。asar 里这一份与运行期无关，是 100% 冗余。

### 2.2 主进程运行期只 `require` 4 个包

`dist-electron/main.js` 里的外部 require 全集：

```text
require("better-sqlite3")  require("docx")  require("jszip")  require("mammoth")
require("electron")  require("fs")  require("path")  require("crypto")  require("node:fs")  require("node:path")
```

与 `vite.config.ts` 的 `external: ['electron','better-sqlite3','mammoth','docx','jszip']`
完全对应。在 `electron/**` 里 grep 第三方导入，结果同样只有这四个包
（`db.ts` / `novel-db.ts` → better-sqlite3，`handlers/memo-handlers.ts` → mammoth +
jszip + docx，`handlers/todo-handlers.ts` → jszip）。**渲染层依赖在 `electron/**` 中零导入。**

### 2.3 `asarUnpack: ["node_modules/**/*.node"]` 触发 smartUnpack 整包外置

通配符命中 better-sqlite3 的原生模块后，electron-builder 把**整个包**外置，于是
`app.asar.unpacked/node_modules/better-sqlite3` 里带上了：

| 内容 | 体积 | 性质 |
|---|---|---|
| `deps/sqlite3.c` | 9.8 MB | 编译期 C 源码 |
| `src/*.cpp` | 162 KB | 编译期 C++ 源码 |
| `build/` | 1.9 MB | 含 `better_sqlite3.node` |
| `lib/` | —— | 运行期必需 |

`deps/` + `src/` 是给 `node-gyp` 用的，装机后一辈子用不到。

### 2.4 `after-pack.js` 的 `LICENSE.electron.txt` 条目必须移除

`node_modules/electron/dist` 里没有 `LICENSE.electron.txt`，只有 `LICENSE`（1,096 B）；
electron-builder 打包时会把这份 `LICENSE` 写成 `appOutDir/LICENSE.electron.txt`（实测
1,096 B，与源文件逐字节一致）。也就是说：**这个文件在产物里确实存在，而且必须保留**
（MIT 许可要求随分发附带版权声明）。旧清单里写着删它，实际是「看起来删的是个死文件名、
其实一直在删许可证文本」—— 本条不是「删掉死条目」，而是「确认它不该被删、并禁止加回」。

---

## 3. 改动清单

| 文件 | 位置 | 改了什么 | 为什么 |
|---|---|---|---|
| `package.json` | `version` | `1.47.0` → `2.0.0` | 本次为架构级打包治理，按 §8.6 升主版本 |
| `package.json` | `dependencies` | 只保留 `better-sqlite3` / `docx` / `jszip` / `mammoth` | 只有这四个被主进程 require；其余进 asar 即冗余 |
| `package.json` | `devDependencies` | 接收迁出的 19 个渲染层依赖（版本区间不变，只换 section） | 仍在 `pnpm install` 中安装、仍被 Vite 打包，只是不再进 asar |
| `package.json` | `build.files` | 新增 6 条 `!node_modules/...` 排除（`*.map` / `*.md` / `*.d.ts` / 测试与示例目录 / `@types` / `better-sqlite3/{deps,src}`） | docx 把 `@types/node` 声明成运行时依赖（纯类型无运行期用途）；npm 包里的 README、sourcemap、测试 fixtures 一律无用 |
| `package.json` | `build.asarUnpack` | `node_modules/**/*.node` → `node_modules/better-sqlite3/build/Release/*.node` | 精确到原生模块本体，避免 smartUnpack 把整个包外置（含 9.8 MB C 源码） |
| `package.json` | `build.electronLanguages` | 新增 `["zh-CN","en-US"]` | 把 locale 裁减前置到打包阶段，替代 afterPack 事后删 53 个 `.pak` 的兜底（原 `locales/` 48 MB） |
| `package.json` | `scripts.analyze:asar` | 新增 | 一条命令出体积审计，改动打包配置后可留痕 |
| `scripts/after-pack.js` | 删除清单 | 移除 `LICENSE.electron.txt` 删除项（它是 electron-builder 由 `electron/dist/LICENSE` 生成的 Electron MIT 许可证，删除即违反随分发附带版权声明的要求，注释已标「禁删」） | 见 §2.4 |
| `scripts/after-pack.js` | 注释 + 日志 | `dxil.dll` 明确保留（注释写明「待 Electron 44 实机回归后评估」）；缺失文件记 debug 不静默；结尾打印「共节省 X MB / 剩余 locales 数量」 | `dxil.dll`（1.44 MB）与已删的 `dxcompiler.dll` 配套，本次不升级 Electron、无法实机验证 GPU 回退路径，1.44 MB 收益不值得白屏风险 |
| `scripts/analyze-asar.mjs` | 新增 | 读 `getRawHeader()` 解析 asar（不解包），输出顶层分区 / 按包排序（≥200 KiB）/ 分区小计，支持 `--json` 与 `ASAR_BYTES=` 尾巴 | 让「谁把体积吃掉了」变成可核对的数据 |
| `scripts/split-changelog.mjs` | 归档分支 | 新增「归档为空时提前退出」分支（`archived.length === 0` 直接打印并 `process.exit(0)`） | CHANGELOG 未超 800 行时原逻辑会在 `archived[0]` 抛 TypeError |
| `package.json` | `devDependencies` | 新增 `@electron/asar@^3.4.1` | 审计脚本直接依赖它，不再靠 electron-builder 传递依赖被 hoist 到根目录 |
| `electron/packaging-guard.test.ts` | 新增 | 5 组守卫、10 个测试用例（见 §5） | 依赖归位这类错误没有任何运行期症状，只能靠守卫 |
| `AGENTS.md` | §6.8 新增 | 「打包与依赖归位规范」三条铁律 | 把判断标准写死，避免下次又有人把渲染层依赖塞回 `dependencies` |
| `AGENTS.md` | §8.5 | external 清单说明补「同时要进 dependencies」 | 与新守卫一致 |
| `.gitignore` | 根目录 | 新增 `release-*` | 备用打包输出目录（`-c.directories.output=release-xxx`）动辄 300 MB，产物不入库 |
| `pnpm-lock.yaml` | `importers['.']` | 19 个包从 `dependencies` 移到 `devDependencies` | `pnpm install --lockfile-only` 生成，锁版本不变 |

**未改**：Electron 版本（42.4.1）、better-sqlite3 版本、electron-builder 版本
（25.1.8）、`npmRebuild: false`、`compression: "maximum"`、`electronDist`、任何业务源码。

---

## 4. 优化前后对比（实测）

| 指标 | 1.44.0（改前） | 2.0.0（改后） | 变化 |
|---|---|---|---|
| `app.asar` 磁盘字节 | 123,035,304 B / 117.34 MiB | **14,447,397 B / 13.78 MiB** | −108,587,907 B（**−88.3%**） |
| 其中 `node_modules` 逻辑体积 | 121.89 MiB | **11.81 MiB** | −110.08 MiB（−90.3%） |
| 其中 `dist` | 2.20 MiB | 3.37 MiB | +1.17 MiB（业务代码增长，非本次改动引起） |
| 其中 `dist-electron` | 126.0 KiB | 175.5 KiB | +49.5 KiB（同上） |
| asar 内文件数 | 19,579 | **1,162** | −18,417（−94.1%） |
| asar 内包数（node_modules） | 160 | **62** | −98 |
| `app.asar.unpacked` | 12,302,158 B / 11.73 MiB | **1,945,966 B / 1.86 MiB** | −10,356,192 B（**−84.2%**） |
| `release/win-unpacked` 合计 | 401,103,686 B / 383 MiB | **282,160,683 B / 269 MiB** | −118,943,003 B（**−29.7%**） |
| `locales/` 文件数 | 55（48 MB） | **2**（`zh-CN.pak` / `en-US.pak`） | −53 |
| 安装包 `CheckIn Setup *.exe` | 106,407,729 B / 101.48 MiB | **89,402,895 B / 85.26 MiB** | −17,004,834 B（**−16.0%**） |

改后 asar 的包体积排序（≥200 KiB 全量）：

| 包 | 体积 |
|---|---|
| `docx` | 4.32 MiB |
| `mammoth` | 2.26 MiB |
| `better-sqlite3` | 1.86 MiB（全部外置到 unpacked） |
| `pako` | 759.5 KiB |
| `jszip` | 721.9 KiB |
| `underscore` | 594.6 KiB |
| `xml-js` | 375.2 KiB |

其余 55 个包均 < 200 KiB（合计约 0.9 MiB）—— 全部是上面四个包的真实传递依赖。

---

## 5. 验证方式

```bash
# 1. 清构建产物（Vite 的 safe-delete 守卫会拦 dist 文件数超阈值的情况）
rm -rf dist dist-electron

# 2. 编译 + 打包渲染层与主进程
pnpm build

# 3. 只出 unpacked 目录（快，用于取证）
npx electron-builder --dir

# 4. 体积审计（默认读 release/win-unpacked/resources/app.asar）
pnpm analyze:asar
node scripts/analyze-asar.mjs --json     # 机器可读，便于前后对比

# 5. 磁盘实测
du -sb release/win-unpacked release/win-unpacked/resources/app.asar release/win-unpacked/resources/app.asar.unpacked

# 6. 出完整安装包（compression=maximum，10 分钟量级）
npx electron-builder --win nsis

# 7. 守卫与类型检查
npx vitest run electron/packaging-guard.test.ts
pnpm typecheck
```

**运行期依赖完整性自查**（必须四条全 OK，否则装机后白屏 / 功能挂）：

```bash
node -e "
const asar=require('@electron/asar');const fs=require('fs');
const root='release/win-unpacked/resources/app.asar.unpacked/';
const set=new Set(asar.listPackage('release/win-unpacked/resources/app.asar').map(f=>f.replace(/\\\\/g,'/')));
for(const name of ['better-sqlite3','docx','jszip','mammoth']){
  const pkg=JSON.parse(fs.readFileSync('node_modules/'+name+'/package.json','utf8'));
  const main=(pkg.main||'index.js').replace(/^\.\//,'');
  console.log(name, set.has('/node_modules/'+name+'/'+main) || fs.existsSync(root+'node_modules/'+name+'/'+main) ? 'OK':'MISSING');
}"
```

本次实跑结果：

```text
better-sqlite3   main=lib/index.js        pkg.json=true entryAsar=true  entryUnpacked=true  OK
docx             main=dist/index.umd.cjs  pkg.json=true entryAsar=true  entryUnpacked=false OK
jszip            main=lib/index           pkg.json=true entryAsar=true  entryUnpacked=false OK
mammoth          main=lib/index.js        pkg.json=true entryAsar=true  entryUnpacked=false OK
better-sqlite3 unpacked 目录 = build, lib, LICENSE, package.json   # deps/ 与 src/ 已消失
```

**守卫测试（`electron/packaging-guard.test.ts`，5 组 / 10 个测试用例全绿，约 24 条 expect）**：

1. production `dependencies` 键集合严格等于 `['better-sqlite3','docx','jszip','mammoth']`；
2. 渲染层依赖（antd / react / framer-motion / @codemirror/view …）都在 `devDependencies`；
3. `vite.config.ts` 里 external 的每个包都在 `dependencies`（防「打包后 Cannot find module」）；
4. external 清单与 `dependencies` 双向一致（不多不少）；
5. `build.files` 含 `!node_modules/better-sqlite3/{deps,src}/**`、`!node_modules/@types/**` 及 map/md/d.ts/测试目录四条排除；
6. `build.asarUnpack` 只含 better-sqlite3 的 `.node`，不得出现 `node_modules/**/*.node`；
7. `electronLanguages` 恰为 `zh-CN` / `en-US`；
8. `version` 是合法 semver 且 `major >= 2`。

> 解析源码做断言前统一 `stripComments()`（AGENTS §6.6）—— 本仓注释里常抄着被删掉的旧写法。

---

## 6. 未做项与后续

| 项 | 现状 | 为什么这次不做 | 后续条件 |
|---|---|---|---|
| **升级 Electron 42 → 44** | 保持 42.4.1 | 需要实机回归（原生模块 ABI、GPU、托盘、协议注册），与体积治理不是同一件事 | 独立阶段：升级后重跑 `pnpm electron:rebuild` + 全量单测 + 冒烟 |
| **删除 `dxil.dll`（1.44 MB）** | 保留 | 与已删的 `dxcompiler.dll` 配套；无法实机验证 GPU 回退路径时删除有白屏风险 | Electron 44 实机回归通过后评估 |
| **升级 electron-builder 25 → 26** | 保持 25.1.8 | 26 的 files / asar 行为有变更，需重新核对守卫与产物 | 单独一次打包实验，产出对比表 |
| **进一步瘦身 `docx`（4.32 MiB，含 iife/umd/esm 三份产物）** | 未做 | 需要 `files` 级子路径裁剪（只留 `dist/index.cjs`），属于「改第三方包内容」，风险与收益比不佳 | 如未来 asar 仍偏大，可尝试 |
| **`better-sqlite3` 单包外置体积（1.86 MB）** | 已最小化 | 只剩 `build/Release/*.node` + `lib/` | —— |

---

## 7. 本次实跑的环境备注

本机 `release/win-unpacked` 中 1.44.0 的 `app.asar`（117 MB）在构建前已被系统标记为
delete-pending（前一次清理被安全删除中间层中断），`rm` / `rd /s /q` / `fs.rmSync` 全部返回
`EBUSY`（「另一个程序正在使用此文件」），且连带锁住了所在目录，导致 electron-builder
无法清空 `release/win-unpacked` 重新打包。

处置：构建输出改到 **`release-c/`**（中途还试过 `release-next/` 与 `release-b/`，前者被
安全删除层截断、后者 rcedit 撞上 Defender 对 232 MB `CheckIn.exe` 的扫描锁；两者已删除）。
`release-c/` 的产物与 `release/` 下应得的结果完全一致：

- `release-c/win-unpacked/`（269 MiB，含 `resources/app.asar` 14,447,397 B）
- `release-c/CheckIn Setup 2.0.0.exe`（89,402,895 B）

随后已把安装包与更新元数据**复制**到正式位置，基线安装包未被触碰：

```text
release/CheckIn Setup 1.44.0.exe          106,407,729 B   （基线，保留）
release/CheckIn Setup 2.0.0.exe            89,402,895 B   （本次产物）
release/CheckIn Setup 2.0.0.exe.blockmap       96,156 B
release/latest-2.0.0.yml                          342 B
```

`release/win-unpacked` 仍是锁住的旧目录，**重启后**执行
`rm -rf release/win-unpacked && mv release-c/win-unpacked release/win-unpacked` 即可对齐。
日常机器（无 delete-pending 残留）直接 `npx electron-builder --dir` 即可，不会遇到此问题。

