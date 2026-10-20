# Check In

## 开发环境

安装依赖并为 Electron 编译 `better-sqlite3`：

```bash
pnpm electron:setup
```

之后启动开发环境：

```bash
pnpm dev
```

> `better-sqlite3` 自 **13.0** 起改用 Node-API（N-API）预编译二进制，随 npm 包分发、
> 跨 Node / Electron ABI 通用，**不再需要 `pnpm electron:rebuild` 这一步**。
> 若原生模块加载失败（`Could not locate the bindings file` 等），执行 `pnpm install`
> 重装即可，它会重新解压 `node_modules/better-sqlite3/prebuilds/`。

## 常见异常排查

### 1. 启动即崩：`electron.app` / `ipcMain` 为 undefined

**现象**：主进程一加载就崩，日志里 `process.type` 为 `undefined`，`require('electron')` 返回的是路径字符串而非 API。

**原因**：终端环境注入了 `ELECTRON_RUN_AS_NODE=1`，Electron 以 Node.js 兼容模式启动（部分集成终端会注入该变量）。

**处理**：`scripts/start-electron.js` 已在 spawn 前自动剔除该变量，正常走 `pnpm dev` 即可；若手动启动 Electron，先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。

### 2. 报错「Electron 二进制缺失」或 `node_modules/electron/dist` 不存在

**现象**：`pnpm dev` 报 Electron 可执行文件不存在。

**原因**：pnpm ≥10 默认拦截依赖的构建脚本，electron 的 postinstall（下载运行时二进制）没有执行。pnpm 11 还**不再读取** `package.json` 的 `pnpm` 字段，只认 `pnpm-workspace.yaml`。

**处理**：

1. 确认 `pnpm-workspace.yaml` 的 `allowBuilds` 里 `electron: true`、`esbuild: true`、
   **`better-sqlite3: false`**（13.x 用包内预编译，本地编译必失败，见「4. pnpm 9 装不上」）；
   pnpm 9/10 走 `package.json` 的 `pnpm.onlyBuiltDependencies`，**两处都要维护，别只改一边**；
2. 改完后普通 `pnpm install` 可能因 "Already up to date" 跳过构建脚本，用以下方式强制补齐：

```bash
# 方式一：强制重建
pnpm rebuild electron

# 方式二（rebuild 无效时）：直接执行安装脚本，国内可命中镜像缓存
# PowerShell:
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules\electron\install.js
```

3. 验证：`node_modules/electron/dist/electron.exe` 与 `node_modules/electron/path.txt` 必须同时存在。

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

**处理**：仓库已在 `package.json` 里补了 pnpm 9 认的那一份：

```json
"pnpm": { "onlyBuiltDependencies": ["@parcel/watcher", "electron-winstaller", "electron", "esbuild"] }
```

`better-sqlite3` **故意不在列表里** → pnpm 9 会打印
`The following dependencies have build scripts that were ignored: better-sqlite3` 并安装成功。拉最新代码后重跑 `pnpm install` 即可。

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

### 5. 团队 pnpm 版本差异须知

- **pnpm 9**：读取 `package.json` 的 `pnpm` 字段，默认执行构建脚本，装完即用；
- **pnpm ≥10**：默认拦截构建脚本，依赖 `pnpm-workspace.yaml` 白名单；
- **pnpm ≥10.26 / 11**：`onlyBuiltDependencies` 被移除，统一改用 `allowBuilds` 映射，且忽略 `package.json` 的 `pnpm` 字段（安装时有 `ignored` 警告，可忽略）。

新增带 install 脚本的依赖时，`allowBuilds` 与 `pnpm.onlyBuiltDependencies` **两处需同步添加**，否则不同版本的 pnpm 用户会各自踩坑。另外 pnpm 11 默认启用 1 天发布冷却期（`minimumReleaseAge: 1440`），刚发布的依赖装不上时可用 `minimumReleaseAgeExclude` 放行。

