# Check In

## 文档导航

| 想了解 | 去哪看 |
|--------|--------|
| 架构、模块边界、开发规范 | [`AGENTS.md`](AGENTS.md)（主文档，改代码前必读） |
| 历史文档（规范 / 审查报告 / 归档过程稿） | [`docs/README.md`](docs/README.md) |
| 版本变更 | [`CHANGELOG.md`](CHANGELOG.md)，更早的在 [`changeLogHistory/`](changeLogHistory/README.md) |

## 开发环境

安装依赖并启动：

```bash
pnpm install     # postinstall 会做依赖体检 + 补装 Electron 二进制
pnpm dev
```

也可一步到位：`pnpm electron:setup`（= `pnpm install && pnpm ensure:electron`）。

> `better-sqlite3` 自 **13.0** 起改用 Node-API（N-API）预编译二进制，随 npm 包分发、
> 跨 Node / Electron ABI 通用，**不需要也不存在 `pnpm electron:rebuild` 这一步**。
> 若原生模块加载失败（`Could not locate the bindings file` 等），执行 `pnpm install`
> 重装即可，它会重新解压 `node_modules/better-sqlite3/prebuilds/`。

## 常见异常排查

### 1. 启动即崩：`electron.app` / `ipcMain` 为 undefined

**现象**：主进程一加载就崩，日志里 `process.type` 为 `undefined`，`require('electron')` 返回的是路径字符串而非 API。

**原因**：终端环境注入了 `ELECTRON_RUN_AS_NODE=1`，Electron 以 Node.js 兼容模式启动（部分集成终端会注入该变量）。

**处理**：`scripts/start-electron.js` 已在 spawn 前自动剔除该变量，正常走 `pnpm dev` 即可；若手动启动 Electron，先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。

### 2. 报错「Electron 二进制缺失」/ `pnpm dev` 卡住不动

**现象**：`pnpm dev` 报 Electron 可执行文件不存在；或终端停在 `pnpm dev` 后**毫无输出、看起来卡死**。

**真正原因**（1.47.0 定位，别再按「pnpm 拦截 postinstall」处理）：
Electron ≥41（本项目 44.x）的包**已经没有 postinstall 脚本**，二进制的安装被推迟到
**首次 `require('electron')`** —— 没有 `path.txt` 时，它会在同步调用栈里 spawnSync
下载 ~140MB，默认直连 github、**无超时无进度**，于是表现为「卡死」。而 `.npmrc` 的
`electron_mirror` 只在包管理器执行安装脚本时才转成 `ELECTRON_MIRROR`，被内部 spawn
时一个环境变量都没有。

**处理**：

```bash
pnpm ensure:electron   # 自动读 .npmrc 注入 ELECTRON_MIRROR 并补装（已装好则毫秒返回）
pnpm dev:doctor        # 完整体检：二进制 / locales / default_app.asar / 依赖链接
```

> 二进制「看着齐全」但 Electron 仍在几十毫秒内 `exit(1)` 且零输出 = **解压不完整**
> （常见是只剩 19 个根文件，缺 `dist/locales/*.pak` 与 `resources/default_app.asar`）。
> 此时 `install.js` 因 `path.txt` 已存在而判定「已安装」，`pnpm install` 永远说
> Already up to date —— 用 `pnpm ensure:electron` 强制重解压，别手动删了又装。
> 另外：`pnpm install` / `ensure:electron` 执行中途**不要中断**，否则就会留下这种半份 dist。

### 3. 数据库报错 / `Cannot locate the bindings file`

**原因（历史问题，2.1.0 起已消除）**：`better-sqlite3` 12.x 是用 NAN 直接对接 V8 的
ABI 相关模块，必须针对 Electron 的 `NODE_MODULE_VERSION` 重编译；Electron 一升级就崩。

**现状**：`better-sqlite3` 13.x 改用 **Node-API**，`prebuilds/win32-x64.node` 与
Electron ABI 无关，升 Electron 不再需要重编译，`pnpm electron:rebuild` 已移除。

**若仍报错**（按顺序）：

1. 确认版本：`node -e "console.log(require('better-sqlite3/package.json').version)"`，
   低于 13 说明 lockfile 没更新，执行 `pnpm install`。
2. 确认二进制存在：`node_modules/better-sqlite3/prebuilds/win32-x64.node`。
3. 缺失则 `pnpm install` 重装。

### 4. pnpm 9 安装失败：`gyp ERR! find VS` / `Could not find any Visual Studio installation`

**现象**：`pnpm install` 停在

```
node_modules/better-sqlite3 install$ node-gyp rebuild
gyp ERR! find VS could not find a version of Visual Studio 2017 or newer to use
gyp ERR! not ok
ELIFECYCLE  Command failed with exit code 1.
```

**原因**：`better-sqlite3@13` 没有 `install` 脚本，但包内留着 `binding.gyp`；npm/pnpm 的既有约定是
「有 `binding.gyp` 且无 `install` 脚本 → 默认执行 `node-gyp rebuild`」。它真正需要的是**禁止**构建，
而 `pnpm-workspace.yaml` 里的 `allowBuilds` / `onlyBuiltDependencies` **pnpm 9 完全不读**
（实测 9.15.9：pnpm 设置只有 pnpm 10 之后才从 `pnpm-workspace.yaml` 读）。

**处理**：仓库已在 `.npmrc` 里补了 pnpm 9 认的那一份（`key[]=value` 数组语法，
是 pnpm 9 / 11 都能正确解析的唯一位置）：

```ini
only-built-dependencies[]=@parcel/watcher
only-built-dependencies[]=electron-winstaller
only-built-dependencies[]=electron
only-built-dependencies[]=esbuild
```

`better-sqlite3` **故意不在列表里** → pnpm 9 会打印
`The following dependencies have build scripts that were ignored: better-sqlite3` 并安装成功。拉最新代码后重跑 `pnpm install` 即可。

> 不要试图把这份名单写进 `package.json` 的 `pnpm` 字段：pnpm 11 **完全不读**它，
> 而 pnpm 9 实测同样只认 `.npmrc`，写在那里两头都不生效。

**两个附带注意**：

- pnpm 9 会**重写 `pnpm-lock.yaml`**（丢掉 pnpm 11 生成的 peer 后缀，diff 上千行）。
  装完若看到 lockfile 被改，`git checkout -- pnpm-lock.yaml`，不要提交。
- 布局不用担心：`nodeLinker: hoisted` 在 `pnpm-workspace.yaml` 里 pnpm 9 同样不读，
  但 `.npmrc` 有 `node-linker=hoisted` 兜底（这条 pnpm 9 认）。
- 根治办法是统一到仓库声明的 pnpm 11：`corepack enable` 后直接 `pnpm install`。

### 5. Electron 二进制下载慢 / 超时

**处理**：项目 `.npmrc` 已配置 npmmirror 镜像；若仍超时，安装前显式注入环境变量：

```bash
# bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
# PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
```

> 注意：独立子进程（如 `node install.js`）不继承 `.npmrc` 的镜像配置，必须显式带 `ELECTRON_MIRROR` 环境变量。

### 6. 团队 pnpm 版本差异须知

- **pnpm 9**：**只认 `.npmrc`** 的 `only-built-dependencies[]` / `node-linker`，
  完全忽略 `pnpm-workspace.yaml` 里的 pnpm 设置（无任何报错）；
- **pnpm ≥10**：默认拦截构建脚本，依赖 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 白名单，并读 `.npmrc`；
- **pnpm ≥10.26 / 11**：`onlyBuiltDependencies` 被移除，统一改用 `allowBuilds` 映射，且忽略 `package.json` 的 `pnpm` 字段（安装时有 `ignored` 警告，可忽略）。

新增带 install 脚本的依赖时，**`pnpm-workspace.yaml` 的 `allowBuilds` 与 `.npmrc` 的
`only-built-dependencies[]` 两处需同步添加**，否则不同版本的 pnpm 用户会各自踩坑。另外 pnpm 11 默认启用 1 天发布冷却期（`minimumReleaseAge: 1440`），刚发布的依赖装不上时可用 `minimumReleaseAgeExclude` 放行。

