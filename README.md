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

如果出现 `NODE_MODULE_VERSION` 不匹配，单独重新编译原生模块：

```bash
pnpm electron:rebuild
```

## 常见异常排查

### 1. 启动即崩：`electron.app` / `ipcMain` 为 undefined

**现象**：主进程一加载就崩，日志里 `process.type` 为 `undefined`，`require('electron')` 返回的是路径字符串而非 API。

**原因**：终端环境注入了 `ELECTRON_RUN_AS_NODE=1`，Electron 以 Node.js 兼容模式启动（部分集成终端会注入该变量）。

**处理**：`scripts/start-electron.js` 已在 spawn 前自动剔除该变量，正常走 `pnpm dev` 即可；若手动启动 Electron，先 `unset ELECTRON_RUN_AS_NODE`（PowerShell：`Remove-Item Env:ELECTRON_RUN_AS_NODE`）。

### 2. 报错「Electron 二进制缺失」或 `node_modules/electron/dist` 不存在

**现象**：`pnpm dev` 报 Electron 可执行文件不存在。

**原因**：pnpm ≥10 默认拦截依赖的构建脚本，electron 的 postinstall（下载运行时二进制）没有执行。pnpm 11 还**不再读取** `package.json` 的 `pnpm` 字段，只认 `pnpm-workspace.yaml`。

**处理**：

1. 确认 `pnpm-workspace.yaml` 的 `allowBuilds` 白名单包含 `electron`、`better-sqlite3`、`esbuild`（pnpm 9/10 走 `package.json` 的 `pnpm.onlyBuiltDependencies`，两处都别漏）；
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

### 3. 数据库报错 / `NODE_MODULE_VERSION` 不匹配

**原因**：`better-sqlite3` 是按 Node ABI 编译的，与 Electron 的 ABI 不一致。

**处理**：

```bash
pnpm electron:rebuild
```

### 4. Electron 二进制下载慢 / 超时

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

